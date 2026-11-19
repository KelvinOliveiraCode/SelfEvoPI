import test from "node:test";
import assert from "node:assert/strict";

import {
  createGraph,
  validate,
  topologicalOrder,
  nextReady,
  GraphError,
  NODE_KINDS,
  NODE_STATUSES,
  EDGE_KINDS,
} from "./model.mjs";

/* Grafo de referência: task -> task -> review -> human -> artifact */
function sampleGraph() {
  return createGraph({
    nodes: [
      { id: "t1", agent: "A1", kind: "task", status: "pending", dependsOn: [] },
      { id: "t2", agent: "A3", kind: "task", status: "pending", dependsOn: ["t1"] },
      { id: "r1", agent: "A2", kind: "review", status: "pending", dependsOn: ["t2"] },
      { id: "h1", agent: "humano", kind: "human", status: "pending", dependsOn: ["r1"] },
      { id: "a1", agent: "A8", kind: "artifact", status: "pending", dependsOn: ["h1"] },
    ],
    edges: [
      { from: "t1", to: "t2", kind: "handoff" },
      { from: "t2", to: "r1", kind: "handoff" },
      { from: "r1", to: "h1", kind: "approval" },
      { from: "h1", to: "a1", kind: "artifact" },
    ],
  });
}

/* ------------------------------------------------------------------ */

test("grafo válido passa na validação e é construído", () => {
  const graph = sampleGraph();
  const { ok, errors } = validate(graph);
  assert.equal(ok, true);
  assert.deepEqual(errors, []);
  assert.equal(graph.nodes.length, 5);
  assert.equal(graph.edges.length, 4);
});

test("createGraph aplica defaults (kind=task, status=pending, dependsOn=[])", () => {
  const graph = createGraph({ nodes: [{ id: "x", agent: "A1" }], edges: [] });
  const node = graph.nodes[0];
  assert.equal(node.kind, "task");
  assert.equal(node.status, "pending");
  assert.deepEqual(node.dependsOn, []);
});

test("id duplicado é reprovado", () => {
  const graph = { nodes: [{ id: "a" }, { id: "a" }], edges: [] };
  const { ok, errors } = validate(graph);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.code === "duplicate-id"));
  assert.throws(() => createGraph(graph), GraphError);
});

test("dependência inexistente é reprovada", () => {
  const graph = { nodes: [{ id: "a", dependsOn: ["ghost"] }], edges: [] };
  const { ok, errors } = validate(graph);
  assert.equal(ok, false);
  const issue = errors.find((e) => e.code === "unknown-dependency");
  assert.ok(issue, "esperava unknown-dependency");
  assert.equal(issue.dependency, "ghost");
});

test("ciclo em dependsOn é reprovado", () => {
  const graph = {
    nodes: [
      { id: "a", dependsOn: ["b"] },
      { id: "b", dependsOn: ["a"] },
    ],
    edges: [],
  };
  const { ok, errors } = validate(graph);
  assert.equal(ok, false);
  const cycle = errors.find((e) => e.code === "cycle");
  assert.ok(cycle, "esperava cycle");
  assert.deepEqual(cycle.cycle[0], cycle.cycle[cycle.cycle.length - 1], "ciclo deve fechar");
});

test("auto-dependência é tratada como ciclo", () => {
  const graph = { nodes: [{ id: "a", dependsOn: ["a"] }], edges: [] };
  const { ok, errors } = validate(graph);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.code === "cycle"));
});

test("nó human sem tarefa anterior é reprovado", () => {
  const graph = {
    nodes: [
      { id: "h", kind: "human" },
      { id: "a", kind: "artifact", dependsOn: ["h"] },
    ],
    edges: [],
  };
  const { ok, errors } = validate(graph);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.code === "human-without-task"));
});

test("nó human com tarefa ancestral (mesmo indireta) passa", () => {
  const graph = {
    nodes: [
      { id: "t", kind: "task" },
      { id: "r", kind: "review", dependsOn: ["t"] },
      { id: "h", kind: "human", dependsOn: ["r"] },
    ],
    edges: [],
  };
  const { ok, errors } = validate(graph);
  assert.equal(ok, true, errors.map((e) => e.code).join(", "));
});

test("aresta com ponta inexistente é reprovada", () => {
  const graph = {
    nodes: [{ id: "a" }],
    edges: [{ from: "a", to: "ghost", kind: "handoff" }],
  };
  const { ok, errors } = validate(graph);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.code === "unknown-edge-endpoint"));
});

test("topologicalOrder devolve a ordem respeitando dependências", () => {
  const graph = sampleGraph();
  assert.deepEqual(topologicalOrder(graph), ["t1", "t2", "r1", "h1", "a1"]);
});

test("topologicalOrder é determinístico em empates (ordem de inserção)", () => {
  const graph = createGraph({
    nodes: [
      { id: "b", dependsOn: [] },
      { id: "a", dependsOn: [] },
      { id: "c", dependsOn: ["a", "b"] },
    ],
    edges: [],
  });
  // raízes b, a (nessa ordem) e c por último
  assert.deepEqual(topologicalOrder(graph), ["b", "a", "c"]);
});

test("topologicalOrder lança em grafo com ciclo", () => {
  const graph = { nodes: [{ id: "a", dependsOn: ["b"] }, { id: "b", dependsOn: ["a"] }], edges: [] };
  assert.throws(() => topologicalOrder(graph), (err) => err instanceof GraphError && err.code === "cycle");
});

test("nextReady respeita dependências ao longo da execução", () => {
  const graph = sampleGraph();

  // só t1 (sem deps) começa pronto
  assert.deepEqual(nextReady(graph).map((n) => n.id), ["t1"]);

  // completa t1 -> t2 fica pronto
  graph.nodes.find((n) => n.id === "t1").status = "done";
  assert.deepEqual(nextReady(graph).map((n) => n.id), ["t2"]);

  // completa t2 -> r1 pronto
  graph.nodes.find((n) => n.id === "t2").status = "done";
  assert.deepEqual(nextReady(graph).map((n) => n.id), ["r1"]);
});

test("nextReady não libera nó cuja dependência falhou", () => {
  const graph = createGraph({
    nodes: [
      { id: "t", kind: "task" },
      { id: "r", kind: "review", dependsOn: ["t"] },
    ],
    edges: [],
  });
  graph.nodes.find((n) => n.id === "t").status = "failed";
  assert.deepEqual(nextReady(graph).map((n) => n.id), []);
});

test("nextReady devolve os nós (não cópias) e ignora nós já em andamento", () => {
  const graph = createGraph({
    nodes: [
      { id: "a", dependsOn: [] },
      { id: "b", dependsOn: [] },
    ],
    edges: [],
  });
  graph.nodes.find((n) => n.id === "a").status = "running";
  const ready = nextReady(graph);
  assert.deepEqual(ready.map((n) => n.id), ["b"]);
  assert.equal(ready[0], graph.nodes.find((n) => n.id === "b"));
});

test("arestas não afetam a ordem (só dependsOn)", () => {
  const graph = createGraph({
    nodes: [{ id: "a" }, { id: "b" }],
    edges: [{ from: "a", to: "b", kind: "handoff" }],
  });
  // aresta a->b existe, mas sem dependsOn a ordem é a de inserção
  assert.deepEqual(topologicalOrder(graph), ["a", "b"]);
});

test("vocabulários públicos estão expostos", () => {
  assert.deepEqual(NODE_KINDS, ["task", "review", "human", "artifact"]);
  assert.deepEqual(NODE_STATUSES, ["pending", "running", "done", "failed", "blocked"]);
  assert.deepEqual(EDGE_KINDS, ["handoff", "approval", "artifact"]);
});

test("status e kind fora do vocabulário são reprovados", () => {
  const graph = {
    nodes: [{ id: "a", kind: "robô", status: "parado" }],
    edges: [],
  };
  const { ok, errors } = validate(graph);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.code === "invalid-kind"));
  assert.ok(errors.some((e) => e.code === "invalid-status"));
});