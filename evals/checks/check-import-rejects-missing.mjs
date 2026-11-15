#!/usr/bin/env node
/**
 * Grupo B — o importador precisa rejeitar uma origem sem os providers do SelfEvoPI.
 *
 * Cria um JSONC minimo (sem kilo1..kilo4 e or1..or4), aponta --source para ele e
 * exige saida com codigo 2 e mensagem de erro. Se sair 0, o importador aceitou
 * uma origem invalida — falha. O arquivo temporario e removido ao final.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const script = path.join(ROOT, "scripts", "import-providers.mjs");

const dir = mkdtempSync(path.join(os.tmpdir(), "selfevopi-import-"));
const source = path.join(dir, "sem-provedores.jsonc");
const out = path.join(dir, "models.json");

const jsonc = `{
  // origem minima: nenhum provedor alvo do SelfEvoPI
  "provider": {
    "exemplo": {
      "options": { "baseURL": "https://exemplo.invalid/v1", "apiKey": "x" },
      "models": { "modelo": {} }
    }
  }
}
`;

let code = 0;
let stderr = "";
try {
  writeFileSync(source, jsonc, "utf8");
  try {
    execFileSync(process.execPath, [script, "--source", source, "--out", out], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 20000,
    });
  } catch (err) {
    code = typeof err.status === "number" ? err.status : 1;
    stderr = err.stderr ? String(err.stderr) : "";
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const problems = [];
if (code === 0) problems.push("importador saiu 0 para origem sem os provedores do SelfEvoPI");
else if (code !== 2) problems.push(`importador saiu ${code}, esperado 2`);
if (stderr.trim().length === 0) problems.push("importador nao emitiu mensagem de erro");

if (problems.length > 0) {
  console.error("rejeicao invalida:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { exitCode: code, rejected: true } }));