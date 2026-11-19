import test from "node:test";
import assert from "node:assert/strict";

import { createGraph } from "./model.mjs";
import { createExecutor, TimeoutError } from "./executor.mjs";

/* Nó `task` simples. `run` é o que o `runNode` faz. */
function task(id, dependsOn = [], extra = {}) {
  return { id, agent: `A-${id}`, kind: "task", status: "pending", dependsOn, ...extra };
}

/* runNode que registra a ordem e devolve o próprio id. */
function recorder(order, fn = null) {
  return async (node) => {
    order.push(node.id);
    return fn ? fn(node) : node.id;
  };
}

/* ------------------------------------------------------------------ */

test("grafo linear executa em ordem topológica", async () => {
  const graph = createGraph({
    nodes: [task("t1"), task("t2", ["t1"]), task("t3", ["t2"])],
    edges: [],
  });
  const order = [];
  const result = await createExecutor({ graph, runNode: recorder(order) });

  assert.equal(result.status, "completed");
  assert.deepEqual(order, ["t1", "t2", "t3"]);
  assert.deepEqual(result.nodes.map((n) => n.status), ["done", "done", "done"]);
  assert.equal(result.waitingFor, null);
});

test("nó com dependência que falhou fica blocked", async () => {
  const graph = createGraph({
    nodes: [task("t1"), task("t2", ["t1"])],
    edges: [],
  });
  const order = [];
  const runNode = async (node) => {
    order.push(node.id);
    if (node.id === "t1") throw new Error("boom");
    return node.id;
  };

  const result = await createExecutor({ graph, runNode });

  assert.equal(result.status, "failed");
  assert.deepEqual(order, ["t1"], "t2 não deve rodar");

  const t1 = result.nodes.find((n) => n.id === "t1");
  const t2 = result.nodes.find((n) => n.id === "t2");
  assert.equal(t1.status, "failed");
  assert.equal(t1.reason, "error");
  assert.equal(t1.error.message, "boom");
  assert.equal(t2.status, "blocked");
  assert.deepEqual(t2.deps, ["t1"]);
});

test("nó human sem autoApprove devolve waiting-human e não passa adiante", async () => {
  const graph = createGraph({
    nodes: [task("t1"), { id: "h1", agent: "humano", kind: "human", dependsOn: ["t1"] }, task("t2", ["h1"])],
    edges: [],
  });
  const order = [];
  const result = await createExecutor({ graph, runNode: recorder(order) });

  assert.equal(result.status, "waiting-human");
  assert.equal(result.waitingFor, "h1");
  assert.deepEqual(order, ["t1"], "deve parar antes do nó humano");

  const h1 = result.nodes.find((n) => n.id === "h1");
  const t2 = result.nodes.find((n) => n.id === "t2");
  assert.equal(h1.status, "waiting");
  assert.equal(t2.status, "skipped", "nó depois do human não roda");
});

test("autoApprove true deixa o nó human rodar como os outros", async () => {
  const graph = createGraph({
    nodes: [task("t1"), { id: "h1", agent: "humano", kind: "human", dependsOn: ["t1"] }, task("t2", ["h1"])],
    edges: [],
  });
  const order = [];
  const result = await createExecutor({ graph, runNode: recorder(order), autoApprove: true });

  assert.equal(result.status, "completed");
  assert.deepEqual(order, ["t1", "h1", "t2"]);
  assert.equal(result.waitingFor, null);
});

test("timeout de um nó marca failed (reason timeout) e segue", async () => {
  const graph = createGraph({
    nodes: [
      task("t1", [], { timeoutMs: 5 }), // nunca resolve
      task("t2"), // independente: deve rodar
      task("t3", ["t1"]), // depende do que estourou
    ],
    edges: [],
  });
  const order = [];
  const runNode = async (node) => {
    order.push(node.id);
    if (node.id === "t1") return new Promise(() => {}); // pendura
    return node.id;
  };

  const result = await createExecutor({ graph, runNode });

  assert.equal(result.status, "failed");

  const t1 = result.nodes.find((n) => n.id === "t1");
  assert.equal(t1.status, "failed");
  assert.equal(t1.reason, "timeout");
  assert.ok(t1.error instanceof TimeoutError);
  assert.equal(t1.timeoutMs, 5);

  // segue: nó independente roda, dependente do que falhou fica blocked
  assert.deepEqual(order, ["t1", "t2"]);
  assert.equal(result.nodes.find((n) => n.id === "t2").status, "done");
  assert.equal(result.nodes.find((n) => n.id === "t3").status, "blocked");
});

test("estado compartilhado é visível entre nós", async () => {
  const graph = createGraph({
    nodes: [task("t1"), task("t2", ["t1"]), task("t3", ["t2"])],
    edges: [],
  });
  const runNode = async (node, { state }) => {
    state.count = (state.count ?? 0) + 1;
    state.trace = [...(state.trace ?? []), node.id];
    return state.count;
  };

  const result = await createExecutor({ graph, runNode });

  assert.equal(result.status, "completed");
  assert.equal(result.state.count, 3);
  assert.deepEqual(result.state.trace, ["t1", "t2", "t3"]);
  // cada nó viu o estado do anterior
  assert.deepEqual(result.nodes.map((n) => n.result), [1, 2, 3]);
});

test("previous é o registro do nó anterior (e null no primeiro)", async () => {
  const graph = createGraph({ nodes: [task("t1"), task("t2", ["t1"])], edges: [] });
  const seen = [];
  const runNode = async (node, { previous }) => {
    seen.push(previous ? previous.id : null);
    return node.id;
  };
  await createExecutor({ graph, runNode });
  assert.deepEqual(seen, [null, "t1"]);
});

test("nós não alcançados após human ficam skipped, não failed", async () => {
  const graph = createGraph({
    nodes: [task("t1"), { id: "h1", kind: "human", dependsOn: ["t1"] }, task("t2", ["h1"])],
    edges: [],
  });
  const result = await createExecutor({ graph, runNode: recorder([]) });
  assert.equal(result.status, "waiting-human");
  assert.equal(result.nodes.find((n) => n.id === "t2").status, "skipped");
});

test("executor não lê relógio para decidir fluxo (sem timeout, sem Date.now)", async () => {
  const graph = createGraph({ nodes: [task("a"), task("b", ["a"]), task("c", ["b"])], edges: [] });

  const realNow = Date.now;
  let calls = 0;
  Date.now = () => {
    calls += 1;
    return realNow();
  };
  try {
    const order = [];
    const result = await createExecutor({ graph, runNode: recorder(order) });
    assert.equal(result.status, "completed");
    assert.deepEqual(order, ["a", "b", "c"]);
  } finally {
    Date.now = realNow;
  }
  assert.equal(calls, 0, "fluxo não deve consultar o relógio");
});

test("grafo inválido (ciclo) é rejeitado antes de executar", async () => {
  const graph = { nodes: [task("a", ["b"]), task("b", ["a"])], edges: [] };
  await assert.rejects(
    createExecutor({ graph, runNode: recorder([]) }),
    (err) => err?.code === "cycle"
  );
});

test("runNode obrigatório", async () => {
  const graph = createGraph({ nodes: [task("a")], edges: [] });
  await assert.rejects(createExecutor({ graph }), TypeError);
});