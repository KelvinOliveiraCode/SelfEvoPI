import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { createArtifactRequest } from "./contract.mjs";
import { generateMcpConfig } from "./generate-mcp-config.mjs";

async function tempDir() {
  return mkdtemp(join(tmpdir(), "forge-mcp-config-"));
}

const BASE = {
  goal: "configurar servidor MCP",
  kind: "mcp-config",
  inputs: {},
  outputs: {},
  permissions: [],
  forbidden: ["acessar rede"],
  tests: [{ name: "smoke", command: 'node -e "process.exit(0)"' }],
};

test("mcp-config: gera .mcp.json válido e verify passa", async () => {
  const out = await tempDir();
  try {
    const req = createArtifactRequest(BASE);
    const res = await generateMcpConfig(req, out);
    assert.deepEqual(res.files, [".mcp.json", "verify.mjs"]);

    const raw = await readFile(join(out, ".mcp.json"), "utf8");
    const doc = JSON.parse(raw); // precisa ser JSON válido
    assert.ok(doc.mcpServers && typeof doc.mcpServers === "object");
    const name = Object.keys(doc.mcpServers)[0];
    assert.equal(doc.mcpServers[name].command, "node");
    assert.deepEqual(doc.mcpServers[name].args, ["server.mjs"]);
    assert.deepEqual(doc.mcpServers[name].env, {});

    const v = spawnSync(res.verifyCommand, { shell: true, encoding: "utf8", cwd: out });
    assert.equal(v.status, 0, v.stderr);
    assert.match(v.stdout, /PASS \.mcp\.json/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("mcp-config: recusa sobrescrever .mcp.json existente", async () => {
  const out = await tempDir();
  try {
    const req = createArtifactRequest(BASE);
    await generateMcpConfig(req, out);
    await assert.rejects(generateMcpConfig(req, out), /já existe \.mcp\.json/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("mcp-config: recusa kind errado", async () => {
  const out = await tempDir();
  try {
    const req = createArtifactRequest({ ...BASE, kind: "cli" });
    await assert.rejects(generateMcpConfig(req, out), /kind deve ser "mcp-config"/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});