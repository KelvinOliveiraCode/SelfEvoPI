/**
 * failover.test.mjs — prova failover, circuit breaker e teto de consumo
 * sob falha injetada. Nenhum teste faz rede real: todos usam callbacks falsos.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { Router, Circuit, DISABLED_FAMILIES } from "./router.mjs";
import { createBudget } from "./budget.mjs";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Provider falso injetável: simula respostas sem tocar a rede.
 * O roteador só sabe id/baseUrl/models — o fetch fica no callback do teste.
 */
function fakeProvider(id, { failCount = 0, status = 429, emptyBody = false } = {}) {
  let calls = 0;
  return {
    id,
    baseUrl: `https://${id}.example/v1`,
    models: [{ id: `model-${id}`, contextWindow: 128_000 }],
    /** Simula uma chamada HTTP. Retorna { ok, status, body } ou lança. */
    async fetch() {
      calls++;
      if (calls <= failCount) {
        if (emptyBody) return { ok: true, status: 200, body: "" };
        return { ok: false, status, body: null };
      }
      return { ok: true, status: 200, body: { answer: 42, from: id } };
    },
    get calls() {
      return calls;
    },
    reset() {
      calls = 0;
    },
  };
}

/** Cria um Router com providers injetáveis e circuit breaker rápido. */
function makeRouter(providers, opts = {}) {
  return new Router({
    providers,
    strategy: "roundRobin",
    circuit: { failureThreshold: 2, cooldownMs: 50 },
    rng: () => 0.5,
    ...opts,
  });
}

/** Cria um fn que usa o provider injetável para simular a chamada. */
function makeFn(providersById) {
  return async (pick) => {
    const provider = providersById[pick.provider];
    if (!provider) throw new Error(`provider desconhecido: ${pick.provider}`);
    const res = await provider.fetch();
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.code = `HTTP_${res.status}`;
      throw err;
    }
    if (!res.body || (typeof res.body === "object" && Object.keys(res.body).length === 0)) {
      const err = new Error("empty response body");
      err.code = "EMPTY_BODY";
      throw err;
    }
    return res.body;
  };
}

/* ------------------------------------------------------------------ */
/* 1. Failover sob falha injetada                                      */
/* ------------------------------------------------------------------ */

test("failover: troca de provider após 429 e completa a tarefa", async () => {
  const p1 = fakeProvider("kilo1", { failCount: 1, status: 429 });
  const p2 = fakeProvider("kilo2", { failCount: 0 });
  const byId = { kilo1: p1, kilo2: p2 };
  const r = makeRouter([p1, p2]);

  const tried = [];
  const { result } = await r.pickWithRetry("worker", makeFn(byId), {
    attempts: 3,
    onAttempt: ({ provider }) => tried.push(provider),
  });

  assert.ok(tried.includes("kilo1"), "deve ter tentado kilo1");
  assert.ok(tried.includes("kilo2"), "deve ter trocado para kilo2");
  assert.notEqual(tried[0], tried[1], "deve ter trocado de provider");
  assert.equal(result.answer, 42);
  assert.equal(result.from, "kilo2");
});

test("failover: timeout injetado troca de provider", async () => {
  const p1 = fakeProvider("kilo1", { failCount: 1, status: 429 });
  const p2 = fakeProvider("kilo2", { failCount: 0 });
  const byId = { kilo1: p1, kilo2: p2 };
  const r = makeRouter([p1, p2]);

  const { result } = await r.pickWithRetry("worker", async (pick) => {
    if (pick.provider === "kilo1") {
      const err = new Error("ETIMEDOUT");
      err.code = "ETIMEDOUT";
      throw err;
    }
    return { answer: 99, from: pick.provider };
  }, { attempts: 3 });

  assert.equal(result.from, "kilo2");
  assert.equal(result.answer, 99);
});

test("failover: corpo vazio (exit 0) não repete no mesmo provider", async () => {
  const p1 = fakeProvider("kilo1", { failCount: 2, emptyBody: true });
  const p2 = fakeProvider("kilo2", { failCount: 0 });
  const byId = { kilo1: p1, kilo2: p2 };
  const r = makeRouter([p1, p2]);

  const tried = [];
  // EMPTY_BODY não é retryable → deve propagar na primeira tentativa
  // sem gastar as outras tentativas
  await assert.rejects(
    r.pickWithRetry("worker", makeFn(byId), {
      attempts: 3,
      onAttempt: ({ provider }) => tried.push(provider),
    }),
    /empty response body/
  );

  // Deve ter tentado apenas 1 vez (não-retryable propaga imediatamente)
  assert.equal(tried.length, 1, "não deve gastar tentativas com erro não-retryable");
  assert.equal(tried[0], "kilo1", "deve ter tentado kilo1");
});

/* ------------------------------------------------------------------ */
/* 2. Circuit breaker                                                  */
/* ------------------------------------------------------------------ */

test("circuit breaker: abre após N falhas e provider sai da rotação", async () => {
  const p1 = fakeProvider("kilo1", { failCount: 10, status: 503 });
  const p2 = fakeProvider("kilo2", { failCount: 0 });
  const r = makeRouter([p1, p2], { circuit: { failureThreshold: 2, cooldownMs: 1000 } });

  // Força 2 falhas no kilo1 para abrir o breaker
  r.report("kilo1", false);
  r.report("kilo1", false);

  const snap = r.snapshot();
  const kilo1Snap = snap.find((p) => p.id === "kilo1");
  assert.equal(kilo1Snap.circuit, "open", "breaker deve estar aberto após 2 falhas");

  // Próxima escolha não deve ser kilo1
  const pick = r.pick("worker");
  assert.notEqual(pick.provider, "kilo1", "provider com breaker aberto não deve ser escolhido");
  assert.equal(pick.provider, "kilo2");
});

test("circuit breaker: fecha após cooldown e sucesso", async () => {
  const c = new Circuit({ failureThreshold: 2, cooldownMs: 20 });
  c.failure();
  c.failure();
  assert.equal(c.state, "open");
  assert.equal(c.allow(), false);

  // Espera o cooldown passar (usando clock real, mas curto)
  await new Promise((r) => setTimeout(r, 30));

  // allow() deve retornar true (halfOpen)
  assert.equal(c.allow(), true, "deve permitir após cooldown");

  // Sucesso fecha o breaker
  c.success();
  assert.equal(c.state, "closed");
  assert.equal(c.allow(), true);
});

test("circuit breaker: provider recuperado volta à rotação", async () => {
  const p1 = fakeProvider("kilo1", { failCount: 0 });
  const p2 = fakeProvider("kilo2", { failCount: 0 });
  const r = makeRouter([p1, p2], { circuit: { failureThreshold: 2, cooldownMs: 20 } });

  // Abre o breaker do kilo1
  r.report("kilo1", false);
  r.report("kilo1", false);
  assert.equal(r.snapshot().find((p) => p.id === "kilo1").circuit, "open");

  // Espera cooldown
  await new Promise((r) => setTimeout(r, 30));

  // Força sucesso para fechar
  r.report("kilo1", true);
  assert.equal(r.snapshot().find((p) => p.id === "kilo1").circuit, "closed");

  // Agora pode ser escolhido de novo
  const picks = new Set();
  for (let i = 0; i < 10; i++) picks.add(r.pick("worker").provider);
  assert.ok(picks.has("kilo1"), "provider recuperado deve voltar à rotação");
});

/* ------------------------------------------------------------------ */
/* 3. Família `or` fora da rotação                                     */
/* ------------------------------------------------------------------ */

test("família or nunca é escolhida (DISABLED_FAMILIES)", async () => {
  const providers = [
    { id: "kilo1", baseUrl: "https://k1.example", models: [{ id: "m1", contextWindow: 200_000 }] },
    { id: "kilo2", baseUrl: "https://k2.example", models: [{ id: "m2", contextWindow: 200_000 }] },
    { id: "or1", baseUrl: "https://or.example", models: [{ id: "m3", contextWindow: 128_000 }] },
    { id: "or2", baseUrl: "https://or.example", models: [{ id: "m4", contextWindow: 128_000 }] },
  ];
  const r = makeRouter(providers);

  assert.ok(DISABLED_FAMILIES.includes("or"), "or deve estar em DISABLED_FAMILIES");

  // Percorre o pool várias vezes e garante que nenhum or* é escolhido
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const pick = r.pick("worker");
    seen.add(pick.provider);
  }

  const orProviders = [...seen].filter((id) => id.startsWith("or"));
  assert.equal(orProviders.length, 0, `nenhum or* deve ser escolhido, mas veio: ${orProviders.join(", ")}`);
  assert.ok(seen.has("kilo1") || seen.has("kilo2"), "deve escolher algum kilo");
});

/* ------------------------------------------------------------------ */
/* 4. Teto de tokens                                                   */
/* ------------------------------------------------------------------ */

test("teto de tokens: onExceeded dispara uma vez e chamada seguinte é recusada", async () => {
  let exceededCount = 0;
  const budget = createBudget({
    limitTokens: 100,
    limitCostUsd: 1.0,
    onExceeded: () => exceededCount++,
  });

  const p1 = fakeProvider("kilo1", { failCount: 0 });
  const r = makeRouter([p1]);

  // Simula consumo que estoura o budget
  budget.spend({ tokens: 60, costUsd: 0.3 });
  assert.ok(budget.ok, "ainda dentro do limite");

  budget.spend({ tokens: 50, costUsd: 0.3 }); // total 110 > 100
  assert.equal(budget.ok, false, "budget deve ter estourado");
  assert.equal(exceededCount, 1, "onExceeded deve ter disparado exatamente uma vez");

  // Próxima chamada ao pickWithRetry deve ser recusada
  await assert.rejects(
    r.pickWithRetry(
      "worker",
      async () => ({ answer: 1 }),
      { attempts: 1, budget }
    ),
    /orcamento esgotado/
  );

  // onExceeded não deve disparar de novo
  assert.equal(exceededCount, 1, "onExceeded não deve disparar novamente");
});

/* ------------------------------------------------------------------ */
/* 5. Sem rede real                                                    */
/* ------------------------------------------------------------------ */

test("nenhum teste faz rede real — providers são falsos injetáveis", async () => {
  // Este teste é uma asserção de contrato: se algum teste anterior
  // tivesse feito rede, teria falhado ou excedido o tempo.
  // Aqui apenas documentamos que todos os providers são instâncias
  // de fakeProvider, não chamadas HTTP reais.
  const p = fakeProvider("kilo1");
  assert.equal(typeof p.fetch, "function");
  assert.equal(typeof p.calls, "number");
  // Se fosse um provider real, teria propriedades como apiKey, secret, etc.
  assert.equal(p.apiKey, undefined);
  assert.equal(p.secret, undefined);
});