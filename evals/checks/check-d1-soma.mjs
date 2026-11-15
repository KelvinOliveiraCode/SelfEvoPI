#!/usr/bin/env node
/**
 * Grupo D (modelo real) — verifica o módulo que o PI deveria ter criado.
 *
 * Importa soma.mjs do workspace da tarefa e cobre casos normais, negativos e zero.
 * Não confia na aparência do arquivo: executa o código.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const workdir = process.env.EVAL_WORKDIR;
if (!workdir) {
  console.error("EVAL_WORKDIR ausente");
  process.exit(1);
}

const target = path.join(workdir, "soma.mjs");
let mod;
try {
  mod = await import(pathToFileURL(target).href);
} catch (err) {
  console.error(`não foi possível importar soma.mjs: ${err.message}`);
  process.exit(1);
}

const problems = [];
if (typeof mod.soma !== "function") {
  problems.push("exportação 'soma' ausente ou não é função");
} else {
  const cases = [
    [2, 3, 5],
    [-1, 1, 0],
    [0, 0, 0],
    [-5, -7, -12],
    [1.5, 2.25, 3.75],
    [1e6, 1e6, 2e6],
  ];
  for (const [a, b, want] of cases) {
    let got;
    try {
      got = mod.soma(a, b);
    } catch (err) {
      problems.push(`soma(${a}, ${b}) lançou: ${err.message}`);
      continue;
    }
    if (Object.is(got, want) || Math.abs(got - want) < 1e-9) continue;
    problems.push(`soma(${a}, ${b}) = ${got}, esperado ${want}`);
  }
}

if (problems.length > 0) {
  console.error("soma.mjs inválido:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { casos: 6, funcoes: 1 } }));
console.error("ok: soma.mjs exporta função correta e passa nos 6 casos");