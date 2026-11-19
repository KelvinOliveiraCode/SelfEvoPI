#!/usr/bin/env node
/**
 * Grupo C (regressao) — o .gitignore nunca pode parar de bloquear segredos.
 * Se alguem remover uma regra, este teste quebra antes de um commit vazar chave.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const ignore = await readFile(path.join(ROOT, ".gitignore"), "utf8");

const required = [
  ".env",
  "*.key",
  "credentials.json",
  "providers.local.json",
  ".pi/agent/",
  "node_modules/",
  ".worktrees/",
];

const missing = required.filter((rule) => !ignore.includes(rule));
if (missing.length > 0) {
  console.error("regras ausentes no .gitignore: " + missing.join(", "));
  process.exit(1);
}

// nenhum arquivo real com segredo pode estar sendo rastreado
const { execFileSync } = await import("node:child_process");
let tracked = "";
try {
  tracked = execFileSync("git", ["-C", ROOT, "ls-files"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
} catch {
  process.exit(0); // sem git: nao ha o que vazar
}

const dangerous = tracked
  .split("\n")
  .filter((f) => /\.(key|pem|p12|pfx)$|(^|\/)\.env($|\.)|credentials\.json$|models\.json$/.test(f.trim()));

if (dangerous.length > 0) {
  console.error("arquivos sensiveis versionados: " + dangerous.join(", "));
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { rules: required.length, trackedFiles: tracked.split("\n").length } }));
console.error("ok: .gitignore cobre todos os padroes obrigatorios");