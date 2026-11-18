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
  formatFindResults,
  extractArtifactPath,
  truncateText,
  FIND_LIMIT,
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

/* --------------------------- /mem find -------------------------------- */

test("extractArtifactPath extrai o caminho do texto da skill", () => {
  assert.equal(
    extractArtifactPath("soma dois números — artefato em `skills/soma/cli.mjs` (gerado da lacuna X)"),
    "skills/soma/cli.mjs"
  );
  assert.equal(extractArtifactPath("fato sem caminho"), null);
});

test("truncateText corta texto longo preservando começo e fim", () => {
  const long = "a".repeat(50) + "MEIO" + "b".repeat(50);
  const t = truncateText(long, 20);
  assert.ok(t.length <= 20, `tamanho ${t.length} > 20`);
  assert.ok(t.includes("…"));
  assert.ok(t.startsWith("a"));
  assert.ok(t.endsWith("b"));
});

test("formatFindResults produz uma linha por resultado, com nível e id", () => {
  const res = {
    results: [
      { level: "skills", id: "abc", text: "soma dois números — artefato em `skills/soma/cli.mjs`", score: 4 },
      { level: "project", id: "def", text: "fato sobre soma", score: 2 },
    ],
  };
  const { lines, count, shown } = formatFindResults(res);
  assert.equal(count, 2);
  assert.equal(shown, 2);
  assert.ok(lines[0].startsWith("- [skills] abc"));
  assert.match(lines[0], /skills\/soma\/cli\.mjs/);
  assert.ok(lines[1].startsWith("- [project] def"));
});

test("formatFindResults respeita o teto de linhas (limit)", () => {
  const results = Array.from({ length: 20 }, (_, i) => ({
    level: "skills",
    id: `id${i}`,
    text: `capacidade ${i}`,
    score: 1,
  }));
  const { lines, count, shown, truncated } = formatFindResults({ results }, { limit: 5 });
  assert.equal(count, 20);
  assert.equal(shown, 5);
  assert.equal(lines.length, 5);
  assert.equal(truncated, true);
});

test("formatFindResults lida com lista vazia sem quebrar", () => {
  const { lines, count, shown } = formatFindResults({ results: [] });
  assert.equal(count, 0);
  assert.equal(lines.length, 0);
  assert.equal(shown, 0);
});

test("controller.find encontra o que foi gravado (skills)", () => {
  const { root, store } = tempStore();
  try {
    store.append("skills", {
      text: "soma dois números — artefato em `skills/soma/cli.mjs`",
      tags: ["artefato", "cli", "tarefa:D1"],
      source: "evo",
    });
    const ctrl = createMemoryController({ store });
    const { count, lines } = ctrl.find("soma");
    assert.equal(count, 1);
    assert.match(lines[0], /skills\/soma\/cli\.mjs/);
    assert.match(lines[0], /soma/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("controller.find com termo inexistente devolve nada encontrado", () => {
  const { root, store } = tempStore();
  try {
    store.append("skills", { text: "soma dois números", tags: ["artefato"] });
    const ctrl = createMemoryController({ store });
    const { count, lines } = ctrl.find("fotossíntese quântica");
    assert.equal(count, 0);
    assert.equal(lines.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("controller.find acha também no nível project", () => {
  const { root, store } = tempStore();
  try {
    store.append("project", { text: "convenção: sempre validar entrada", tags: ["convencao"] });
    const ctrl = createMemoryController({ store });
    const { count } = ctrl.find("validar");
    assert.ok(count >= 1, "deve achar no project");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("controller.find respeita o teto de resultados (FIND_LIMIT)", () => {
  const { root, store } = tempStore();
  try {
    for (let i = 0; i < 15; i++) {
      store.append("skills", { text: `capacidade de soma ${i}`, tags: ["soma"] });
    }
    const ctrl = createMemoryController({ store });
    const { lines, count, shown, truncated } = ctrl.find("soma");
    assert.equal(count, 15);
    assert.equal(shown, FIND_LIMIT);
    assert.equal(lines.length, FIND_LIMIT);
    assert.equal(truncated, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------- handler /mem: find, listar (regressão) e vazio --------- */

/** Monta um `pi` mock que captura o handler de `mem` e as notificações. */
async function memHarness() {
  const { default: memoryExtension } = await import("./extension.mjs");
  const commands = {};
  const pi = {
    on: () => {},
    registerCommand: (name, def) => {
      commands[name] = def;
    },
    getFlag: () => undefined,
  };
  memoryExtension(pi);
  return {
    handler: commands.mem.handler,
    run: async (args, ctx) => {
      const notes = [];
      ctx = ctx ?? { ui: { notify: (msg, kind) => notes.push({ msg, kind }) } };
      await commands.mem.handler(args, ctx);
      return notes;
    },
  };
}

test("/mem sem argumento continua listando tudo (regressão)", async () => {
  const { root, store } = tempStore();
  const prev = process.env.SELFEOPI_MEMORY_DIR;
  process.env.SELFEOPI_MEMORY_DIR = root;
  try {
    store.append("project", { text: "fato um", tags: [] });
    store.append("project", { text: "fato dois", tags: [] });
    const { run } = await memHarness();
    const notes = await run("");
    const joined = notes.map((n) => n.msg).join("\n");
    assert.match(joined, /Memória do projeto \(2\)/);
    assert.match(joined, /fato um/);
    assert.match(joined, /fato dois/);
  } finally {
    if (prev === undefined) delete process.env.SELFEOPI_MEMORY_DIR;
    else process.env.SELFEOPI_MEMORY_DIR = prev;
    rmSync(root, { recursive: true, force: true });
  }
});

test("/mem find pelo handler encontra a capacidade gravada", async () => {
  const { root, store } = tempStore();
  const prev = process.env.SELFEOPI_MEMORY_DIR;
  process.env.SELFEOPI_MEMORY_DIR = root;
  try {
    store.append("skills", {
      text: "soma dois números — artefato em `skills/soma/cli.mjs`",
      tags: ["artefato", "cli"],
      source: "evo",
    });
    const { run } = await memHarness();
    const notes = await run("find soma");
    const joined = notes.map((n) => n.msg).join("\n");
    assert.match(joined, /Busca: "soma"/);
    assert.match(joined, /skills\/soma\/cli\.mjs/);
  } finally {
    if (prev === undefined) delete process.env.SELFEOPI_MEMORY_DIR;
    else process.env.SELFEOPI_MEMORY_DIR = prev;
    rmSync(root, { recursive: true, force: true });
  }
});

test("/mem find com termo inexistente diz 'nada encontrado' sem quebrar", async () => {
  const { root, store } = tempStore();
  const prev = process.env.SELFEOPI_MEMORY_DIR;
  process.env.SELFEOPI_MEMORY_DIR = root;
  try {
    store.append("skills", { text: "soma dois números", tags: ["artefato"] });
    const { run } = await memHarness();
    const notes = await run("find naoexiste");
    const joined = notes.map((n) => n.msg).join("\n");
    assert.match(joined, /nada encontrado/);
  } finally {
    if (prev === undefined) delete process.env.SELFEOPI_MEMORY_DIR;
    else process.env.SELFEOPI_MEMORY_DIR = prev;
    rmSync(root, { recursive: true, force: true });
  }
});

test("/mem find com teto de tokens: saída não estoura o orçamento", async () => {
  const { root, store } = tempStore();
  const prev = process.env.SELFEOPI_MEMORY_DIR;
  const prevMax = process.env.SELFEOPI_MEM_TOKENS;
  process.env.SELFEOPI_MEMORY_DIR = root;
  process.env.SELFEOPI_MEM_TOKENS = "200";
  try {
    for (let i = 0; i < 15; i++) {
      store.append("skills", { text: `capacidade de soma numero ${i} com texto longo`, tags: ["soma"] });
    }
    const { run } = await memHarness();
    const notes = await run("find soma");
    const joined = notes.map((n) => n.msg).join("\n");
    // No máximo FIND_LIMIT (10) linhas, e cada linha cortada em FIND_TEXT_CHARS.
    const bodyLines = joined.split("\n").filter((l) => l.startsWith("- ["));
    assert.ok(bodyLines.length <= FIND_LIMIT, `${bodyLines.length} linhas > ${FIND_LIMIT}`);
    for (const l of bodyLines) {
      assert.ok(l.length <= 200, `linha longa demais: ${l.length}`);
    }
  } finally {
    if (prev === undefined) delete process.env.SELFEOPI_MEMORY_DIR;
    else process.env.SELFEOPI_MEMORY_DIR = prev;
    if (prevMax === undefined) delete process.env.SELFEOPI_MEM_TOKENS;
    else process.env.SELFEOPI_MEM_TOKENS = prevMax;
    rmSync(root, { recursive: true, force: true });
  }
});