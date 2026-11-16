import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openStore } from "./store.mjs";
import { proposeDeltas, applyDeltas } from "./refine.mjs";

/** Store temporário isolado (não toca em .pi/harness real). */
function tempStore() {
  const root = mkdtempSync(join(tmpdir(), "selfevopi-refine-"));
  return { root, store: openStore({ root }) };
}

/* ----------------------------- proposeDeltas ----------------------------- */

test("proposeDeltas aponta duplicata (mesmo texto normalizado)", () => {
  const entries = [
    { id: "a", at: "2026-01-01T00:00:00.000Z", text: "Usar ESM puro", tags: ["esm"] },
    { id: "b", at: "2026-02-01T00:00:00.000Z", text: "usar esm puro", tags: ["esm"] }, // duplicata normalizada
  ];
  const deltas = proposeDeltas({ entries });
  const dedupe = deltas.find((d) => d.op === "dedupe");
  assert.ok(dedupe, "deve propor dedupe");
  assert.equal(dedupe.kept, "b", "mantém a mais recente");
  assert.deepEqual(dedupe.ids, ["a"]);
});

test("proposeDeltas descarta entrada vazia/curta e corrompida", () => {
  const entries = [
    { id: "vazia", at: "2026-01-01T00:00:00.000Z", text: "   ", tags: [] },
    { id: "curta", at: "2026-01-01T00:00:00.000Z", text: "ab", tags: [] },
    { id: null, at: null, text: "[linha 3 inválida]", tags: [], invalid: true },
  ];
  const drops = proposeDeltas({ entries }).filter((d) => d.op === "drop");
  assert.equal(drops.length, 3);
  assert.deepEqual(drops.map((d) => d.id).sort(), [null, "curta", "vazia"].sort());
});

test("proposeDeltas preserva decisão (keep)", () => {
  const entries = [
    { id: "d1", at: "2026-01-01T00:00:00.000Z", text: "O agente deve sempre validar antes de promover", tags: ["decisao"] },
    { id: "d2", at: "2026-01-01T00:00:00.000Z", text: "Nunca commitar segredos", tags: ["seguranca"] },
  ];
  const keeps = proposeDeltas({ entries }).filter((d) => d.op === "keep");
  assert.equal(keeps.length, 2);
  assert.deepEqual(keeps.map((k) => k.id).sort(), ["d1", "d2"]);
});

test("proposeDeltas propõe merge-tags para variantes normalizadas", () => {
  const entries = [
    { id: "x", at: "2026-01-01T00:00:00.000Z", text: "fato um", tags: ["ESM", "esm"] },
  ];
  const merges = proposeDeltas({ entries }).filter((d) => d.op === "merge-tags");
  assert.equal(merges.length, 1);
  assert.equal(merges[0].to, "esm");
  assert.equal(merges[0].from, "ESM");
});

test("proposeDeltas respeita limit", () => {
  const entries = Array.from({ length: 10 }, (_, i) => ({
    id: `e${i}`,
    at: "2026-01-01T00:00:00.000Z",
    text: i % 2 === 0 ? "curto" : `fato numero ${i}`,
    tags: [],
  }));
  assert.ok(proposeDeltas({ entries, limit: 2 }).length <= 2);
});

/* ------------------------------- applyDeltas ------------------------------ */

test("applyDeltas remove duplicatas e entradas vazias do store", () => {
  const { root, store } = tempStore();
  try {
    const a = store.append("project", { text: "Usar ESM puro", tags: ["esm"] });
    const b = store.append("project", { text: "usar esm puro", tags: ["esm"] });
    const vazio = store.append("project", { text: "x", tags: [] }); // curto demais
    const decisao = store.append("project", { text: "deve sempre validar", tags: ["decisao"] });

    const entries = store.query({ level: "project" });
    const deltas = proposeDeltas({ entries });
    const res = applyDeltas(store, deltas, { level: "project" });

    assert.equal(res.removed, 2, "remove a duplicata e a entrada curta");
    const remaining = store.query({ level: "project" }).map((e) => e.id).sort();
    assert.deepEqual(remaining, [b.id, decisao.id].sort(), "mantém a mais recente e a decisão");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyDeltas é idempotente (rodar duas vezes não remove nada a mais)", () => {
  const { root, store } = tempStore();
  try {
    store.append("project", { text: "fato duplicado", tags: [] });
    store.append("project", { text: "fato duplicado", tags: [] });
    store.append("project", { text: "ab", tags: [] });

    const first = applyDeltas(store, proposeDeltas({ entries: store.query({ level: "project" }) }), { level: "project" });
    const afterFirst = store.stats();

    const second = applyDeltas(store, proposeDeltas({ entries: store.query({ level: "project" }) }), { level: "project" });
    const afterSecond = store.stats();

    assert.ok(first.removed >= 1);
    assert.equal(second.removed, 0, "segunda passada não remove nada");
    assert.deepEqual(afterSecond, afterFirst, "estado não muda na segunda passada");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyDeltas não aplica merge-tags/keep, apenas relata", () => {
  const { root, store } = tempStore();
  try {
    store.append("project", { text: "deve sempre validar", tags: ["Regra"] });
    const deltas = proposeDeltas({ entries: store.query({ level: "project" }) });
    const res = applyDeltas(store, deltas, { level: "project" });
    assert.equal(res.removed, 0, "nada removido por keep");
    assert.ok(res.advisory.some((d) => d.op === "keep"));
    assert.equal(store.stats().project, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("linha corrompida de JSONL e podada de verdade (sem id, por conteudo)", async () => {
  const { store, root } = tempStore();
  try {
    const valid = store.append("project", { text: "convencao valida que deve sobreviver", source: "teste" });
    // Grava uma linha quebrada no meio do arquivo (simula JSONL corrompido).
    const file = join(root, "project.jsonl");
    const { readFileSync, writeFileSync } = await import("node:fs");
    const lines = readFileSync(file, "utf8").trim().split("\n");
    lines.splice(1, 0, "{isto nao e json");
    writeFileSync(file, lines.join("\n") + "\n", "utf8");

    const entries = store.query({ level: "project", includeInvalid: true });
    const deltas = proposeDeltas({ entries });
    const corrupt = deltas.find((d) => d.reason && d.reason.includes("corrompida"));
    assert.ok(corrupt, "deve propor drop da entrada corrompida");
    assert.equal(corrupt.id, null, "linha corrompida nao tem id");

    const res = applyDeltas(store, deltas, { level: "project" });
    assert.ok(res.removed >= 1, `deve remover a linha corrompida (removed=${res.removed})`);

    const after = store.query({ level: "project" });
    assert.equal(after.length, 1, "sobrou apenas a entrada valida");
    assert.equal(after[0].id, valid.id, "a entrada valida foi preservada");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
