import test from "node:test";
import assert from "node:assert/strict";

import { Router } from "./router.mjs";
import { createBudget } from "./budget.mjs";

const PROVIDERS = [
  {
    id: "or1",
    baseUrl: "https://or.example/v1",
    models: [{ id: "model-a", contextWindow: 128_000 }],
  },
  {
    id: "or2",
    baseUrl: "https://or.example/v1",
    models: [{ id: "model-b", contextWindow: 128_000 }],
  },
  {
    id: "or3",
    baseUrl: "https://or.example/v1",
    models: [{ id: "model-c", contextWindow: 128_000 }],
  },
  {
    id: "or4",
    baseUrl: "https://or.example/v1",
    models: [{ id: "model-d", contextWindow: 128_000 }],
  },
];

function makeRouter() {
  return new Router({ providers: PROVIDERS, strategy: "roundRobin", rng: () => 0 });
}

// ----------------------------------------------------------------

test("sucesso na 2ª tentativa troca de provider", async () => {
  const r = makeRouter();
  const calls = [];

  const { result, attempts, providersTried } = await r.pickWithRetry(
    "worker",
    async (pick) => {
      calls.push(pick.provider);
      if (calls.length === 1) {
        const err = new Error("429 Too Many Requests");
        err.code = "HTTP_429";
        throw err;
      }
      return { answer: 42, from: pick.provider };
    },
    { attempts: 3 }
  );

  assert.equal(attempts, 2);
  assert.equal(providersTried.length, 2);
  assert.notEqual(providersTried[0], providersTried[1]);
  assert.equal(result.answer, 42);
  assert.equal(result.from, providersTried[1]);
});

// ----------------------------------------------------------------

test("erro não-retryable propaga imediatamente sem gastar tentativas", async () => {
  const r = makeRouter();
  let calls = 0;

  await assert.rejects(
    r.pickWithRetry(
      "worker",
      async () => {
        calls++;
        const err = new Error("401 Unauthorized");
        err.code = "HTTP_401";
        throw err;
      },
      { attempts: 5 }
    ),
    /401 Unauthorized/
  );

  assert.equal(calls, 1, "deve ter chamado fn apenas uma vez");
});

// ----------------------------------------------------------------

test("esgotamento de tentativas lança erro com resumo", async () => {
  const r = makeRouter();
  let calls = 0;

  await assert.rejects(
    r.pickWithRetry(
      "worker",
      async () => {
        calls++;
        const err = new Error("503 Service Unavailable");
        err.code = "HTTP_503";
        throw err;
      },
      { attempts: 2 }
    ),
    /esgotou 2 tentativas/
  );

  assert.equal(calls, 2);
});

// ----------------------------------------------------------------

test("parada por orçamento antes da tentativa", async () => {
  const r = makeRouter();
  const budget = createBudget({ limitTokens: 100, limitCostUsd: 1.0 });
  budget.spend({ tokens: 200, costUsd: 0 }); // estoura
  let calls = 0;

  await assert.rejects(
    r.pickWithRetry(
      "worker",
      async () => {
        calls++;
        return "ok";
      },
      { attempts: 3, budget }
    ),
    /orcamento esgotado antes/
  );

  assert.equal(calls, 0, "fn não deve ser chamado quando orçamento já estourou");
});

// ----------------------------------------------------------------

test("parada por orçamento durante execução", async () => {
  const r = makeRouter();
  const budget = createBudget({ limitTokens: 100, limitCostUsd: 1.0 });

  // fn consome orçamento e depois falha com retryable
  // na 2ª tentativa o budget já estourou → deve parar
  let calls = 0;
  await assert.rejects(
    r.pickWithRetry(
      "worker",
      async () => {
        calls++;
        budget.spend({ tokens: 60, costUsd: 0 });
        const err = new Error("500 Internal Server Error");
        err.code = "HTTP_500";
        throw err;
      },
      { attempts: 5, budget }
    ),
    /orcamento esgotado apos/
  );

  assert.equal(calls, 2, "deve parar após 2 tentativas (budget estourou no meio)");
});

// ----------------------------------------------------------------

test("onAttempt é chamado a cada tentativa com info do provider", async () => {
  const r = makeRouter();
  const seen = [];
  let callCount = 0;

  await r.pickWithRetry(
    "worker",
    async () => {
      callCount++;
      if (callCount < 3) {
        const err = new Error("timeout");
        err.code = "ETIMEDOUT";
        throw err;
      }
      return "done";
    },
    {
      attempts: 3,
      onAttempt: ({ attempt, provider, ref }) => {
        seen.push({ attempt, provider, ref });
      },
    }
  );

  assert.equal(seen.length, 3);
  assert.equal(seen[0].attempt, 1);
  assert.equal(seen[1].attempt, 2);
  assert.equal(seen[2].attempt, 3);
  assert.notEqual(seen[0].provider, seen[1].provider);
  assert.notEqual(seen[1].provider, seen[2].provider);
});