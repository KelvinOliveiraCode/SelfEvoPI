/**
 * selfevopi-forge-detect — detecta lacunas (gaps) no ledger de evals.
 *
 * Sem dependencias externas. Lê a trilha JSONL real
 * (.pi/harness/ledger/evals.jsonl) e devolve gaps acionáveis para o loop.
 *
 * Gatilhos (reais, não decorativos):
 *  - tool-failing : mesma ferramenta/tarefa com >= threshold falhas no ledger.
 *  - tool-missing : goal que nenhuma capability cobre.
 *  - tool-fragile : tarefa acima do teto de tokens, marcada como frágil, ou que
 *                   usou screenshot onde caberia CLI.
 *
 * Modelo mental (docs/research/inspiracoes.md §2.5, Voyager): a lacuna vira
 * uma capability pedida, que o loop traduz em kind e gera.
 */

import { readFile } from "node:fs/promises";

/* ------------------------------------------------------------------ */
/* Tipos de gap                                                        */
/* ------------------------------------------------------------------ */

/** Tipos de lacuna que o detector reconhece. */
export const GAP_KINDS = ["tool-failing", "tool-missing", "tool-fragile"];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function fail(msg) {
  throw new Error(`forge-detect: ${msg}`);
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Lê e faz parse de um JSONL, ignorando linhas corrompidas (não para no meio). */
export async function readLedger(filePath) {
  const text = await readFile(filePath, "utf8").catch(() => "");
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // linha corrompida no ledger não derruba a detecção
    }
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* createGap                                                           */
/* ------------------------------------------------------------------ */

/**
 * Cria e valida um gap. Normaliza capability e evidência.
 *
 * @param {object} g
 * @param {string} g.kind       um de GAP_KINDS
 * @param {string} g.taskId      tarefa/ferramenta que originou o gap
 * @param {string} g.capability  capacidade pedida (o que resolveria)
 * @param {string} [g.goal]      objetivo do artefato a gerar (= capability)
 * @param {string[]} [g.evidence] linhas/ids do ledger que sustentam o gap
 * @param {object} [g.meta]      dados crus do gatilho (contagens, tokens...)
 * @returns {object} gap normalizado
 */
export function createGap({ kind, taskId, capability, goal, evidence, meta } = {}) {
  if (!GAP_KINDS.includes(kind)) {
    fail(`kind inválido "${kind}"; esperado um de: ${GAP_KINDS.join(", ")}`);
  }
  if (typeof taskId !== "string" || taskId.trim() === "") {
    fail("taskId é obrigatório e deve ser string não-vazia");
  }
  if (typeof capability !== "string" || capability.trim() === "") {
    fail("capability é obrigatória e deve ser string não-vazia");
  }
  return {
    kind,
    taskId: taskId.trim(),
    capability: capability.trim(),
    goal: typeof goal === "string" && goal.trim() !== "" ? goal.trim() : capability.trim(),
    evidence: Array.isArray(evidence) ? evidence.filter((e) => typeof e === "string") : [],
    meta: isPlainObject(meta) ? meta : {},
  };
}

/* ------------------------------------------------------------------ */
/* Gatilhos                                                            */
/* ------------------------------------------------------------------ */

/**
 * tool-failing: mesma taskId com >= threshold falhas no ledger.
 *عتبر attempt distinto? Não: cada linha é uma execução; falha = passed:false.
 */
function detectFailing(rows, threshold) {
  const byTask = new Map();
  for (const r of rows) {
    if (!isPlainObject(r) || typeof r.taskId !== "string") continue;
    if (!byTask.has(r.taskId)) byTask.set(r.taskId, { total: 0, fails: 0, evidence: [] });
    const s = byTask.get(r.taskId);
    s.total += 1;
    if (r.passed === false) {
      s.fails += 1;
      if (typeof r.at === "string") s.evidence.push(`${r.taskId}@${r.at}`);
    }
  }
  const gaps = [];
  for (const [taskId, s] of byTask) {
    if (s.fails >= threshold) {
      gaps.push(
        createGap({
          kind: "tool-failing",
          taskId,
          capability: `ferramenta confiável para ${taskId}`,
          goal: `tornar confiável a tarefa ${taskId} que falhou ${s.fails} vezes`,
          evidence: s.evidence.slice(0, 8),
          meta: { failures: s.fails, runs: s.total, threshold },
        })
      );
    }
  }
  return gaps;
}

/**
 * tool-missing: só dispara com **evidência**.
 *
 * Duas fontes, e uma delas basta:
 *  1. um registro do ledger marca explicitamente a falta
 *     (`missingCapability`, `toolMissing`, ou erro "no such tool"/"ferramenta não encontrada");
 *  2. um **registro de capabilities** é informado e o objetivo da tarefa não casa
 *     com nenhuma.
 *
 * Sem as duas coisas, o detector **não afirma** que falta ferramenta: ausência de
 * catálogo não é evidência de ausência de capacidade. Sem isso, toda tarefa do
 * ledger virava "lacuna" — ruído que enterraria os gaps reais.
 */
function detectMissing(rows, capabilities) {
  const catalog = (Array.isArray(capabilities) ? capabilities : []).map((c) => String(c).toLowerCase()).filter(Boolean);
  const gaps = [];
  const seen = new Set();

  const push = (r, capability, goal, meta) => {
    if (seen.has(r.taskId)) return;
    seen.add(r.taskId);
    gaps.push(
      createGap({
        kind: "tool-missing",
        taskId: r.taskId,
        capability,
        goal,
        evidence: typeof r.at === "string" ? [`${r.taskId}@${r.at}`] : [r.taskId],
        meta,
      }),
    );
  };

  for (const r of rows) {
    if (!isPlainObject(r) || typeof r.taskId !== "string") continue;
    const m = isPlainObject(r.metrics) ? r.metrics : {};
    const err = String(r.error ?? "").toLowerCase();

    // 1) evidência explícita no registro
    const declared = r.missingCapability ?? r.toolMissing ?? m.missingCapability ?? m.toolMissing;
    if (typeof declared === "string" && declared.trim() !== "") {
      push(r, declared.trim(), `cobrir a capacidade ausente da tarefa ${r.taskId}`, { source: "ledger" });
      continue;
    }
    if (r.missingCapability === true || r.toolMissing === true || m.missingCapability === true) {
      push(r, `capacidade para ${r.taskId}`, `cobrir a lacuna da tarefa ${r.taskId}`, { source: "ledger" });
      continue;
    }
    if (/no such tool|ferramenta n[aã]o encontrada|unknown tool|tool not found/.test(err)) {
      push(r, `capacidade para ${r.taskId}`, `cobrir a lacuna da tarefa ${r.taskId}`, {
        source: "erro",
        reason: "erro indica ferramenta inexistente",
      });
      continue;
    }

    // 2) catálogo informado: só aí a ausência é comparável.
    //    Casa por token/prefixo com fronteira (não substring crua) e ignora
    //    capabilities curtas (<2 chars) que casariam com quase tudo — evita
    //    falso-positivo (cap "cr" em "micro") e falso-negativo por substring.
    if (catalog.length === 0) continue;
    const tokens = `${r.taskId} ${r.group ?? ""}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    const usable = catalog.filter((cap) => cap.replace(/[^a-z0-9]/g, "").length >= 2);
    const covered = usable.some((cap) => {
      const parts = cap.split(/[^a-z0-9]+/).filter(Boolean);
      if (parts.length === 0) return false;
      // capability de uma palavra: casa token exato ou prefixo de token;
      // de várias palavras: exige que cada parte apareça como token.
      return parts.every((p) => tokens.some((tok) => tok === p || tok.startsWith(p)));
    });
    if (!covered) {
      push(r, `capacidade para ${r.taskId}`, `cobrir a lacuna da tarefa ${r.taskId}`, { source: "catalogo" });
    }
  }
  return gaps;
}

/**
 * tool-fragile: tarefa marcada como frágil (`metrics.fragile`), que usou
 * screenshot onde caberia CLI (`metrics.screenshot` / `metrics.usedScreenshot`),
 * ou — apenas quando um teto é informado (`tokenCeiling > 0`) — acima dele.
 *
 * O teto vem **desligado** por padrão: qualquer número absoluto é arbitrário
 * enquanto a linha de base não estiver medida. Com o PI puro em ~8.685 tokens,
 * um teto de 8.000 marcaria todas as tarefas como frágeis — ruído puro.
 */
function detectFragile(rows, tokenCeiling) {
  const ceiling = Number.isFinite(Number(tokenCeiling)) ? Number(tokenCeiling) : 0;
  const groups = new Map();
  for (const r of rows) {
    if (!isPlainObject(r) || typeof r.taskId !== "string") continue;
    if (!groups.has(r.taskId)) groups.set(r.taskId, { tokens: [], fragile: 0, screenshot: 0, evidence: [] });
    const s = groups.get(r.taskId);
    if (typeof r.tokens === "number" && r.tokens > 0) s.tokens.push(r.tokens);
    const m = isPlainObject(r.metrics) ? r.metrics : {};
    if (m.fragile === true) s.fragile += 1;
    if (m.screenshot === true || m.usedScreenshot === true) s.screenshot += 1;
    if (typeof r.at === "string") s.evidence.push(`${r.taskId}@${r.at}`);
  }

  const gaps = [];
  for (const [taskId, s] of groups) {
    const avg = s.tokens.length
      ? Math.round(s.tokens.reduce((a, b) => a + b, 0) / s.tokens.length)
      : 0;
    const reasons = [];
    if (ceiling > 0 && avg > ceiling) reasons.push(`tokens ${avg} > teto ${ceiling}`);
    if (s.fragile > 0) reasons.push(`${s.fragile}x marcada frágil`);
    if (s.screenshot > 0) reasons.push(`${s.screenshot}x usou screenshot onde caberia CLI`);
    if (reasons.length > 0) {
      gaps.push(
        createGap({
          kind: "tool-fragile",
          taskId,
          capability: `alternativa mais leve e estável para ${taskId}`,
          goal: `substituir fluxo frágil da tarefa ${taskId}`,
          evidence: s.evidence.slice(0, 8),
          meta: { avgTokens: avg, tokenCeiling: ceiling, fragile: s.fragile, screenshot: s.screenshot, reasons },
        })
      );
    }
  }
  return gaps;
}

/* ------------------------------------------------------------------ */
/* detectGaps                                                          */
/* ------------------------------------------------------------------ */

/**
 * Detecta lacunas no ledger. Devolve gaps deduplicados por (kind, taskId).
 *
 * @param {object} opts
 * @param {object[]|string} opts.ledger     linhas do ledger, ou caminho do JSONL
 * @param {number} [opts.threshold=3]        falhas para tool-failing
 * @param {number} [opts.maxGaps=20]         teto de gaps devolvidos
 * @param {string[]} [opts.capabilities=[]]  capacidades já existentes (tool-missing)
 * @param {number} [opts.tokenCeiling=0]  teto de tokens para tool-fragile; 0 desliga
 * @returns {Promise<{ gaps: object[], counts: object, scanned: number }>}
 */
export async function detectGaps(opts = {}) {
  const {
    threshold = 3,
    maxGaps = 20,
    capabilities = [],
    tokenCeiling = 0,
  } = opts;

  let rows;
  if (typeof opts.ledger === "string") {
    rows = await readLedger(opts.ledger);
  } else if (Array.isArray(opts.ledger)) {
    rows = opts.ledger;
  } else {
    fail("informe ledger (array de registros ou caminho do JSONL)");
  }

  const numThreshold = Number(threshold);
  if (!Number.isInteger(numThreshold) || numThreshold < 1) {
    fail(`threshold deve ser inteiro >= 1, veio ${threshold}`);
  }
  const numCeiling = Number(tokenCeiling);
  if (typeof tokenCeiling !== "number" || Number.isNaN(numCeiling)) {
    fail(`tokenCeiling deve ser número, veio ${tokenCeiling}`);
  }

  const all = [
    ...detectFailing(rows, numThreshold),
    ...detectMissing(rows, capabilities),
    ...detectFragile(rows, numCeiling),
  ];

  // deduplica por (kind, taskId) e respeita o teto
  const seen = new Set();
  const gaps = [];
  for (const g of all) {
    const key = `${g.kind}::${g.taskId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    gaps.push(g);
    if (gaps.length >= maxGaps) break;
  }

  const counts = { "tool-failing": 0, "tool-missing": 0, "tool-fragile": 0 };
  for (const g of gaps) counts[g.kind] += 1;

  return { gaps, counts, scanned: rows.length };
}