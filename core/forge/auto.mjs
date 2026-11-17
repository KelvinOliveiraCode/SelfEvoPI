#!/usr/bin/env node
/**
 * selfevopi-forge-auto — auto-disparo do loop evolutivo (evolução sem operador).
 *
 * O `cli.mjs evolve` só roda quando um humano chama. Este módulo fecha o
 * ciclo: o harness detecta a lacuna sozinho e, com `--auto`, executa o
 * pipeline evolve — com travas.
 *
 * Dois modos:
 *   --once    uma passada: lê o ledger, acha lacuna, monta o plano.
 *   --watch   repete a cada N segundos (default 60s), com backoff em erro.
 *
 * Regra de ouro: **o padrão é dry-run**. Sem `--auto`, o comando apenas
 * IMPRIME o que faria (meta, kind, comando) e não escreve nada, não promove
 * nada, não toca em arquivo. `--auto` é obrigatório para agir.
 *
 * Mesmo com `--auto`:
 *   - nunca promove sem o gate passar;
 *   - toda ação auto-disparada é registrada no ledger com `origin: "auto"`;
 *   - lacuna que aponta para área protegida (evals/, core/governance/,
 *     scripts/verify-urls.mjs) é RECUSADA, não contornada.
 *
 * Uso:
 *   node core/forge/cli.mjs auto [--once|--watch] [--interval 60]
 *     [--auto] [--json] [--threshold 3] [--ledger <arquivo>]
 *
 * O módulo é puro o suficiente para testar: `runAutoPass` recebe todas as
 * peças injetáveis (detect, loop, writeLedger, now) e não abre processo so
 *zinho — quem chama (o CLI) injeta os defaults reais.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/* ------------------------------------------------------------------ */
/* Áreas protegidas                                                    */
/* ------------------------------------------------------------------ */

/**
 * Caminhos que o loop autônomo NÃO pode tocar. Se a lacuna apontar para
 * dentro de um deles, a ação é recusada com mensagem — nunca contornada.
 * Mesma lista de docs/fase2/forge.md e do handoff.
 */
export const PROTECTED_AREAS = Object.freeze([
  "evals/",
  "core/governance/",
  "scripts/verify-urls.mjs",
]);

/** Normaliza um caminho para comparação (barras, sem ./ inicial). */
function normPath(p) {
  return String(p ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .toLowerCase();
}

/**
 * Diz se um texto aponta para dentro de uma área protegida.
 * Aceita o texto livre da lacuna (capability/goal) ou um caminho.
 */
export function isProtectedPath(text) {
  const t = normPath(text);
  if (t === "") return false;
  return PROTECTED_AREAS.some((area) => t === area || t.startsWith(area) || t.includes(area));
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Lê um JSONL de ledger, ignorando linhas corrompidas. */
export async function readLedgerRows(filePath) {
  const text = await readFile(filePath, "utf8").catch(() => "");
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (s === "") continue;
    try {
      rows.push(JSON.parse(s));
    } catch {
      // linha corrompida não derruba a leitura
    }
  }
  return rows;
}

/**
 * Ids das tarefas de eval (evals/tasks/*.json).
 *
 * Uma tarefa de eval mede o modelo/harness; ela não é uma ferramenta que
 * "falta". Uma falha de benchmark (tool-failing) ali significa "o modelo
 * errou a medição", não "falta capacidade ao harness" — e o auto-disparo
 * não deve perseguir isso. Este conjunto é a interseção que evita o falso
 * positivo, sem remover o detector tool-failing (que é correto para tool real).
 *
 * @param {string} tasksDir  diretório com os *.json de tarefas
 * @returns {Promise<Set<string>>}
 */
export async function loadEvalTaskIds(tasksDir) {
  const ids = new Set();
  let files = [];
  try {
    files = await readdir(tasksDir);
  } catch {
    return ids;
  }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const doc = JSON.parse(await readFile(join(tasksDir, f), "utf8"));
      for (const t of Array.isArray(doc) ? doc : [doc]) {
        if (t && typeof t.id === "string" && t.id.trim() !== "") ids.add(t.id.trim());
      }
    } catch {
      // arquivo de tarefa corrompido não derruba a leitura
    }
  }
  return ids;
}

/** O que a lacuna pede, em texto, para checar área protegida. */
function gapText(gap) {
  if (!isPlainObject(gap)) return "";
  return [gap.capability, gap.goal, gap.taskId].filter((x) => typeof x === "string").join(" ");
}

/* ------------------------------------------------------------------ */
/* runAutoPass                                                         */
/* ------------------------------------------------------------------ */

/**
 * Uma passada do auto-disparo.
 *
 * @param {object} opts
 * @param {string} [opts.ledger]        caminho do JSONL (default: .pi/harness/ledger/evals.jsonl)
 * @param {number} [opts.threshold=3]   falhas para tool-failing
 * @param {number} [opts.maxGaps=5]     teto de lacunas consideradas
 * @param {boolean} [opts.auto=false]   false = dry-run (só imprime o plano)
 * @param {Function} [opts.detect]      default detectGaps (import sob demanda)
 * @param {Function} [opts.runEvolve]   default: cria loop e chama evolve
 * @param {Function} [opts.writeLedger] default: append JSONL no ledger
 * @param {Function} [opts.now]         relógio
 * @param {Function} [opts.onEvent]     telemetria
 * @returns {Promise<{ok, dryRun, scanned, considered, actions, skipped}>}
 */
export async function runAutoPass(opts = {}) {
  const {
    ledger = null,
    threshold = 3,
    maxGaps = 5,
    auto = false,
    detect = null,
    runEvolve = null,
    writeLedger = null,
    evalTaskIds = null,
    tasksDir = null,
    now = () => new Date(),
    onEvent = null,
  } = opts;

  const dryRun = !auto;
  const emit = (e) => {
    if (typeof onEvent === "function") {
      try {
        onEvent({ at: now().toISOString(), ...e });
      } catch {
        /* telemetria nunca derruba */
      }
    }
  };

  // 1. Detecta lacunas (detect real por padrão).
  let det;
  if (typeof detect === "function") {
    det = await detect({ ledger, threshold, maxGaps });
  } else {
    if (!ledger) throw new Error("auto: informe ledger (caminho do JSONL) ou injete detect()");
    const { detectGaps } = await import("./detect.mjs");
    det = await detectGaps({ ledger, threshold, maxGaps });
  }
  const gaps = Array.isArray(det?.gaps) ? det.gaps : [];

  // ids de tarefas de eval: default vem do tasksDir, se informado.
  const evalIds = evalTaskIds instanceof Set
    ? evalTaskIds
    : new Set(Array.isArray(evalTaskIds) ? evalTaskIds.map(String) : []);
  if (!(evalTaskIds instanceof Set) && !Array.isArray(evalTaskIds) && tasksDir) {
    for (const id of await loadEvalTaskIds(tasksDir)) evalIds.add(id);
  }

  const actions = [];
  const skipped = [];
  const ignored = [];
  let considered = 0;

  for (const gap of gaps) {
    // 1. Tarefa de eval: mede o modelo, não o harness. Uma falha de benchmark
    //    (tool-failing) ali NÃO é lacuna de ferramenta — ignorar, visível.
    if (gap.kind === "tool-failing" && gap.taskId && evalIds.has(gap.taskId)) {
      const reason = "tarefa de eval, mede o modelo não o harness";
      ignored.push({ taskId: gap.taskId, kind: gap.kind, capability: gap.capability, reason });
      emit({ event: "ignored", taskId: gap.taskId, reason });
      continue;
    }

    // 2. Trava de área protegida: recusa, não contorna.
    if (isProtectedPath(gapText(gap))) {
      const reason = `lacuna aponta para área protegida (${PROTECTED_AREAS.join(", ")}) — recusada`;
      skipped.push({ taskId: gap.taskId ?? null, kind: gap.kind, reason });
      emit({ event: "protected", taskId: gap.taskId, reason });
      continue;
    }
    considered += 1;
    if (considered > maxGaps) {
      skipped.push({ taskId: gap.taskId ?? null, reason: "teto de lacunas atingido" });
      break;
    }

    // 3. Monta o plano. O comando é o que um operador humano rodaria.
    const plan = {
      taskId: gap.taskId ?? null,
      gapKind: gap.kind,
      capability: gap.capability,
      goal: gap.goal,
      command: buildPlanCommand(gap),
    };
    actions.push(plan);
    emit({ event: "plan", ...plan });
  }

  // 4. Dry-run: só o plano. Nada é escrito, nada é promovido.
  if (dryRun) {
    return { ok: true, dryRun: true, scanned: det?.scanned ?? null, considered, actions, skipped, ignored };
  }

  // 5. --auto: executa cada plano pelo loop, com promote real.
  const results = [];
  for (const plan of actions) {
    let report;
    if (typeof runEvolve === "function") {
      report = await runEvolve({ gap: plan, threshold, maxGaps });
    } else {
      // default: cria o loop com o promote real do CLI e roda.
      const { createEvolutionLoop } = await import("./loop.mjs");
      const { realPromote, realRunEvals } = await import("./cli.mjs");
      const loop = createEvolutionLoop({ runEvals: realRunEvals, promote: realPromote });
      report = await loop.evolve({ goal: plan.goal, taskId: plan.taskId, forceKind: undefined });
    }
    results.push(report);
    emit({ event: "auto-result", taskId: plan.taskId, outcome: report?.outcome ?? "error" });

    // 6. Registra no ledger com carimbo de origem.
    if (typeof writeLedger === "function") {
      try {
        await writeLedger({
          at: now().toISOString(),
          origin: "auto",
          taskId: plan.taskId,
          gapKind: plan.gapKind,
          capability: plan.capability,
          outcome: report?.outcome ?? "error",
          promoted: report?.promoted?.path ?? null,
          reasons: report?.reasons ?? [],
        });
      } catch (err) {
        emit({ event: "ledger-error", message: String(err?.message ?? err) });
      }
    }
  }

  return {
    ok: true,
    dryRun: false,
    scanned: det?.scanned ?? null,
    considered,
    actions: actions.length,
    results,
    skipped,
    ignored,
  };
}

/** Monta o comando canônico do plano (o mesmo que o operador usaria). */
function buildPlanCommand(gap) {
  const goal = String(gap?.goal ?? gap?.capability ?? "").replace(/"/g, '\\"');
  const parts = ["node core/forge/cli.mjs evolve", `--goal "${goal}"`];
  if (gap?.taskId) parts.push(`--task ${gap.taskId}`);
  return parts.join(" ");
}

/* ------------------------------------------------------------------ */
/* runWatch                                                            */
/* ------------------------------------------------------------------ */

/**
 * Repete `runAutoPass` a cada `intervalMs`, com backoff em erro.
 *
 * Não entra em laço infinito silencioso: cada passada é uma chamada a
 * `pass` (injetável, default runAutoPass). Em erro, espera `intervalMs *
 * 2^falhas` (com teto). Para quando `shouldStop()` devolver true.
 *
 * @param {object} opts
 * @param {number} [opts.intervalMs=60000]
 * @param {number} [opts.maxBackoffMs=300000]
 * @param {Function} [opts.pass]        default runAutoPass
 * @param {Function} [opts.shouldStop]  default: () => false
 * @param {Function} [opts.onEvent]
 * @returns {Promise<{ok, passes, stopped}>}
 */
export async function runWatch(opts = {}) {
  const {
    intervalMs = 60_000,
    maxBackoffMs = 300_000,
    pass = runAutoPass,
    shouldStop = () => false,
    onEvent = null,
    ...passOpts
  } = opts;

  const emit = (e) => {
    if (typeof onEvent === "function") {
      try {
        onEvent({ at: new Date().toISOString(), ...e });
      } catch {
        /* telemetria nunca derruba */
      }
    }
  };

  let passes = 0;
  let failures = 0;
  let stopped = false;

  while (!shouldStop()) {
    let ok = false;
    try {
      await pass(passOpts);
      ok = true;
      failures = 0;
      passes += 1;
    } catch (err) {
      failures += 1;
      emit({ event: "watch-error", message: String(err?.message ?? err), failures });
    }

    if (shouldStop()) break;

    // backoff exponencial em erro, teto em maxBackoffMs
    const delay = ok
      ? Math.max(0, Number(intervalMs) || 0)
      : Math.min(maxBackoffMs, (Number(intervalMs) || 1000) * 2 ** Math.max(0, failures - 1));

    await sleep(delay);
    if (shouldStop()) {
      stopped = true;
      break;
    }
  }

  return { ok: true, passes, stopped };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

export default { runAutoPass, runWatch, isProtectedPath, PROTECTED_AREAS, readLedgerRows, loadEvalTaskIds };