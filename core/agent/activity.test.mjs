import test from "node:test";
import assert from "node:assert/strict";

import {
  registerActivity,
  updateActivity,
  unregisterActivity,
  listActivity,
  getActive,
  getActivity,
  clearActivity,
} from "./activity.mjs";

/* ------------------------------------------------------------------ */
/* Setup: cada teste começa com o registro vazio (módulo é singleton)   */
/* ------------------------------------------------------------------ */

test.beforeEach(() => clearActivity());

/* ------------------------------------------------------------------ */
/* Registro e listagem                                                 */
/* ------------------------------------------------------------------ */

test("registra shell e subagente e lista tudo", () => {
  registerActivity({ id: "s1", kind: "shell", name: "build", status: "running", startedAt: "2026-11-20T10:00:00Z" });
  registerActivity({
    id: "a1",
    kind: "subagent",
    name: "k3",
    status: "running",
    startedAt: "2026-11-20T10:01:00Z",
    meta: { persistent: true, provider: "kilo3", model: "ernie" },
  });

  const all = listActivity();
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((r) => r.kind).sort(), ["shell", "subagent"]);
});

test("filtra por kind", () => {
  registerActivity({ id: "s1", kind: "shell", name: "x", status: "running", startedAt: "2026-11-20T10:00:00Z" });
  registerActivity({ id: "a1", kind: "subagent", name: "y", status: "running", startedAt: "2026-11-20T10:01:00Z" });

  const shells = listActivity({ kind: "shell" });
  assert.equal(shells.length, 1);
  assert.equal(shells[0].id, "s1");
});

test("filtra por status", () => {
  registerActivity({ id: "s1", kind: "shell", name: "x", status: "running", startedAt: "2026-11-20T10:00:00Z" });
  registerActivity({ id: "s2", kind: "shell", name: "y", status: "done", startedAt: "2026-11-20T10:01:00Z" });

  const done = listActivity({ status: "done" });
  assert.equal(done.length, 1);
  assert.equal(done[0].id, "s2");
});

test("filtra por kind e status combinados", () => {
  registerActivity({ id: "s1", kind: "shell", name: "x", status: "running", startedAt: "2026-11-20T10:00:00Z" });
  registerActivity({ id: "a1", kind: "subagent", name: "y", status: "running", startedAt: "2026-11-20T10:01:00Z" });

  const runningSubagents = listActivity({ kind: "subagent", status: "running" });
  assert.equal(runningSubagents.length, 1);
  assert.equal(runningSubagents[0].id, "a1");
});

/* ------------------------------------------------------------------ */
/* Update / unregister                                                 */
/* ------------------------------------------------------------------ */

test("updateActivity muda o status e reflete na listagem", () => {
  registerActivity({ id: "s1", kind: "shell", name: "x", status: "running", startedAt: "2026-11-20T10:00:00Z" });

  const updated = updateActivity("s1", { status: "done", endedAt: "2026-11-20T10:05:00Z" });
  assert.equal(updated.status, "done");
  assert.equal(updated.endedAt, "2026-11-20T10:05:00Z");
  assert.equal(getActivity("s1").status, "done");
});

test("updateActivity mescla meta sem perder campos", () => {
  registerActivity({
    id: "a1", kind: "subagent", name: "k3", status: "running",
    startedAt: "2026-11-20T10:00:00Z",
    meta: { persistent: true, provider: "kilo3", model: "ernie" },
  });

  updateActivity("a1", { meta: { model: "proximo" } });
  const rec = getActivity("a1");
  assert.equal(rec.meta.model, "proximo", "campo atualizado");
  assert.equal(rec.meta.provider, "kilo3", "campo preservado");
  assert.equal(rec.meta.persistent, true, "campo preservado");
});

test("updateActivity retorna null quando o id não existe", () => {
  assert.equal(updateActivity("nao-existe", { status: "done" }), null);
});

test("unregisterActivity remove e reflete na listagem", () => {
  registerActivity({ id: "s1", kind: "shell", name: "x", status: "running", startedAt: "2026-11-20T10:00:00Z" });

  assert.equal(unregisterActivity("s1"), true);
  assert.equal(getActivity("s1"), null);
  assert.equal(listActivity().length, 0);
});

test("unregisterActivity retorna false quando o id não existe", () => {
  assert.equal(unregisterActivity("nada"), false);
});

/* ------------------------------------------------------------------ */
/* Upsert por id (não duplica)                                         */
/* ------------------------------------------------------------------ */

test("id duplicado atualiza em vez de duplicar", () => {
  registerActivity({ id: "s1", kind: "shell", name: "x", status: "running", startedAt: "2026-11-20T10:00:00Z" });
  registerActivity({ id: "s1", kind: "shell", name: "x", status: "stopped", startedAt: "2026-11-20T10:00:00Z" });

  const all = listActivity();
  assert.equal(all.length, 1, "não duplica");
  assert.equal(all[0].status, "stopped", "status atualizado");
});

/* ------------------------------------------------------------------ */
/* getActive / getActivity / clearActivity                             */
/* ------------------------------------------------------------------ */

test("getActive devolve só running", () => {
  registerActivity({ id: "s1", kind: "shell", name: "x", status: "running", startedAt: "2026-11-20T10:00:00Z" });
  registerActivity({ id: "s2", kind: "shell", name: "y", status: "done", startedAt: "2026-11-20T10:01:00Z" });

  const active = getActive();
  assert.equal(active.length, 1);
  assert.equal(active[0].id, "s1");
});

test("getActivity acha por id e devolve null para inexistente", () => {
  registerActivity({ id: "s1", kind: "shell", name: "x", status: "running", startedAt: "2026-11-20T10:00:00Z" });

  assert.equal(getActivity("s1").name, "x");
  assert.equal(getActivity("nao-existe"), null);
});

test("clearActivity zera tudo", () => {
  registerActivity({ id: "s1", kind: "shell", name: "x", status: "running", startedAt: "2026-11-20T10:00:00Z" });
  registerActivity({ id: "a1", kind: "subagent", name: "y", status: "running", startedAt: "2026-11-20T10:01:00Z" });

  clearActivity();
  assert.equal(listActivity().length, 0);
});

/* ------------------------------------------------------------------ */
/* Ordenação determinística (startedAt desc)                           */
/* ------------------------------------------------------------------ */

test("listActivity ordena por startedAt desc", () => {
  registerActivity({ id: "a", kind: "shell", name: "a", status: "running", startedAt: "2026-11-20T10:00:00Z" });
  registerActivity({ id: "b", kind: "shell", name: "b", status: "running", startedAt: "2026-11-20T10:02:00Z" });
  registerActivity({ id: "c", kind: "shell", name: "c", status: "running", startedAt: "2026-11-20T10:01:00Z" });

  assert.deepEqual(listActivity().map((r) => r.id), ["b", "c", "a"]);
});

/* ------------------------------------------------------------------ */
/* Não muta o estado                                                   */
/* ------------------------------------------------------------------ */

test("listActivity/getActivity devolvem cópias (mutar não afeta o store)", () => {
  registerActivity({
    id: "a1", kind: "subagent", name: "k3", status: "running",
    startedAt: "2026-11-20T10:00:00Z", meta: { persistent: true },
  });

  const l = listActivity();
  l[0].status = "crashed";
  l[0].meta.persistent = false;

  const one = getActivity("a1");
  assert.equal(one.status, "running", "status do store intacto");
  assert.equal(one.meta.persistent, true, "meta do store intacto");
});

/* ------------------------------------------------------------------ */
/* Validação                                                           */
/* ------------------------------------------------------------------ */

test("registerActivity recusa id ausente", () => {
  assert.throws(() => registerActivity({ kind: "shell", name: "x", status: "running", startedAt: "2026-11-20T10:00:00Z" }), /id/);
});

test("registerActivity recusa kind inválido", () => {
  assert.throws(
    () => registerActivity({ id: "x", kind: "widget", name: "x", status: "running", startedAt: "2026-11-20T10:00:00Z" }),
    /kind/,
  );
});

test("registerActivity recusa status inválido", () => {
  assert.throws(
    () => registerActivity({ id: "x", kind: "shell", name: "x", status: "voando", startedAt: "2026-11-20T10:00:00Z" }),
    /status/,
  );
});