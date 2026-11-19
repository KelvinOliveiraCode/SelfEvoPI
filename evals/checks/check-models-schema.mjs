#!/usr/bin/env node
/**
 * Grupo B — valida o schema de ~/.pi/agent/models.json (o arquivo do PI, nao o do repo).
 *
 * Garante a forma esperada:
 *   - raiz com objeto "providers"
 *   - cada provider com baseUrl string, api string, apiKey string e models array nao vazio
 *   - cada modelo com id string e contextWindow > 0
 *
 * Nunca imprime o valor de apiKey — apenas conta quantos provedores a possuem.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import process from "node:process";

const file = process.env.EVAL_MODELS_JSON || path.join(os.homedir(), ".pi", "agent", "models.json");

let doc;
try {
  doc = JSON.parse(await readFile(file, "utf8"));
} catch (err) {
  console.error(`models.json inacessivel ou invalido (${file}): ${err.message}`);
  console.error("gere com: node scripts/import-providers.mjs --apply");
  process.exit(1);
}

if (!doc || typeof doc !== "object" || !doc.providers || typeof doc.providers !== "object") {
  console.error("raiz sem objeto 'providers'");
  process.exit(1);
}

const problems = [];
const ids = Object.keys(doc.providers);
let totalModels = 0;
let withApiKey = 0;

for (const id of ids) {
  const p = doc.providers[id];
  if (!p || typeof p !== "object") {
    problems.push(`${id}: provider nao e objeto`);
    continue;
  }
  if (typeof p.baseUrl !== "string" || p.baseUrl.length === 0) problems.push(`${id}: baseUrl ausente ou nao-string`);
  if (typeof p.api !== "string" || p.api.length === 0) problems.push(`${id}: api ausente ou nao-string`);
  if (typeof p.apiKey === "string" && p.apiKey.length > 0) withApiKey++;
  else problems.push(`${id}: apiKey ausente ou nao-string`);
  if (!Array.isArray(p.models) || p.models.length === 0) {
    problems.push(`${id}: models vazio ou nao-array`);
    continue;
  }
  for (let i = 0; i < p.models.length; i++) {
    const m = p.models[i];
    const tag = `${id}.models[${i}]`;
    totalModels++;
    if (!m || typeof m !== "object") {
      problems.push(`${tag}: modelo nao e objeto`);
      continue;
    }
    if (typeof m.id !== "string" || m.id.length === 0) problems.push(`${tag}: id ausente ou nao-string`);
    if (typeof m.contextWindow !== "number" || !(m.contextWindow > 0)) problems.push(`${tag}: contextWindow ausente ou <= 0`);
  }
}

if (problems.length > 0) {
  console.error("schema invalido:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { providers: ids.length, models: totalModels, withApiKey } }));