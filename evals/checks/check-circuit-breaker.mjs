#!/usr/bin/env node
/**
 * Grupo A (codigo) — circuit breaker do roteador.
 * Garante que inicia fechado, abre ao atingir o limiar de falhas
 * bloqueando allow(), e volta a fechar em success().
 * Cooldown grande: nao depende do relogio real.
 * Determinístico, sem chamadas de modelo.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { Circuit } = await import(pathToFileURL(path.join(ROOT, "core", "router", "router.mjs")).href);

const THRESHOLD = 3;
const COOLDOWN = 3_600_000; // 1h: nao expira durante o teste
const failures = [];

// 1. inicia fechado e liberando chamadas
const c = new Circuit({ failureThreshold: THRESHOLD, cooldownMs: COOLDOWN });
if (c.state !== "closed") failures.push(`estado inicial "${c.state}", esperado "closed"`);
if (!c.allow()) failures.push("allow() false com o circuito fechado");
if (c.isOpen) failures.push("isOpen true com o circuito fechado");

// 2. abaixo do limiar continua fechado
for (let i = 1; i < THRESHOLD; i++) {
  c.failure();
  if (c.state !== "closed") failures.push(`apos ${i} falha(s): estado "${c.state}", esperado "closed"`);
  if (!c.allow()) failures.push(`apos ${i} falha(s): allow() false`);
}

// 3. na N-esima falha abre e bloqueia
c.failure();
if (c.state !== "open") failures.push(`apos ${THRESHOLD} falhas: estado "${c.state}", esperado "open"`);
if (!c.isOpen) failures.push("isOpen false com cooldown grande e circuito aberto");
if (c.allow()) failures.push("allow() true com o circuito aberto");

// 4. cooldown grande mantem aberto
if (c.state !== "open") failures.push(`estado "${c.state}" com cooldown de ${COOLDOWN}ms, esperado "open"`);

// 5. success() volta a fechar e zera as falhas
c.success();
if (c.state !== "closed") failures.push(`apos success(): estado "${c.state}", esperado "closed"`);
if (c.failures !== 0) failures.push(`failures ${c.failures} apos success(), esperado 0`);
if (!c.allow()) failures.push("allow() false apos success()");

// 6. reabre depois de fechar: o ciclo e repetivel
for (let i = 0; i < THRESHOLD; i++) c.failure();
if (c.state !== "open") failures.push(`reabertura: estado "${c.state}", esperado "open"`);
if (c.allow()) failures.push("allow() true apos reabrir");

if (failures.length > 0) {
  console.error("falhou:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { failures: THRESHOLD } }));
console.error("ok: circuit abre no limiar, bloqueia allow() e fecha com success()");