import test from "node:test";
import assert from "node:assert/strict";

import { createGraph } from "./model.mjs";
import { toHarnessState, fromHarnessState } from "./harness-state.mjs";

/* Estado do runtime em formato próprio (o que runtime.mjs grava). */
function runtimeState() {
  return {
    runId: "run-abc",
    status: "completed",
    startedAt: "2026-11-16T10:00:00.000Z",
    updatedAt: "2026-11-16T10:00:03.000Z",
    order: ["t1", "t2", "r1"],
    nodes: {
      t1: { id: "t1", kind: "task", status: "done", at: "2026-11-16T10:00:01.000Z", endedAt: "2026-11-16T10:00:01.000Z" },
      t2: { id: "t2", kind: "task", status: "done", at: "2026-11-16T10:00:02.000Z", endedAt: "2026-11-16T10:00:02.000Z" },
      r1: { id: "r1", kind: "review", status: "done", at: "2026-11-16T10:00:03.000Z", endedAt: "2026-11-16T10:00:03.000Z" },
    },
    checkpoints: [
      { id: "t1", status: "done", at: "2026-11-16T10:00:01.000Z" },
      { id: "t2", status: "done", at: "2026-11-16T10:00:02.000Z" },
      { id: "r1", status: "done", at: "2026-11-16T10:00:03.000Z" },
    ],
    waitingFor: null,
  };
}

/* ------------------------------------------------------------------ */

test("toHarnessState produz o formato da ponte com nós em ordem", () => {
  const graph = createGraph({
    nodes: [
      { id: "t1", kind: "task" },
      { id: "t2", kind: "task", dependsOn: ["t1"] },
      { id: "r1", kind: "review", dependsOn: ["t2"] },
    ],
    edges: [],
  });
  const doc = toHarnessState({ ...runtimeState(), graph });

  assert.equal(doc.runId, "run-abc");
  assert.equal(doc.status, "completed");
  assert.equal(doc.nodes.length, 3);
  // ordem topológica
  assert.deepEqual(doc.nodes.map((n) => n.id), ["t1", "t2", "r1"]);
  // campos por nó
  const t1 = doc.nodes[0];
  assert.equal(t1.label, "t1");
  assert.equal(t1.kind, "task");
  assert.equal(t1.status, "done");
  assert.ok(t1.startedAt);
  assert.ok(t1.endedAt);
  assert.equal(typeof t1.durationMs, "number");
  assert.equal(typeof t1.attempt, "number");
  // stats
  assert.deepEqual(doc.stats, { total: 3, done: 3, failed: 0, skipped: 0, durationMs: doc.stats.durationMs });
  assert.equal(doc.stats.done, 3);
});

test("toHarnessState amarra checkpoints a sha/label", () => {
  const doc = toHarnessState(runtimeState(), { sha: "abc1234", label: "ckpt/f3-t1" });
  assert.equal(doc.checkpoints.length, 3);
  assert.ok(doc.checkpoints.every((c) => c.sha === "abc1234"));
  assert.ok(doc.checkpoints[0].label.includes("ckpt/f3-t1"));
});

test("toHarnessState monta humanQueue a partir de waitingFor", () => {
  const rs = runtimeState();
  rs.status = "waiting-human";
  rs.waitingFor = "h1";
  const doc = toHarnessState(rs);
  assert.equal(doc.waitingFor, "h1");
  assert.equal(doc.humanQueue.length, 1);
  assert.equal(doc.humanQueue[0].nodeId, "h1");
});

test("fromHarnessState(toHarnessState(x)) preserva o que importa (ida e volta)", () => {
  const rs = runtimeState();
  const doc = toHarnessState(rs);
  const back = fromHarnessState(doc);

  assert.equal(back.runId, rs.runId);
  assert.equal(back.status, rs.status);
  assert.deepEqual(back.order, rs.order);
  // nós preservados
  for (const id of rs.order) {
    assert.equal(back.nodes[id].status, rs.nodes[id].status, `status de ${id}`);
    assert.equal(back.nodes[id].kind, rs.nodes[id].kind, `kind de ${id}`);
  }
  assert.equal(back.waitingFor, rs.waitingFor);
});

test("fromHarnessState é idempotente com toHarnessState", () => {
  const rs = runtimeState();
  const once = fromHarnessState(toHarnessState(rs));
  const twice = fromHarnessState(toHarnessState(once));
  assert.equal(twice.runId, once.runId);
  assert.deepEqual(twice.order, once.order);
  assert.equal(twice.nodes.t1.status, once.nodes.t1.status);
});

test("toHarnessState deriva status quando ausente", () => {
  const rs = runtimeState();
  delete rs.status;
  const doc = toHarnessState(rs);
  assert.equal(doc.status, "completed");
});