#!/usr/bin/env node
/**
 * Grupo D (modelo real) — verifica o módulo que o PI deveria ter criado.
 *
 * Importa soma.mjs do workspace da tarefa e cobre casos normais, negativos e
 * zero, mais pares surpresa que o modelo não viu (derrota lookup table).
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
    // surpresa: pares que o modelo não viu (derrota lookup table)
    [7, 8, 15],
    [-3, 10, 7],
    [100, 250, 350],
    [0.5, 0.25, 0.75],
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
  console.error(`soma.mjs inválido: ${problems[0]}`);
  for (let i = 1; i < problems.length; i++) console.error("  - " + problems[i]);
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { casos: 10, funcoes: 1 } }));
console.error("ok: soma.mjs exporta função correta e passa nos 10 casos (incl. surpresa)");