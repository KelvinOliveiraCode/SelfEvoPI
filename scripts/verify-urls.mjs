#!/usr/bin/env node
/**
 * verify-urls.mjs — gate de integridade de fontes (FASE P do SelfEvoPI)
 *
 * Lê as URLs citadas em docs/research/inspiracoes.md, verifica cada uma
 * e classifica o resultado. Falha (exit 1) se alguma fonte primária
 * responder 404/5xx ou erro de rede.
 *
 * Uso:
 *   node scripts/verify-urls.mjs
 *   node scripts/verify-urls.mjs --json
 *   node scripts/verify-urls.mjs --file docs/research/inspiracoes.md
 *   node scripts/verify-urls.mjs --timeout 15000
 *
 * Sem dependências externas. Windows nativo (PowerShell/cmd) e POSIX.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const file = path.resolve(ROOT, argValue("--file", "docs/research/inspiracoes.md"));
const timeoutMs = Number(argValue("--timeout", "15000"));
const concurrency = Number(argValue("--concurrency", "6"));
const asJson = process.argv.includes("--json");

/** Extrai URLs de markdown: <https://...>, (https://...) e texto puro. */
function extractUrls(markdown) {
  const found = new Set();
  const patterns = [
    /<((?:https?):\/\/[^>\s]+)>/g,
    /\]\(\s*((?:https?):\/\/[^\s)]+)\s*\)/g,
    /(?:^|[\s(])((?:https?):\/\/[^\s<>)"']+)/gm,
  ];
  for (const re of patterns) {
    for (const match of markdown.matchAll(re)) {
      found.add(match[1].replace(/[.,;]+$/, ""));
    }
  }
  return [...found].sort();
}

function classify(status) {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 403 || status === 429) return "wall";
  if (status >= 300 && status < 400) return "ok";
  return "fail";
}

async function probe(url) {
  // HEAD primeiro (barato); alguns servidores recusam HEAD → GET.
  // Cada método recebe seu próprio teto de tempo: um HEAD lento não pode
  // abortar o GET que vem depois (o bug do controller único compartilhado).
  for (const method of ["HEAD", "GET"]) {
    try {
      const res = await fetch(url, {
        method,
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "user-agent": "SelfEvoPI-verify-urls/1.0 (+local research gate)",
          accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        },
      });
      const kind = classify(res.status);
      if (kind !== "fail" || method === "GET") {
        return {
          url,
          status: res.status,
          kind,
          method,
          finalUrl: res.url || url,
        };
      }
      // 404 no HEAD: tenta GET para confirmar.
    } catch {
      // tenta o próximo método
    }
  }
  return { url, status: 0, kind: "error", method: "-", finalUrl: url, error: "timeout/network" };
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function icon(kind) {
  return { ok: "✓", wall: "○", fail: "✗", error: "!" }[kind] ?? "?";
}

async function main() {
  let markdown;
  try {
    markdown = await readFile(file, "utf8");
  } catch (err) {
    console.error(`não foi possível ler ${file}: ${err.message}`);
    process.exit(2);
  }

  const urls = extractUrls(markdown);
  if (urls.length === 0) {
    console.error(`nenhuma URL encontrada em ${file}`);
    process.exit(2);
  }

  const results = await mapWithConcurrency(urls, concurrency, probe);

  const counts = { ok: 0, wall: 0, fail: 0, error: 0 };
  for (const r of results) counts[r.kind]++;

  if (asJson) {
    console.log(JSON.stringify({ file, checkedAt: new Date().toISOString(), counts, results }, null, 2));
  } else {
    console.log(`Verificando ${urls.length} URLs de ${path.relative(ROOT, file)}\n`);
    for (const r of results) {
      const status = r.status ? String(r.status) : "ERR";
      console.log(`${icon(r.kind)} ${status.padEnd(4)} ${r.url}`);
    }
    console.log(
      `\nok=${counts.ok}  wall=${counts.wall}  fail=${counts.fail}  error=${counts.error}`
    );
    if (counts.wall > 0) {
      console.log("\n○ wall = exige login/JS (conteúdo não verificável por fetch).");
    }
    if (counts.fail + counts.error > 0) {
      console.log("\n✗ fail = fonte primária quebrada. Corrija a URL ou remova a citação.");
    }
  }

  process.exit(counts.fail + counts.error > 0 ? 1 : 0);
}

main();