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

export const ROOT = path.resolve(import.meta.dirname, "..", "..");
export const LEDGER = path.join(ROOT, ".pi", "harness", "ledger", "evals.jsonl");
export const BASELINE = path.join(ROOT, "evals", "baseline.json");
export const TASKS_DIR = path.join(ROOT, "evals", "tasks");
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
 * Extrai a contagem de tokens da linha resumo do `evals/run.mjs`:
 *   "  resultado: 3/3  ·  1234 ms  ·  5678 tokens"
 *
 * `parsed` é false quando a linha não aparece (ex.: eval que falhou antes de
 * imprimir o resumo) — o chamador decide o que fazer com tokens=0 nesses casos.
 */
function parseEvalTokens(stdout) {
  const text = String(stdout ?? "");
  const matches = [...text.matchAll(/resultado:[^\n]*?(\d+)\s*tokens/gi)];
  if (matches.length === 0) return { tokens: 0, parsed: false };
  const last = matches[matches.length - 1];
  const n = Number(last[1]);
  return { tokens: Number.isFinite(n) && n >= 0 ? n : 0, parsed: true };
}

/**
 * runEvals real: chama `evals/run.mjs --task <id>` N vezes.
 *
 * Quando a tarefa não existe (artefato gerado para um objetivo novo, sem tarefa
 * no ledger), devolve `{ skipped: true }` em vez de reprovar: o gate passa a
 * julgar pela evidência do próprio artefato, e diz isso no laudo.
 *
 * O stdout do eval é capturado e a linha `resultado: P/N · <ms> ms · <T> tokens`
 * fornece os tokens reais — sem isso `avgTokens` seria sempre 0 e a regressão de
 * tokens nunca reprovaria. `deps` existe para injetar um runner/tarefas em teste.
 */
export async function realRunEvals({ taskId, runs } = {}, deps = {}) {
  const {
    tasksDir = TASKS_DIR,
    runScript = path.join(ROOT, "evals", "run.mjs"),
    exec = null,
  } = deps;

  if (!taskId || !existsSync(path.join(tasksDir, `${taskId}.json`))) {
    return [{ skipped: true, reason: `sem tarefa de eval "${taskId}"` }];
  }

  let execFileAsync;
  if (typeof exec === "function") {
    execFileAsync = exec;
  } else {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    execFileAsync = promisify(execFile);
  }

  const results = [];
  for (let i = 0; i < (runs ?? 1); i++) {
    try {
      const { stdout } = await execFileAsync(process.execPath, [runScript, "--task", taskId, "--no-ledger"], {
        cwd: ROOT,
        timeout: 200_000,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      });
      const parsed = parseEvalTokens(stdout);
      const rec = { passed: true, tokens: parsed.tokens };
      if (!parsed.parsed) rec.tokenWarning = "linha de tokens ausente no stdout do eval";
      results.push(rec);
    } catch (err) {
      const parsed = parseEvalTokens(err?.stdout);
      const rec = { passed: false, tokens: parsed.tokens, error: String(err?.message ?? err).slice(0, 200) };
      if (!parsed.parsed) rec.tokenWarning = "linha de tokens ausente no stdout do eval";
      results.push(rec);
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
export async function realPromote({ artifactDir, report, request }) {
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

  // `--llm` troca o gerador de esqueleto pelo gerador com modelo **para CLIs**,
  // que é o único kind que o generate-llm sabe produzir. Os outros quatro usam
  // seus geradores próprios (template), e isso é dito no relatório.
  const useLlm = Boolean(args.flags.llm) && !dryRun;
  let generate;
  let onGenerateError = null;
  if (useLlm) {
    const model = typeof args.flags.model === "string" ? args.flags.model : DEFAULT_MODEL;
    const runModel = makeRunModel({ model });
    const { generateArtifactWithModel } = await import("./generate-llm.mjs");
    const { defaultGenerate } = await import("./loop.mjs");
    generate = async (request, outDir) => {
      // `cli`, `mcp-server` e `extension` produzem código: o modelo escreve.
      // `mcp-config` e `skill` são documento/configuração: o template é a
      // implementação certa, e devolvê-los ao modelo seria inventar.
      const target = (await import("./generate-llm.mjs")).TARGETS[request.kind];
      if (!target) return defaultGenerate(request, outDir);
      try {
        return await generateArtifactWithModel({ request, outDir, runModel, model });
      } catch (err) {
        onGenerateError = { code: err?.code ?? "erro", message: err?.message ?? String(err), kind: request.kind };
        // cai no gerador de template: o artefato existe, mas é esqueleto
        return defaultGenerate(request, outDir);
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

/**
 * `skills [termo]` — o que o loop já produziu e está registrado na memória.
 * Existe para que a pergunta "isso já foi feito?" tenha resposta antes de gerar
 * de novo. Sem termo, lista tudo o que está no nível skills.
 */
async function cmdSkills(args) {
  const query = args._.slice(1).join(" ").trim();
  const level = typeof args.flags.level === "string" ? args.flags.level : "skills";
  const levels = level === "all" ? ["skills", "project"] : [level];
  const { openStore } = await import("../memory/store.mjs");
  const { searchCapabilities } = await import("../memory/search.mjs");
  const store = openStore({ root: path.join(ROOT, ".pi", "harness", "memory") });

  if (query === "") {
    const entries = store.query({ level }).filter((e) => !e.invalid);
    if (args.flags.json) {
      jsonLine({ ok: true, level, count: entries.length, entries });
      return 0;
    }
    text(`memória (${level}): ${entries.length} entrada(s)`);
    for (const e of entries) text(`  ${e.id}  ${e.text}`);
    return 0;
  }

  const res = searchCapabilities(store, query, { levels, limit: Number(args.flags.limit ?? 10) });
  if (args.flags.json) {
    jsonLine({ ok: true, ...res });
    return 0;
  }
  text(`busca: "${query}"  (${res.count} resultado(s))`);
  if (res.count === 0) {
    text("  nada encontrado — talvez ainda não tenha sido gerado");
    return 0;
  }
  for (const r of res.results) {
    text(`  [${r.score}] ${r.text.slice(0, 100)}`);
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* auto — auto-disparo do loop (evolução sem operador)                 */
/* ------------------------------------------------------------------ */

async function cmdAuto(args) {
  const { runAutoPass, runWatch, isProtectedPath, PROTECTED_AREAS } = await import("./auto.mjs");

  // default é dry-run: sem --auto, só imprime o plano.
  const auto = Boolean(args.flags.auto);
  const watch = Boolean(args.flags.watch);
  const interval = Number(args.flags.interval ?? 60);
  const threshold = Number(args.flags.threshold ?? 3);
  const maxGaps = Number(args.flags["max-gaps"] ?? 5);

  // carimbo de origem no ledger: só em modo --auto
  const writeLedger = auto
    ? async (entry) => {
        const { append } = await import("../../evals/lib/ledger.mjs");
        await append(LEDGER, [entry]);
      }
    : null;

  // ids de tarefas de eval: uma falha de benchmark não é lacuna de ferramenta.
  // --include-eval desliga o filtro (para diagnóstico do detector cru).
  const { loadEvalTaskIds } = await import("./auto.mjs");
  const evalTaskIds = args.flags["include-eval"] ? new Set() : await loadEvalTaskIds(TASKS_DIR);

  const passOpts = {
    ledger: LEDGER,
    threshold,
    maxGaps,
    auto,
    writeLedger,
    evalTaskIds,
    onEvent: args.flags.json ? null : (e) => {
      if (e.event === "ignored") return; // resumo já mostra
      text(`  · ${e.event}${e.taskId ? ` (${e.taskId})` : ""}`);
    },
  };

  if (watch) {
    // --watch: repete com backoff. Para em erro de Ctrl+C (shouldStop).
    let stopping = false;
    const stop = () => { stopping = true; };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    const out = await runWatch({ ...passOpts, intervalMs: interval * 1000, shouldStop: () => stopping });
    if (args.flags.json) jsonLine({ ok: out.ok, watch: true, passes: out.passes, stopped: out.stopped });
    else text(`watch: ${out.passes} passada(s)${out.stopped ? " (interrompido)" : ""}`);
    return 0;
  }

  // --once (default): uma passada.
  const out = await runAutoPass(passOpts);
  if (args.flags.json) {
    jsonLine(out);
  } else {
    text(`modo: ${out.dryRun ? "dry-run (nada foi alterado)" : "auto (ações executadas)"}`);
    if (out.scanned != null) text(`ledger: ${out.scanned} execução(ões) lida(s)`);
    if (out.considered !== undefined) text(`lacunas acionáveis: ${out.considered}`);
    if (out.actions && out.actions.length > 0) {
      for (const a of out.actions) {
        if (typeof a === "object") {
          text(`  plano: [${a.gapKind}] ${a.taskId} → ${a.capability}`);
          text(`         ${a.command}`);
        } else {
          text(`  ação #${a}`);
        }
      }
    } else if (out.dryRun) {
      text(out.ignored && out.ignored.length > 0
        ? `  nenhuma lacuna acionável (${out.ignored.length} ignorada(s))`
        : "  nenhuma lacuna detectada — nada a fazer");
    }
    if (out.ignored && out.ignored.length > 0) {
      for (const ig of out.ignored) text(`  · ignorado (${ig.reason}): ${ig.taskId}`);
    }
    if (out.skipped && out.skipped.length > 0) {
      for (const sk of out.skipped) text(`  pulado: ${sk.taskId ?? "?"} — ${sk.reason}`);
    }
    if (!out.dryRun && out.results) {
      for (const r of out.results) {
        text(`  resultado: ${r?.outcome ?? "?"} (${r?.taskId ?? "?"})`);
      }
    }
  }
  // Em dry-run, sempre exit 0 (é só diagnóstico). Em auto, exit 1 se algo falhou.
  if (!out.dryRun && Array.isArray(out.results) && out.results.some((r) => r?.outcome === "error")) return 1;
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
  else if (cmd === "skills") code = await cmdSkills(args);
  else if (cmd === "auto") code = await cmdAuto(args);
  else {
    if (args.flags.json) jsonLine({ ok: false, error: "comando desconhecido" });
    else {
      text("uso:");
      text("  node core/forge/cli.mjs detect [--json]");
      text("  node core/forge/cli.mjs evolve --task <id> [--dry-run] [--json]");
      text("  node core/forge/cli.mjs gate --artifact <dir> --task <id>");
      text("  node core/forge/cli.mjs skills [termo] [--level skills|project|all] [--json]");
      text("  node core/forge/cli.mjs auto [--once|--watch] [--interval 60] [--auto] [--json]");
      text("  node core/forge/cli.mjs status");
    }
    code = 2;
  }
  process.exitCode = code;
}

// Só executa quando chamado como CLI; importar não dispara o main (evita
// recursão quando auto.mjs ou um teste importa este módulo).
import { pathToFileURL } from "node:url";
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main();
}