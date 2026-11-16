#!/usr/bin/env node
/**
 * verify.mjs — confere que o .mcp.json e um JSON valido com o servidor esperado.
 */
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const NOME = "configurar-um-servidor-mcp";

const raw = await readFile(AQUI + "/.mcp.json", "utf8");
let doc = null;
try {
  doc = JSON.parse(raw);
} catch (e) {
  console.error("FAIL .mcp.json nao e JSON valido: " + e.message);
  process.exit(1);
}

const servers = doc && doc.mcpServers;
if (!servers || typeof servers !== "object") {
  console.error("FAIL falta mcpServers");
  process.exit(1);
}
const entry = servers[NOME];
if (!entry) {
  console.error("FAIL falta o servidor " + NOME);
  process.exit(1);
}
if (typeof entry.command !== "string" || entry.command === "") {
  console.error("FAIL command ausente");
  process.exit(1);
}
if (!Array.isArray(entry.args)) {
  console.error("FAIL args deve ser array");
  process.exit(1);
}
if (!entry.env || typeof entry.env !== 'object') {
  console.error("FAIL env deve ser objeto");
  process.exit(1);
}
console.log("PASS .mcp.json: " + NOME + " (" + entry.command + " " + entry.args.join(" ") + ")");
