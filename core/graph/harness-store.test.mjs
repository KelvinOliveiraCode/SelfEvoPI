import test from "node:test";
import assert from "node:assert/strict";
import { rm, readFile } from "node:fs/promises";

import { createHarnessStore } from "./harness-store.mjs";

const DIR = ".pi/harness/tmp/ponte-teste";

function doc(runId, status = "running") {
  return {
    runId,
    status,
    startedAt: "2026-11-16T10:00:00.000Z",
    updatedAt: "2026-11-16T10:00:01.000Z",
    nodes: [
      { id: "t1", label: "t1", kind: "task", status: "done", startedAt: "2026-11-16T10:00:00.000Z", endedAt: "2026-11-16T10:00:01.000Z", durationMs: 1000, attempt: 1 },
      { id: "t2", label: "t2", kind: "task", status: status === "completed" ? "done" : "pending", startedAt: null, endedAt: null, durationMs: 0, attempt: 0 },
    ],
    checkpoints: [{ at: "2026-11-16T10:00:01.000Z", sha: "abc1234", label: "ckpt/x#1" }],
    waitingFor: null,
    humanQueue: [],
    stats: { total: 2, done: status === "completed" ? 2 : 1, failed: 0, skipped: 0, durationMs: 1000 },
  };
}

test("harness-store: grava, lista e carrega", async () => {
  await rm(DIR, { recursive: true, force: true });
  const store = createHarnessStore({ dir: DIR });

  await store.save("run-1", doc("run-1", "completed"));
  await store.save("run-2", doc("run-2", "running"));

  const list = await store.list();
  assert.equal(list.length, 2);
  const ids = list.map((r) => r.runId).sort();
  assert.deepEqual(ids, ["run-1", "run-2"]);

  const loaded = await store.load("run-1");
  assert.equal(loaded.runId, "run-1");
  assert.equal(loaded.nodes.length, 2);
  assert.equal(loaded.nodes[0].status, "done");

  await rm(DIR, { recursive: true, force: true });
});

test("harness-store: index.json tem id, status, startedAt, nodes e progresso", async () => {
  await rm(DIR, { recursive: true, force: true });
  const store = createHarnessStore({ dir: DIR });
  await store.save("run-x", doc("run-x", "completed"));

  const raw = await readFile(`${DIR}/index.json`, "utf8");
  const index = JSON.parse(raw);
  assert.equal(index.version, 1);
  assert.equal(index.runs.length, 1);
  const run = index.runs[0];
  assert.equal(run.runId, "run-x");
  assert.equal(run.status, "completed");
  assert.ok(run.startedAt);
  assert.equal(run.nodes, 2);
  assert.equal(run.progress, 1, "2/2 done = progresso 1");
  assert.equal(run.done, 2);

  await rm(DIR, { recursive: true, force: true });
});

test("harness-store: sobrescreve sem duplicar no index", async () => {
  await rm(DIR, { recursive: true, force: true });
  const store = createHarnessStore({ dir: DIR });

  await store.save("run-1", doc("run-1", "running"));
  await store.save("run-1", doc("run-1", "completed")); // sobrescreve

  const list = await store.list();
  assert.equal(list.length, 1, "não duplica");
  assert.equal(list[0].status, "completed");
  assert.equal(list[0].progress, 1);

  await rm(DIR, { recursive: true, force: true });
});

test("harness-store: recusa id inválido", async () => {
  const store = createHarnessStore({ dir: DIR });
  await assert.rejects(store.save("../evil", doc("x")), /runId inválido/);
  await assert.rejects(store.save("a/b", doc("x")), /runId inválido/);
  await assert.rejects(store.load(""), /runId inválido/);
});

test("harness-store: load retorna null para run inexistente", async () => {
  await rm(DIR, { recursive: true, force: true });
  const store = createHarnessStore({ dir: DIR });
  const loaded = await store.load("run-fantasma");
  assert.equal(loaded, null);
});

test("harness-store: listFiles devolve os runIds com arquivo", async () => {
  await rm(DIR, { recursive: true, force: true });
  const store = createHarnessStore({ dir: DIR });
  await store.save("run-a", doc("run-a"));
  await store.save("run-b", doc("run-b"));

  const files = (await store.listFiles()).sort();
  assert.deepEqual(files, ["run-a", "run-b"]);

  await rm(DIR, { recursive: true, force: true });
});