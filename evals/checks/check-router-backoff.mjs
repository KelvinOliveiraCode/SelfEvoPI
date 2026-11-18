#!/usr/bin/env node
/**
 * Grupo A (codigo) — backoff exponencial do roteador.
 * Garante que cresce por tentativa, nunca passa do teto e, sem jitter
 * (rng=()=>1), devolve exatamente o valor cheio.
 * Determinístico, sem chamadas de modelo.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { backoffMs } = await import(pathToFileURL(path.join(ROOT, "core", "router", "router.mjs")).href);

const BASE = 250;
const FACTOR = 2;
const CAP = 8_000;
const ATTEMPTS = 8;
const CHEIO = { base: BASE, factor: FACTOR, cap: CAP, rng: () => 1 };

/** valor cheio esperado: min(teto, base * fator^(attempt-1)) */
const cheio = (attempt) => Math.min(CAP, BASE * FACTOR ** (attempt - 1));

const failures = [];

// 1. cresce por tentativa, respeita o teto e bate o valor cheio (rng=1)
let prev = -1;
for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  const got = backoffMs(attempt, CHEIO);
  const want = cheio(attempt);

  if (got !== want) failures.push(`tentativa ${attempt}: valor cheio esperado ${want}, recebido ${got}`);
  if (got > CAP) failures.push(`tentativa ${attempt}: ${got} acima do teto ${CAP}`);
  if (prev >= 0) {
    if (want < CAP && got <= prev) failures.push(`tentativa ${attempt}: ${got} deveria crescer acima de ${prev}`);
    if (got < prev) failures.push(`tentativa ${attempt}: ${got} decresceu (anterior ${prev})`);
  }
  prev = got;
}

// 2. o teto entra antes do jitter: com rng=()=>0 o valor e metade do cheio
for (const attempt of [1, 6, 7]) {
  const low = backoffMs(attempt, { ...CHEIO, rng: () => 0 });
  const wantLow = Math.round(cheio(attempt) * 0.5);
  if (low !== wantLow) failures.push(`rng=0 tentativa ${attempt}: esperado ${wantLow}, recebido ${low}`);
  if (low > CAP) failures.push(`rng=0 tentativa ${attempt}: ${low} acima do teto ${CAP}`);
}

// 3. teto aplicado: nenhuma tentativa passa do cap em 12 sorteios
for (let attempt = 1; attempt <= 12; attempt++) {
  for (const r of [0, 0.5, 1]) {
    const got = backoffMs(attempt, { ...CHEIO, rng: () => r });
    if (got > CAP) failures.push(`tentativa ${attempt} (rng=${r}): ${got} acima do teto ${CAP}`);
  }
}

if (failures.length > 0) {
  console.error("falhou:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { attempts: ATTEMPTS, cap: CAP } }));
console.error("ok: backoff cresce por tentativa e respeita o teto");