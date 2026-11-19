import test from "node:test";
import assert from "node:assert/strict";

import { createBudget } from "./budget.mjs";

test("estouro de tokens dispara onExceeded uma vez", () => {
  let chamadas = 0;
  const b = createBudget({
    limitTokens: 100,
    limitCostUsd: Infinity,
    onExceeded: () => chamadas++,
  });

  assert.equal(b.spend({ tokens: 40, costUsd: 0 }).ok, true);
  assert.equal(chamadas, 0);

  const r = b.spend({ tokens: 70, costUsd: 0 }); // total 110 > 100
  assert.equal(r.ok, false);
  assert.equal(r.remainingTokens, 0);
  assert.equal(chamadas, 1);

  // gastos seguintes não disparam de novo
  b.spend({ tokens: 10, costUsd: 0 });
  assert.equal(chamadas, 1);
});

test("estouro de custo dispara onExceeded uma vez", () => {
  let chamadas = 0;
  const b = createBudget({
    limitTokens: Infinity,
    limitCostUsd: 0.05,
    onExceeded: () => chamadas++,
  });

  assert.equal(b.spend({ tokens: 0, costUsd: 0.02 }).ok, true);
  assert.equal(chamadas, 0);

  const r = b.spend({ tokens: 0, costUsd: 0.04 }); // total 0.06 > 0.05
  assert.equal(r.ok, false);
  assert.equal(r.remainingCostUsd, 0);
  assert.equal(chamadas, 1);
});

test("reset zera a contagem e permite gastar de novo", () => {
  let chamadas = 0;
  const b = createBudget({
    limitTokens: 100,
    limitCostUsd: Infinity,
    onExceeded: () => chamadas++,
  });

  b.spend({ tokens: 150, costUsd: 0 });
  assert.equal(b.ok, false);
  assert.equal(chamadas, 1);

  b.reset();
  assert.equal(b.ok, true);
  assert.equal(b.spentTokens, 0);
  assert.equal(chamadas, 1); // reset não dispara onExceeded

  assert.equal(b.spend({ tokens: 50, costUsd: 0 }).ok, true);
  assert.equal(chamadas, 1);
});

test("múltiplos gastos acumulam corretamente", () => {
  const b = createBudget({ limitTokens: 100, limitCostUsd: 1.0 });

  b.spend({ tokens: 10, costUsd: 0.10 });
  b.spend({ tokens: 20, costUsd: 0.20 });
  b.spend({ tokens: 30, costUsd: 0.30 });

  assert.equal(b.spentTokens, 60);
  assert.ok(Math.abs(b.spentCostUsd - 0.60) < 1e-9, `esperava ~0.60, veio ${b.spentCostUsd}`);
  assert.equal(b.ok, true);

  const r = b.spend({ tokens: 50, costUsd: 0.50 });
  assert.equal(r.ok, false); // 110 tokens > 100 e 1.10 > 1.0
  assert.equal(r.remainingTokens, 0);
  assert.equal(r.remainingCostUsd, 0);
});

test("gasto único que ultrapassa o limite de uma vez", () => {
  let chamadas = 0;
  const b = createBudget({
    limitTokens: 100,
    limitCostUsd: 0.10,
    onExceeded: () => chamadas++,
  });

  const r = b.spend({ tokens: 500, costUsd: 0.50 });
  assert.equal(r.ok, false);
  assert.equal(r.remainingTokens, 0);
  assert.equal(r.remainingCostUsd, 0);
  assert.equal(chamadas, 1);
  assert.equal(b.exceeded, true);
});