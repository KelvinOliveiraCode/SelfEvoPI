#!/usr/bin/env node
/**
 * gate.mjs — comparador de regressão da suíte de evals do SelfEvoPI.
 *
 * Roda a suíte N vezes (subprocesso de evals/run.mjs --no-ledger), agrega por
 * tarefa {runs, passes, rate, avgMs, tokens} e compara com evals/baseline.json.
 * Sai 1 se qualquer tarefa cair abaixo da linha de base; 0 se mantiver ou
 * melhorar. Latência e tokens entram no relatório como informação, não como
 * gate (medidas de modelo real oscilam entre execuções).
 *
 * Uso:
 *   node evals/gate.mjs                 # 3 execuções, compara com a baseline
 *   node evals/gate.mjs --runs 1        # 1 execução
 *   node evals/gate.mjs --group D       # só um grupo
 *   node evals/gate.mjs --update        # regrava evals/baseline.json
 */

import { execFile } from "node:child_process";
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const RUN = path.join(ROOT, "evals", "run.mjs");
const DEFAULT_BASELINE = path.join(ROOT, "evals", "baseline.json");

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const RUNS = Math.max(1, Number(argValue("runs", "3")) || 3);
const GROUP = argValue("group", null);
const UPDATE = process.argv.includes("--update");
const BASELINE = argValue("baseline", null)
  ? path.resolve(argValue("baseline"))
  : DEFAULT_BASELINE;

// Linha de resultado impressa por run.mjs:
//   "  ✓ A1-router-reviewer              155 ms  grupo A"
//   "  ✓ D1-cria-soma                   5292 ms 8237 tok  grupo D"
//   "  ✗ tarefa                           12 ms  grupo B"
const TASK_LINE = /^\s+([✓✗])\s+(\S+)\s+(\d+)\s+ms(?:\s+(\d+)\s+tok)?\s+grupo\s+(\S+)\s*$/;

export function parseRun(stdout) {
  const tasks = new Map();
  for (const line of String(stdout).split("\n")) {
    const m = line.match(TASK_LINE);
    if (!m) continue;
    const [, mark, taskId, ms, tok, group] = m;
    tasks.set(taskId, {
      taskId,
      group,
      passed: mark === "✓",
      ms: Number(ms),
      tokens: tok ? Number(tok) : 0,
    });
  }
  return tasks;
}

async function runOnce(group) {
  const args = [RUN, "--no-ledger"];
  if (group) args.push("--group", group);
  try {
    const { stdout } = await execFileAsync(process.execPath, args, {
      cwd: ROOT,
      maxBuffer: 8 * 1024 * 1024,
      timeout: 20 * 60_000,
      windowsHide: true,
    });
    return { ok: true, code: 0, tasks: parseRun(stdout) };
  } catch (err) {
    // run.mjs sai 1 quando alguma tarefa falha; ainda assim imprimimos o
    // que deu pra parsear, para não mascarar a regressão.
    return {
      ok: false,
      code: typeof err.code === "number" ? err.code : 1,
      tasks: parseRun(err.stdout || ""),
    };
  }
}

/**
 * Reexecuta UMA tarefa e devolve a taxa da última tentativa.
 * Usada só para separar regressão real de instabilidade de modelo.
 */
async function retryTask(taskId, attempts = 2) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        [RUN, "--task", taskId, "--no-ledger"],
        { cwd: ROOT, maxBuffer: 8 * 1024 * 1024, timeout: 10 * 60_000, windowsHide: true },
      );
      last = parseRun(stdout).get(taskId) ?? null;
    } catch (err) {
      last = parseRun(err.stdout || "").get(taskId) ?? null;
    }
    if (last?.passed) return { passed: true, attempts: i + 1 };
  }
  return { passed: false, attempts };
}

/**
 * Tarefas de grupo D chamam um modelo: uma execução pode falhar por variância,
 * não por regressão. Aqui a gente separa os dois sem esconder nada:
 *  - falhou e passou na reexecução → `flaky` (relatado, não reprova)
 *  - falhou de novo → regressão real
 */
export async function classifyRegressions(regressions, baselineTasks) {
  const real = [];
  const flaky = [];
  for (const r of regressions) {
    const isStochastic = r.group === "D" || baselineTasks?.[r.taskId]?.stochastic === true;
    if (isStochastic) {
      const retry = await retryTask(r.taskId, 2);
      if (retry.passed) {
        flaky.push({ ...r, retryAttempts: retry.attempts });
        continue;
      }
      real.push({ ...r, retryAttempts: retry.attempts });
      continue;
    }
    real.push(r);
  }
  return { real, flaky };
}

export async function runSuite(runs, group) {
  const agg = new Map();
  for (let i = 0; i < runs; i++) {
    const r = await runOnce(group);
    process.stderr.write(
      `  execução ${i + 1}/${runs}: ${r.tasks.size} tarefa(s)${r.ok ? "" : ` [run.mjs saiu ${r.code}]`}\n`,
    );
    if (r.tasks.size === 0) {
      process.stderr.write(
        `  aviso: nenhuma tarefa parseada na execução ${i + 1} (saída inesperada de run.mjs)\n`,
      );
    }
    for (const [id, t] of r.tasks) {
      const cur =
        agg.get(id) ?? { taskId: id, group: t.group, runs: 0, passes: 0, totalMs: 0, tokens: 0 };
      cur.runs++;
      cur.passes += t.passed ? 1 : 0;
      cur.totalMs += t.ms || 0;
      cur.tokens += t.tokens || 0;
      agg.set(id, cur);
    }
  }
  return [...agg.values()].map((t) => ({
    ...t,
    rate: t.passes / t.runs,
    avgMs: Math.round(t.totalMs / t.runs),
  }));
}

export async function loadBaseline(file = DEFAULT_BASELINE) {
  const raw = await readFile(file, "utf8").catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Mapa taskId -> { group, hasPrompt } lido de evals/tasks/*.json.
 * `hasPrompt` marca tarefas que rodam um modelo (grupo B/D reais): são
 * estocásticas e, portanto, sujeitas a instabilidade de modelo, não a regressão.
 */
export async function loadTaskDefs() {
  const dir = path.join(ROOT, "evals", "tasks");
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".json"));
  const map = new Map();
  for (const file of files) {
    let doc;
    try {
      doc = JSON.parse(await readFile(path.join(dir, file), "utf8"));
    } catch {
      continue;
    }
    for (const t of Array.isArray(doc) ? doc : [doc]) {
      if (!t || typeof t.id !== "string") continue;
      map.set(t.id, { group: t.group, hasPrompt: typeof t.prompt === "string" && t.prompt.trim().length > 0 });
    }
  }
  return map;
}

export function totalsOf(tasks) {
  const taskRuns = tasks.reduce((n, t) => n + t.runs, 0);
  const passes = tasks.reduce((n, t) => n + t.passes, 0);
  const totalMs = tasks.reduce((n, t) => n + t.totalMs, 0);
  const tokens = tasks.reduce((n, t) => n + t.tokens, 0);
  return {
    taskRuns,
    passes,
    rate: taskRuns ? passes / taskRuns : 0,
    avgMs: taskRuns ? Math.round(totalMs / taskRuns) : 0,
    tokens,
    costUsd: 0, // grupo D usa modelos :free; custo real é 0
  };
}

export function compare(current, baseline) {
  const regressions = [];
  const baseTasks = baseline?.tasks ?? {};
  for (const cur of current) {
    const base = baseTasks[cur.taskId];
    if (!base) continue; // tarefa nova: não é regressão
    const curRate = cur.rate;
    const baseRate = Number(base.rate) || 0;
    if (curRate + 1e-9 < baseRate) {
      regressions.push({
        taskId: cur.taskId,
        group: cur.group,
        from: baseRate,
        to: curRate,
        basePasses: base.passes,
        baseRuns: base.runs,
        curPasses: cur.passes,
        curRuns: cur.runs,
      });
    }
  }
  return regressions;
}

function pct(rate) {
  return `${(rate * 100).toFixed(0)}%`;
}

export async function main() {
  const baseline = await loadBaseline();

  if (UPDATE) {
    process.stderr.write(`coletando linha de base (${RUNS} execução(ões)${GROUP ? `, grupo ${GROUP}` : ""})...\n`);
    const tasks = await runSuite(RUNS, GROUP);
    if (tasks.length === 0) {
      console.error("nenhuma tarefa medida; baseline não gravada");
      process.exit(2);
    }
    tasks.sort((a, b) => a.taskId.localeCompare(b.taskId));
    const defs = await loadTaskDefs();
    const doc = {
      generatedAt: new Date().toISOString(),
      generator: "evals/gate.mjs --update",
      runs: RUNS,
      group: GROUP,
      tasks: Object.fromEntries(
        tasks.map((t) => [
          t.taskId,
          {
            group: t.group,
            runs: t.runs,
            passes: t.passes,
            rate: t.rate,
            avgMs: t.avgMs,
            tokens: t.tokens,
            ...(defs.get(t.taskId)?.hasPrompt ? { stochastic: true } : {}),
          },
        ]),
      ),
      totals: totalsOf(tasks),
    };
    await writeFile(BASELINE, JSON.stringify(doc, null, 2) + "\n", "utf8");
    console.log(`baseline gravada: ${path.relative(ROOT, BASELINE)} (${tasks.length} tarefas, ${RUNS} execuções)`);
    process.exit(0);
  }

  if (!baseline) {
    console.error(`baseline ausente ou inválida: ${path.relative(ROOT, BASELINE)}`);
    console.error("gere com: node evals/gate.mjs --update");
    process.exit(2);
  }

  process.stderr.write(`comparando com baseline de ${baseline.generatedAt} (${baseline.runs} execução(ões))\n`);
  process.stderr.write(`rodando ${RUNS} execução(ões)${GROUP ? `, grupo ${GROUP}` : ""}...\n`);
  const current = await runSuite(RUNS, GROUP);
  current.sort((a, b) => a.taskId.localeCompare(b.taskId));

  // Ao filtrar por grupo, só compara tarefas daquele grupo.
  const baseTasks = baseline.tasks ?? {};
  const comparable = current.filter((t) => {
    if (!baseTasks[t.taskId]) return false;
    if (GROUP && baseTasks[t.taskId].group !== GROUP) return false;
    return true;
  });

  const rawRegressions = compare(comparable, baseline);
  const { real: regressions, flaky } = await classifyRegressions(rawRegressions, baseTasks);
  const curTotals = totalsOf(comparable);
  const baseTotals = {
    rate: baseline.totals?.rate ?? 0,
    avgMs: baseline.totals?.avgMs ?? 0,
    tokens: baseline.totals?.tokens ?? 0,
  };

  // ---- relatório ----
  const lines = [];
  lines.push("# Gate de regressão — SelfEvoPI");
  lines.push("");
  lines.push(`- baseline: \`${path.relative(ROOT, BASELINE)}\` de ${baseline.generatedAt} (${baseline.runs} exec.)`);
  lines.push(`- atual: ${RUNS} execução(ões)${GROUP ? ` · grupo ${GROUP}` : " · todos os grupos"}`);
  lines.push("");
  lines.push("| tarefa | grupo | baseline | atual | Δ acerto | latência | tokens |");
  lines.push("|:---|:---|:---|:---|:---|:---|:---|");

  for (const t of comparable) {
    const base = baseTasks[t.taskId];
    const baseRate = Number(base.rate) || 0;
    const delta = t.rate - baseRate;
    const mark = delta < -1e-9 ? "▼" : delta > 1e-9 ? "▲" : "=";
    const baseCell = `${pct(baseRate)} (${base.passes}/${base.runs})`;
    const curCell = `${pct(t.rate)} (${t.passes}/${t.runs})`;
    lines.push(
      `| \`${t.taskId}\` | ${t.group} | ${baseCell} | ${curCell} | ${mark} | ${t.avgMs} ms | ${t.tokens} |`,
    );
  }

  lines.push("");
  lines.push(
    `**Totais:** ${curTotals.passes}/${curTotals.taskRuns} (${pct(curTotals.rate)}) · ` +
      `latência média ${curTotals.avgMs} ms · ${curTotals.tokens} tokens · custo US$ 0,0000 (free tier)`,
  );
  lines.push(
    `**Baseline:** ${pct(baseTotals.rate)} · latência média ${baseTotals.avgMs} ms · ${baseTotals.tokens} tokens`,
  );
  lines.push("");

  if (flaky.length > 0) {
    lines.push(`**Instáveis (reexecução confirmou, não reprova) (${flaky.length}):**`);
    for (const f of flaky) {
      lines.push(
        `- \`${f.taskId}\` (${f.group}): ${pct(f.from)} → ${pct(f.to)} na 1ª passada; passou ao reexecutar (${f.retryAttempts} tentativa(s))`,
      );
    }
    lines.push("");
  }

  if (regressions.length > 0) {
    lines.push(`**Regressões (${regressions.length}):**`);
    for (const r of regressions) {
      lines.push(
        `- \`${r.taskId}\` (${r.group}): ${pct(r.from)} → ${pct(r.to)} ` +
          `(${r.basePasses}/${r.baseRuns} → ${r.curPasses}/${r.curRuns})` +
          (r.retryAttempts ? ` [reexecutada ${r.retryAttempts}x, falhou de novo]` : ""),
      );
    }
    lines.push("");
    lines.push("✗ GATE REPROVADO — há tarefa abaixo da linha de base.");
    console.log(lines.join("\n"));
    process.exit(1);
  }

  lines.push("✓ GATE APROVADO — nenhuma tarefa abaixo da linha de base.");
  console.log(lines.join("\n"));
  process.exit(0);
}

// Só executa quando rodado diretamente; importar as funções (testes) não dispara main().
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("gate.mjs falhou:", err?.stack || err?.message || err);
    process.exit(2);
  });
}