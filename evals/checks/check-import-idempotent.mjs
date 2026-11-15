#!/usr/bin/env node
/**
 * Grupo B — o importador precisa ser idempotente.
 *
 * Roda `node scripts/import-providers.mjs` (dry-run, sem --apply) duas vezes e
 * exige que a saida seja byte a byte identica. Qualquer diferenca indica
 * nao-determinismo (ordem instavel, timestamp, fingerprint variavel).
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const script = path.join(ROOT, "scripts", "import-providers.mjs");

function run() {
  return execFileSync(process.execPath, [script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 20000,
  });
}

let a;
let b;
try {
  a = run();
  b = run();
} catch (err) {
  const detail = err.stderr ? String(err.stderr).trim().split("\n")[0] : err.message;
  console.error(`importador falhou ao rodar: ${detail}`);
  process.exit(1);
}

if (a !== b) {
  console.error("importador nao e idempotente: as duas execucoes dry-run diferem");
  const la = a.split("\n");
  const lb = b.split("\n");
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) {
      console.error(`  primeira diferenca na linha ${i + 1}:`);
      console.error(`    1a execucao: ${JSON.stringify(la[i] ?? null)}`);
      console.error(`    2a execucao: ${JSON.stringify(lb[i] ?? null)}`);
      break;
    }
  }
  process.exit(1);
}

const lines = a.split("\n").length;
console.log(JSON.stringify({ tokens: 0, metrics: { runs: 2, identical: true, bytes: Buffer.byteLength(a), lines } }));