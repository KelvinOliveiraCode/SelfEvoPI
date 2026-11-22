#!/usr/bin/env node
/**
 * Grupo C (regressao) — a documentação interna mínima precisa existir.
 *
 * Confere a presença dos documentos que outros checks, scripts e a-onboarding
 * citam. Não valida conteúdo, apenas existência (e que não é diretório).
 */
import { stat } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

const REQUIRED = [
  "README.md",
  "docs/research/inspiracoes.md",
  "docs/research/backlog-fase1.md",
  "docs/research/alternativas-windows.md",
  "docs/fase0/router.md",
  "docs/fase0/evals.md",
];

const missing = [];

for (const rel of REQUIRED) {
  try {
    const info = await stat(path.join(ROOT, rel));
    if (!info.isFile()) missing.push(`${rel} (não é arquivo)`);
  } catch {
    missing.push(rel);
  }
}

if (missing.length > 0) {
  console.error("documentos internos ausentes:");
  for (const m of missing) console.error("  - " + m);
  process.exit(1);
}

console.log(
  JSON.stringify({ tokens: 0, metrics: { docs: REQUIRED.length, missing: 0 } })
);
console.error(`ok: ${REQUIRED.length} documentos internos presentes`);