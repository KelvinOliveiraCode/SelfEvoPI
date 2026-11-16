#!/usr/bin/env node
/**
 * Grupo A (codigo) — teto de consumo (core/router/budget.mjs).
 * Garante que nunca gasta acima do limite, dispara onExceeded exatamente uma
 * vez, mantém remaining em >= 0 (clamp) e zera com reset().
 * Determinístico, sem chamadas de modelo.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { createBudget } = await import(pathToFileURL(path.join(ROOT, "core", "router", "budget.mjs")).href);

const failures = [];

// 1. dentro do limite: ok true e remaining correto
{
  const b = createBudget({ limitTokens: 1000, limitCostUsd: 1.0 });
  const r = b.spend({ tokens: 300, costUsd: 0.2 });
  if (r.ok !== true) failures.push("spend dentro do limite deveria ser ok:true");
  if (r.remainingTokens !== 700) failures.push(`remainingTokens ${r.remainingTokens}, esperado 700`);
  if (Math.abs(r.remainingCostUsd - 0.8) > 1e-9) failures.push(`remainingCostUsd ${r.remainingCostUsd}, esperado 0.8`);
}

// 2. ultrapassar marca estouro, chama onExceeded uma vez e trava remaining em 0
{
  let calls = 0;
  const b = createBudget({ limitTokens: 100, onExceeded: () => { calls += 1; } });
  const r1 = b.spend({ tokens: 150 });
  if (r1.ok !== false) failures.push("spend acima do limite deveria ser ok:false");
  if (b.ok !== false) failures.push("budget.ok deveria ser false após ultrapassar");
  if (b.exceeded !== true) failures.push("budget.exceeded deveria ser true");
  if (r1.remainingTokens !== 0) failures.push(`remainingTokens após estouro ${r1.remainingTokens}, esperado 0 (clamp)`);
  const r2 = b.spend({ tokens: 10 });
  if (r2.ok !== false) failures.push("spend após estouro deveria continuar ok:false");
  if (calls !== 1) failures.push(`onExceeded chamado ${calls}x, esperado exatamente 1`);
}

// 3. estouro por custo (limite em USD)
{
  const b = createBudget({ limitCostUsd: 0.5 });
  b.spend({ costUsd: 0.5 });
  if (b.ok !== false) failures.push("estouro por custo (gasto == limite) não detectado");
}

// 4. reset volta ao estado inicial e permite gastar de novo
{
  const b = createBudget({ limitTokens: 100 });
  b.spend({ tokens: 200 });
  if (b.ok !== false) failures.push("pré-reset deveria estar estourado");
  b.reset();
  if (b.ok !== true) failures.push("após reset ok deveria ser true");
  if (b.spentTokens !== 0) failures.push(`spentTokens após reset ${b.spentTokens}, esperado 0`);
  const r = b.spend({ tokens: 50 });
  if (r.ok !== true) failures.push("após reset, novo spend dentro do limite deveria ser ok:true");
}

if (failures.length > 0) {
  console.error("falhou:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { verificacoes: 4 } }));
console.error("ok: budget nunca estoura, notifica uma vez e zera com reset");