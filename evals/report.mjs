#!/usr/bin/env node
/**
 * report.mjs — resume o ledger JSONL em um relatório.
 *
 * Uso:
 *   node evals/report.mjs              # tabela markdown
 *   node evals/report.mjs --json       # dados crus
 *   node evals/report.mjs --last 20    # janela de execucoes
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const LEDGER = path.join(ROOT, ".pi", "harness", "ledger", "evals.jsonl");

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const raw = await readFile(LEDGER, "utf8").catch(() => "");
const all = raw
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

const windowSize = Number(argValue("last", "0")) || 0;
const rows = windowSize > 0 ? all.slice(-windowSize) : all;

if (rows.length === 0) {
  console.error("ledger vazio: node evals/run.mjs");
  process.exit(2);
}

const byTask = new Map();
for (const r of rows) {
  const cur = byTask.get(r.taskId) ?? { taskId: r.taskId, group: r.group, runs: 0, passes: 0, totalMs: 0, tokens: 0, cost: 0 };
  cur.runs++;
  cur.passes += r.passed ? 1 : 0;
  cur.totalMs += r.durationMs || 0;
  cur.tokens += r.tokens || 0;
  cur.cost += r.costUsd || 0;
  byTask.set(r.taskId, cur);
}

const tasks = [...byTask.values()].map((t) => ({
  ...t,
  rate: t.passes / t.runs,
  avgMs: Math.round(t.totalMs / t.runs),
}));
tasks.sort((a, b) => a.rate - b.rate || a.taskId.localeCompare(b.taskId));

const totalRuns = rows.length;
const totalPass = rows.filter((r) => r.passed).length;
const totalTokens = rows.reduce((n, r) => n + (r.tokens || 0), 0);
const totalCost = rows.reduce((n, r) => n + (r.costUsd || 0), 0);
const avgMs = Math.round(rows.reduce((n, r) => n + (r.durationMs || 0), 0) / totalRuns);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ totalRuns, totalPass, rate: totalPass / totalRuns, avgMs, totalTokens, totalCost, tasks }, null, 2));
  process.exit(0);
}

const pct = ((totalPass / totalRuns) * 100).toFixed(1);
console.log(`# Relatório de evals\n`);
console.log(`- execuções: **${totalRuns}**`);
console.log(`- acerto: **${pct}%** (${totalPass}/${totalRuns})`);
console.log(`- latência média: **${avgMs} ms**`);
console.log(`- tokens: **${totalTokens}**`);
console.log(`- custo: **US$ ${totalCost.toFixed(4)}**\n`);
console.log(`| tarefa | grupo | acerto | média |`);
console.log(`|:---|:---|:---|:---|`);

for (const t of tasks) {
  const mark = t.rate === 1 ? "✓" : t.rate === 0 ? "✗" : "~";
  console.log(`| ${mark} \`${t.taskId}\` | ${t.group} | ${(t.rate * 100).toFixed(0)}% (${t.passes}/${t.runs}) | ${t.avgMs} ms |`);
}

const flaky = tasks.filter((t) => t.rate > 0 && t.rate < 1);
if (flaky.length > 0) {
  console.log(`\n**Instáveis:** ${flaky.map((t) => t.taskId).join(", ")}`);
}