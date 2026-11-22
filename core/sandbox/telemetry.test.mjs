import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { recordGateDecision, readGateDecisions, logPath } from "./telemetry.mjs";

function gate(decision) {
  return {
    decision,
    file: "C:\\temp\\projeto\\gerado.mjs",
    blockingRules: decision === "block" ? ["embedded-secret"] : [],
    warningRules: decision === "warn" ? ["outside-workspace-path"] : [],
    violations: [{ rule: "embedded-secret", line: 7, excerpt: 'const k = "sk-abcdefghijklmnopqrstuvwx";' }],
  };
}

test("recordGateDecision ignora allow/clean", async () => {
  const root = mkdtempSync(join(tmpdir(), "se-telemetry-"));
  try {
    assert.equal(await recordGateDecision({ decision: "allow" }, { root }), false);
    assert.equal(await recordGateDecision(gate("block"), { root }), true);
    assert.equal((await readGateDecisions({ root })).length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("registro redige chave e guarda caminho relativo", async () => {
  const root = mkdtempSync(join(tmpdir(), "se-telemetry-"));
  try {
    const r = gate("block");
    const resultado = await recordGateDecision(r, { root, task: "tarefa-teste" });
    assert.equal(resultado, true);
    const linhas = await readGateDecisions({ root });
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].decision, "block");
    assert.equal(linhas[0].task, "tarefa-teste");
    assert.deepEqual(linhas[0].rules.blocking, ["embedded-secret"]);
    assert.ok(!JSON.stringify(linhas[0]).includes("sk-abcdefghijklmnopqrstuvwx"), "chave vazou no log");
    assert.equal(linhas[0].file, "[fora-do-workspace]");
    assert.ok(logPath({ root }).endsWith(".pi\\harness\\ledger\\blocked.jsonl") || logPath({ root }).endsWith(".pi/harness/ledger/blocked.jsonl"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("readGateDecisions com arquivo ausente devolve vazio e não lança", async () => {
  const root = mkdtempSync(join(tmpdir(), "se-telemetry-"));
  try {
    assert.deepEqual(await readGateDecisions({ root }), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
