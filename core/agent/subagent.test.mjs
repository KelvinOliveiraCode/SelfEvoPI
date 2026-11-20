import test from "node:test";
import assert from "node:assert/strict";

import {
  runSubagent,
  runSwarmExecution,
  listPersistent,
  closePersistent,
  closeAllPersistent,
  synthesizeSubagents,
} from "./subagent.mjs";

/** Cliente falso: registra o que recebeu e devolve um texto pronto. */
function fakeClient(resposta = "ok do sub") {
  const chamadas = { setModel: [], setEffort: [], prompts: [], closed: 0 };
  return {
    chamadas,
    async setModel(provider, model) { chamadas.setModel.push([provider, model]); },
    _rpc: { async setThinkingLevel(e) { chamadas.setEffort.push(e); } },
    async promptAndWait(msg) { chamadas.prompts.push(msg); return resposta; },
    async close() { chamadas.closed++; },
  };
}

test("runSubagent: molda modelo+effort, executa e fecha (temporário)", async () => {
  const cli = fakeClient("resposta A");
  const r = await runSubagent(
    { name: "pesq", provider: "or1", model: "m1", effort: "high", mode: "ask", task: "pesquise X" },
    { createClient: async () => cli, cwd: "/tmp" },
  );
  assert.equal(r.ok, true);
  assert.equal(r.text, "resposta A");
  assert.deepEqual(cli.chamadas.setModel, [["or1", "m1"]]);
  assert.deepEqual(cli.chamadas.setEffort, ["high"]);
  assert.deepEqual(cli.chamadas.prompts, ["pesquise X"]);
  assert.equal(cli.chamadas.closed, 1, "temporário tem de fechar ao fim");
});

test("runSubagent: falha vira ok:false com o motivo (não lança)", async () => {
  const cli = fakeClient();
  cli.promptAndWait = async () => { throw new Error("boom"); };
  const r = await runSubagent({ name: "x", task: "t" }, { createClient: async () => cli });
  assert.equal(r.ok, false);
  assert.match(r.error, /boom/);
  assert.equal(cli.chamadas.closed, 1, "fecha mesmo em erro (temporário)");
});

test("runSubagent: task vazia é erro tipado, sem criar cliente", async () => {
  let criou = 0;
  const r = await runSubagent({ name: "x", task: "  " }, { createClient: async () => { criou++; return fakeClient(); } });
  assert.equal(r.ok, false);
  assert.match(r.error, /task.*vazia/i);
  assert.equal(criou, 0);
});

test("runSubagent: persistente reutiliza a sessão (não fecha, não recria)", async () => {
  let criou = 0;
  const factory = async () => { criou++; return fakeClient("P"); };
  const r1 = await runSubagent({ name: "keep", provider: "or1", model: "m", task: "t1", persistent: true }, { createClient: factory });
  const r2 = await runSubagent({ name: "keep", task: "t2", persistent: true }, { createClient: factory });
  assert.equal(r1.text, "P");
  assert.equal(r2.text, "P");
  assert.equal(criou, 1, "só cria um cliente para o persistente");
  assert.ok(listPersistent().includes("keep"));
  await closePersistent("keep");
  assert.ok(!listPersistent().includes("keep"));
});

test("runSwarmExecution: paralelo, cada um com sua spec, falha isolada", async () => {
  const specs = [
    { name: "a", provider: "p", model: "m", effort: "low", task: "ta" },
    { name: "b", provider: "p", model: "m", effort: "high", task: "tb" },
    { name: "c", task: "tc" },
  ];
  const factory = async ({ }) => {
    const c = fakeClient("resp " + Math.random().toString(36).slice(2, 6));
    return c;
  };
  const res = await runSwarmExecution(specs, { createClient: factory });
  assert.equal(res.length, 3);
  assert.equal(res[0].name, "a");
  assert.ok(res.every((r) => r.ok), "todos ok");
  await closeAllPersistent();
});

test("sendA2A: entrega entre persistentes e devolve msg vazia/erro", async () => {
  const a = fakeClient("resposta do A");
  const b = fakeClient("resposta do B");
  // A e B persistentes
  await runSubagent({ name: "A", task: "ta", persistent: true }, { createClient: async () => a });
  await runSubagent({ name: "B", task: "tb", persistent: true }, { createClient: async () => b });
  const { sendA2A } = await import("./subagent.mjs");
  const r1 = await sendA2A({ from: "A", to: "B", message: "oi B" });
  assert.equal(r1.ok, true);
  assert.equal(r1.text, "resposta do B");
  const r2 = await sendA2A({ from: "A", to: "inexistente", message: "x" });
  assert.equal(r2.ok, false);
  const r3 = await sendA2A({ from: "A", to: "B", message: "  " });
  assert.equal(r3.ok, false);
  const r4 = await sendA2A({ from: "A", to: "orquestrador", message: "oi chefe" });
  assert.equal(r4.ok, true);
  assert.equal(r4.deliver, "orchestrator");
  await closeAllPersistent();
});

test("synthesizeSubagents: cita cada subagente e lista falhas", () => {
  const md = synthesizeSubagents([
    { name: "a", provider: "p", model: "m", effort: "high", ok: true, text: "descobri X" },
    { name: "b", ok: false, error: "timeout" },
  ]);
  assert.match(md, /descobri X/);
  assert.match(md, /think:high/);
  assert.match(md, /✗ b: timeout/);
});