#!/usr/bin/env node
/**
 * Grupo D (modelo real) — verifica a correção do bug em contador.mjs.
 *
 * Executa o módulo: não confia na descrição do modelo, testa o comportamento.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const workdir = process.env.EVAL_WORKDIR;
if (!workdir) {
  console.error("EVAL_WORKDIR ausente");
  process.exit(1);
}

let mod;
try {
  mod = await import(pathToFileURL(path.join(workdir, "contador.mjs")).href);
} catch (err) {
  console.error(`não foi possível importar contador.mjs: ${err.message}`);
  process.exit(1);
}

const problems = [];
if (typeof mod.proximo !== "function") {
  problems.push("exportação 'proximo' ausente ou não é função");
} else {
  for (const [input, want] of [
    [0, 1],
    [1, 2],
    [41, 42],
    [-1, 0],
    [-5, -4],
  ]) {
    let got;
    try {
      got = mod.proximo(input);
    } catch (err) {
      problems.push(`proximo(${input}) lançou: ${err.message}`);
      continue;
    }
    if (got === want) continue;
    problems.push(`proximo(${input}) = ${got}, esperado ${want}`);
  }
}

if (problems.length > 0) {
  console.error("contador.mjs ainda incorreto:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { casos: 5 } }));
console.error("ok: proximo(n) devolve n + 1 nos 5 casos");