#!/usr/bin/env node
/**
 * Grupo C (regressão) — contrato de artefato do Forge (core/forge/contract.mjs).
 * Segurança do loop evolutivo que nunca pode degradar: um pedido precisa de
 * goal, kind válido, proibições não-vazias e ao menos um teste; e um resultado
 * só é promovido (ok) com todos os testes passando, sem violações e sem usar
 * nada proibido.
 * Determinístico, sem chamadas de modelo.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { createArtifactRequest, validateArtifactResult } = await import(
  pathToFileURL(path.join(ROOT, "core", "forge", "contract.mjs")).href
);

const failures = [];
const baseReq = { goal: "extrair linhas de um CSV", kind: "cli", inputs: { file: "arquivo" }, outputs: { rows: "linhas" } };
const forbidden = ["acessar rede"];
const tests = [{ name: "t1", command: "node cli.mjs --file x" }];

// 1. pedido válido normaliza e mantém campos
{
  const req = createArtifactRequest({ ...baseReq, forbidden, tests });
  if (req.goal !== "extrair linhas de um CSV" || req.kind !== "cli") failures.push("pedido válido não normalizou goal/kind");
  if (req.forbidden[0] !== "acessar rede") failures.push("pedido não preservou proibições");
}

// 2-5. pedidos inválidos lançam
const invalidCases = [
  ["sem goal", { kind: "cli", forbidden, tests }],
  ["kind inválido", { goal: "g", kind: "xxx", forbidden, tests }],
  ["proibições vazias", { goal: "g", kind: "cli", forbidden: [], tests }],
  ["sem testes", { goal: "g", kind: "cli", forbidden, tests: [] }],
];
for (const [label, req] of invalidCases) {
  let threw = false;
  try {
    createArtifactRequest(req);
  } catch {
    threw = true;
  }
  if (!threw) failures.push(`createArtifactRequest aceitou caso inválido: ${label}`);
}

const request = createArtifactRequest({ ...baseReq, forbidden, tests });

// 6. resultado promovido: testes passam, sem violações
{
  const r = validateArtifactResult({ kind: "cli", tests: [{ name: "t1", passed: true }] }, request);
  if (!r.ok) failures.push(`resultado válido reprovado: ${r.reasons.join("; ")}`);
}

// 7. teste reprovado -> não promove
{
  const r = validateArtifactResult({ kind: "cli", tests: [{ name: "t1", passed: false }] }, request);
  if (r.ok) failures.push("resultado com teste reprovado foi promovido");
}

// 8. violação de proibição -> não promove
{
  const r = validateArtifactResult({ kind: "cli", tests: [{ name: "t1", passed: true }], violations: ["acessar rede"] }, request);
  if (r.ok) failures.push("resultado com violação foi promovido");
}

// 9. usou algo proibido -> não promove
{
  const r = validateArtifactResult({ kind: "cli", tests: [{ name: "t1", passed: true }], permissionsUsed: ["acessar rede"] }, request);
  if (r.ok) failures.push("resultado que usou algo proibido foi promovido");
}

// 10. sem evidência de teste -> não promove
{
  const r = validateArtifactResult({ kind: "cli", tests: [] }, request);
  if (r.ok) failures.push("resultado sem testes foi promovido");
}

if (failures.length > 0) {
  console.error("falhou:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { casos: 10 } }));
console.error("ok: contrato nunca promove artefato sem teste aprovado ou com violação");