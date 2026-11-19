import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openStore, LEVELS } from "./store.mjs";

/** Cria um diretório temporário de memória, isolado do .pi/harness real. */
function tempStore() {
  const root = mkdtempSync(join(tmpdir(), "selfevopi-mem-"));
  return { root, store: openStore({ root }) };
}

test("append grava uma entrada com formato estável", () => {
  const { root, store } = tempStore();
  try {
    const entry = store.append("project", {
      text: "usar ESM puro, sem dependências externas",
      tags: ["convencao", "esm"],
      source: "A7",
    });
    assert.match(entry.id, /.+/);
    assert.ok(entry.at);
    assert.equal(entry.text, "usar ESM puro, sem dependências externas");
    assert.deepEqual(entry.tags, ["convencao", "esm"]);
    assert.equal(entry.source, "A7");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("query filtra por tag e devolve mais recentes primeiro", () => {
  const { root, store } = tempStore();
  try {
    store.append("project", { text: "mais antiga", tags: ["g"], at: "2026-01-01T00:00:00.000Z" });
    store.append("project", { text: "mais nova", tags: ["g"], at: "2026-03-01T00:00:00.000Z" });
    const byTag = store.query({ level: "project", tag: "g" });
    assert.equal(byTag.length, 2);
    assert.equal(byTag[0].text, "mais nova", "mais recente primeiro");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("query busca textual (case-insensitive)", () => {
  const { root, store } = tempStore();
  try {
    store.append("skills", { text: "Roteador multi-provider escolhe por latência", tags: ["router"] });
    store.append("skills", { text: "Circuit breaker abre após N falhas", tags: ["resiliencia"] });
    const hits = store.query({ level: "skills", text: "CIRCUIT" });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].tags[0], "resiliencia");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("promote move uma entrada de nível preservando id e at", () => {
  const { root, store } = tempStore();
  try {
    const entry = store.append("session", {
      text: "padrão ACI: saída JSON compacta",
      tags: ["aci"],
    });
    const promoted = store.promote(entry.id, "session", "project");
    assert.equal(promoted.id, entry.id);
    assert.equal(promoted.at, entry.at);
    assert.equal(store.query({ level: "session" }).length, 0);
    const inProject = store.query({ level: "project", tag: "aci" });
    assert.equal(inProject.length, 1);
    assert.equal(inProject[0].id, entry.id);
    // id duplicado no destino é recusado
    const again = store.append("session", { text: "duplicada", tags: ["dup"] });
    store.append("project", { id: again.id, text: "conflito no destino", tags: ["dup"] });
    assert.throws(() => store.promote(again.id, "session", "project"), /já existe/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("promote retorna null quando o id não existe na origem", () => {
  const { root, store } = tempStore();
  try {
    assert.equal(store.promote("inexistente", "session", "project"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistência: fechar, reabrir e ler os mesmos dados", () => {
  const { root, store } = tempStore();
  const created = store.append("project", {
    text: "decisão persistida entre sessões",
    tags: ["persist"],
  });
  const before = store.stats();
  // "Fechar" = descartar a referência; reabrir aponta para o mesmo root.
  store.close?.();
  const reopened = openStore({ root });
  assert.deepEqual(reopened.stats(), before);
  const rows = reopened.query({ level: "project", text: "persistida" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, created.id);
  rmSync(root, { recursive: true, force: true });
});

test("stats conta por nível e aceita os três níveis", () => {
  const { root, store } = tempStore();
  try {
    store.append("session", { text: "a" });
    store.append("session", { text: "b" });
    store.append("project", { text: "c" });
    assert.deepEqual(store.stats(), { session: 2, project: 1, skills: 0 });
    assert.deepEqual(LEVELS, ["session", "project", "skills"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("nível inválido é recusado", () => {
  const { root, store } = tempStore();
  try {
    assert.throws(() => store.append("nope", { text: "x" }), /nível inválido/i);
    assert.throws(() => store.query({ level: "nope" }), /nível inválido/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});