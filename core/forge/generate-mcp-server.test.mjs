import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { createArtifactRequest } from "./contract.mjs";
import { generateMcpServer } from "./generate-mcp-server.mjs";

async function tempDir() {
  return mkdtemp(join(tmpdir(), "forge-mcp-server-"));
}

const BASE = {
  goal: "expor uma ferramenta de soma",
  kind: "mcp-server",
  inputs: { a: "primeiro numero", b: "segundo numero" },
  outputs: { soma: "resultado da soma" },
  permissions: [],
  forbidden: ["acessar rede"],
  tests: [{ name: "smoke", command: 'node -e "process.exit(0)"' }],
};

test("mcp-server: gera server.mjs, node --check passa e verify responde", async () => {
  const out = await tempDir();
  try {
    const req = createArtifactRequest(BASE);
    const res = await generateMcpServer(req, out);
    assert.deepEqual(res.files, ["server.mjs", "README.md", "verify.mjs"]);

    const chk = spawnSync(process.execPath, ["--check", join(out, "server.mjs")], { encoding: "utf8" });
    assert.equal(chk.status, 0, "server.mjs deve passar no node --check");

    const v = spawnSync(res.verifyCommand, { shell: true, encoding: "utf8", cwd: out });
    assert.equal(v.status, 0, v.stderr);
    assert.match(v.stdout, /PASS MCP server: initialize \+ tools\/list/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("mcp-server: initialize + tools/list respondem JSON-RPC válido", async () => {
  const out = await tempDir();
  try {
    const req = createArtifactRequest(BASE);
    await generateMcpServer(req, out);
    const init = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const list = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const r = spawnSync(process.execPath, [join(out, "server.mjs")], {
      input: init + "\n" + list + "\n", encoding: "utf8", cwd: out,
    });
    assert.equal(r.status, 0);
    const msgs = r.stdout.trim().split("\n").map((l) => JSON.parse(l));
    const i = msgs.find((m) => m.id === 1);
    const l = msgs.find((m) => m.id === 2);
    assert.ok(i.result.protocolVersion);
    assert.equal(l.result.tools.length, 2); // a, b
    assert.deepEqual(l.result.tools.map((t) => t.name).sort(), ["a", "b"]);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("mcp-server: recusa sobrescrever e kind errado", async () => {
  const out = await tempDir();
  try {
    const req = createArtifactRequest(BASE);
    await generateMcpServer(req, out);
    await assert.rejects(generateMcpServer(req, out), /já existe server\.mjs/);
    const bad = createArtifactRequest({ ...BASE, kind: "skill" });
    await assert.rejects(generateMcpServer(bad, join(out, "x")), /kind deve ser "mcp-server"/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});