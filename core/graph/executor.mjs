/**
 * selfevopi-graph-executor — executor do grafo de execução do SelfEvoPI (Fase 3).
 *
 * Sem dependências. Node ESM puro.
 *
 * O executor percorre o grafo em ordem topológica e chama `runNode(node, ctx)`
 * para cada nó, mantendo um `state` compartilhado entre todos. Ele NÃO decide
 * fluxo por relógio: a ordem vem só do grafo (`dependsOn`); o relógio é usado
 * apenas para o timeout de um nó.
 *
 * Contrato:
 *   const result = await createExecutor({ graph, runNode, autoApprove?, timeoutMs? })
 *   // result = { status, nodes: [...], state, waitingFor }
 *
 * `runNode(node, { state, previous })` é assíncrona e fornecida por quem chama.
 * - resolve            -> nó `done`, `result` guardado
 * - lança (throw)      -> nó `failed`, `error` guardado
 * - excede timeoutMs   -> nó `failed`, `reason: "timeout"`
 *
 * Estados do resultado (`nodes[].status`):
 *   done | failed | blocked | skipped | waiting
 * (`skipped` = nó depois de um `human` que parou a execução; nunca rodou.)
 */

import { topologicalOrder } from "./model.mjs";

/* ------------------------------------------------------------------ */
/* Timeout                                                             */
/* ------------------------------------------------------------------ */

/** Erro de timeout de nó (distinto de erro do próprio `runNode`). */
export class TimeoutError extends Error {
  constructor(message, { node = null, timeoutMs = null } = {}) {
    super(message);
    this.name = "TimeoutError";
    this.code = "timeout";
    this.node = node;
    this.timeoutMs = timeoutMs;
  }
}

/** Roda `fn` com teto de tempo. `timeoutMs` nulo/<=0 = sem teto. */
async function invokeWithTimeout(fn, node, ctx, timeoutMs) {
  if (timeoutMs == null || timeoutMs <= 0) {
    return await fn(node, ctx);
  }
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(`timeout de ${timeoutMs}ms no nó "${node.id}"`, { node: node.id, timeoutMs }));
    }, timeoutMs);
  });
  try {
    // `fn(node, ctx)` é avaliado dentro do try: throw síncrono também é capturado.
    return await Promise.race([Promise.resolve(fn(node, ctx)), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Executor                                                            */
/* ------------------------------------------------------------------ */

/**
 * Executa o grafo. Função assíncrona: devolve uma Promise do resultado.
 *
 * @param {object}   opts
 * @param {object}   opts.graph        grafo válido (de `createGraph`)
 * @param {Function} opts.runNode      `async (node, { state, previous }) => any`
 * @param {boolean}  [opts.autoApprove=false]  quando true, nós `human` rodam como os outros
 * @param {number}   [opts.timeoutMs=null]     teto padrão por nó (nó pode sobrescrever com `node.timeoutMs`)
 * @param {object}   [opts.initialState=null]  estado compartilhado herdado (retomada)
 * @param {object}   [opts.resumeFrom=null]    Map/obj id -> registro terminal a reusar (não re-roda)
 * @param {Function} [opts.shouldStop=null]    `async (node, { state, previous }) => boolean`:
 *                                             verdadeiro pausa a execução ENTRE nós
 * @param {Function} [opts.onNode=null]        `(record) => void|Promise` chamado após cada
 *                                             nó terminal (checkpoint por nó)
 * @returns {Promise<{ status: string, nodes: Array, state: object, waitingFor: (string|null) }>}
 */
export async function createExecutor({
  graph,
  runNode,
  autoApprove = false,
  timeoutMs = null,
  initialState = null,
  resumeFrom = null,
  shouldStop = null,
  onNode = null,
} = {}) {
  if (typeof runNode !== "function") {
    throw new TypeError("createExecutor: runNode deve ser uma função");
  }

  const order = topologicalOrder(graph); // ids; lança se houver ciclo
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const state = initialState ?? {}; // estado compartilhado, mutado por runNode
  const records = new Map(); // id -> registro final (mantém a ordem de `order`)
  // Registros terminais herdados da retomada: nó `done`/`failed` não re-roda.
  const prior = resumeFrom instanceof Map ? resumeFrom : new Map(Object.entries(resumeFrom ?? {}));
  // checkpoint por nó: chamado ao fim de cada nó (não bloqueia o fluxo)
  const checkpoint = async (rec) => {
    if (typeof onNode === "function") await onNode(rec);
  };

  let previous = null; // registro do nó processado imediatamente antes
  let waitingFor = null;
  let stopped = false; // pausa cooperativa pedida entre nós

  for (const id of order) {
    const node = byId.get(id);

    // 0) retomada: nó já concluído (done/failed) não re-roda
    if (prior.has(id)) {
      const rec = prior.get(id);
      records.set(id, rec);
      previous = rec;
      continue;
    }

    // 0.5) pausa cooperativa: interrompe ENTRE nós, nunca no meio de um
    if (typeof shouldStop === "function" && (await shouldStop(node, { state, previous }))) {
      stopped = true;
      break;
    }

    const deps = Array.isArray(node.dependsOn) ? node.dependsOn : [];

    // 1) dependências precisam estar `done`
    const unmet = deps.filter((dep) => records.get(dep)?.status !== "done");
    if (unmet.length > 0) {
      const rec = { id, status: "blocked", reason: "dependencies-not-done", deps: unmet };
      records.set(id, rec);
      previous = rec;
      await checkpoint(rec);
      continue;
    }

    // 2) gate humano: para a execução quando chega num nó `human`
    if ((node.kind ?? "task") === "human" && !autoApprove) {
      const rec = { id, status: "waiting", reason: "human" };
      records.set(id, rec);
      waitingFor = id;
      await checkpoint(rec);
      break; // demais nós ficam `skipped`
    }

    // 3) executa
    const nodeTimeout = node.timeoutMs ?? timeoutMs;
    try {
      const result = await invokeWithTimeout(runNode, node, { state, previous }, nodeTimeout);
      const rec = { id, status: "done", result };
      records.set(id, rec);
      previous = rec;
      await checkpoint(rec);
    } catch (err) {
      const timedOut = err instanceof TimeoutError || err?.code === "timeout";
      const rec = timedOut
        ? { id, status: "failed", reason: "timeout", timeoutMs: nodeTimeout, error: err }
        : { id, status: "failed", reason: "error", error: err };
      records.set(id, rec);
      previous = rec;
      await checkpoint(rec);
      // segue: um nó falho não derruba a execução, só bloqueia os dependentes
    }
  }

  // nós não alcançados (após um human) => skipped, preservando a ordem topológica
  for (const id of order) {
    if (!records.has(id)) records.set(id, { id, status: "skipped" });
  }

  const nodes = order.map((id) => records.get(id));

  // status agregado
  const anyFailed = nodes.some((n) => n.status === "failed");
  const allDone = nodes.every((n) => n.status === "done");
  let status;
  if (waitingFor) status = "waiting-human";
  else if (stopped) status = "paused";
  else if (anyFailed) status = "failed";
  else if (allDone) status = "completed";
  else status = "blocked";

  return { status, nodes, state, waitingFor };
}