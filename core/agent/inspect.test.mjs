import test from "node:test";
import assert from "node:assert/strict";

import { sessionStatus, sessionCost, contextUsage, formatTokens, formatCost } from "./inspect.mjs";

/* ------------------------------------------------------------------ */
/* sessionStatus                                                       */
/* ------------------------------------------------------------------ */

test("sessionStatus devolve campos do estado", () => {
  const state = {
    version: "0.5.0",
    model: "nemotron-3-ultra",
    provider: "kilo1",
    sessionId: "abc123",
    turns: 7,
    mode: "acceptEdits",
  };
  const s = sessionStatus(state);
  assert.equal(s.version, "0.5.0");
  assert.equal(s.model, "nemotron-3-ultra");
  assert.equal(s.provider, "kilo1");
  assert.equal(s.sessionId, "abc123");
  assert.equal(s.turns, 7);
  assert.equal(s.mode, "acceptEdits");
});

test("sessionStatus com estado vazio devolve nulls e zero", () => {
  const s = sessionStatus({});
  assert.equal(s.version, null);
  assert.equal(s.model, null);
  assert.equal(s.provider, null);
  assert.equal(s.sessionId, null);
  assert.equal(s.turns, 0);
  assert.equal(s.mode, null);
});

test("sessionStatus sem argumento não quebra", () => {
  const s = sessionStatus();
  assert.equal(s.turns, 0);
  assert.equal(s.version, null);
});

/* ------------------------------------------------------------------ */
/* sessionCost                                                         */
/* ------------------------------------------------------------------ */

test("sessionCost com ledger de tokens (formato usage)", () => {
  const state = {
    ledger: [
      { usage: { input: 1000, output: 200, cacheRead: 500 }, costUsd: 0.03 },
      { usage: { input: 2000, output: 400, cacheRead: 800 }, costUsd: 0.06 },
    ],
  };
  const c = sessionCost(state);
  assert.equal(c.tokensIn, 3000);
  assert.equal(c.tokensOut, 600);
  assert.equal(c.tokensCacheRead, 1300);
  assert.equal(c.costUsd, 0.09);
  assert.equal(c.byTurn.length, 2);
  assert.equal(c.byTurn[0].turn, 1);
  assert.equal(c.byTurn[0].costUsd, 0.03);
});

test("sessionCost com ledger formato simples (tokens)", () => {
  const state = {
    ledger: [
      { tokens: 500, costUsd: 0.01 },
      { tokens: 700, costUsd: 0.02 },
    ],
  };
  const c = sessionCost(state);
  assert.equal(c.tokensIn, 1200);
  assert.equal(c.tokensOut, 0);
  assert.equal(c.costUsd, 0.03);
});

test("sessionCost sem custo devolve null (não zero)", () => {
  const state = {
    ledger: [
      { usage: { input: 1000, output: 200 }, costUsd: 0 },
      { usage: { input: 2000, output: 400 } }, // sem costUsd
    ],
  };
  const c = sessionCost(state);
  // costUsd === 0 é uma afirmação;ausência é outra.
  // Se todas as entradas têm costUsd (mesmo 0), o custo é 0.
  // Se alguma entrada não tem costUsd, o custo é null.
  // Aqui: a primeira tem costUsd:0, a segunda não tem → null
  // Na verdade, a soma só funciona se TODAS tiverem. Se uma não tem, não dá para somar.
  // Comportamento: se alguma entrada não tem costUsd, retorna null (incompleto).
  assert.equal(c.costUsd, null);
});

test("sessionCost com ledger vazio", () => {
  const c = sessionCost({ ledger: [] });
  assert.equal(c.tokensIn, 0);
  assert.equal(c.tokensOut, 0);
  assert.equal(c.costUsd, null);
  assert.equal(c.byTurn.length, 0);
});

test("sessionCost sem ledger", () => {
  const c = sessionCost({});
  assert.equal(c.tokensIn, 0);
  assert.equal(c.costUsd, null);
});

/* ------------------------------------------------------------------ */
/* contextUsage                                                        */
/* ------------------------------------------------------------------ */

test("contextUsage calcula percentual", () => {
  const state = { usedTokens: 50_000, budgetTokens: 200_000 };
  const u = contextUsage(state);
  assert.equal(u.usedTokens, 50_000);
  assert.equal(u.budgetTokens, 200_000);
  assert.equal(u.percent, 25);
});

test("contextUsage com breakdown", () => {
  const state = {
    usedTokens: 80_000,
    budgetTokens: 200_000,
    breakdown: { system: 5000, messages: 60000, tools: 15000 },
  };
  const u = contextUsage(state);
  assert.equal(u.percent, 40);
  assert.equal(u.breakdown.system, 5000);
  assert.equal(u.breakdown.messages, 60000);
});

test("contextUsage com estado vazio usa defaults", () => {
  const u = contextUsage({});
  assert.equal(u.usedTokens, 0);
  assert.equal(u.budgetTokens, 200_000);
  assert.equal(u.percent, 0);
  assert.deepEqual(u.breakdown, {});
});

test("contextUsage sem budgetTokens usa 200k", () => {
  const u = contextUsage({ usedTokens: 100_000 });
  assert.equal(u.budgetTokens, 200_000);
  assert.equal(u.percent, 50);
});

/* ------------------------------------------------------------------ */
/* formatTokens                                                        */
/* ------------------------------------------------------------------ */

test("formatTokens formata milhares", () => {
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1500), "1.500");
  assert.equal(formatTokens(1_500_000), "1.500.000");
});

test("formatTokens com null/undefined", () => {
  assert.equal(formatTokens(null), "—");
  assert.equal(formatTokens(undefined), "—");
  assert.equal(formatTokens(NaN), "—");
});

/* ------------------------------------------------------------------ */
/* formatCost                                                          */
/* ------------------------------------------------------------------ */

test("formatCost formata USD", () => {
  assert.equal(formatCost(0.05), "$0.05");
  assert.equal(formatCost(1.5), "$1.50");
  assert.equal(formatCost(0), "$0.00");
});

test("formatCost com valores pequenos", () => {
  assert.equal(formatCost(0.001), "<$0.01");
});

test("formatCost com null/undefined", () => {
  assert.equal(formatCost(null), "—");
  assert.equal(formatCost(undefined), "—");
});