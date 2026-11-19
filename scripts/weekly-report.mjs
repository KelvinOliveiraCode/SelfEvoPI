#!/usr/bin/env node
/**
 * weekly-report.mjs — relatório semanal do SelfEvoPI (Fase 5).
 *
 * Uso:
 *   node scripts/weekly-report.mjs [--out <arquivo>] [--json]
 *
 * Gera `.pi/harness/reports/weekly-<timestamp>.md` com:
 *   - taxa de sucesso (do ledger, por grupo e total)
 *   - tokens por tarefa (média e pior caso)
 *   - latência média
 *   - lacunas resolvidas (artefatos promovidos: entries no nível skills)
 *   - reversões (rollbacks registrados no ledger)
 *
 * Lê o ledger de execuções (`.pi/harness/ledger/evals.jsonl`) e a memória
 * (`.pi/harness/memory`). Não escreve em `evals/`, `core/forge/` ou `core/governance/`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { openStore } from "../core/memory/store.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_LEDGER = join(ROOT, ".pi", "harness", "ledger", "evals.jsonl");
const DEFAULT_MEMORY_ROOT = join(ROOT, ".pi", "harness", "memory");
const DEFAULT_REPORTS_DIR = join(ROOT, ".pi", "harness", "reports");

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const opts = { out: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") opts.json = true;
    else if (arg === "--out") opts.out = argv[++i];
    else if (arg.startsWith("--")) throw new Error(`weekly-report: flag desconhecida "${arg}"`);
  }
  return opts;
}

/* ------------------------------------------------------------------ */
/* Leitura e agregação                                                 */
/* ------------------------------------------------------------------ */

/** Lê o ledger JSONL. Arquivo ausente = lista vazia. */
export function readLedger(file) {
  if (!existsSync(file)) return [];
  const raw = readFileSync(file, "utf8");
  if (raw.trim() === "") return [];
  const rows = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // linha corrompida no ledger: ignora (não é memória; é trilha de execução)
    }
  }
  return rows;
}

/**
 * Agrega o ledger em métricas de relatório.
 * @param {Array<object>} rows
 * @returns {object} métricas agregadas
 */
export function aggregateMetrics(rows) {
  const groups = {};
  const tokens = [];
  const durations = [];
  let passes = 0;
  let failures = 0;

  for (const r of rows) {
    const g = r.group ?? "?";
    groups[g] = groups[g] ?? { runs: 0, passes: 0, tokens: 0, durations: 0 };
    groups[g].runs++;
    groups[g].durations += Number(r.durationMs) || 0;
    groups[g].tokens += Number(r.tokens) || 0;

    if (r.passed) {
      groups[g].passes++;
      passes++;
    } else {
      failures++;
    }
    if (typeof r.tokens === "number") tokens.push(r.tokens);
    if (typeof r.durationMs === "number") durations.push(r.durationMs);
  }

  const totalRuns = rows.length;
  const avgTokens = tokens.length ? Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length) : 0;
  const worstTokens = tokens.length ? Math.max(...tokens) : 0;
  const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

  // Tokens por tarefa (média e pior caso) — agregado por taskId.
  const perTask = {};
  for (const r of rows) {
    const id = r.taskId ?? "?";
    perTask[id] = perTask[id] ?? { taskId: id, group: r.group ?? "?", runs: 0, passes: 0, tokens: [], durations: [] };
    perTask[id].runs++;
    if (r.passed) perTask[id].passes++;
    if (typeof r.tokens === "number") perTask[id].tokens.push(r.tokens);
    if (typeof r.durationMs === "number") perTask[id].durations.push(r.durationMs);
  }
  for (const t of Object.values(perTask)) {
    t.avgTokens = t.tokens.length ? Math.round(t.tokens.reduce((a, b) => a + b, 0) / t.tokens.length) : 0;
    t.worstTokens = t.tokens.length ? Math.max(...t.tokens) : 0;
    t.avgMs = t.durations.length ? Math.round(t.durations.reduce((a, b) => a + b, 0) / t.durations.length) : 0;
    t.rate = t.runs ? t.passes / t.runs : 0;
    delete t.tokens;
    delete t.durations;
  }

  // Grupo: completa as médias.
  for (const g of Object.values(groups)) {
    g.avgTokens = g.runs ? Math.round(g.tokens / g.runs) : 0;
    g.avgMs = g.runs ? Math.round(g.durations / g.runs) : 0;
    g.rate = g.runs ? g.passes / g.runs : 0;
    delete g.tokens;
    delete g.durations;
  }

  return {
    totalRuns,
    passes,
    failures,
    rate: totalRuns ? passes / totalRuns : 0,
    avgTokens,
    worstTokens,
    avgDuration,
    groups,
    perTask: Object.values(perTask).sort((a, b) => a.taskId.localeCompare(b.taskId)),
  };
}

/** Conta lacunas resolvidas (entradas no nível skills) e reversões (rollbacks). */
export function countOutcomes(rows, store) {
  // Reversões: linhas do ledger com `rolledBack`, `reverted` ou `outcome: "rolled-back"`.
  let reversals = 0;
  for (const r of rows) {
    if (r.rolledBack === true || r.reverted === true || r.outcome === "rolled-back" || r.outcome === "rolled_back") {
      reversals++;
    }
  }

  // Lacunas resolvidas: artefatos promovidos = entradas ativas no nível skills.
  let gapsResolved = 0;
  if (store && typeof store.query === "function") {
    gapsResolved = store.query({ level: "skills" }).length;
  }

  return { gapsResolved, reversals };
}

/* ------------------------------------------------------------------ */
/* Relatório                                                           */
/* ------------------------------------------------------------------ */

function tsCompact(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function pct(rate) {
  return `${(rate * 100).toFixed(1)}%`;
}

/**
 * Monta o markdown do relatório semanal.
 * @param {object} metrics  saída de aggregateMetrics
 * @param {object} outcomes saída de countOutcomes
 */
export function renderWeeklyReport(metrics, outcomes, { at = new Date() } = {}) {
  const lines = [];
  lines.push("# Relatório semanal — SelfEvoPI");
  lines.push("");
  lines.push(`- gerado em: ${at.toISOString()}`);
  lines.push(`- execuções no ledger: ${metrics.totalRuns}`);
  lines.push("");

  lines.push("## Taxa de sucesso");
  lines.push("");
  lines.push("| grupo | execuções | acertos | taxa |");
  lines.push("|:---|:---|:---|:---|");
  for (const [g, v] of Object.entries(metrics.groups).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`| ${g} | ${v.runs} | ${v.passes} | ${pct(v.rate)} |`);
  }
  lines.push(`| **total** | ${metrics.totalRuns} | ${metrics.passes} | **${pct(metrics.rate)}** |`);
  lines.push("");

  lines.push("## Tokens por tarefa");
  lines.push("");
  lines.push("| tarefa | grupo | execuções | taxa | tokens média | tokens pior caso | latência média |");
  lines.push("|:---|:---|:---|:---|:---|:---|:---|");
  for (const t of metrics.perTask) {
    lines.push(`| \`${t.taskId}\` | ${t.group} | ${t.runs} | ${pct(t.rate)} | ${t.avgTokens} | ${t.worstTokens} | ${t.avgMs} ms |`);
  }
  lines.push("");
  lines.push(`**Resumo:** tokens média ${metrics.avgTokens} · pior caso ${metrics.worstTokens} · latência média ${metrics.avgDuration} ms`);
  lines.push("");

  lines.push("## Lacunas e reversões");
  lines.push("");
  lines.push(`- lacunas resolvidas (artefatos promovidos em \`skills\`): ${outcomes.gapsResolved}`);
  lines.push(`- reversões (rollbacks): ${outcomes.reversals}`);
  lines.push("");

  return lines.join("\n") + "\n";
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`weekly-report: ${err.message}\n`);
    process.exit(2);
  }

  const rows = readLedger(DEFAULT_LEDGER);
  const metrics = aggregateMetrics(rows);

  let store = null;
  if (existsSync(DEFAULT_MEMORY_ROOT)) {
    store = openStore({ root: DEFAULT_MEMORY_ROOT });
  }
  const outcomes = countOutcomes(rows, store);

  if (opts.json) {
    process.stdout.write(JSON.stringify({ metrics, outcomes }, null, 0) + "\n");
  } else {
    process.stdout.write(renderWeeklyReport(metrics, outcomes));
  }

  // Grava arquivo
  const out = opts.out ? resolve(opts.out) : join(DEFAULT_REPORTS_DIR, `weekly-${tsCompact()}.md`);
  mkdirSync(resolve(out, ".."), { recursive: true });
  writeFileSync(out, renderWeeklyReport(metrics, outcomes), "utf8");
  if (!opts.json) process.stdout.write(`\nrelatório: ${out}\n`);
}

// Só executa quando rodado diretamente.
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`weekly-report falhou: ${err?.stack || err?.message || err}\n`);
    process.exit(2);
  }
}