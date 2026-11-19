#!/usr/bin/env node
/**
 * limpar-sessoes-teste.mjs — remove sessões de teste ("fork de teste") do projeto.
 *
 * CONTEXTO: os testes de /api/sessions/fork (versões anteriores a 8ba950c) rodavam
 * contra o HOME real e criaram sessões "fork de teste" reais na pasta do projeto,
 * que poluem a lista do desktop ("sessões que eu nunca usei"). O bug de produção
 * (teste usando HOME real) já foi corrigido; este script limpa o RESÍDUO.
 *
 * SEGURANÇA:
 *   - DRY-RUN por padrão: lista o que removeria, não remove nada.
 *   - Só remove com --confirm, e só sessões com título exatamente "fork de teste"
 *     (não toca em sessões reais do usuário, que em geral não têm título).
 *   - Nunca remove a raiz de uma cadeia que seja sessão real: só remove o que
 *     tem título "fork de teste".
 *
 * USO:
 *   node scripts/limpar-sessoes-teste.mjs                 # dry-run (lista)
 *   node scripts/limpar-sessoes-teste.mjs --confirm       # remove de verdade
 *   node scripts/limpar-sessoes-teste.mjs --proj <raiz>   # outro projeto
 */

import { readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import process from "node:process";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const CONFIRM = process.argv.includes("--confirm");
const PROJ = (arg("proj") || process.cwd()).replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
const HOME = process.env.USERPROFILE || os.homedir();
const BASE = path.join(HOME, ".pi", "agent", "sessions");
const TITULO_ALVO = "fork de teste";

function parseHeader(text) {
  const first = String(text).split(/\r?\n/).find((l) => l.trim() !== "");
  try {
    const o = JSON.parse(first);
    return o && o.type === "session" ? o : null;
  } catch {
    return null;
  }
}

// 1) acha a subpasta do projeto (casa header.cwd == PROJ)
const entries = await readdir(BASE, { withFileTypes: true }).catch(() => []);
let projDir = null;
for (const e of entries) {
  if (!e.isDirectory()) continue;
  const sub = path.join(BASE, e.name);
  const files = (await readdir(sub).catch(() => [])).filter((f) => f.endsWith(".jsonl"));
  if (!files.length) continue;
  const h = parseHeader(await readFile(path.join(sub, files[0]), "utf8").catch(() => ""));
  const cwd = h && typeof h.cwd === "string" ? h.cwd.replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase() : "";
  if (cwd === PROJ) { projDir = sub; break; }
}

if (!projDir) {
  console.log(`Nenhuma pasta de sessões para o projeto ${PROJ}. Nada a fazer.`);
  process.exit(0);
}

// 2) lista as sessões "fork de teste" dessa pasta
const files = (await readdir(projDir).catch(() => [])).filter((f) => f.endsWith(".jsonl"));
const alvos = [];
for (const f of files) {
  const full = path.join(projDir, f);
  const h = parseHeader(await readFile(full, "utf8").catch(() => ""));
  if (h && h.title === TITULO_ALVO) alvos.push({ full, id: h.id, forkedFrom: h.forkedFrom || null });
}

console.log(`Projeto : ${PROJ}`);
console.log(`Pasta   : ${projDir}`);
console.log(`Sessões "fork de teste" encontradas: ${alvos.length}`);
for (const a of alvos.slice(0, 10)) console.log(`  ${a.id}  (fork de ${a.forkedFrom || "?"})`);
if (alvos.length > 10) console.log(`  … e mais ${alvos.length - 10}`);

if (!CONFIRM) {
  console.log(`\nDRY-RUN: nada removido. Rode com --confirm para apagar.`);
  process.exit(0);
}

// 3) remove
let removed = 0;
for (const a of alvos) {
  try { await unlink(a.full); removed++; } catch (e) { console.error(`  falha ao remover ${a.id}: ${e.message}`); }
}
console.log(`\nRemovidas ${removed} sessão(ões) de teste.`);