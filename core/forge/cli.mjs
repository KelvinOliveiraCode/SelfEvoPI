#!/usr/bin/env node
/**
 * selfevopi-forge-cli — a linha de frente do Núcleo Evolutivo.
 *
 * Comandos:
 *   node core/forge/cli.mjs detect [--json]
 *   node core/forge/cli.mjs evolve --task <id> [--dry-run] [--json]
 *   node core/forge/cli.mjs gate   --artifact <dir> --task <id> [--json]
 *   node core/forge/cli.mjs status
 *
 * Saída JSON compacta (uma linha) com --json; texto curto sem ele.
 *
 * Não edita evals/ nem core/governance/: só os consome.
 */

import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { detectGaps } from "./detect.mjs";
import { runGate, decidePromotion } from "./gatekeeper.mjs";
import { createEvolutionLoop } from "./loop.mjs";
import { promoteArtifact } from "./promote.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const LEDGER = path.join(ROOT, ".pi", "harness", "ledger", "evals.jsonl");
const BASELINE = path.join(ROOT, "evals", "baseline.json");
const TASKS_DIR = path.join(ROOT, "evals", "tasks");
const DEFAULT_MODEL = process.env.SELFEOPI_MODEL || "kilo1/nvidia/nemotron-3-ultra-550b-a55b:free";

/* ------------------------------------------------------------------ */
/* Args                                                                */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out.flags[key] = next;
        i++;
      } else {
        out.flags[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function jsonLine(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function text(line) {
  process.stdout.write(line + "\n");
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

/**
 * runEvals real: chama `evals/run.mjs --task <id>` N vezes.
 *
 * Quando a tarefa não existe (artefato gerado para um objetivo novo, sem tarefa
 * no ledger), devolve `{ skipped: true }` em vez de reprovar: o gate passa a
 * julgar pela evidência do próprio artefato, e diz isso no laudo.
 */
async function realRunEvals({ taskId, runs }) {
  if (!taskId || !existsSync(path.join(TASKS_DIR, `${taskId}.json`))) {
    return [{ skipped: true, reason: `sem tarefa de eval "${taskId}"` }];
  }
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const results = [];
  for (let i = 0; i < (runs ?? 1); i++) {
    try {
      await execFileAsync(process.execPath, [path.join(ROOT, "evals", "run.mjs"), "--task", taskId, "--no-ledger"], {
        cwd: ROOT,
        timeout: 200_000,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      });
      results.push({ passed: true, tokens: 0 });
    } catch (err) {
      results.push({ passed: false, tokens: 0, error: String(err?.message ?? err).slice(0, 200) });
    }
  }
  return results;
}

/**
 * Promoção real: copia o artefato para `.pi/harness/artifacts/`, faz o commit
 * atômico e grava `last-known-good.json`.
 *
 * O `verify` que alimenta o checkpoint é o próprio laudo do gate: se o gate
 * reprovou (regressão), não há estado verde a gravar. Evita que um artefato
 * reprovado vire "último estado bom" por engano.
 */
async function realPromote({ artifactDir, report, request }) {
  const taskId = request?.taskId ?? report?.taskId ?? "tarefa";
  // Sem tarefa de eval, a evidência é a do próprio artefato (mesmo critério do gate).
  const gateOk = report?.skipped
    ? (report?.testEvidence ?? []).length > 0 && report.testEvidence.every((t) => t?.passed === true)
    : report?.regressed !== true && (report?.passes ?? 0) === (report?.runs ?? 0);
  return promoteArtifact({
    artifactDir,
    taskId,
    request: { ...request, goal: request?.goal ?? taskId },
    repoRoot: ROOT,
    verify: async () => ({
      ok: gateOk,
      detail: report?.skipped
        ? "sem tarefa de eval; evidência do artefato"
        : `gate: ${report?.passes ?? 0}/${report?.runs ?? 0} execucoes, delta ${report?.deltaTokens ?? 0} tokens`,
    }),
    message: `evo(${taskId}): artefato aprovado pelo gate`,
  });
}

/** Converte "a,b,c" em { a: "a", b: "b" } (ou null). */
function parseList(value) {
  if (typeof value !== "string") return null;
  const items = value.split(",").map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) return null;
  const out = {};
  for (const k of items) out[k] = k;
  return out;
}

/* ------------------------------------------------------------------ */
/* Modelo (usado pelo gerador com modelo)                              */
/* ------------------------------------------------------------------ */

/**
 * Cria um `runModel` que chama o PI em modo texto.
 *
 * Vive no CLI (camada de composição) e não em `core/`: assim o núcleo não
 * depende de `evals/`, que é área protegida.
 */
function makeRunModel({ model, timeoutMs = 120_000 } = {}) {
  return async ({ prompt }) => {
    const { spawnSync } = await import("node:child_process");
    const bundle = path.join(
      process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming"),
      "npm", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js",
    );
    const args = process.platform === "win32" ? [bundle] : [];
    const cmd = process.platform === "win32" ? process.execPath : "pi";
    const res = spawnSync(
      cmd,
      [...args, "--model", model, "--approve", "--mode", "text", "--print", prompt],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, windowsHide: true, timeout: timeoutMs },
    );
    if (res.status !== 0) {
      const detail = String(res.stderr || res.stdout || "").trim().split("\n")[0] || `exit ${res.status}`;
      throw new Error(`pi saiu com código ${res.status}: ${detail.slice(0, 200)}`);
    }
    return { text: String(res.stdout ?? ""), tokens: null };
  };
}

/* ------------------------------------------------------------------ */
/* Comandos                                                            */
/* ------------------------------------------------------------------ */

async function cmdDetect(args) {
  const det = await detectGaps({
    ledger: LEDGER,
    threshold: Number(args.flags.threshold ?? 3),
    maxGaps: Number(args.flags["max-gaps"] ?? 20),
    tokenCeiling: Number(args.flags["token-ceiling"] ?? 0),
  });
  if (args.flags.json) {
    jsonLine({ ok: true, scanned: det.scanned, counts: det.counts, gaps: det.gaps });
  } else {
    text(`scanned: ${det.scanned}`);
    text(`gaps: ${det.gaps.length}  (${det.counts["tool-failing"]} failing, ${det.counts["tool-missing"]} missing, ${det.counts["tool-fragile"]} fragile)`);
    for (const g of det.gaps) text(`  - [${g.kind}] ${g.taskId} → ${g.capability}`);
  }
  return 0;
}

async function cmdEvolve(args) {
  const taskId = args.flags.task;
  const goal = typeof args.flags.goal === "string" ? args.flags.goal : null;

  // Duas formas de pedir um ciclo: por tarefa do ledger (detect) ou por objetivo
  // explícito (--goal), que sintetiza a lacuna na hora.
  if ((!taskId || taskId === true) && !goal) {
    if (args.flags.json) jsonLine({ ok: false, error: "informe --task <id> ou --goal \"<objetivo>\"" });
    else text("erro: informe --task <id> ou --goal \"<objetivo>\"");
    return 2;
  }

  // Um CLI sem entradas declaradas não tem teste de interface possível: gerar
  // assim produziria evidência fraca. Melhor recusar e pedir o contrato.
  const wantKind = typeof args.flags.kind === "string" ? args.flags.kind : null;
  if (goal && wantKind === "cli" && typeof args.flags.inputs !== "string") {
    const msg = "para --kind cli, declare --inputs \"nome,nome\" (e --outputs \"chave,chave\"): sem contrato não há teste de interface";
    if (args.flags.json) jsonLine({ ok: false, error: msg });
    else text(`erro: ${msg}`);
    return 2;
  }

  const baseline = await readJson(BASELINE, {});
  // dry-run não toca em modelo real: stub neutro determinístico, 1 execução.
  const dryRun = Boolean(args.flags["dry-run"]);
  const runEvals = dryRun ? async () => [{ passed: true, tokens: 0 }] : (opts) => realRunEvals(opts);

  // `--llm` troca o gerador de esqueleto pelo gerador com modelo. Se ele falhar,
  // o loop cai no gerador de template (o artefato existe, mas é esqueleto).
  const useLlm = Boolean(args.flags.llm) && !dryRun;
  let generate;
  let onGenerateError = null;
  if (useLlm) {
    const model = typeof args.flags.model === "string" ? args.flags.model : DEFAULT_MODEL;
    const runModel = makeRunModel({ model });
    const { generateWithModel } = await import("./generate-llm.mjs");
    generate = async (request, outDir) => {
      try {
        return await generateWithModel({ request, outDir, runModel, model });
      } catch (err) {
        onGenerateError = { code: err?.code ?? "erro", message: err?.message ?? String(err) };
        const { generateCli } = await import("./generate-cli.mjs");
        return generateCli(request, outDir);
      }
    };
  }

  const loop = createEvolutionLoop({
    runEvals,
    promote: realPromote,
    ...(generate ? { generate } : {}),
    onEvent: args.flags.json ? null : (e) => text(`  · ${e.event}${e.reason ? ` (${e.reason})` : ""}`),
  });

  const report = await loop.evolve({
    taskId: taskId === true ? null : taskId,
    goal,
    forceKind: wantKind ?? undefined,
    inputs: parseList(args.flags.inputs),
    outputs: parseList(args.flags.outputs),
    ledger: LEDGER,
    baseline,
    toleranceTokens: Number(args.flags["tolerance-tokens"] ?? 0),
    dryRun,
    runs: dryRun ? 1 : Number(args.flags.runs ?? 3),
  });

  if (args.flags.json) {
    jsonLine({ ok: report.outcome !== "error", report, generate: useLlm ? "modelo" : "template", generateError: onGenerateError });
  } else {
    text(`outcome: ${report.outcome}`);
    if (report.gap) text(`gap: [${report.gap.kind}] ${report.gap.taskId}`);
    if (report.kind) text(`kind: ${report.kind}`);
    if (report.verify) {
      text(`verify: ${report.verify.ok ? "pass" : "fail"} (exit ${report.verify.status})`);
      if (report.verify.ok === false) {
        const detail = String(report.verify.stdout || report.verify.stderr || "").trim().split("\n").slice(0, 6);
        for (const line of detail) text(`  | ${line}`);
      }
    }
    if (report.decision) text(`gate: ${report.decision.promote ? "promover" : "reprovar"} ${report.decision.reasons.join("; ")}`);
    if (report.promoted?.path) text(`artefato: ${report.promoted.path}`);
    if (onGenerateError) text(`gerador com modelo falhou (${onGenerateError.code}): ${onGenerateError.message}`);
  }
  return report.outcome === "rejected" || report.outcome === "error" ? 1 : 0;
}

async function cmdGate(args) {
  const artifact = args.flags.artifact;
  const taskId = args.flags.task;
  if (!artifact || artifact === true || !taskId || taskId === true) {
    if (args.flags.json) jsonLine({ ok: false, error: "informe --artifact <dir> e --task <id>" });
    else text("erro: informe --artifact <dir> e --task <id>");
    return 2;
  }
  const baseline = await readJson(BASELINE, {});
  const report = await runGate({
    artifactDir: artifact,
    request: { goal: taskId, kind: "skill", taskId, tests: [{ name: "smoke", command: 'node -e "process.exit(0)"' }] },
    runEvals: (opts) => realRunEvals(opts),
    baseline,
    toleranceTokens: Number(args.flags["tolerance-tokens"] ?? 0),
    runs: Number(args.flags.runs ?? 1),
  });
  const decision = decidePromotion(report, { toleranceTokens: args.flags["tolerance-tokens"] });
  if (args.flags.json) {
    jsonLine({ ok: decision.promote, report, decision });
  } else {
    text(`task: ${report.taskId}`);
    text(`passes: ${report.passes}/${report.runs}  tokens: ${report.avgTokens} (baseline ${report.baselineTokens}, delta ${report.deltaTokens})`);
    text(`decisão: ${decision.promote ? "promover" : "reprovar"} ${decision.reasons.join("; ")}`);
  }
  return decision.promote ? 0 : 1;
}

async function cmdStatus() {
  const det = await detectGaps({ ledger: LEDGER, threshold: 3, maxGaps: 5 });
  const lkg = await readJson(path.join(ROOT, ".pi", "harness", "last-known-good.json"), {});
  const baseline = await readJson(BASELINE, {});
  const taskCount = baseline?.totals?.taskRuns ?? 0;
  const rate = baseline?.totals?.rate ?? null;
  text(`last-known-good: ${lkg.sha ?? "?"} (${lkg.phase ?? "?"})`);
  text(`baseline: ${taskCount} execuções, taxa ${rate ?? "?"}`);
  text(`gaps abertos (top 5): ${det.gaps.length}`);
  for (const g of det.gaps) text(`  - [${g.kind}] ${g.taskId}`);
  return 0;
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  let code = 0;
  if (cmd === "detect") code = await cmdDetect(args);
  else if (cmd === "evolve") code = await cmdEvolve(args);
  else if (cmd === "gate") code = await cmdGate(args);
  else if (cmd === "status") code = await cmdStatus();
  else {
    if (args.flags.json) jsonLine({ ok: false, error: "comando desconhecido" });
    else {
      text("uso:");
      text("  node core/forge/cli.mjs detect [--json]");
      text("  node core/forge/cli.mjs evolve --task <id> [--dry-run] [--json]");
      text("  node core/forge/cli.mjs gate --artifact <dir> --task <id>");
      text("  node core/forge/cli.mjs status");
    }
    code = 2;
  }
  process.exitCode = code;
}

main();