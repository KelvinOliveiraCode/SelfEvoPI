import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = "C:/Users/Kelvin/Desktop/SelfEvoPI";

const SERVIDOR_FALSO = `
let buf = "";
const tools = [
  { name: "soma", description: "soma dois numeros", inputSchema: { type: "object" } },
  { name: "eco", description: "ecoa texto", inputSchema: { type: "object" } },
];
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\\n")) >= 0) {
    const linha = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!linha) continue;
    const msg = JSON.parse(linha);
    if (msg.id == null) continue;
    let result;
    if (msg.method === "initialize") result = { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "falso", version: "1" } };
    else if (msg.method === "tools/list") result = { tools };
    else if (msg.method === "tools/call") {
      const a = msg.params.arguments || {};
      const texto = msg.params.name === "soma" ? String(Number(a.a) + Number(a.b)) : String(a.texto || "").toUpperCase();
      result = { content: [{ type: "text", text: texto }] };
    } else result = {};
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\\n");
  }
});
`;

function cliente(programa, args, env = {}) {
  const proc = spawn(programa, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buf = "";
  let seq = 0;
  const pendentes = new Map();
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const linha = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!linha) continue;
      const msg = JSON.parse(linha);
      if (msg.id != null && pendentes.has(msg.id)) {
        const { resolve, timer } = pendentes.get(msg.id);
        clearTimeout(timer);
        pendentes.delete(msg.id);
        resolve(msg);
      }
    }
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pendentes.delete(id); reject(new Error("timeout " + method)); }, 8000);
    pendentes.set(id, { resolve, timer });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const notify = (method, params = {}) => proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  const close = () => { try { proc.stdin.end(); } catch {} try { proc.kill(); } catch {} };
  return { request, notify, close };
}

test("gateway MCP expõe run_code e encadeia tools locais sem nomes no código", { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "se-code-mode-"));
  const servidor = join(dir, "fake-server.mjs");
  const config = join(dir, "settings.json");
  writeFileSync(servidor, SERVIDOR_FALSO, "utf8");
  writeFileSync(config, JSON.stringify({
    mcpServers: {
      "servidor-teste": { command: process.execPath, args: [servidor] },
      "selfevopi-code-mode": { command: "node", args: ["nao-deve-conectar"] },
    },
  }), "utf8");

  const gw = cliente(process.execPath, [join(ROOT, "scripts", "code-mode-mcp.mjs")], {
    SELFEOPI_CODE_MODE_CONFIG: config,
    SELFEOPI_CODE_MODE_SERVERS: "servidor-teste",
  });
  try {
    const init = await gw.request("initialize", { protocolVersion: "2024-11-05", capabilities: {} });
    assert.equal(init.result.serverInfo.name, "selfevopi-code-mode");
    gw.notify("notifications/initialized", {});

    const lista = await gw.request("tools/list", {});
    assert.deepEqual(lista.result.tools.map((t) => t.name), ["run_code"]);

    const chamada = await gw.request("tools/call", {
      name: "run_code",
      arguments: {
        code: "const a = await tools.call('servidor-teste.soma', {a:2,b:3}); return await tools.call('servidor-teste.eco', {texto:'total '+a.text});",
      },
    });
    const texto = chamada.result.content[0].text;
    const r = JSON.parse(texto);
    assert.equal(r.ok, true, texto);
    assert.equal(r.calls, 2);
    assert.equal(r.value.text, "TOTAL 5");
    assert.equal(r.servers, 1);
    assert.equal(chamada.result.isError, false);
  } finally {
    gw.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
