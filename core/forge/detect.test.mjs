import test from "node:test";
import assert from "node:assert/strict";

import { GAP_KINDS, createGap, detectGaps, readLedger } from "./detect.mjs";

/* ------------------------------------------------------------------ */
/* createGap                                                           */
/* ------------------------------------------------------------------ */

test("createGap normaliza e valida", () => {
  const g = createGap({ kind: "tool-failing", taskId: "D1", capability: "cli confiável" });
  assert.equal(g.kind, "tool-failing");
  assert.equal(g.taskId, "D1");
  assert.equal(g.capability, "cli confiável");
  assert.equal(g.goal, "cli confiável"); // goal = capability quando ausente
  assert.deepEqual(g.evidence, []);
});

test("createGap recusa kind inválido", () => {
  assert.throws(() => createGap({ kind: "x", taskId: "D1", capability: "c" }), /kind inválido/);
});

test("createGap exige taskId e capability", () => {
  assert.throws(() => createGap({ kind: "tool-failing", capability: "c" }), /taskId/);
  assert.throws(() => createGap({ kind: "tool-failing", taskId: "D1" }), /capability/);
});

/* ------------------------------------------------------------------ */
/* detectGaps — tool-failing                                           */
/* ------------------------------------------------------------------ */

const LEDGER = [
  // D1: 3 falhas (deve disparar threshold 3)
  { at: "t1", taskId: "D1", group: "D", passed: false, tokens: 0 },
  { at: "t2", taskId: "D1", group: "D", passed: false, tokens: 0 },
  { at: "t3", taskId: "D1", group: "D", passed: false, tokens: 0 },
  { at: "t4", taskId: "D1", group: "D", passed: true, tokens: 0 },
  // A1: 1 falha (não dispara)
  { at: "t5", taskId: "A1", group: "A", passed: false, tokens: 0 },
  { at: "t6", taskId: "A1", group: "A", passed: true, tokens: 0 },
];

test("detectGaps: tool-failing dispara com >= threshold", async () => {
  const { gaps, counts } = await detectGaps({ ledger: LEDGER, threshold: 3 });
  const failing = gaps.filter((g) => g.kind === "tool-failing");
  assert.equal(failing.length, 1);
  assert.equal(failing[0].taskId, "D1");
  assert.ok(failing[0].meta.failures >= 3);
  assert.equal(counts["tool-failing"], 1);
});

test("detectGaps: threshold maior não dispara", async () => {
  const { gaps } = await detectGaps({ ledger: LEDGER, threshold: 10 });
  assert.equal(gaps.filter((g) => g.kind === "tool-failing").length, 0);
});

/* ------------------------------------------------------------------ */
/* detectGaps — tool-missing                                           */
/* ------------------------------------------------------------------ */

test("detectGaps: tool-missing quando goal não é coberto", async () => {
  const { gaps } = await detectGaps({
    ledger: LEDGER,
    threshold: 99,
    capabilities: ["cli", "skill"], // nada casa com taskIds
  });
  const missing = gaps.filter((g) => g.kind === "tool-missing");
  assert.ok(missing.length > 0);
  assert.ok(missing.every((g) => g.capability.includes(g.taskId)));
});

test("detectGaps: tool-missing some quando capability cobre", async () => {
  const { gaps } = await detectGaps({
    ledger: [{ at: "t", taskId: "cli-helper", group: "A", passed: true, tokens: 0 }],
    threshold: 99,
    capabilities: ["cli"],
  });
  assert.equal(gaps.filter((g) => g.kind === "tool-missing").length, 0);
});

/* ------------------------------------------------------------------ */
/* detectGaps — tool-fragile                                           */
/* ------------------------------------------------------------------ */

test("detectGaps: tool-fragile por tokens acima do teto", async () => {
  const ledger = [
    { at: "t1", taskId: "D2", group: "D", passed: true, tokens: 9000 },
    { at: "t2", taskId: "D2", group: "D", passed: true, tokens: 9000 },
  ];
  const { gaps } = await detectGaps({ ledger, threshold: 99, tokenCeiling: 8000 });
  const fragile = gaps.filter((g) => g.kind === "tool-fragile");
  assert.equal(fragile.length, 1);
  assert.equal(fragile[0].taskId, "D2");
  assert.ok(fragile[0].meta.avgTokens > 8000);
});

test("detectGaps: tool-fragile por marcação frágil", async () => {
  const ledger = [{ at: "t", taskId: "X", group: "A", passed: true, tokens: 10, metrics: { fragile: true } }];
  const { gaps } = await detectGaps({ ledger, threshold: 99 });
  assert.ok(gaps.some((g) => g.kind === "tool-fragile" && g.taskId === "X"));
});

test("detectGaps: tool-fragile por screenshot onde caberia CLI", async () => {
  const ledger = [{ at: "t", taskId: "Y", group: "A", passed: true, tokens: 10, metrics: { usedScreenshot: true } }];
  const { gaps } = await detectGaps({ ledger, threshold: 99 });
  const f = gaps.find((g) => g.kind === "tool-fragile" && g.taskId === "Y");
  assert.ok(f);
  assert.ok(f.meta.reasons.some((r) => /screenshot/.test(r)));
});

test("detectGaps: tokens abaixo do teto não dispara frágil", async () => {
  const ledger = [{ at: "t", taskId: "Z", group: "A", passed: true, tokens: 100 }];
  const { gaps } = await detectGaps({ ledger, threshold: 99, tokenCeiling: 8000 });
  assert.equal(gaps.filter((g) => g.kind === "tool-fragile").length, 0);
});

/* ------------------------------------------------------------------ */
/* robustez                                                            */
/* ------------------------------------------------------------------ */

test("detectGaps: deduplica e respeita maxGaps", async () => {
  const many = [];
  for (let i = 0; i < 50; i++) many.push({ at: `t${i}`, taskId: `T${i % 5}`, group: "A", passed: false, tokens: 0 });
  const { gaps } = await detectGaps({ ledger: many, threshold: 1, maxGaps: 3 });
  assert.ok(gaps.length <= 3);
});

test("detectGaps: aceita caminho de arquivo (string) e ignora linhas corrompidas", async () => {
  const { readFile, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await (await import("node:fs/promises")).mkdtemp(join(tmpdir(), "forge-ledger-"));
  const file = join(dir, "evals.jsonl");
  await writeFile(file, '{"taskId":"D1","passed":false,"tokens":0}\nlinha corrompida\n{"taskId":"D1","passed":false,"tokens":0}\n', "utf8");
  try {
    const rows = await readLedger(file);
    assert.equal(rows.length, 2); // a linha corrompida foi ignorada
    const { gaps } = await detectGaps({ ledger: file, threshold: 2 });
    assert.ok(gaps.some((g) => g.kind === "tool-failing" && g.taskId === "D1"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("detectGaps: recusa ledger ausente e threshold inválido", async () => {
  await assert.rejects(detectGaps({}), /informe ledger/);
  await assert.rejects(detectGaps({ ledger: [], threshold: 0 }), /threshold/);
});

test("GAP_KINDS são os três gatilhos", () => {
  assert.deepEqual(GAP_KINDS, ["tool-failing", "tool-missing", "tool-fragile"]);
});