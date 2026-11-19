import test from "node:test";
import assert from "node:assert/strict";

import { createGraph } from "./model.mjs";
import { createRuntime, createFileStore } from "./runtime.mjs";

/* Nó `task` simples. */
function task(id, dependsOn = [], extra = {}) {
  return { id, agent: `A-${id}`, kind: "task", status: "pending", dependsOn, ...extra };
}

/* Store em memória (evita tocar disco nos testes). */
function memoryStore(initial = null) {
  let saved = initial;
  const writes = [];
  return {
    writes,
    async save(state) {
      saved = JSON.parse(JSON.stringify(state));
      writes.push(saved);
    },
    async load() {
      return saved;
    },
    _get() {
      return saved;
    },
  };
}

/* ------------------------------------------------------------------ */

test("3 nós em cadeia: checkpoint existe após cada nó", async () => {
  const graph = createGraph({ nodes: [task("t1"), task("t2", ["t1"]), task("t3", ["t2"])], edges: [] });
  const store = memoryStore();
  const rt = createRuntime({
    graph,
    store,
    runNode: async (node, { state }) => {
      state.seen = [...(state.seen ?? []), node.id];
      return node.id;
    },
  });

  const out = await rt.run();

  assert.equal(out.status, "completed");
  const cps = rt.checkpoints();
  assert.equal(cps.length, 3, "um checkpoint por nó");
  assert.deepEqual(cps.map((c) => c.id), ["t1", "t2", "t3"]);
  assert.ok(cps.every((c) => c.at), "cada checkpoint tem timestamp");
  assert.ok(cps.every((c) => c.status === "done"));
});

test("pause() interrompe entre nós e resume() não re-roda os done", async () => {
  const graph = createGraph({ nodes: [task("t1"), task("t2", ["t1"]), task("t3", ["t2"])], edges: [] });
  const store = memoryStore();
  const order = [];

  let rt;
  rt = createRuntime({
    graph,
    store,
    runNode: async (node) => {
      order.push(node.id);
      if (node.id === "t1") rt.pause(); // pede pausa ao fim do 1º nó
      return node.id;
    },
  });

  const first = await rt.run();
  assert.equal(first.status, "paused", "deve parar após o 1º nó");
  assert.deepEqual(order, ["t1"], "só t1 rodou");

  const st = rt.status();
  assert.equal(st.nodes.find((n) => n.id === "t1").status, "done");
  assert.equal(st.nodes.find((n) => n.id === "t2").status, "pending");

  const second = await rt.resume();
  assert.equal(second.status, "completed");
  assert.deepEqual(order, ["t1", "t2", "t3"], "resume não re-rodou t1");
  assert.equal(rt.status().nodes.find((n) => n.id === "t3").status, "done");
});

test("nó que falha: dependentes ficam blocked e resume não re-executa o que falhou", async () => {
  const graph = createGraph({ nodes: [task("t1"), task("t2", ["t1"])], edges: [] });
  const store = memoryStore();
  const order = [];

  const rt = createRuntime({
    graph,
    store,
    runNode: async (node) => {
      order.push(node.id);
      if (node.id === "t1") throw new Error("boom");
      return node.id;
    },
  });

  const first = await rt.run();
  assert.equal(first.status, "failed");

  let st = rt.status();
  assert.equal(st.nodes.find((n) => n.id === "t1").status, "failed");
  assert.equal(st.nodes.find((n) => n.id === "t2").status, "blocked");
  assert.deepEqual(order, ["t1"], "t2 não roda");

  // resume: t1 (failed) não re-executa; t2 continua blocked
  const second = await rt.resume();
  assert.deepEqual(order, ["t1"], "t1 não deve re-executar no resume");
  st = rt.status();
  assert.equal(st.nodes.find((n) => n.id === "t1").status, "failed");
  assert.equal(st.nodes.find((n) => n.id === "t2").status, "blocked");
});

test("status() devolve JSON compacto com runId, nodes, waitingFor, checkpoints", async () => {
  const graph = createGraph({ nodes: [task("t1")], edges: [] });
  const store = memoryStore();
  const rt = createRuntime({ graph, store, runNode: async (n) => n.id });

  await rt.run();
  const st = rt.status();

  assert.equal(typeof st.runId, "string");
  assert.ok(Array.isArray(st.nodes));
  assert.equal(st.nodes[0].id, "t1");
  assert.equal(st.nodes[0].status, "done");
  assert.ok("waitingFor" in st);
  assert.equal(typeof st.checkpoints, "number");
  assert.equal(st.checkpoints, 1);
});

test("estado compartilhado persiste entre nós e entre retomadas", async () => {
  const graph = createGraph({ nodes: [task("t1"), task("t2", ["t1"])], edges: [] });
  const store = memoryStore();
  const rt = createRuntime({
    graph,
    store,
    runNode: async (node, { state }) => {
      state.count = (state.count ?? 0) + 1;
      return state.count;
    },
  });

  await rt.run();
  // o estado sobrevive no runtime e no store
  assert.equal(rt.status().nodes.length, 2);
  const saved = store._get();
  assert.equal(saved.shared.count, 2);
});

test("runtime com harness:true grava os dois formatos (próprio + ponte)", async () => {
  const { createHarnessStore } = await import("./harness-store.mjs");
  const graph = createGraph({ nodes: [task("t1"), task("t2", ["t1"])], edges: [] });

  const ownStore = memoryStore();
  const bridgeDir = ".pi/harness/tmp/runtime-harness-teste";
  const bridgeStore = createHarnessStore({ dir: bridgeDir });

  const rt = createRuntime({
    graph,
    store: ownStore,
    harness: true,
    harnessStore: bridgeStore,
    runId: "run-bridge",
    harnessMeta: { sha: "deadbee", label: "ckpt/f3" },
    runNode: async (node) => node.id,
  });

  const out = await rt.run();
  assert.equal(out.status, "completed");

  // formato próprio
  assert.ok(ownStore._get(), "formato do runtime gravado");
  // formato da ponte
  const bridged = await bridgeStore.load("run-bridge");
  assert.ok(bridged, "ponte gravada");
  assert.equal(bridged.runId, "run-bridge");
  assert.equal(bridged.nodes.length, 2);
  assert.deepEqual(bridged.nodes.map((n) => n.id), ["t1", "t2"]);
  assert.ok(bridged.checkpoints.every((c) => c.sha === "deadbee"));

  // index.json
  const list = await bridgeStore.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].runId, "run-bridge");
  assert.equal(list[0].progress, 1);

  await (await import("node:fs/promises")).rm(bridgeDir, { recursive: true, force: true });
});

test("createFileStore grava e carrega JSON em disco", async () => {
  const dir = ".pi/harness/tmp/test-graph-store";
  const store = createFileStore({ dir });
  const rt = createRuntime({
    graph: createGraph({ nodes: [task("t1")], edges: [] }),
    store,
    runId: "run-filetest",
    runNode: async (n) => n.id,
  });
  await rt.run();

  // novo runtime, mesmo runId e store: deve carregar do disco
  const rt2 = createRuntime({
    graph: createGraph({ nodes: [task("t1")], edges: [] }),
    store,
    runId: "run-filetest",
    runNode: async () => {
      throw new Error("não deveria re-rodar");
    },
  });
  const out = await rt2.run();
  assert.equal(out.status, "completed", "recuperou do checkpoint sem re-rodar");
});