#!/usr/bin/env node
/**
 * Grupo A (codigo) — fromPiConfig + Router.pick (core/router/router.mjs).
 * Carrega um models.json de verdade (em diretório temporário) e garante que:
 *  (1) o ref tem o formato "provider/modelo",
 *  (2) o filtro de contexto (minContext) escolhe um modelo com janela suficiente,
 *  (3) o modelo pedido explicitamente tem prioridade,
 *  (4) a família desativada (or*) nunca é escolhida para o perfil worker.
 * Determinístico, sem chamadas de modelo.
 */
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { fromPiConfig } = await import(pathToFileURL(path.join(ROOT, "core", "router", "router.mjs")).href);

const failures = [];

const workdir = process.env.EVAL_WORKDIR || (await mkdtemp(path.join(os.tmpdir(), "a7-models-")));
const cfgPath = path.join(workdir, "models.json");
await writeFile(
  cfgPath,
  JSON.stringify({
    providers: {
      kilo1: { baseUrl: "http://x", api: "kilo", apiKey: "k", models: [{ id: "small", contextWindow: 8_000 }, { id: "big", contextWindow: 200_000 }] },
      kilo2: { baseUrl: "http://x", api: "kilo", apiKey: "k", models: [{ id: "small", contextWindow: 8_000 }, { id: "big", contextWindow: 200_000 }] },
      or1: { baseUrl: "http://x", api: "or", apiKey: "k", models: [{ id: "free", contextWindow: 100_000 }] },
    },
  }),
  "utf8",
);

try {
  const router = await fromPiConfig(cfgPath);

  // 1. formato do ref "provider/modelo"
  const p0 = router.pick("worker");
  if (!/^kilo\d+\/[^/]+$/.test(p0.ref)) failures.push(`ref "${p0.ref}" fora do formato provider/modelo`);

  // 2. minContext filtra por janela: precisa do modelo "big"
  const pBig = router.pick("worker", { minContext: 100_000 });
  if (pBig.model !== "big") failures.push(`minContext=100000 escolheu "${pBig.model}", esperado "big"`);

  // 3. minContext baixo deixa o primeiro modelo (small) passar
  const pSmall = router.pick("worker", { minContext: 1_000 });
  if (pSmall.model !== "small") failures.push(`minContext=1000 escolheu "${pSmall.model}", esperado "small"`);

  // 4. modelo explícito tem prioridade
  const pExplicit = router.pick("worker", { model: "big" });
  if (pExplicit.model !== "big") failures.push(`modelo explícito "big" virou "${pExplicit.model}"`);

  // 5. família desativada nunca é escolhida em 12 sorteios
  for (let i = 0; i < 12; i++) {
    const p = router.pick("worker").provider;
    if (p.startsWith("or")) failures.push(`worker escolheu família desativada: ${p}`);
  }
} finally {
  if (!process.env.EVAL_WORKDIR) await rm(workdir, { recursive: true, force: true }).catch(() => {});
}

if (failures.length > 0) {
  console.error("falhou:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { picks: 12 } }));
console.error("ok: fromPiConfig/pick respeita formato, contexto, modelo explícito e famílias desativadas");