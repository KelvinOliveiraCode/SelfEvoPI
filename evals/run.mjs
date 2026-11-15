#!/usr/bin/env node
/**
 * run.mjs — executor da suíte de evals do SelfEvoPI.
 *
 * Para cada tarefa em evals/tasks/*.json:
 *   1. cria um workspace temporario
 *   2. executa o checker (comando determinístico) nesse workspace
 *   3. mede duração, tokens e custo (quando informados pelo checker)
 *   4. grava uma linha no ledger JSONL
 *
 * O checker recebe:
 *   EVAL_WORKDIR  — diretorio temporario da tarefa
 *   EVAL_TASK_ID  — id da tarefa
 * e deve sair 0 (passou) ou != 0 (falhou). Pode imprimir JSON em stdout com
 * { tokens, costUsd, metrics } para enriquecer o ledger.
 *
 * Uso:
 *   node evals/run.mjs                  # todas as tarefas
 *   node evals/run.mjs --group A        # so o grupo A
 *   node evals/run.mjs --task A1-...    # uma tarefa
 *   node evals/run.mjs --no-ledger      # nao grava (dry-run)
 */

import { readdir, readFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import { append, record } from "./lib/ledger.mjs";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const TASKS_DIR = path.join(ROOT, "evals", "tasks");
const LEDGER = path.join(ROOT, ".pi", "harness", "ledger", "evals.jsonl");

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const onlyGroup = argValue("group");
const onlyTask = argValue("task");
const noLedger = process.argv.includes("--no-ledger");

async function loadTasks() {
  const files = (await readdir(TASKS_DIR).catch(() => [])).filter((f) => f.endsWith(".json"));
  const tasks = [];
  for (const file of files) {
    const doc = JSON.parse(await readFile(path.join(TASKS_DIR, file), "utf8"));
    const list = Array.isArray(doc) ? doc : [doc];
    for (const t of list) tasks.push({ ...t, _file: file });
  }
  return tasks;
}

async function runChecker(task) {
  const workdir = await mkdtemp(path.join(tmpdir(), `selfevopi-${task.id}-`));
  const [cmd, ...rawArgs] = task.checker.split(" ");
  // paths relativos ao repo (evals/..., core/...) precisam virar absolutos:
  // o checker roda com cwd = worktree temporario, nao na raiz.
  const args = rawArgs.map((a) => (a.startsWith("evals/") || a.startsWith("core/") || a.startsWith("scripts/") ? path.join(ROOT, a) : a));
  const executable = cmd === "node" || cmd === "nodejs" ? process.execPath : cmd;
  const started = performance.now();
  try {
    const { stdout } = await execFileAsync(executable, args, {
      cwd: workdir,
      env: { ...process.env, EVAL_WORKDIR: workdir, EVAL_TASK_ID: task.id },
      timeout: task.timeoutMs ?? 30_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    const durationMs = performance.now() - started;
    let meta = {};
    try {
      meta = JSON.parse(String(stdout).trim().split("\n").pop());
    } catch {
      /* checker nao emitiu JSON */
    }
    return { passed: true, durationMs, meta, workdir };
  } catch (err) {
    const durationMs = performance.now() - started;
    return {
      passed: false,
      durationMs,
      meta: {},
      error: err.stderr?.toString().slice(0, 500) || err.message,
      workdir,
    };
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  let tasks = await loadTasks();
  if (onlyTask) tasks = tasks.filter((t) => t.id === onlyTask);
  if (onlyGroup) tasks = tasks.filter((t) => t.group === onlyGroup);

  if (tasks.length === 0) {
    console.error("nenhuma tarefa encontrada");
    process.exit(2);
  }

  const results = [];
  console.log(`Executando ${tasks.length} tarefa(s)\n`);

  for (const task of tasks) {
    const r = await runChecker(task);
    const rec = record({
      taskId: task.id,
      group: task.group,
      passed: r.passed,
      durationMs: r.durationMs,
      tokens: r.meta.tokens ?? 0,
      costUsd: r.meta.costUsd ?? 0,
      error: r.error ?? null,
      metrics: r.meta.metrics ?? {},
    });
    results.push(rec);
    const mark = r.passed ? "✓" : "✗";
    const ms = String(Math.round(r.durationMs)).padStart(5);
    console.log(`  ${mark} ${task.id.padEnd(28)} ${ms} ms  grupo ${task.group}`);
    if (!r.passed && r.error) console.log(`      ${r.error.split("\n")[0].slice(0, 140)}`);
  }

  if (!noLedger) {
    await mkdir(path.dirname(LEDGER), { recursive: true });
    await append(LEDGER, results);
    console.log(`\n  ledger: ${path.relative(ROOT, LEDGER)}`);
  }

  const passed = results.filter((r) => r.passed).length;
  const totalMs = results.reduce((n, r) => n + r.durationMs, 0);
  console.log(`\n  resultado: ${passed}/${results.length}  ·  ${Math.round(totalMs)} ms`);
  process.exit(passed === results.length ? 0 : 1);
}

main();