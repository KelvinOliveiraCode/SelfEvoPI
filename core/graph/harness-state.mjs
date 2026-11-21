/**
 * selfevopi-harness-state — o formato git-nativo do estado do grafo.
 *
 * Sem dependências. Node ESM puro. Windows nativo (sem `.sh`).
 *
 * O runtime (`runtime.mjs`) salva um formato próprio em `.pi/harness/graph/`. O
 * `scripts/checkpoint.mjs` salva outro (git: sha/branch/checks). Um consumidor
 * externo precisaria entender os dois. Este módulo traduz o estado do runtime para um
 * formato único, git-nativo e legível — e de volta.
 *
 * Formato da ponte (harness-state):
 *   {
 *     runId, status, startedAt, updatedAt,
 *     nodes: [{ id, label, kind, status, startedAt, endedAt, durationMs, attempt }],
 *     checkpoints: [{ at, sha, label }],
 *     waitingFor, humanQueue: [{ nodeId, question, at }],
 *     stats: { total, done, failed, skipped, durationMs }
 *   }
 *
 * Contrato:
 *   toHarnessState(runState, { sha?, label? }) -> doc
 *   fromHarnessState(doc)                      -> runState (formato do runtime)
 *
 * Idempotente: fromHarnessState(toHarnessState(x)) preserva o que importa.
 */

import { topologicalOrder } from "./model.mjs";

const STATUS_LABEL = {
  pending: "pending",
  running: "running",
  done: "done",
  failed: "failed",
  blocked: "blocked",
  skipped: "skipped",
  waiting: "waiting",
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Soma de tempo (ms) a partir de timestamps ISO. Tolerante a ausência. */
function durationBetween(start, end) {
  if (!start || !end) return 0;
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return b - a;
}

/** Lê um timestamp de um registro (aceita `at` ISO ou `_startedAt`). */
function startedOf(rec) {
  return rec?.startedAt ?? rec?.at ?? null;
}

/* ------------------------------------------------------------------ */
/* toHarnessState                                                      */
/* ------------------------------------------------------------------ */

/**
 * Converte o estado do runtime (formato próprio) para o formato da ponte.
 *
 * @param {object} runState  estado do runtime: { runId, nodes:{id:rec}, order:[],
 *                           checkpoints:[{id,status,at}], waitingFor, shared?, status? }
 * @param {object} [opts]
 * @param {string} [opts.sha]    SHA do commit no momento do checkpoint (git-nativo)
 * @param {string} [opts.label]  rótulo do checkpoint (ex.: tag `ckpt/<fase>-<step>`)
 * @returns {object} doc no formato da ponte
 */
export function toHarnessState(runState, { sha = null, label = null } = {}) {
  const rs = runState ?? {};
  const graphNodes = rs.nodes ?? {};
  const order = Array.isArray(rs.order) && rs.order.length ? rs.order : Object.keys(graphNodes);

  // ordem topológica preferida; se o estado não trouxer, usa a ordem gravada
  let orderedIds = order;
  if (rs.graph) {
    try {
      orderedIds = topologicalOrder(rs.graph);
    } catch {
      /* mantém order */
    }
  }

  const startedAt = rs.startedAt ?? firstTimestamp(graphNodes) ?? null;
  const updatedAt = rs.updatedAt ?? rs.finishedAt ?? lastTimestamp(graphNodes) ?? new Date().toISOString();

  const nodes = orderedIds.map((id) => {
    const rec = graphNodes[id] ?? {};
    const start = startedOf(rec) ?? null;
    const end = rec.endedAt ?? (rec.status === "done" || rec.status === "failed" ? rec.at ?? null : null);
    return {
      id,
      label: rec.label ?? id,
      kind: rec.kind ?? "task",
      status: STATUS_LABEL[rec.status] ?? "pending",
      startedAt: start,
      endedAt: end,
      durationMs: rec.durationMs ?? durationBetween(start, end),
      attempt: typeof rec.attempt === "number" ? rec.attempt : rec.status === "pending" ? 0 : 1,
    };
  });

  // checkpoints: cada um amarrado a um commit/tag (git-nativo)
  const cps = Array.isArray(rs.checkpoints) ? rs.checkpoints : [];
  const checkpoints = cps.map((c, i) => ({
    at: c.at ?? updatedAt,
    sha: c.sha ?? sha,
    label: c.label ?? (label ? `${label}#${i + 1}` : null),
  }));

  // fila humana
  const humanQueue = rs.humanQueue ?? (rs.waitingFor ? [{ nodeId: rs.waitingFor, question: rs.humanQuestion ?? null, at: rs.waitingAt ?? updatedAt }] : []);

  // estatísticas
  const statusCount = { pending: 0, running: 0, done: 0, failed: 0, blocked: 0, skipped: 0, waiting: 0 };
  for (const n of nodes) statusCount[n.status] = (statusCount[n.status] ?? 0) + 1;
  const total = nodes.length;
  const done = statusCount.done ?? 0;
  const failed = statusCount.failed ?? 0;
  const skipped = (statusCount.skipped ?? 0) + (statusCount.blocked ?? 0);
  const durationMs = nodes.reduce((acc, n) => acc + (n.durationMs ?? 0), 0);

  return {
    runId: rs.runId ?? null,
    status: rs.status ?? deriveStatus(statusCount, total),
    startedAt,
    updatedAt,
    nodes,
    checkpoints,
    waitingFor: rs.waitingFor ?? null,
    humanQueue,
    stats: { total, done, failed, skipped, durationMs },
  };
}

/* ------------------------------------------------------------------ */
/* fromHarnessState                                                    */
/* ------------------------------------------------------------------ */

/**
 * Converte um documento da ponte de volta para o formato do runtime.
 * Preserva: runId, status, nós (id→rec), ordem, checkpoints, waitingFor.
 *
 * @param {object} doc  documento da ponte
 * @returns {object} runState no formato do runtime
 */
export function fromHarnessState(doc) {
  const d = doc ?? {};
  const nodes = {};
  const order = [];

  for (const n of Array.isArray(d.nodes) ? d.nodes : []) {
    if (!n || typeof n.id !== "string") continue;
    nodes[n.id] = {
      id: n.id,
      label: n.label ?? n.id,
      kind: n.kind ?? "task",
      status: STATUS_LABEL[n.status] ? n.status : "pending",
      startedAt: n.startedAt ?? null,
      endedAt: n.endedAt ?? null,
      durationMs: typeof n.durationMs === "number" ? n.durationMs : 0,
      attempt: typeof n.attempt === "number" ? n.attempt : n.status === "pending" ? 0 : 1,
      ...(n.startedAt ? { at: n.startedAt } : {}),
      ...(n.endedAt ? { endedAt: n.endedAt } : {}),
    };
    order.push(n.id);
  }

  const checkpoints = (Array.isArray(d.checkpoints) ? d.checkpoints : []).map((c) => ({
    id: c.label ?? null,
    status: "done",
    at: c.at ?? null,
    sha: c.sha ?? null,
    label: c.label ?? null,
  }));

  return {
    runId: d.runId ?? null,
    status: d.status ?? "pending",
    nodes,
    order,
    checkpoints,
    waitingFor: d.waitingFor ?? null,
    humanQueue: Array.isArray(d.humanQueue) ? d.humanQueue : [],
    shared: {},
    startedAt: d.startedAt ?? null,
    updatedAt: d.updatedAt ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Internos                                                            */
/* ------------------------------------------------------------------ */

function deriveStatus(statusCount, total) {
  if (statusCount.waiting > 0) return "waiting-human";
  if (statusCount.failed > 0) return "failed";
  if (statusCount.running > 0) return "running";
  if (total > 0 && statusCount.done === total) return "completed";
  if (statusCount.pending === total && total > 0) return "pending";
  return "blocked";
}

/** Primeiro timestamp ISO entre os registros (ou null). */
function firstTimestamp(nodes) {
  let first = null;
  for (const rec of Object.values(nodes)) {
    const t = startedOf(rec);
    if (t && (!first || Date.parse(t) < Date.parse(first))) first = t;
  }
  return first;
}

/** Último timestamp ISO entre os registros (ou null). */
function lastTimestamp(nodes) {
  let last = null;
  for (const rec of Object.values(nodes)) {
    const t = rec.endedAt ?? rec.at;
    if (t && (!last || Date.parse(t) > Date.parse(last))) last = t;
  }
  return last;
}