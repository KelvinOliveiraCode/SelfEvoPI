import test from "node:test";
import assert from "node:assert/strict";

import { runGate, decidePromotion, buildResultFromGate } from "./gatekeeper.mjs";

const REQ = {
  goal: "tarefa X",
  kind: "cli",
  taskId: "X",
  tests: [{ name: "smoke", command: 'node -e "process.exit(0)"' }],
};

/* ------------------------------------------------------------------ */
/* runGate                                                             */
/* ------------------------------------------------------------------ */

test("runGate: aprova quando tudo passa e tokens <= baseline", async () => {
  const runEvals = async () => [
    { passed: true, tokens: 100 },
    { passed: true, tokens: 100 },
    { passed: true, tokens: 100 },
  ];
  const report = await runGate({
    artifactDir: "/tmp/art",
    request: REQ,
    runEvals,
    baseline: { X: { rate: 1, tokens: 100 } },
    toleranceTokens: 0,
    runs: 3,
  });
  assert.equal(report.runs, 3);
  assert.equal(report.passes, 3);
  assert.equal(report.avgTokens, 100);
  assert.equal(report.deltaTokens, 0);
  assert.equal(report.regressed, false);
  const d = decidePromotion(report);
  assert.equal(d.promote, true);
  assert.deepEqual(d.reasons, []);
});

test("runGate: reprova quando a tarefa-alvo falha", async () => {
  const runEvals = async () => [
    { passed: true, tokens: 100 },
    { passed: false, tokens: 100 },
  ];
  const report = await runGate({ artifactDir: "/tmp/art", request: REQ, runEvals, baseline: { X: { tokens: 100 } }, runs: 2 });
  assert.equal(report.passes, 1);
  const d = decidePromotion(report);
  assert.equal(d.promote, false);
  assert.ok(d.reasons.some((r) => /não passou/.test(r)));
});

test("runGate: reprova por regressão de tokens", async () => {
  const runEvals = async () => [{ passed: true, tokens: 500 }];
  const report = await runGate({ artifactDir: "/tmp/art", request: REQ, runEvals, baseline: { X: { tokens: 100 } }, toleranceTokens: 0 });
  assert.ok(report.deltaTokens > 0);
  const d = decidePromotion(report);
  assert.equal(d.promote, false);
  assert.ok(d.reasons.some((r) => /deltaTokens|tolerância/.test(r)));
});

test("runGate: tolerância absorve delta pequeno", async () => {
  const runEvals = async () => [{ passed: true, tokens: 130 }];
  const report = await runGate({ artifactDir: "/tmp/art", request: REQ, runEvals, baseline: { X: { tokens: 100 } }, toleranceTokens: 50 });
  const d = decidePromotion(report, { toleranceTokens: 50 });
  assert.equal(d.promote, true);
});

test("runGate: runEvals que lança vira falha, não exceção", async () => {
  const runEvals = async () => { throw new Error("boom"); };
  const report = await runGate({ artifactDir: "/tmp/art", request: REQ, runEvals, baseline: { X: { tokens: 100 } } });
  assert.equal(report.passes, 0);
  assert.equal(report.regressed, true);
});

test("runGate: exige artifactDir, request e runEvals", async () => {
  await assert.rejects(runGate({ request: REQ, runEvals: async () => [] }), /artifactDir/);
  await assert.rejects(runGate({ artifactDir: "/tmp", runEvals: async () => [] }), /request/);
  await assert.rejects(runGate({ artifactDir: "/tmp", request: REQ }), /runEvals/);
});

test("runGate: sem baseline não há regressão", async () => {
  const runEvals = async () => [{ passed: true, tokens: 999 }];
  const report = await runGate({ artifactDir: "/tmp/art", request: REQ, runEvals, baseline: null });
  assert.equal(report.regressed, false);
  const d = decidePromotion(report);
  assert.equal(d.promote, true);
});

/* ------------------------------------------------------------------ */
/* decidePromotion                                                     */
/* ------------------------------------------------------------------ */

test("decidePromotion: laudo inválido reprova", () => {
  const d = decidePromotion(null);
  assert.equal(d.promote, false);
});

test("decidePromotion: sem execuções reprova", () => {
  const d = decidePromotion({ runs: 0, passes: 0, regressed: false, deltaTokens: 0 });
  assert.equal(d.promote, false);
  assert.ok(d.reasons.some((r) => /sem execuções/.test(r)));
});

/* ------------------------------------------------------------------ */
/* buildResultFromGate                                                 */
/* ------------------------------------------------------------------ */

test("buildResultFromGate: monta resultado que passa o contrato", async () => {
  const report = { kind: "cli", testEvidence: [{ name: "smoke", passed: true }] };
  const res = await buildResultFromGate(report, REQ);
  assert.equal(res.ok, true);
});

test("buildResultFromGate: reprova sem evidência de teste", async () => {
  const report = { kind: "cli", testEvidence: [] };
  const res = await buildResultFromGate(report, REQ);
  assert.equal(res.ok, false);
});