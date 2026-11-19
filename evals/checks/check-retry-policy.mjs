#!/usr/bin/env node
/**
 * Grupo A (codigo) — política de retry do roteador (withRetry).
 * Garante que recupera na 3ª tentativa, desiste imediatamente quando
 * retryOn e false, e repassa ao onRetry o backoff da tentativa.
 * sleep injetado: nao espera de verdade.
 * Determinístico, sem chamadas de modelo.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { withRetry } = await import(pathToFileURL(path.join(ROOT, "core", "router", "router.mjs")).href);

// backoffMs default do router: base 250, fator 2, teto 8000, jitter em [0.5, 1.0]
const BACKOFF = { base: 250, factor: 2, cap: 8_000 };
const fullOf = (attempt) => Math.min(BACKOFF.cap, BACKOFF.base * BACKOFF.factor ** (attempt - 1));

const failures = [];

// 1. sucesso na 3ª tentativa
const attempts = [];
const retries = [];
const sleeps = [];
let calls = 0;

const result = await withRetry(
  async (attempt) => {
    calls += 1;
    attempts.push(attempt);
    if (attempt < 3) throw new Error(`falha ${attempt}`);
    return "ok";
  },
  {
    attempts: 3,
    retryOn: () => true,
    onRetry: (info) => retries.push(info),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  },
);

if (result !== "ok") failures.push(`resultado "${result}", esperado "ok"`);
if (calls !== 3) failures.push(`fn chamada ${calls}x, esperado 3`);
if (retries.length !== 2) failures.push(`onRetry chamado ${retries.length}x, esperado 2`);
if (sleeps.length !== 2) failures.push(`sleep chamado ${sleeps.length}x, esperado 2`);
if (attempts.join(",") !== "1,2,3") failures.push(`tentativas ${attempts.join(",")}, esperado 1,2,3`);
if (retries.map((r) => r.attempt).join(",") !== "1,2") {
  failures.push(`attempt em onRetry ${retries.map((r) => r.attempt).join(",")}, esperado 1,2`);
}

// 2. onRetry recebe o backoff correto da tentativa (dentro da faixa de jitter)
for (const info of retries) {
  if (!(info.error instanceof Error)) failures.push(`error ausente na tentativa ${info.attempt}`);
  const raw = fullOf(info.attempt);
  const lo = Math.round(raw * 0.5);
  const hi = raw;
  if (!Number.isFinite(info.delayMs)) {
    failures.push(`delayMs nao numerico na tentativa ${info.attempt}`);
  } else if (info.delayMs < lo || info.delayMs > hi) {
    failures.push(`delayMs ${info.delayMs} fora da faixa [${lo},${hi}] da tentativa ${info.attempt}`);
  }
}

// 3. desiste imediatamente quando retryOn e false
let calls2 = 0;
let retries2 = 0;
let sleeps2 = 0;
let thrown = null;
try {
  await withRetry(
    async () => {
      calls2 += 1;
      throw new Error("boom");
    },
    {
      attempts: 5,
      retryOn: () => false,
      onRetry: () => {
        retries2 += 1;
      },
      sleep: async () => {
        sleeps2 += 1;
      },
    },
  );
} catch (err) {
  thrown = err;
}

if (thrown === null) failures.push("nao lancou o erro final com retryOn=false");
if (calls2 !== 1) failures.push(`fn chamada ${calls2}x com retryOn=false, esperado 1`);
if (retries2 !== 0) failures.push(`onRetry chamado ${retries2}x com retryOn=false, esperado 0`);
if (sleeps2 !== 0) failures.push(`sleep chamado ${sleeps2}x com retryOn=false, esperado 0`);
if (thrown?.message !== "boom") failures.push(`erro final "${thrown?.message}", esperado "boom"`);

// 4. esgota as tentativas e propaga o ultimo erro
let calls3 = 0;
let retries3 = 0;
let thrown3 = null;
try {
  await withRetry(
    async (attempt) => {
      calls3 += 1;
      throw new Error(`erro ${attempt}`);
    },
    {
      attempts: 2,
      retryOn: () => true,
      onRetry: () => {
        retries3 += 1;
      },
      sleep: async () => {},
    },
  );
} catch (err) {
  thrown3 = err;
}

if (calls3 !== 2) failures.push(`fn chamada ${calls3}x com attempts=2, esperado 2`);
if (retries3 !== 1) failures.push(`onRetry chamado ${retries3}x com attempts=2, esperado 1`);
if (thrown3?.message !== "erro 2") failures.push(`ultimo erro "${thrown3?.message}", esperado "erro 2"`);

if (failures.length > 0) {
  console.error("falhou:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { attempts: calls } }));
console.error("ok: withRetry recupera na 3ª tentativa, respeita retryOn e informa o backoff");