#!/usr/bin/env node
/**
 * Grupo B (ferramenta) — store de memória (core/memory/store.mjs).
 * É a camada de persistência append-only do harness. Verifica um ciclo real:
 * append, query (mais recente primeiro), filtro por tag, filtro por texto
 * (case-insensitive), promote entre níveis e stats. Também recusa nível inválido.
 * Determinístico (at injetado), sem chamadas de modelo.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { openStore } = await import(pathToFileURL(path.join(ROOT, "core", "memory", "store.mjs")).href);

const failures = [];

const workdir = process.env.EVAL_WORKDIR || (await mkdtemp(path.join(os.tmpdir(), "b7-mem-")));
const root = path.join(workdir, "memoria");

try {
  const store = openStore({ root });

  // 1. append com at explícito (ordem determinística)
  const e1 = store.append("session", { text: "hello world", tags: ["greet"], at: "2026-01-01T00:00:00.000Z" });
  const e2 = store.append("session", { text: "second entry", tags: ["other"], at: "2026-01-02T00:00:00.000Z" });
  if (!e1.id || !e1.at) failures.push("append não preencheu id/at");
  if (e1.at !== "2026-01-01T00:00:00.000Z") failures.push(`append não respeitou o at injetado: ${e1.at}`);

  // 2. query sem filtro: tudo, mais recente primeiro
  const all = store.query({ level: "session" });
  if (all.length !== 2) failures.push(`query session: ${all.length} entradas, esperado 2`);
  else if (all[0].text !== "second entry") failures.push(`query não ordenou mais-recente-primeiro: veio "${all[0].text}"`);

  // 3. filtro por tag
  const greet = store.query({ level: "session", tag: "greet" });
  if (greet.length !== 1 || greet[0].text !== "hello world") failures.push(`filtro tag greet: ${greet.length} itens`);

  // 4. filtro por texto case-insensitive
  const byText = store.query({ level: "session", text: "HELLO" });
  if (byText.length !== 1 || byText[0].text !== "hello world") failures.push(`filtro texto HELLO: ${byText.length} itens`);

  // 5. promote session -> project preserva id e move a entrada
  const promoted = store.promote(e1.id, "session", "project");
  if (!promoted || promoted.id !== e1.id) failures.push("promote não devolveu a entrada promovida");

  const stats = store.stats();
  if (stats.session !== 1 || stats.project !== 1 || stats.skills !== 0) {
    failures.push(`stats ${JSON.stringify(stats)}, esperado {session:1, project:1, skills:0}`);
  }

  // 6. nível inválido é recusado
  let refused = false;
  try {
    store.append("uuid", { text: "x" });
  } catch {
    refused = true;
  }
  if (!refused) failures.push("append aceitou nível inválido 'uuid'");
} finally {
  if (!process.env.EVAL_WORKDIR) await rm(workdir, { recursive: true, force: true }).catch(() => {});
}

if (failures.length > 0) {
  console.error("falhou:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { entradas: 2, niveis: 3 } }));
console.error("ok: memory store append/query/promote/stats e recusa nível inválido");