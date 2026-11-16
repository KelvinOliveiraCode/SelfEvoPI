#!/usr/bin/env node
/**
 * verify.mjs — sobe o server.mjs, fala initialize + tools/list e confere o JSON.
 */
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const ESPERADO = ["a","b"];
const PRIMEIRO = "a";

function rpc(method, id, params) {
  return JSON.stringify({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
}

const child = spawn(process.execPath, ["server.mjs"], { cwd: AQUI, stdio: ["pipe", "pipe", "pipe"] });

let out = "";
let err = "";
child.stdout.on("data", function (d) { out += d.toString("utf8"); });
child.stderr.on("data", function (d) { err += d.toString("utf8"); });

child.stdin.write(rpc("initialize", 1, {}) + "\n");
child.stdin.write(rpc("tools/list", 2, {}) + "\n");
child.stdin.end();

function linhas(json) {
  return String(json)
    .split("\n")
    .map(function (l) { return l.trim(); })
    .filter(function (l) { return l !== ""; })
    .map(function (l) { try { return JSON.parse(l); } catch (e) { return null; } })
    .filter(function (m) { return m !== null; });
}

child.on("close", function () {
  const msgs = linhas(out);
  const init = msgs.find(function (m) { return m.id === 1 && m.result; });
  const list = msgs.find(function (m) { return m.id === 2 && m.result; });
  let bad = 0;
  if (!init) { console.error("FAIL initialize nao respondeu"); bad++; }
  if (!list || !Array.isArray(list.result.tools)) {
    console.error("FAIL tools/list nao respondeu com tools");
    bad++;
  } else if (PRIMEIRO !== null) {
    const names = list.result.tools.map(function (t) { return t.name; });
    const faltando = ESPERADO.filter(function (n) { return names.indexOf(n) === -1; });
    if (faltando.length > 0) {
      console.error("FAIL faltando ferramentas: " + faltando.join(", "));
      bad++;
    }
  }
  if (bad > 0) {
    if (err.trim()) console.error("  stderr: " + err.trim().split("\n").slice(0, 6).join("\n"));
    process.exit(1);
  }
  console.log("PASS MCP server: initialize + tools/list (" + list.result.tools.length + " ferramenta(s))");
});
