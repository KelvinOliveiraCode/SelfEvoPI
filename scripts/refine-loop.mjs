#!/usr/bin/env node
/**
 * refine-loop.mjs — rotina de `/refine` com evidência e gate (Fase 5).
 *
 * Uso:
 *   node scripts/refine-loop.mjs [--apply] [--dry-run] [--report [arquivo]]
 *                                [--level project|session|skills] [--json]
 *                                [--memory-root <dir>] [--ledger <arquivo>]
 *                                [--gate <comando>]
 *
 * O que faz:
 *   1. lê o ledger de execuções (`.pi/harness/ledger/evals.jsonl`) e a memória atual
 *   2. chama `proposeDeltas({ entries })` para ver o que PODERIA mudar
 *   3. sem `--apply` (default = dry-run): só mostra. Nada é escrito.
 *   4. com `--apply`: aplica via `applyDeltas` e re-roda o gate
 *      - gate verde → mantém o delta
 *      - gate vermelho → DESFAZ (re-aplica o estado anterior) e registra a reversão
 *   5. grava relatório em `.pi/harness/reports/refine-<timestamp>.md` com `--report`
 *
 * Regra de ouro: um delta de memória só sobrevive se NÃO piorar os evals.
 *
 * O gate é um runner injetável (opts.runGate). O default chama `node evals/gate.mjs
 * --runs 1` via spawnSync. Testes injetam um runner sintético (sem tocar em evals/).
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { openStore } from "../core/memory/store.mjs";
import { proposeDeltas, applyDeltas } from "../core/memory/refine.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_LEDGER = join(ROOT, ".pi", "harness", "ledger", "evals.jsonl");
const DEFAULT_MEMORY_ROOT = join(ROOT, ".pi", "harness", "memory");
const DEFAULT_REPORTS_DIR = join(ROOT, ".pi", "harness", "reports");
const DEFAULT_GATE = join(ROOT, "evals", "gate.mjs");

const LEVELS = ["project", "session", "skills"];

/* ------------------------------------------------------------------ */
/* CLI parsing                                                         */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const opts = {
    apply: false,
    dryRun: false,
    report: false,
    reportPath: null,
    level: "project",
    json: false,
    memoryRoot: null,
    ledger: null,
    gate: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--apply":
        opts.apply = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--report": {
        opts.report = true;
        // `--report` opcionalmente recebe o caminho; se o próximo for outro flag,
        // usa o default `.pi/harness/reports/refine-<timestamp>.md`.
        if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) opts.reportPath = next();
        break;
      }
      case "--level": {
        const v = next();
        if (!LEVELS.includes(v)) throw new Error(`refine-loop: nível inválido "${v}" (use: ${LEVELS.join(", ")})`);
        opts.level = v;
        break;
      }
      case "--json":
        opts.json = true;
        break;
      case "--memory-root":
        opts.memoryRoot = next();
        break;
      case "--ledger":
        opts.ledger = next();
        break;
      case "--gate":
        opts.gate = next();
        break;
      default:
        if (arg.startsWith("--")) throw new Error(`refine-loop: flag desconhecida "${arg}"`);
    }
  }
  return opts;
}

/* ------------------------------------------------------------------ */
/* Ledger                                                              */
/* ------------------------------------------------------------------ */

/** Lê o ledger de execuções (JSONL). Arquivo ausente = lista vazia. */
export function readLedger(file) {
  if (!existsSync(file)) return { rows: [], invalid: [], total: 0 };
  const raw = readFileSync(file, "utf8");
  if (raw.trim() === "") return { rows: [], invalid: [], total: 0 };
  const rows = [];
  const invalid = [];
  raw.split("\n").forEach((line, i) => {
    if (line.trim() === "") return;
    try {
      rows.push(JSON.parse(line));
    } catch {
      invalid.push(i);
    }
  });
  return { rows, invalid, total: rows.length + invalid.length };
}

/** Resume o ledger: total, taxa de sucesso e grupos. */
export function summarizeLedger(rows) {
  const groups = {};
  let passes = 0;
  for (const r of rows) {
    const g = r.group ?? "?";
    groups[g] = groups[g] ?? { runs: 0, passes: 0 };
    groups[g].runs++;
    if (r.passed) {
      groups[g].passes++;
      passes++;
    }
  }
  return {
    runs: rows.length,
    passes,
    rate: rows.length ? passes / rows.length : 0,
    groups,
  };
}

/* ------------------------------------------------------------------ */
/* Gate (runner injetável)                                             */
/* ------------------------------------------------------------------ */

/**
 * Runner de gate padrão: chama `node evals/gate.mjs --runs 1`.
 * Devolve { ok, code, stdout, stderr }.
 * Nunca importa `evals/` — isolar o runner evita acoplamento.
 */
export function spawnGate({ gateScript = DEFAULT_GATE } = {}) {
  const res = spawnSync(process.execPath, [gateScript, "--runs", "1"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    ok: res.status === 0,
    code: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

/* ------------------------------------------------------------------ */
/* Núcleo do loop (injetável, testável)                                */
/* ------------------------------------------------------------------ */

/**
 * Executa um ciclo de refine.
 *
 * @param {object} deps
 * @param {object} deps.store        instância de openStore
 * @param {"project"|"session"|"skills"} deps.level
 * @param {boolean} deps.apply       se false, dry-run (não escreve nada)
 * @param {(opts?: object) => {ok:boolean, code?:number}} deps.runGate  runner de gate
 * @param {string} [deps.ledgerSummary]  resumo textual do ledger para o relatório
 * @returns {Promise<object>} resultado do ciclo
 */
export async function runRefineCycle({ store, level = "project", apply = false, runGate = spawnGate, ledgerSummary = null } = {}) {
  if (!store || typeof store.query !== "function") {
    throw new Error("refine-loop: store inválido (openStore)");
  }

  // Lê incl. inválidas: a poda de linhas corrompidas é condição de applyDeltas,
  // não seletor de índice (regra da Fase 2).
  const entries = store.query({ level, includeInvalid: true });
  const deltas = proposeDeltas({ entries });

  const actionable = deltas.filter((d) => d.op === "drop" || d.op === "dedupe");
  const advisory = deltas.filter((d) => d.op === "keep" || d.op === "merge-tags");

  const base = {
    level,
    apply,
    entries: entries.length,
    deltas: deltas.length,
    actionable: actionable.length,
    advisory: advisory.length,
    ledger: ledgerSummary,
    applied: null,
    gate: null,
    reverted: false,
  };

  // Dry-run: nada é escrito, nem o gate roda.
  if (!apply) {
    return { ...base, dryRun: true, reverted: false, gate: null, applied: null };
  }

  // Estado anterior (para desfazer em caso de regressão).
  const before = store.query({ level, includeInvalid: true });
  const applied = applyDeltas(store, deltas, { level });

  // Re-roda o gate: delta de memória só sobrevive se não piorar os evals.
  let gate;
  try {
    gate = runGate();
  } catch (err) {
    gate = { ok: false, code: -1, error: err?.message ?? String(err) };
  }
  const gateOk = gate?.ok === true;

  if (!gateOk) {
    // Desfaz: regrava o estado anterior do nível.
    rollbackLevel(store, level, before);
    return { ...base, applied, gate, reverted: true, gateOk: false };
  }

  return { ...base, applied, gate, reverted: false, gateOk: true };
}

/** Regrava o nível exatamente com o estado anterior (desfaz um apply). */
function rollbackLevel(store, level, beforeEntries) {
  // Remove as entradas atuais do nível e reinsere as anteriores, preservando id/at.
  const current = store.query({ level, includeInvalid: true });
  const currentIds = new Set(current.map((e) => e.id).filter((id) => id != null));
  // Remove do arquivo tudo que não é inválido (regravar via promote não serve:
  // precisamos do arquivo bruto). Usamos o módulo de refine para reescrever.
  // applyDeltas já sabe remover por id; aqui removemos as entradas novas e
  // reinserimos as antigas.
  // Estratégia: reescreve o arquivo do nível com o snapshot anterior.
  const file = levelFile(store.root, level);
  if (!existsSync(file)) return;
  writeFileSync(file, serialize(beforeEntries), "utf8");
}

function levelFile(root, level) {
  const name = { session: "session.jsonl", project: "project.jsonl", skills: "skills.jsonl" }[level];
  if (!name) throw new Error(`refine-loop: nível inválido "${level}"`);
  return join(root, name);
}

function serialize(entries) {
  if (entries.length === 0) return "";
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
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

/** Monta o markdown do relatório de um ciclo de refine. */
export function renderRefineReport(result, { at = new Date() } = {}) {
  const lines = [];
  lines.push("# Refine — relatório de ciclo");
  lines.push("");
  lines.push(`- gerado em: ${at.toISOString()}`);
  lines.push(`- nível: \`${result.level}\``);
  lines.push(`- modo: ${result.apply ? "**apply**" : "dry-run (nada escrito)"}`);
  lines.push(`- entradas analisadas: ${result.entries}`);
  lines.push(`- deltas propostos: ${result.deltas} (acionáveis: ${result.actionable}, advisory: ${result.advisory})`);
  if (result.ledger) {
    const l = result.ledger;
    lines.push(`- ledger: ${l.passes}/${l.runs} (${pct(l.rate)})`);
  }
  lines.push("");

  if (!result.apply) {
    lines.push("> Dry-run: nenhum delta foi aplicado. Rode com `--apply` para aplicar e validar no gate.");
    lines.push("");
    if (result.deltas > 0) {
      lines.push("Deltas que SERIAM aplicados: ver saída JSON (`--json`) ou o console.");
    }
    return lines.join("\n") + "\n";
  }

  lines.push("## Resultado do apply");
  lines.push("");
  lines.push(`- entradas removidas: ${result.applied?.removed ?? 0}`);
  lines.push(`- gate: ${result.gateOk ? "✓ verde" : "✗ vermelho"}${result.gate?.code != null ? ` (exit ${result.gate.code})` : ""}`);
  lines.push(`- revertido: ${result.reverted ? "**sim**" : "não"}`);
  lines.push("");
  if (result.reverted) {
    lines.push("> Regressão detectada no gate. O delta foi DESFEITO e o estado anterior restaurado.");
  } else {
    lines.push("> Gate aprovado. O delta de memória sobreviveu.");
  }
  lines.push("");
  return lines.join("\n") + "\n";
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`refine-loop: ${err.message}\n`);
    process.exit(2);
  }

  const memoryRoot = opts.memoryRoot ? resolve(opts.memoryRoot) : DEFAULT_MEMORY_ROOT;
  const ledgerFile = opts.ledger ? resolve(opts.ledger) : DEFAULT_LEDGER;

  const store = openStore({ root: memoryRoot });

  let ledgerSummary = null;
  if (existsSync(ledgerFile)) {
    const { rows, invalid, total } = readLedger(ledgerFile);
    ledgerSummary = { ...summarizeLedger(rows), invalid: invalid.length, total };
  }

  const runGate = opts.gate ? () => spawnGate({ gateScript: resolve(opts.gate) }) : spawnGate;

  const result = await runRefineCycle({
    store,
    level: opts.level,
    apply: opts.apply && !opts.dryRun,
    runGate,
    ledgerSummary,
  });

  // Saída JSON compacta
  if (opts.json) {
    process.stdout.write(JSON.stringify(result) + "\n");
  } else {
    process.stdout.write(renderRefineReport(result));
    if (result.deltas > 0) {
      process.stdout.write("\n");
      for (const line of describeDeltas(store, opts.level)) {
        process.stdout.write(`  ${line}\n`);
      }
    }
  }

  // Grava relatório em arquivo
  if (opts.report) {
    mkdirSync(DEFAULT_REPORTS_DIR, { recursive: true });
    const out = opts.reportPath
      ? resolve(opts.reportPath)
      : join(DEFAULT_REPORTS_DIR, `refine-${tsCompact()}.md`);
    mkdirSync(resolve(out, ".."), { recursive: true });
    writeFileSync(out, renderRefineReport(result), "utf8");
    if (!opts.json) process.stdout.write(`\nrelatório: ${out}\n`);
  }

  process.exit(0);
}

/** Descreve os deltas de forma legível para o console. */
function describeDeltas(store, level) {
  const entries = store.query({ level, includeInvalid: true });
  const deltas = proposeDeltas({ entries });
  return deltas.map((d) => {
    switch (d.op) {
      case "drop":
        return `drop    ${d.id ?? "(inválida)"} — ${d.reason}`;
      case "dedupe":
        return `dedupe  remove ${d.ids.join(", ")} → mantém ${d.kept}`;
      case "keep":
        return `keep    ${d.id} — ${d.reason}`;
      case "merge-tags":
        return `merge   "${d.from}" → "${d.to}" (${d.ids.length} entrada(s))`;
      default:
        return `${d.op} ${JSON.stringify(d)}`;
    }
  });
}

// Só executa quando rodado diretamente.
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`refine-loop falhou: ${err?.stack || err?.message || err}\n`);
    process.exit(2);
  });
}