import test from "node:test";
import assert from "node:assert/strict";

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  STATUS,
  stripJsonc,
  stripTrailingCommas,
  findOpencodeConfig,
  listOpencodeMcp,
  normalizeOpencodeServer,
  probeOpencodeMcp,
} from "./mcp-probe.mjs";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const homes = [];

async function novoHome() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "selfevopi-mcp-"));
  homes.push(dir);
  return dir;
}

async function escreverConfig(home, body, nome = "settings.json") {
  const dir = path.join(home, ".pi");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, nome);
  await writeFile(file, body, "utf8");
  return file;
}

/** Servidor MCP de mentira: responde initialize e tools/list. */
const SERVIDOR_FAKE = `
import { appendFileSync } from "node:fs";
appendFileSync(process.env.MARKER, String(process.pid));
process.stdin.setEncoding("utf8");
let buf = "";
process.stdin.on("data", (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const linha = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!linha) continue;
    const msg = JSON.parse(linha);
    if (msg.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        protocolVersion: "2024-11-05", capabilities: {},
        serverInfo: { name: "fake", version: "1.0.0" } } }) + "\\n");
    }
    if (msg.method === "tools/list") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        tools: [{ name: "ping" }, { name: "echo" }] } }) + "\\n");
    }
  }
});
setInterval(() => {}, 1000);
`;

/** Servidor que existe e nunca responde: prova o timeout curto. */
const SERVIDOR_MUDO = `setInterval(() => {}, 1000);`;

function vivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

test.after(async () => {
  for (const dir of homes) await rm(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/* stripJsonc                                                          */
/* ------------------------------------------------------------------ */

test("stripJsonc remove comentario de linha e de bloco", () => {
  const src = [
    "{",
    "  // um comentario",
    '  "a": 1, /* outro */',
    '  "b": 2',
    "}",
  ].join("\n");

  const { text } = stripJsonc(src);
  assert.ok(!text.includes("um comentario"));
  assert.ok(!text.includes("outro"));
  assert.deepEqual(JSON.parse(text), { a: 1, b: 2 });
});

test("stripJsonc nao confunde // de URL com comentario", () => {
  const src = `{ "url": "https://exemplo.local/x", "n": 1 }`;
  const { text } = stripJsonc(src);
  assert.deepEqual(JSON.parse(text), { url: "https://exemplo.local/x", n: 1 });
});

test("stripJsonc respeita escape dentro de string", () => {
  const src = String.raw`{ "a": "ele disse \"oi\"", "b": "// nao comentario" }`;
  const { text } = stripJsonc(src);
  assert.deepEqual(JSON.parse(text), { a: 'ele disse "oi"', b: "// nao comentario" });
});

test("stripJsonc acusa a linha da string que nao fecha", () => {
  const src = ['{', '  "a": "abc', "}"].join("\n");
  assert.throws(() => stripJsonc(src), /string não fechada \(linha 2\)/);
});

test("stripJsonc acusa a linha do comentario de bloco que nao fecha", () => {
  const src = ['{', "  /* comecou aqui", '  "a": 1', "}"].join("\n");
  assert.throws(() => stripJsonc(src), /comentário de bloco não fechado \(linha 2\)/);
});

/* ------------------------------------------------------------------ */
/* stripTrailingCommas                                                 */
/* ------------------------------------------------------------------ */

test("stripTrailingCommas tira a virgula que sobra", () => {
  const src = `{ "a": [1, 2,], "b": { "c": 1, }, }`;
  assert.deepEqual(JSON.parse(stripTrailingCommas(src)), { a: [1, 2], b: { c: 1 } });
});

test("stripTrailingCommas nao mexe em virgula dentro de string", () => {
  const src = `{ "a": "x,}y" }`;
  assert.deepEqual(JSON.parse(stripTrailingCommas(src)), { a: "x,}y" });
});

/* ------------------------------------------------------------------ */
/* findOpencodeConfig                                                  */
/* ------------------------------------------------------------------ */

test("findOpencodeConfig acha o settings.json no home injetado", async () => {
  const home = await novoHome();
  const file = await escreverConfig(home, "{}");
  assert.equal(await findOpencodeConfig({ home }), file);
});

test("findOpencodeConfig devolve null quando nao existe nada", async () => {
  const home = await novoHome();
  assert.equal(await findOpencodeConfig({ home }), null);
});

test("findOpencodeConfig respeita configPath explicito", async () => {
  const home = await novoHome();
  assert.equal(await findOpencodeConfig({ home, configPath: path.join(home, "nada.json") }), null);
});

/* ------------------------------------------------------------------ */
/* listOpencodeMcp                                                     */
/* ------------------------------------------------------------------ */

test("listOpencodeMcp le JSONC com comentario e virgula sobrando (mcpServers)", async () => {
  const home = await novoHome();
  const node = process.execPath;

  await escreverConfig(
    home,
    [
      "{",
      "  // config do usuario",
      '  "mcpServers": {',
      "    /* servidores */",
      '      "fake": {',
      '        "type": "local",',
      `        "command": [${JSON.stringify(node)}, "server.mjs"],`,
      '        "cwd": ".",',
      '        "environment": { "PYTHONUTF8": "1" },',
      '        "timeout": { "startup": 60000, "catalog": 120000 },',
      "      },",
      "  },",
      "}",
    ].join("\n")
  );

  const lista = await listOpencodeMcp({ home });
  assert.equal(lista.length, 1);

  const s = lista[0];
  assert.equal(s.name, "fake");
  assert.equal(s.type, "local");
  assert.equal(s.command, node);
  assert.deepEqual(s.args, ["server.mjs"]);
  assert.equal(s.cwd, ".");
  assert.deepEqual(s.environment, { PYTHONUTF8: "1" });
  assert.deepEqual(s.timeout, { startup: 60000, catalog: 120000 });
  assert.equal(s.status, STATUS.CONFIGURED);
  assert.deepEqual(Object.keys(s).sort(), [
    "args",
    "command",
    "cwd",
    "environment",
    "name",
    "status",
    "timeout",
    "type",
  ]);
});

test("listOpencodeMcp aceita formato legado mcp.servers (compatibilidade)", async () => {
  const home = await novoHome();
  const node = process.execPath;

  await escreverConfig(
    home,
    JSON.stringify({
      mcp: {
        servers: {
          fake: {
            type: "local",
            command: [node, "server.mjs"],
          },
        },
      },
    })
  );

  const lista = await listOpencodeMcp({ home });
  assert.equal(lista.length, 1);
  assert.equal(lista[0].name, "fake");
  assert.equal(lista[0].status, STATUS.CONFIGURED);
});

test("listOpencodeMcp classifica disabled, broken e type desconhecido", async () => {
  const home = await novoHome();
  const node = process.execPath;

  await escreverConfig(
    home,
    JSON.stringify({
      mcpServers: {
        desligado: { type: "local", command: [node, "a.mjs"], disabled: true },
        semArquivo: { type: "local", command: ["C:/nao/existe/xyz.exe"] },
        semComando: { type: "local" },
        alienigena: { type: "telepata", command: [node, "a.mjs"] },
      },
    })
  );

  const mapa = Object.fromEntries((await listOpencodeMcp({ home })).map((s) => [s.name, s.status]));
  assert.equal(mapa.desligado, STATUS.DISABLED);
  assert.equal(mapa.semArquivo, STATUS.BROKEN);
  assert.equal(mapa.semComando, STATUS.BROKEN);
  assert.equal(mapa.alienigena, STATUS.BROKEN);
});

test("listOpencodeMcp devolve lista vazia quando nao ha arquivo", async () => {
  const home = await novoHome();
  assert.deepEqual(await listOpencodeMcp({ home }), []);
});

test("listOpencodeMcp acusa a linha quando o JSON e invalido", async () => {
  const home = await novoHome();
  await escreverConfig(home, ['{', '  "mcpServers": {', "    oops", "  }", "}"].join("\n"));

  await assert.rejects(() => listOpencodeMcp({ home }), (err) => {
    assert.match(err.message, /inválida/);
    assert.match(err.message, /linha \d+/);
    return true;
  });
});

/* ------------------------------------------------------------------ */
/* normalizeOpencodeServer                                             */
/* ------------------------------------------------------------------ */

test("normalizeOpencodeServer aceita command string e array", () => {
  const a = normalizeOpencodeServer("x", { type: "local", command: "node", args: ["a.mjs"] });
  assert.equal(a.command, "node");
  assert.deepEqual(a.args, ["a.mjs"]);

  const b = normalizeOpencodeServer("y", { type: "local", command: ["node", "a.mjs", "--x"] });
  assert.equal(b.command, "node");
  assert.deepEqual(b.args, ["a.mjs", "--x"]);

  const c = normalizeOpencodeServer("z", { type: "local" });
  assert.equal(c.command, null);
  assert.deepEqual(c.args, []);
});

/* ------------------------------------------------------------------ */
/* probeOpencodeMcp                                                    */
/* ------------------------------------------------------------------ */

test("probeOpencodeMcp diz que nao conhece o servidor, sem lancar", async () => {
  const home = await novoHome();
  const r = await probeOpencodeMcp({ name: "nada", home });
  assert.equal(r.ok, false);
  assert.deepEqual(r.tools, []);
  assert.match(r.error, /não está na configuração/);
});

test("probeOpencodeMcp recusa servidor quebrado sem abrir processo", async () => {
  const home = await novoHome();
  await escreverConfig(
    home,
    JSON.stringify({ mcpServers: { morto: { type: "local", command: ["C:/nao/existe/x.exe"] } } })
  );

  const r = await probeOpencodeMcp({ name: "morto", home });
  assert.equal(r.ok, false);
  assert.match(r.error, /comando executável/);
});

test("probeOpencodeMcp faz o handshake e devolve as ferramentas", async () => {
  const home = await novoHome();
  const dir = path.join(home, "srv");
  await mkdir(dir, { recursive: true });

  const script = path.join(dir, "fake.mjs");
  await writeFile(script, SERVIDOR_FAKE, "utf8");
  const marker = path.join(dir, "pid.txt");

  await escreverConfig(
    home,
    JSON.stringify({
      mcpServers: { fake: { type: "local", command: [process.execPath, script], environment: { MARKER: marker } } },
    })
  );

  const r = await probeOpencodeMcp({ name: "fake", home, timeoutMs: 5_000 });

  assert.equal(r.ok, true, `ok deveria ser true, erro=${r.error}`);
  assert.deepEqual(r.tools, ["ping", "echo"]);
  assert.equal(r.error, null);

  // o filho tem de estar morto depois do probe
  assert.ok(existsSync(marker), "o servidor deveria ter registrado o proprio pid");
  const pid = Number(readFileSync(marker, "utf8").trim());
  assert.ok(pid > 0, "pid registrado");
  assert.equal(vivo(pid), false, `o pid ${pid} continua vivo depois do probe`);
});

test("probeOpencodeMcp devolve ok:false quando o servidor nao responde", async () => {
  const home = await novoHome();
  const dir = path.join(home, "srv");
  await mkdir(dir, { recursive: true });

  const script = path.join(dir, "mudo.mjs");
  await writeFile(script, SERVIDOR_MUDO, "utf8");

  await escreverConfig(
    home,
    JSON.stringify({ mcpServers: { mudo: { type: "local", command: [process.execPath, script] } } })
  );

  const inicio = Date.now();
  const r = await probeOpencodeMcp({ name: "mudo", home, timeoutMs: 800 });
  const levou = Date.now() - inicio;

  assert.equal(r.ok, false);
  assert.match(r.error, /não respondeu/);
  assert.ok(levou < 5_000, `o probe deveria desistir cedo, levou ${levou} ms`);
});

test("probeOpencodeMcp devolve ok:false para servidor remoto", async () => {
  const home = await novoHome();
  await escreverConfig(
    home,
    JSON.stringify({ mcpServers: { remoto: { type: "remote", url: "https://exemplo.invalid/mcp" } } })
  );

  const r = await probeOpencodeMcp({ name: "remoto", home });
  assert.equal(r.ok, false);
  assert.match(r.error, /remoto/);
});

/* ------------------------------------------------------------------ */
/* A10: tools/list em múltiplos chunks sem \n entre eles               */
/* ------------------------------------------------------------------ */

/**
 * Servidor que manda tools/list em múltiplos chunks stdout SEM \n entre
 * eles (só \n no final do último chunk). Reproduz o comportamento dos
 * *-cli.exe (lightcraft/pdfcraft/soundcraft) que fazia o probeOpencodeMcp
 * retornar tools=0.
 */
const SERVIDOR_CHUNKS = `
import { appendFileSync } from "node:fs";
appendFileSync(process.env.MARKER, String(process.pid));
process.stdin.setEncoding("utf8");
let buf = "";
process.stdin.on("data", (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const linha = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!linha) continue;
    const msg = JSON.parse(linha);
    if (msg.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        protocolVersion: "2024-11-05", capabilities: {},
        serverInfo: { name: "chunks", version: "1.0.0" } } }) + "\\n");
    }
    if (msg.method === "tools/list") {
      // Monta a resposta completa e manda em pedaços SEM newline entre eles.
      const resposta = JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        tools: [
          { name: "tool_a", description: "Ferramenta A" },
          { name: "tool_b", description: "Ferramenta B" },
          { name: "tool_c", description: "Ferramenta C" },
        ],
      } });
      // Divide em 3 pedaços, sem newline entre eles.
      const meio = Math.floor(resposta.length / 3);
      process.stdout.write(resposta.slice(0, meio));
      setTimeout(() => {
        process.stdout.write(resposta.slice(meio, meio * 2));
        setTimeout(() => {
          process.stdout.write(resposta.slice(meio * 2) + "\\n");
        }, 10);
      }, 10);
    }
  }
});
setInterval(() => {}, 1000);
`;

/**
 * Servidor que manda uma linha de log no meio do stream stdout, entre
 * initialize e tools/list. Verifica que o parser não quebra.
 */
const SERVIDOR_LOG = `
import { appendFileSync } from "node:fs";
appendFileSync(process.env.MARKER, String(process.pid));
process.stdin.setEncoding("utf8");
let buf = "";
process.stdin.on("data", (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const linha = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!linha) continue;
    const msg = JSON.parse(linha);
    if (msg.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        protocolVersion: "2024-11-05", capabilities: {},
        serverInfo: { name: "log", version: "1.0.0" } } }) + "\\n");
    }
    if (msg.method === "tools/list") {
      // Manda uma linha de log no meio do stream, depois a resposta JSON.
      process.stdout.write("INFO: servidor iniciado\\n");
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        tools: [{ name: "ping" }],
      } }) + "\\n");
    }
  }
});
setInterval(() => {}, 1000);
`;

test("probeOpencodeMcp: tools/list em múltiplos chunks sem \\n entre eles", async () => {
  const home = await novoHome();
  const dir = path.join(home, "srv");
  await mkdir(dir, { recursive: true });

  const script = path.join(dir, "chunks.mjs");
  await writeFile(script, SERVIDOR_CHUNKS, "utf8");
  const marker = path.join(dir, "pid.txt");

  await escreverConfig(
    home,
    JSON.stringify({
      mcpServers: { chunks: { type: "local", command: [process.execPath, script], environment: { MARKER: marker } } },
    })
  );

  const r = await probeOpencodeMcp({ name: "chunks", home, timeoutMs: 5_000 });

  assert.equal(r.ok, true, `ok deveria ser true, erro=${r.error}`);
  assert.deepEqual(r.tools, ["tool_a", "tool_b", "tool_c"],
    `catálogo deveria vir completo: ${JSON.stringify(r.tools)}`);
  assert.equal(r.error, null);
});

test("probeOpencodeMcp: linha de log no meio do stream não quebra o parse", async () => {
  const home = await novoHome();
  const dir = path.join(home, "srv");
  await mkdir(dir, { recursive: true });

  const script = path.join(dir, "log.mjs");
  await writeFile(script, SERVIDOR_LOG, "utf8");
  const marker = path.join(dir, "pid.txt");

  await escreverConfig(
    home,
    JSON.stringify({
      mcpServers: { log: { type: "local", command: [process.execPath, script], environment: { MARKER: marker } } },
    })
  );

  const r = await probeOpencodeMcp({ name: "log", home, timeoutMs: 5_000 });

  assert.equal(r.ok, true, `ok deveria ser true, erro=${r.error}`);
  assert.deepEqual(r.tools, ["ping"],
    `catálogo deveria vir mesmo com log no meio: ${JSON.stringify(r.tools)}`);
  assert.equal(r.error, null);
});