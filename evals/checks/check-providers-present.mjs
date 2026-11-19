#!/usr/bin/env node
/**
 * Grupo B (lacunas de ferramenta) — os 8 providers precisam existir, com baseUrl
 * e ao menos um modelo. Nao imprime chaves; verifica apenas a presenca.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const TARGETS = ["kilo1", "kilo2", "kilo3", "kilo4", "or1", "or2", "or3", "or4"];
const file = process.env.EVAL_MODELS_JSON || path.join(os.homedir(), ".pi", "agent", "models.json");

let doc;
try {
  doc = JSON.parse(await readFile(file, "utf8"));
} catch (err) {
  console.error(`models.json inacessivel (${file}): ${err.message}`);
  console.error("gere com: node scripts/import-providers.mjs --apply");
  process.exit(1);
}

const problems = [];
let totalModels = 0;

for (const id of TARGETS) {
  const p = doc.providers?.[id];
  if (!p) {
    problems.push(`provider ausente: ${id}`);
    continue;
  }
  if (!p.baseUrl) problems.push(`${id} sem baseUrl`);
  const n = Array.isArray(p.models) ? p.models.length : 0;
  totalModels += n;
  if (n === 0) problems.push(`${id} sem modelos`);
  if (!p.apiKey) problems.push(`${id} sem apiKey`);
}

if (problems.length > 0) {
  console.error("problemas:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { providers: TARGETS.length, models: totalModels } }));
console.error(`ok: ${TARGETS.length} provedores, ${totalModels} modelos`);