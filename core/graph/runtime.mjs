/**
 * selfevopi-graph-runtime — runtime persistente do grafo de execução (Fase 3).
 *
 * Sem dependências. Node ESM puro. Windows nativo (sem `.sh`).
 *
 * O runtime fica ENTRE o modelo e o executor: reusa `createExecutor` (não
 * reimplementa a orquestração) e acrescenta o que o executor não tem —
 * checkpoint por nó, pausa/retomada e um `store` que persiste o estado.
 *
 * Contrato:
 *   const rt = createRuntime({ graph, runNode, store?, autoApprove?, timeoutMs? })
 *   await rt.run()          -> executa (ou retoma) do checkpoint
 *   rt.pause()              -> pede pausa (interrompe ENTRE nós)
 *   await rt.resume()       -> continua do último checkpoint
 *   rt.status()             -> { runId, nodes:[{id,status}], waitingFor, checkpoints }
 *   rt.checkpoints()        -> histórico de checkpoints (por nó)
 *
 * `runNode(node, { state, previous })` é a função assíncrona de quem chama.
 *
 * Store: objeto `{ save(state), load() }`. O default grava JSON em
 * `.pi/harness/graph/<runId>.json` (mkdir -p antes).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createExecutor } from "./executor.mjs";
import { topologicalOrder } from "./model.mjs";
import { toHarnessState } from "./harness-state.mjs";
import { createHarnessStore } from "./harness-store.mjs";

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

/**
 * Store de arquivo JSON. `dir` é a pasta base; cada run vira `<dir>/<runId>.json`.
 * `save` serializa o estado inteiro (nós + checkpoints + ponteiros).
 */
export function createFileStore({ dir = ".pi/harness/graph" } = {}) {
  return {
    dir,
    file(runId) {
      return join(dir, `${runId}.json`);
    },
    async save(state) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${state.runId}.json`), JSON.stringify(state), "utf8");
    },
    async load(runId) {
      const raw = await readFile(join(dir, `${runId}.json`), "utf8").catch(() => null);
      return raw ? JSON.parse(raw) : null;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Runtime                                                             */
/* ------------------------------------------------------------------ */

/** Gera um id de run curto e legível, sem depender de aleatoriedade forte. */
function newRunId(now = () => Date.now()) {
  return `run-${now().toString(36)}`;
}

/**
 * Cria o runtime.
 *
 * @param {object}   opts
 * @param {object}   opts.graph        grafo válido (de `createGraph`)
 * @param {Function} opts.runNode      `async (node, { state, previous }) => any`
 * @param {object}   [opts.store]      `{ save, load }`; default = arquivo JSON
 * @param {boolean}  [opts.autoApprove=false]
 * @param {number}   [opts.timeoutMs=null]
 * @param {string}   [opts.runId]      id fixo (para retomar um run gravado)
 * @param {boolean}  [opts.harness=false]  quando true, grava TAMBÉM no formato da
 *                                       ponte (harness-state) via harness-store
 * @param {object}   [opts.harnessStore]   store da ponte; default = `.pi/harness/graph`
 * @param {object}   [opts.stateAdapter]   `{ toHarnessState, fromHarnessState }`; default = harness-state.mjs
 * @param {object}   [opts.harnessMeta]    `{ sha?, label? }` amarrado aos checkpoints (git-nativo)
 */
export function createRuntime({
  graph,
  runNode,
  store = createFileStore(),
  autoApprove = false,
  timeoutMs = null,
  runId = newRunId(),
  harness = false,
  harnessStore = null,
  stateAdapter = null,
  harnessMeta = {},
} = {}) {
  if (typeof runNode !== "function") {
    throw new TypeError("createRuntime: runNode deve ser uma função");
  }

  // ponte opcional: só monta o store da ponte quando pedido
  const bridge =
    harness && harnessStore
      ? { store: harnessStore, adapter: stateAdapter ?? defaultAdapter(), meta: harnessMeta }
      : harness
        ? { store: createHarnessStore(), adapter: stateAdapter ?? defaultAdapter(), meta: harnessMeta }
        : null;

  function defaultAdapter() {
    // import lazy evita ciclo percebido e mantém o módulo testável isolado
    return { toHarnessState, fromHarnessState: null };
  }

  // converte o estado do runtime (formato próprio) + grafo para o formato da ponte
  function toBridgeDoc(runState) {
    const rs = { ...runState, graph };
    return bridge.adapter.toHarnessState(rs, bridge.meta ?? {});
  }

  async function saveBridge(runState) {
    if (!bridge) return;
    const doc = toBridgeDoc(runState);
    await bridge.store.save(runId, doc);
  }

  /* estado durável ------------------------------------------------- */
  let state = null; // { runId, nodes: {id:rec}, order: [ids], checkpoints: [...], waitingFor }
  let pauseRequested = false;
  let running = false;

  function freshState() {
    return { runId, nodes: {}, order: [], checkpoints: [], waitingFor: null };
  }

  function nodeList() {
    // nós com status no estado atual, na ordem topológica do grafo
    const ids = graph.nodes.length ? safeOrder() : [];
    return ids.map((id) => {
      const rec = state?.nodes?.[id];
      return { id, status: rec?.status ?? "pending" };
    });
  }

  // ordem topológica tolerante a falha (não deve falhar: grafo já validado)
  function safeOrder() {
    try {
      return topologicalOrder(graph);
    } catch {
      return graph.nodes.map((n) => n.id);
    }
  }

  function checkpointCount() {
    return state?.checkpoints?.length ?? 0;
  }

  /* pausa/retomada ------------------------------------------------- */

  function pause() {
    pauseRequested = true;
    return status();
  }

  async function resume() {
    return run();
  }

  /* run ------------------------------------------------------------ */

  async function run() {
    if (running) throw new Error("runtime: já está rodando");
    running = true;
    pauseRequested = false;

    try {
      // carrega estado existente (retomada) ou começa um novo
      if (!state) {
        const saved = await store.load(runId).catch(() => null);
        state = saved && saved.runId === runId ? saved : freshState();
      }
      if (!state.startedAt) state.startedAt = new Date().toISOString();
      state.waitingFor = null;

      // registros terminais a reusar (não re-rodar nós done/failed)
      const resumeFrom = {};
      for (const [id, rec] of Object.entries(state.nodes ?? {})) {
        if (rec && (rec.status === "done" || rec.status === "failed")) resumeFrom[id] = rec;
      }

      // estado compartilhado herdado entre retomadas
      const initialState = state.shared ?? {};

      // rótulos e kinds do grafo, para o estado persistido ser legível
      const byId = new Map((graph.nodes ?? []).map((n) => [n.id, n]));

      const result = await createExecutor({
        graph,
        runNode,
        autoApprove,
        timeoutMs,
        initialState,
        resumeFrom,
        // pausa cooperativa: só interrompe no topo do laço, entre nós
        shouldStop: () => pauseRequested,
        onNode: async (rec) => {
          // checkpoint por nó: status, result/error e timestamp.
          // O rótulo vem do grafo: sem ele o estado persistido mostra o id cru,
          // e um desktop leria "n1" em vez de "detectar lacuna".
          const node = byId.get(rec.id);
          const stamped = {
            ...rec,
            label: node?.label ?? rec.label ?? rec.id,
            kind: node?.kind ?? rec.kind ?? "task",
            at: new Date().toISOString(),
          };
          if (!state.nodes) state.nodes = {};
          state.nodes[rec.id] = stamped;
          if (!state.order) state.order = [];
          if (!state.order.includes(rec.id)) state.order.push(rec.id);
          if (!state.checkpoints) state.checkpoints = [];
          state.checkpoints.push({ id: rec.id, status: rec.status, at: stamped.at });
          state.updatedAt = stamped.at;
          await store.save(state);
          await saveBridge(state);
        },
      });

      // consolida resultado no estado durável
      state.shared = result.state ?? state.shared ?? {};
      for (const n of result.nodes) {
        if (n.status === "skipped") continue; // não gravado como terminal
        if (!state.nodes[n.id]) {
          state.nodes[n.id] = { ...n, at: new Date().toISOString() };
          if (!state.order.includes(n.id)) state.order.push(n.id);
        }
      }
      // nós não gravados (blocked/padding) entram como pending no estado
      for (const n of result.nodes) {
        if (!state.nodes[n.id]) {
          state.nodes[n.id] = { id: n.id, status: "pending" };
          if (!state.order.includes(n.id)) state.order.push(n.id);
        }
      }
      state.waitingFor = result.waitingFor ?? null;

      // status agregado do runtime: espelha o do executor
      const anyFailed = Object.values(state.nodes).some((n) => n.status === "failed");
      const allDone =
        state.order.length > 0 && state.order.every((id) => state.nodes[id]?.status === "done");

      let status;
      if (state.waitingFor) status = "waiting-human";
      else if (pauseRequested || result.status === "paused") status = "paused";
      else if (anyFailed) status = "failed";
      else if (allDone) status = "completed";
      else status = "blocked";

      state.status = status;
      state.updatedAt = new Date().toISOString();
      await store.save(state);
      await saveBridge(state);
      return { status, state: result.state, result };
    } finally {
      running = false;
    }
  }

  /* status/checkpoints -------------------------------------------- */

  function status() {
    return {
      runId,
      status: state?.status ?? "pending",
      nodes: nodeList(),
      waitingFor: state?.waitingFor ?? null,
      checkpoints: checkpointCount(),
    };
  }

  function checkpoints() {
    return (state?.checkpoints ?? []).map((c) => ({ ...c }));
  }

  return { run, pause, resume, status, checkpoints };
}