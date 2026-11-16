#!/usr/bin/env node
// Sonda do artefato MCP (gerada pelo Forge).
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));

const mensagens = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
]
  .map((m) => JSON.stringify(m))
  .join("\n");

const r = spawnSync(process.execPath, ["server.mjs"], {
  input: mensagens + "\n",
  cwd: AQUI,
  encoding: "utf8",
  timeout: 20000,
});

const saida = String(r.stdout ?? "");
let ok = r.status === 0;
if (ok && !saida.includes("a")) {
  console.error("  tools/list não devolveu a ferramenta  + JSON.stringify(tool) + ");
  ok = false;
}
if (ok && !saida.includes("jsonrpc")) {
  console.error("  resposta não é JSON-RPC");
  ok = false;
}
process.exit(ok ? 0 : 1);
