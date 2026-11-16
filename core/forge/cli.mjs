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
import path from "node:path";
import process from "node:process";

import { detectGaps } from "./detect.mjs";
import { runGate, decidePromotion } from "./gatekeeper.mjs";
import { createEvolutionLoop } from "./loop.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const LEDGER = path.join(ROOT, ".pi", "harness", "ledger", "evals.jsonl");
const BASELINE = path.join(ROOT, "evals", "baseline.json");
const TASKS_DIR = path.join(ROOT, "evals", "tasks");

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

/** runEvals real: chama evals/run.mjs --task <id> --no-ledger e lê o ledger? */
async function realRunEvals({ taskId, runs }) {
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

/* ------------------------------------------------------------------ */
/* Comandos                                                            */
/* ------------------------------------------------------------------ */

async function cmdDetect(args) {
  const det = await detectGaps({
    ledger: LEDGER,
    threshold: Number(args.flags.threshold ?? 3),
    maxGaps: Number(args.flags["max-gaps"] ?? 20),
    tokenCeiling: Number(args.flags["token-ceiling"] ?? 8000),
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
  if (!taskId || taskId === true) {
    if (args.flags.json) jsonLine({ ok: false, error: "informe --task <id>" });
    else text("erro: informe --task <id>");
    return 2;
  }

  const baseline = await readJson(BASELINE, {});
  // dry-run não toca em modelo real: stub neutro determinístico, 1 execução.
  const dryRun = Boolean(args.flags["dry-run"]);
  const runEvals = dryRun ? async () => [{ passed: true, tokens: 0 }] : (opts) => realRunEvals(opts);
  const loop = createEvolutionLoop({
    runEvals,
    onEvent: args.flags.json ? null : (e) => text(`  · ${e.event}${e.reason ? ` (${e.reason})` : ""}`),
  });

  const report = await loop.evolve({
    taskId,
    ledger: LEDGER,
    baseline,
    toleranceTokens: Number(args.flags["tolerance-tokens"] ?? 0),
    dryRun,
    runs: dryRun ? 1 : Number(args.flags.runs ?? 3),
  });

  if (args.flags.json) {
    jsonLine({ ok: report.outcome !== "error", report });
  } else {
    text(`outcome: ${report.outcome}`);
    if (report.gap) text(`gap: [${report.gap.kind}] ${report.gap.taskId}`);
    if (report.kind) text(`kind: ${report.kind}`);
    if (report.verify) text(`verify: ${report.verify.ok ? "pass" : "fail"} (exit ${report.verify.status})`);
    if (report.decision) text(`gate: ${report.decision.promote ? "promover" : "reprovar"} ${report.decision.reasons.join("; ")}`);
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