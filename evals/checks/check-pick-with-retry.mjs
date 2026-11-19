#!/usr/bin/env node
/**
 * Grupo A (codigo) — pickWithRetry do roteador (core/router/router.mjs).
 * Garante que: (1) após erro retryable troca para um provider DIFERENTE (sem
 * repetir nenhum já tentado), (2) esgota as tentativas e propaga o último erro,
 * (3) não repete quando o erro não é retryable, (4) sucesso de primeira não tenta
 * outros providers.
 * Determinístico, sem chamadas de modelo. Não fixa qual provider vem depois: o
 * que importa é a troca e a ausência de repetição.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { Router } = await import(pathToFileURL(path.join(ROOT, "core", "router", "router.mjs")).href);

const providers = () => [
  { id: "kilo1", models: [{ id: "a", contextWindow: 400_000 }] },
  { id: "kilo2", models: [{ id: "a", contextWindow: 400_000 }] },
  { id: "kilo3", models: [{ id: "a", contextWindow: 400_000 }] },
];

const failures = [];

// 1. sucesso na 2ª tentativa: 1º provider lança erro retryable, outro resolve
{
  const router = new Router({ providers: providers(), strategy: "roundRobin", rng: () => 0.3 });
  const seen = [];
  const attempts = [];
  const out = await router.pickWithRetry(
    "worker",
    async (pick) => {
      seen.push(pick.provider);
      if (pick.provider === "kilo1") throw new Error("429 rate limit");
      return { provider: pick.provider };
    },
    { attempts: 3, onAttempt: (i) => attempts.push(i.provider) },
  );
  if (out.attempts !== 2) failures.push(`attempts ${out.attempts}, esperado 2`);
  if (out.providersTried[0] !== "kilo1") failures.push(`1º provider ${out.providersTried[0]}, esperado kilo1`);
  if (out.providersTried.length !== 2) failures.push(`providersTried tem ${out.providersTried.length}, esperado 2`);
  if (new Set(out.providersTried).size !== 2) failures.push(`provider repetido em ${out.providersTried.join(",")}`);
  if (out.result?.provider !== out.providersTried[1]) failures.push("resultado não veio do 2º provider tentado");
  if (out.result?.provider === "kilo1") failures.push("resultado veio do provider que já havia falhado");
  if (attempts.join(",") !== out.providersTried.join(",")) failures.push("onAttempt não bate com providersTried");
}

// 2. erro retryable em todos: esgota as tentativas e propaga
{
  const router = new Router({ providers: providers(), strategy: "roundRobin", rng: () => 0.3 });
  let calls = 0;
  let threw = null;
  try {
    await router.pickWithRetry(
      "worker",
      async () => {
        calls += 1;
        throw new Error("429 rate limit");
      },
      { attempts: 2 },
    );
  } catch (err) {
    threw = err;
  }
  if (calls !== 2) failures.push(`fn chamada ${calls}x, esperado 2 (attempts=2)`);
  if (!threw || !/esgotou/i.test(threw.message)) failures.push(`erro final "${threw?.message}", esperado "esgotou ..."`);
}

// 3. erro não-retryable: desiste após 1 tentativa e repassa o erro original
{
  const router = new Router({ providers: providers(), strategy: "roundRobin", rng: () => 0.3 });
  let calls = 0;
  let threw = null;
  try {
    await router.pickWithRetry(
      "worker",
      async () => {
        calls += 1;
        throw new Error("boom");
      },
      { attempts: 3 },
    );
  } catch (err) {
    threw = err;
  }
  if (calls !== 1) failures.push(`fn chamada ${calls}x com erro não-retryable, esperado 1`);
  if (threw?.message !== "boom") failures.push(`erro final "${threw?.message}", esperado "boom"`);
}

// 4. sucesso de primeira: uma tentativa, um provider, resultado ok
{
  const router = new Router({ providers: providers(), strategy: "roundRobin", rng: () => 0.3 });
  const out = await router.pickWithRetry("worker", async () => "ok", { attempts: 3 });
  if (out.result !== "ok") failures.push(`resultado "${out.result}", esperado "ok"`);
  if (out.attempts !== 1) failures.push(`attempts ${out.attempts}, esperado 1`);
  if (out.providersTried.length !== 1) failures.push(`providersTried ${out.providersTried.length}, esperado 1`);
}

if (failures.length > 0) {
  console.error("falhou:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { verificacoes: 4 } }));
console.error("ok: pickWithRetry troca de provider, não repete, esgota e propaga");