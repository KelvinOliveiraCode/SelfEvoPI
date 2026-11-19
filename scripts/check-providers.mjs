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
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import process from "node:process";

const file = path.join(os.homedir(), ".pi", "agent", "models.json");
const only = process.argv.slice(2);

const doc = JSON.parse(await readFile(file, "utf8"));
const ids = only.length ? only : Object.keys(doc.providers);

let bad = 0;

for (const id of ids) {
  const p = doc.providers[id];
  if (!p) {
    console.log(`  ✗ ${id.padEnd(6)} nao encontrado no models.json`);
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