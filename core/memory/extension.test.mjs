import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openStore } from "./store.mjs";
import {
  buildMemoryBlock,
  createMemoryController,
  estimateTokens,
  DEFAULT_MAX_TOKENS,
} from "./extension.mjs";

/* --------------------------- buildMemoryBlock --------------------------- */

test("estimateTokens aproxima 4 chars por token", () => {
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
  assert.equal(estimateTokens(""), 0);
});

test("buildMemoryBlock respeita o teto de tokens", () => {
  const entries = Array.from({ length: 20 }, (_, i) => ({
    id: `e${i}`,
    at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
    text: "fato com um texto razoavelmente longo para gastar tokens",
    tags: [],
  }));
  const { usedTokens, truncated, block } = buildMemoryBlock(entries, { maxTokens: 20 });
  assert.ok(usedTokens <= 20, `usou ${usedTokens} > 20`);
  assert.equal(truncated, true);
  assert.ok(block.startsWith("MEMÓRIA DO PROJETO"));
});

test("buildMemoryBlock mantém mais recentes primeiro e não trunca quando cabe", () => {
  const entries = [
    { id: "antigo", at: "2026-01-01T00:00:00.000Z", text: "fato antigo", tags: [] },
    { id: "novo", at: "2026-03-01T00:00:00.000Z", text: "fato novo", tags: [] },
  ];
  const { truncated, count, block } = buildMemoryBlock(entries, { maxTokens: 400 });
  assert.equal(truncated, false);
  assert.equal(count, 2);
  assert.ok(block.indexOf("fato novo") < block.indexOf("fato antigo"), "mais recente vem antes");
});

test("buildMemoryBlock tolera lista vazia e entradas sem texto", () => {
  const { block, count } = buildMemoryBlock([{ id: "x", text: "   " }], { maxTokens: 400 });
  assert.equal(count, 0);
  assert.match(block, /sem memória/);
});

/* -------------------------- createMemoryController ---------------------- */

function tempStore() {
  const root = mkdtempSync(join(tmpdir(), "selfevopi-ext-"));
  return { root, store: openStore({ root }) };
}

test("controller.load carrega fatos do projeto", () => {
  const { root, store } = tempStore();
  try {
    store.append("project", { text: "fato um", tags: ["a"] });
    store.append("project", { text: "fato dois", tags: ["b"] });
    const ctrl = createMemoryController({ store, maxTokens: 400 });
    const { count, block } = ctrl.load();
    assert.equal(count, 2);
    assert.match(block, /fato um/);
    assert.match(block, /fato dois/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("controller respeita o teto configurado", () => {
  const { root, store } = tempStore();
  try {
    for (let i = 0; i < 10; i++) {
      store.append("project", { text: "fato com texto longo o suficiente para gastar tokens", tags: [] });
    }
    const ctrl = createMemoryController({ store, maxTokens: 15 });
    const { usedTokens, truncated } = ctrl.load();
    assert.ok(usedTokens <= 15, `usou ${usedTokens} > 15`);
    assert.equal(truncated, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("controller.add acrescenta e persiste no nível project", () => {
  const { root, store } = tempStore();
  try {
    const ctrl = createMemoryController({ store });
    const entry = ctrl.add("fato novo via comando");
    assert.ok(entry.id);
    const found = store.query({ level: "project", text: "fato novo" });
    assert.equal(found.length, 1);
    assert.equal(found[0].id, entry.id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("controller.add recusa texto vazio", () => {
  const { root, store } = tempStore();
  try {
    const ctrl = createMemoryController({ store });
    assert.throws(() => ctrl.add("   "), /precisa de texto/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("controller.promote move de project para skills", () => {
  const { root, store } = tempStore();
  try {
    const entry = store.append("project", { text: "capacidade candidata", tags: [] });
    const ctrl = createMemoryController({ store });
    const promoted = ctrl.promote(entry.id, "project", "skills");
    assert.equal(promoted.id, entry.id);
    assert.equal(store.query({ level: "project" }).length, 0);
    assert.equal(store.query({ level: "skills" }).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("controller.promote retorna null para id inexistente", () => {
  const { root, store } = tempStore();
  try {
    const ctrl = createMemoryController({ store });
    assert.equal(ctrl.promote("não-existe", "project", "skills"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ----------------------- caso de arquivo ausente ------------------------ */

test("arquivo ausente: load não quebra e devolve bloco vazio", () => {
  const root = mkdtempSync(join(tmpdir(), "selfevopi-ext-vazio-"));
  try {
    const store = openStore({ root }); // diretório existe, sem nenhum .jsonl
    const ctrl = createMemoryController({ store, maxTokens: 400 });
    const { count, block, truncated } = ctrl.load();
    assert.equal(count, 0);
    assert.equal(truncated, false);
    assert.match(block, /sem memória/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* --------------------- default export é carregável ---------------------- */

test("default export é uma função que registra handlers no objeto pi", async () => {
  const { default: memoryExtension } = await import("./extension.mjs");
  assert.equal(typeof memoryExtension, "function");

  const registered = { events: [], commands: [] };
  const pi = {
    on: (name) => registered.events.push(name),
    registerCommand: (name) => registered.commands.push(name),
    getFlag: () => undefined,
  };
  memoryExtension(pi);
  assert.ok(registered.events.includes("session_start"));
  assert.ok(registered.events.includes("before_agent_start"));
  assert.ok(registered.events.includes("session_shutdown"));
  assert.ok(registered.commands.includes("mem"));
});

test("default export recusa objeto pi inválido", async () => {
  const { default: memoryExtension } = await import("./extension.mjs");
  assert.throws(() => memoryExtension({}), /inválido/i);
});

/* ------------------- fluxo ponta a ponta do controller ------------------ */

test("fluxo: carregar → adicionar → promotes → recarregar reflete tudo", () => {
  const { root, store } = tempStore();
  try {
    const ctrl = createMemoryController({ store, maxTokens: 400 });
    ctrl.add("fato A");
    ctrl.add("fato B");
    let loaded = ctrl.load();
    assert.equal(loaded.count, 2);

    const id = ctrl.list()[0].id;
    ctrl.promote(id, "project", "skills");
    loaded = ctrl.load();
    assert.equal(loaded.count, 1, "promovido saiu do project");

    // Persistência: reabrir o store mantém os dados.
    const reopened = openStore({ root });
    const ctrl2 = createMemoryController({ store: reopened, maxTokens: 400 });
    assert.equal(ctrl2.load().count, 1);
    assert.equal(reopened.query({ level: "skills" }).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("DEFAULT_MAX_TOKENS é 400", () => {
  assert.equal(DEFAULT_MAX_TOKENS, 400);
});