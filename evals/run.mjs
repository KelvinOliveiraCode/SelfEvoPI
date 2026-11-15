#!/usr/bin/env node
/**
 * run.mjs — executor da suíte de evals do SelfEvoPI.
 *
 * Dois tipos de tarefa:
 *
 *  - estrutural (sem "prompt"): roda apenas o checker num workspace temporário
 *  - modelo real (com "prompt"): copia a fixture, chama o PI, depois roda o
 *    checker no MESMO workspace, medindo tokens, custo e latência
 *
 * O checker recebe EVAL_WORKDIR e EVAL_TASK_ID e sai 0 (passou) ou != 0.
 * Pode imprimir JSON em stdout com { tokens, costUsd, metrics }.
 *
 * Uso:
 *   node evals/run.mjs                  # todas
 *   node evals/run.mjs --group A        # um grupo
 *   node evals/run.mjs --task A1-...    # uma tarefa
 *   node evals/run.mjs --no-ledger      # não grava
 */

import { readdir, readFile, mkdtemp, rm, mkdir, cp } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import { append, record } from "./lib/ledger.mjs";
import { runPi } from "./lib/pi.mjs";
import { fromPiConfig } from "../core/router/router.mjs";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const TASKS_DIR = path.join(ROOT, "evals", "tasks");
const FIXTURES = path.join(ROOT, "evals", "fixtures");
const LEDGER = path.join(ROOT, ".pi", "harness", "ledger", "evals.jsonl");

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const onlyGroup = argValue("group");
const onlyTask = argValue("task");
const noLedger = process.argv.includes("--no-ledger");

let routerPromise = null;
function getRouter() {
  if (!routerPromise) {
    routerPromise = fromPiConfig(path.join(process.env.USERPROFILE || process.env.HOME, ".pi", "agent", "models.json")).catch(() => null);
  }
  return routerPromise;
}

async function loadTasks() {
  const files = (await readdir(TASKS_DIR).catch(() => [])).filter((f) => f.endsWith(".json"));
  const tasks = [];
  for (const file of files) {
    const doc = JSON.parse(await readFile(path.join(TASKS_DIR, file), "utf8"));
    for (const t of Array.isArray(doc) ? doc : [doc]) tasks.push({ ...t, _file: file });
  }
  return tasks;
}

function resolveRepoPath(p) {
  return p.startsWith("evals/") || p.startsWith("core/") || p.startsWith("scripts/") ? path.join(ROOT, p) : p;
}

async function runChecker(task, workdir) {
  const [cmd, ...rawArgs] = task.checker.split(" ");
  const args = rawArgs.map(resolveRepoPath);
  const executable = cmd === "node" || cmd === "nodejs" ? process.execPath : cmd;
  const started = performance.now();
  try {
    const { stdout } = await execFileAsync(executable, args, {
      cwd: workdir,
      env: { ...process.env, EVAL_WORKDIR: workdir, EVAL_TASK_ID: task.id, ...(task.env || {}) },
      timeout: task.checkerTimeoutMs ?? 30_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    const durationMs = performance.now() - started;
    let meta = {};
    try {
      meta = JSON.parse(String(stdout).trim().split("\n").pop());
    } catch {
      /* checker não emitiu JSON */
    }
    return { passed: true, checkerMs: durationMs, meta };
  } catch (err) {
    return {
      passed: false,
      checkerMs: performance.now() - started,
      meta: {},
      error: (err.stderr?.toString() || err.message || "").slice(0, 800),
    };
  }
}

async function runTask(task) {
  const workdir = await mkdtemp(path.join(tmpdir(), `selfevopi-${task.id}-`));
  try {
    if (task.fixture) {
      await cp(path.join(FIXTURES, task.fixture), workdir, { recursive: true });
    }

    let usage = null;
    let piMs = 0;
    let modelRef = null;
    let piError = null;

    if (task.prompt) {
      const router = await getRouter();
      if (!router) {
        return { passed: false, error: "models.json inacessível e tarefa exige modelo real" };
      }
      const pick = router.pick(task.profile || "worker", { model: task.model });
      modelRef = pick.ref;
      try {
        const r = await runPi({ model: pick.ref, prompt: task.prompt, cwd: workdir, timeoutMs: task.timeoutMs ?? 180_000 });
        usage = r.usage;
        piMs = r.durationMs;
      } catch (err) {
        piError = (err.stderr?.toString() || err.message || "").slice(0, 800);
        return { passed: false, error: `pi falhou: ${piError}`, modelRef };
      }
    }

    const check = await runChecker(task, workdir);
    return {
      passed: check.passed,
      error: check.error ?? null,
      checkerMs: check.checkerMs,
      meta: check.meta,
      usage,
      modelRef,
      totalMs: piMs + check.checkerMs,
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
  const hasModel = tasks.some((t) => t.prompt);
  console.log(`Executando ${tasks.length} tarefa(s)${hasModel ? " (inclui modelo real)" : ""}\n`);

  for (const task of tasks) {
    const r = await runTask(task);
    const usage = r.usage ?? {};
    const rec = record({
      taskId: task.id,
      group: task.group,
      passed: r.passed,
      durationMs: r.totalMs ?? r.checkerMs ?? 0,
      tokens: usage.total ?? r.meta?.tokens ?? 0,
      costUsd: usage.costUsd ?? r.meta?.costUsd ?? 0,
      runner: task.prompt ? "pi" : "local",
      error: r.error ?? null,
      metrics: {
        ...(r.meta?.metrics ?? {}),
        ...(usage.total ? { input: usage.input, output: usage.output, cacheRead: usage.cacheRead } : {}),
        ...(r.modelRef ? { model: r.modelRef } : {}),
      },
    });
    results.push(rec);

    const mark = r.passed ? "✓" : "✗";
    const ms = String(Math.round(rec.durationMs)).padStart(6);
    const tok = rec.tokens ? ` ${rec.tokens} tok` : "";
    console.log(`  ${mark} ${task.id.padEnd(28)} ${ms} ms${tok}  grupo ${task.group}`);
    if (!r.passed && r.error) console.log(`      ${r.error.split("\n")[0].slice(0, 150)}`);
  }

  if (!noLedger) {
    await mkdir(path.dirname(LEDGER), { recursive: true });
    await append(LEDGER, results);
    console.log(`\n  ledger: ${path.relative(ROOT, LEDGER)}`);
  }

  const passed = results.filter((r) => r.passed).length;
  const totalMs = results.reduce((n, r) => n + r.durationMs, 0);
  const totalTok = results.reduce((n, r) => n + r.tokens, 0);
  console.log(`\n  resultado: ${passed}/${results.length}  ·  ${Math.round(totalMs)} ms  ·  ${totalTok} tokens`);
  process.exit(passed === results.length ? 0 : 1);
}

main();