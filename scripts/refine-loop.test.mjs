import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openStore } from "../core/memory/store.mjs";
import {
  runRefineCycle,
  renderRefineReport,
  readLedger,
  summarizeLedger,
} from "./refine-loop.mjs";
import { aggregateMetrics, countOutcomes, renderWeeklyReport } from "./weekly-report.mjs";
import { ledgerForTests } from "../core/forge/ledger-fixture.mjs";

/* --------------------------- helpers de teste --------------------------- */

function tempStore() {
  const root = mkdtempSync(join(tmpdir(), "selfevopi-loop-"));
  return { root, store: openStore({ root }) };
}

function tempLedger(rows) {
  const dir = mkdtempSync(join(tmpdir(), "selfevopi-ledger-"));
  const file = join(dir, "evals.jsonl");
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  return { dir, file };
}

const GREEN = () => ({ ok: true, code: 0, stdout: "✓ GATE APROVADO", stderr: "" });
const RED = () => ({ ok: false, code: 1, stdout: "✗ GATE REPROVADO", stderr: "" });

/* ------------------------------ dry-run -------------------------------- */

test("dry-run não escreve nada e não roda o gate", async () => {
  const { root, store } = tempStore();
  try {
    store.append("project", { text: "fato um", tags: [] });
    store.append("project", { text: "fato um", tags: [] }); // duplicata
    store.append("project", { text: "ab", tags: [] }); // curta demais

    let gateCalled = false;
    const result = await runRefineCycle({
      store,
      level: "project",
      apply: false,
      runGate: () => {
        gateCalled = true;
        return GREEN();
      },
    });

    assert.equal(result.dryRun, true);
    assert.equal(gateCalled, false, "dry-run não deve chamar o gate");
    assert.equal(result.applied, null);
    assert.equal(result.reverted, false);
    // Entradas intactas: nada foi removido.
    assert.equal(store.stats().project, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------- apply com gate verde (mantém) ---------------------- */

test("apply com gate verde mantém o delta", async () => {
  const { root, store } = tempStore();
  try {
    store.append("project", { text: "fato duplicado", tags: [] });
    store.append("project", { text: "fato duplicado", tags: [] }); // duplicata
    store.append("project", { text: "ab", tags: [] }); // curta demais

    const result = await runRefineCycle({ store, level: "project", apply: true, runGate: GREEN });

    assert.equal(result.apply, true);
    assert.equal(result.dryRun, undefined);
    assert.equal(result.gateOk, true);
    assert.equal(result.reverted, false);
    assert.ok(result.applied.removed >= 2, "removeu a duplicata e a entrada curta");
    // Sobrou só 1 entrada (a duplicata mantida = a mais recente).
    assert.equal(store.stats().project, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------ apply com gate vermelho (reverte) ------------------- */

test("apply com gate vermelho reverte o delta", async () => {
  const { root, store } = tempStore();
  try {
    store.append("project", { text: "fato A", tags: [] });
    store.append("project", { text: "fato A", tags: [] }); // duplicata
    store.append("project", { text: "ab", tags: [] }); // curta
    const before = store.stats().project;

    const result = await runRefineCycle({ store, level: "project", apply: true, runGate: RED });

    assert.equal(result.gateOk, false);
    assert.equal(result.reverted, true, "deve marcar como revertido");
    // Estado restaurado: o apply foi desfeito.
    assert.equal(store.stats().project, before, "estado anterior restaurado");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------- idempotência do apply ------------------------ */

test("apply é idempotente: rodar duas vezes não remove mais nada", async () => {
  const { root, store } = tempStore();
  try {
    store.append("project", { text: "fato dup", tags: [] });
    store.append("project", { text: "fato dup", tags: [] });
    store.append("project", { text: "ab", tags: [] });

    const first = await runRefineCycle({ store, level: "project", apply: true, runGate: GREEN });
    const afterFirst = store.stats().project;
    const second = await runRefineCycle({ store, level: "project", apply: true, runGate: GREEN });
    const afterSecond = store.stats().project;

    assert.ok(first.applied.removed >= 1);
    assert.equal(second.applied.removed, 0, "segunda passada não remove nada");
    assert.equal(afterSecond, afterFirst);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* --------------------------- relatório --------------------------------- */

test("renderRefineReport contém os campos certos (dry-run)", () => {
  const md = renderRefineReport(
    {
      level: "project",
      apply: false,
      entries: 3,
      deltas: 2,
      actionable: 2,
      advisory: 0,
      ledger: { passes: 8, runs: 10, rate: 0.8 },
    },
    { at: new Date("2026-11-16T12:00:00.000Z") }
  );
  assert.match(md, /# Refine/);
  assert.match(md, /dry-run/);
  assert.match(md, /nível: `project`/);
  assert.match(md, /deltas propostos: 2/);
});

test("renderRefineReport mostra reversão quando o gate reprova", () => {
  const md = renderRefineReport(
    {
      level: "project",
      apply: true,
      entries: 3,
      deltas: 2,
      actionable: 2,
      advisory: 0,
      applied: { removed: 1 },
      gate: { ok: false, code: 1 },
      gateOk: false,
      reverted: true,
    },
    { at: new Date() }
  );
  assert.match(md, /gate: ✗ vermelho/);
  assert.match(md, /revertido: \*\*sim\*\*/);
  assert.match(md, /DESFEITO/);
});

/* --------------------------- ledger / métricas -------------------------- */

test("readLedger e summarizeLedger leem o ledger sintético", () => {
  const rows = [
    { at: "2026-11-15T22:00:00.000Z", taskId: "A1", group: "A", passed: true, durationMs: 100, tokens: 0 },
    { at: "2026-11-15T22:01:00.000Z", taskId: "A1", group: "A", passed: false, durationMs: 200, tokens: 0 },
    { at: "2026-11-15T22:02:00.000Z", taskId: "D1", group: "D", passed: true, durationMs: 5000, tokens: 10000 },
  ];
  const { dir, file } = tempLedger(rows);
  try {
    const { rows: read, invalid, total } = readLedger(file);
    assert.equal(read.length, 3);
    assert.equal(invalid.length, 0);
    assert.equal(total, 3);

    const summary = summarizeLedger(read);
    assert.equal(summary.runs, 3);
    assert.equal(summary.passes, 2);
    assert.equal(summary.groups.A.runs, 2);
    assert.equal(summary.groups.A.passes, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readLedger tolera arquivo ausente e linhas corrompidas", () => {
  const missing = readLedger(join(tmpdir(), "nao-existe-mesmo-xyz.jsonl"));
  assert.deepEqual(missing, { rows: [], invalid: [], total: 0 });

  const dir = mkdtempSync(join(tmpdir(), "selfevopi-ledger-mau-"));
  const file = join(dir, "evals.jsonl");
  writeFileSync(file, '{"taskId":"A1","group":"A","passed":true}\n{linha corrompida}\n', "utf8");
  try {
    const { rows, invalid, total } = readLedger(file);
    assert.equal(rows.length, 1);
    assert.equal(invalid.length, 1);
    assert.equal(total, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------- weekly report -------------------------------- */

test("aggregateMetrics calcula taxa, tokens e latência", () => {
  const rows = [
    { taskId: "A1", group: "A", passed: true, durationMs: 100, tokens: 0 },
    { taskId: "A1", group: "A", passed: true, durationMs: 300, tokens: 0 },
    { taskId: "D1", group: "D", passed: false, durationMs: 9000, tokens: 20000 },
    { taskId: "D1", group: "D", passed: true, durationMs: 11000, tokens: 30000 },
  ];
  const m = aggregateMetrics(rows);
  assert.equal(m.totalRuns, 4);
  assert.equal(m.passes, 3);
  assert.equal(m.failures, 1);
  assert.equal(m.worstTokens, 30000);
  assert.equal(m.avgTokens, Math.round((0 + 0 + 20000 + 30000) / 4));
  assert.equal(m.avgDuration, Math.round((100 + 300 + 9000 + 11000) / 4));
  assert.equal(m.groups.A.passes, 2);
  assert.equal(m.groups.D.runs, 2);
});

test("countOutcomes conta lacunas resolvidas e reversões", () => {
  const rows = [
    { taskId: "A1", group: "A", passed: true },
    { taskId: "A2", group: "A", passed: false, rolledBack: true },
    { taskId: "A3", group: "A", passed: true, outcome: "rolled-back" },
  ];
  const { root, store } = tempStore();
  try {
    store.append("skills", { text: "cap 1", tags: [] });
    store.append("skills", { text: "cap 2", tags: [] });
    const out = countOutcomes(rows, store);
    assert.equal(out.gapsResolved, 2, "duas entradas em skills");
    assert.equal(out.reversals, 2, "duas reversões (rolledBack + outcome)");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renderWeeklyReport contém as seções esperadas", () => {
  const metrics = aggregateMetrics([
    { taskId: "A1", group: "A", passed: true, durationMs: 100, tokens: 0 },
    { taskId: "D1", group: "D", passed: false, durationMs: 5000, tokens: 10000 },
  ]);
  const md = renderWeeklyReport(metrics, { gapsResolved: 3, reversals: 1 }, { at: new Date("2026-11-16T12:00:00.000Z") });
  assert.match(md, /# Relatório semanal/);
  assert.match(md, /## Taxa de sucesso/);
  assert.match(md, /## Tokens por tarefa/);
  assert.match(md, /## Lacunas e reversões/);
  assert.match(md, /lacunas resolvidas.*3/);
  assert.match(md, /reversões.*1/);
});

test("weekly-report lê o ledger real do projeto sem quebrar", () => {
  const { rows } = readLedger(ledgerForTests(process.cwd()));
  const metrics = aggregateMetrics(rows);
  assert.ok(metrics.totalRuns > 0, "ledger real tem execuções");
  assert.ok(metrics.rate >= 0 && metrics.rate <= 1);
  assert.ok(metrics.avgDuration >= 0);
});