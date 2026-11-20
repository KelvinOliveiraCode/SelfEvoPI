#!/usr/bin/env node
/**
 * check-providers.mjs — teste minimo de conectividade das 8 contas.
 *
 * Para cada provedor do models.json do PI:
 *   GET <baseUrl>/models  com Authorization: Bearer <apiKey>
 * e reporta apenas status HTTP e contagem de modelos.
 *
 * Nunca imprime a chave. Nao consome tokens de inferencia.
 *
 * Uso: node scripts/check-providers.mjs [kilo1 or1 ...]
 *      node scripts/check-providers.mjs --file <models.json> [ids...]
 *
 * Um provedor sem `apiKey` (que usa auth.json) nao e sondado: o script
 * reporta "sem chave" e segue, em vez de mandar `Bearer undefined`.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import process from "node:process";

/** Extrai `--file <caminho>` da argv, preservando os ids posicional­. */
function argFile(argv) {
  const i = argv.indexOf("--file");
  if (i !== -1 && i + 1 < argv.length) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith("--file="));
  return eq ? eq.slice("--file=".length) : null;
}

const fileFlag = argFile(process.argv);
const file = fileFlag
  ? path.resolve(fileFlag)
  : process.env.SELFEOPI_MODELS_JSON
    ? path.resolve(process.env.SELFEOPI_MODELS_JSON)
    : path.join(os.homedir(), ".pi", "agent", "models.json");

// Ids posicional­: tudo que não é flag nem valor de flag.
const argv = process.argv.slice(2);
const only = [];
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === "--file") { i += 1; continue; } // pula o valor
  if (a.startsWith("--")) continue;
  only.push(a);
}

let raw;
try {
  raw = await readFile(file, "utf8");
} catch (err) {
  console.error(`  ✗ nao foi possivel ler ${file}: ${err?.message ?? err}`);
  process.exit(2);
}

let doc;
try {
  doc = JSON.parse(raw);
} catch (err) {
  console.error(`  ✗ JSON invalido em ${file}: ${err?.message ?? err}`);
  process.exit(2);
}

if (!doc || typeof doc !== "object" || !doc.providers || typeof doc.providers !== "object") {
  console.error(`  ✗ ${file} nao tem um objeto "providers" valido`);
  process.exit(2);
}

const ids = only.length ? only : Object.keys(doc.providers);

let bad = 0;

for (const id of ids) {
  const p = doc.providers[id];
  if (!p) {
    console.log(`  ✗ ${id.padEnd(6)} nao encontrado no models.json`);
    bad++;
    continue;
  }
  if (!p.apiKey) {
    console.log(`  ○ ${id.padEnd(6)} sem chave (usar auth.json)`);
    continue;
  }
  if (!p.baseUrl) {
    console.log(`  ✗ ${id.padEnd(6)} sem baseUrl no models.json`);
    bad++;
    continue;
  }
  const url = `${p.baseUrl.replace(/\/+$/, "")}/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${p.apiKey}`, accept: "application/json" },
      signal: controller.signal,
    });
    const text = await res.text();
    let count = 0;
    try {
      const json = JSON.parse(text);
      count = Array.isArray(json?.data) ? json.data.length : Array.isArray(json) ? json.length : 0;
    } catch {
      /* corpo nao e JSON */
    }
    const ok = res.status >= 200 && res.status < 300;
    if (!ok) bad++;
    console.log(`  ${ok ? "✓" : "✗"} ${id.padEnd(6)} HTTP ${res.status}  modelos=${count}  ${ok ? "" : "| " + text.slice(0, 120).replace(/\s+/g, " ")}`);
  } catch (err) {
    bad++;
    console.log(`  ✗ ${id.padEnd(6)} erro: ${err.name === "AbortError" ? "timeout" : err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

console.log(`\n  ${ids.length - bad}/${ids.length} provedores responderam`);
process.exit(bad > 0 ? 1 : 0);