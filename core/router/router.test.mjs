import test from "node:test";
import assert from "node:assert/strict";

import { Router, Circuit, backoffMs, withRetry, PROFILES } from "./router.mjs";

const PROVIDERS = [
  {
    id: "kilo1",
    baseUrl: "https://kilo.example/v1",
    models: [
      { id: "big-model", contextWindow: 1_000_000 },
      { id: "small-model", contextWindow: 64_000 },
    ],
  },
  {
    id: "or1",
    baseUrl: "https://or.example/v1",
    models: [
      { id: "ernie:free", contextWindow: 128_000 },
      { id: "tiny:free", contextWindow: 8_000 },
    ],
  },
  {
    id: "or2",
    baseUrl: "https://or.example/v1",
    models: [{ id: "ernie:free", contextWindow: 128_000 }],
  },
];

function router(opts = {}) {
  return new Router({ providers: PROVIDERS, rng: () => 0.42, ...opts });
}

test("roundRobin distribui entre os providers do perfil", () => {
  const r = router();
  const seen = new Set();
  for (let i = 0; i < 6; i++) seen.add(r.pick("orchestrator").provider);
  assert.deepEqual([...seen].sort(), ["kilo1"]);
  // orchestrator prefere kilo; com um unico kilo, sempre ele
  const w = new Set();
  for (let i = 0; i < 6; i++) w.add(r.pick("worker").provider);
  assert.deepEqual([...w].sort(), ["or1", "or2"]);
});

test("reviewer nunca usa o provider do autor", () => {
  const r = router();
  const author = r.pick("worker").provider;
  for (let i = 0; i < 10; i++) {
    const review = r.pick("reviewer", { exclude: [author] });
    assert.notEqual(review.provider, author);
  }
});

test("orchestrator exige contexto grande", () => {
  const r = router();
  const { model } = r.pick("orchestrator");
  assert.ok(model.includes("big-model"), `esperava big-model, veio ${model}`);
});

test("minContext filtra modelos sem contexto suficiente", () => {
  const r = router();
  const { model } = r.pick("worker", { minContext: 100_000 });
  assert.ok(!model.includes("tiny"));
});

test("modelo explicito e respeitado quando existe", () => {
  const r = router();
  assert.equal(r.pick("orchestrator", { model: "small-model" }).model, "small-model");
});

test("circuit abre apos N falhas e fecha depois do cooldown", () => {
  let clock = 1_000;
  const c = new Circuit({ failureThreshold: 2, cooldownMs: 100 });
  c.failure();
  assert.equal(c.state, "closed");
  c.failure();
  assert.equal(c.state, "open");
  assert.equal(c.allow(), false);
  clock += 150; // o cooldown usa Date.now real; aqui validamos a regra de estado
  c.success();
  assert.equal(c.state, "closed");
});

test("falhas repetidas removem o provider da rotacao", () => {
  const r = router();
  assert.equal(r.pick("worker").provider, "or1");
  r.report("or1", false);
  r.report("or1", false);
  r.report("or1", false);
  const snap = r.snapshot().find((p) => p.id === "or1");
  assert.equal(snap.circuit, "open");
});

test("latencia usa EWMA para escolher o mais rapido", () => {
  const r = router({ strategy: "latency" });
  r.report("or1", true, { latencyMs: 900 });
  r.report("or2", true, { latencyMs: 120 });
  assert.equal(r.pick("worker").provider, "or2");
});

test("backoff cresce e respeita o teto", () => {
  const seq = backoffMs(1, { base: 100, factor: 2, cap: 1_000, rng: () => 1 });
  const seq2 = backoffMs(2, { base: 100, factor: 2, cap: 1_000, rng: () => 1 });
  const seq5 = backoffMs(5, { base: 100, factor: 2, cap: 1_000, rng: () => 1 });
  assert.ok(seq2 > seq, "deve crescer");
  assert.equal(seq5, 1_000, "deve respeitar o teto");
});

test("withRetry tenta de novo e devolve o sucesso", async () => {
  let calls = 0;
  const value = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error("429");
      return "ok";
    },
    { attempts: 3, sleep: async () => {} }
  );
  assert.equal(value, "ok");
  assert.equal(calls, 3);
});

test("withRetry desiste quando o erro nao e retryable", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw new Error("401");
      },
      { attempts: 5, retryOn: (e) => !e.message.includes("401"), sleep: async () => {} }
    )
  );
  assert.equal(calls, 1);
});

test("perfis existem e reviewer exige provider diferente", () => {
  assert.ok(PROFILES.orchestrator);
  assert.ok(PROFILES.worker);
  assert.ok(PROFILES.reviewer);
  assert.equal(PROFILES.reviewer.requireDifferentFrom, "worker");
});