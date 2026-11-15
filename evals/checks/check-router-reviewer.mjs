#!/usr/bin/env node
/**
 * Grupo A (codigo) — a regra do reviewer: nunca reusar o provider do autor.
 * Determinístico, sem chamadas de modelo.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { Router, PROFILES } = await import(pathToFileURL(path.join(ROOT, "core", "router", "router.mjs")).href);

const providers = [
  { id: "kilo1", models: [{ id: "a", contextWindow: 400_000 }] },
  { id: "kilo2", models: [{ id: "a", contextWindow: 400_000 }] },
  { id: "or1", models: [{ id: "b", contextWindow: 100_000 }] },
  { id: "or2", models: [{ id: "b", contextWindow: 100_000 }] },
];

const router = new Router({ providers, strategy: "roundRobin", rng: () => 0.3 });

const failures = [];

// 1. perfis obrigatorios existem
for (const name of ["orchestrator", "worker", "reviewer"]) {
  if (!PROFILES[name]) failures.push(`perfil ausente: ${name}`);
}
if (PROFILES.reviewer?.requireDifferentFrom !== "worker") {
  failures.push("reviewer deve exigir provider diferente do worker");
}

// 2. em 20 sorteios, reviewer nunca cai no provider do autor
for (let i = 0; i < 20; i++) {
  const author = router.pick("worker").provider;
  const review = router.pick("reviewer", { exclude: [author] });
  if (review.provider === author) failures.push(`reviewer reusou ${author}`);
}

// 3. orchestrator exige contexto grande
const orch = router.pick("orchestrator");
if (!(orch.model === "a")) failures.push(`orchestrator escolheu modelo pequeno: ${orch.model}`);

// 4. exclusao e respeitada
const forced = router.pick("reviewer", { exclude: ["kilo1", "kilo2"] });
if (forced.provider.startsWith("kilo")) failures.push("exclusao ignorada");

if (failures.length > 0) {
  console.error("falhou:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { picks: 20 } }));
console.error("ok: reviewer nunca reusa o provider do autor");