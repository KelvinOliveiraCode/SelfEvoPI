import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openStore } from "./store.mjs";
import { searchCapabilities, tokenize } from "./search.mjs";

function tempStore() {
  const root = mkdtempSync(join(tmpdir(), "selfevopi-search-"));
  return { root, store: openStore({ root }) };
}

test("tokenize normaliza acento e caixa e tira palavra vazia", () => {
  assert.deepEqual(tokenize("Ação e Reação"), ["acao", "reacao"]);
  assert.deepEqual(tokenize("  Múltiplos   espaços "), ["multiplos", "espacos"]);
  assert.deepEqual(tokenize("a o de da"), []);
});

test("busca encontra capacidade por termo do texto", () => {
  const { root, store } = tempStore();
  try {
    store.append("skills", { text: "somar dois numeros — artefato em `.pi/harness/artifacts/soma`", tags: ["artefato", "cli"] });
    store.append("skills", { text: "validar um JSON contra um schema", tags: ["artefato"] });
    const r = searchCapabilities(store, "somar numeros");
    assert.ok(r.count >= 1, JSON.stringify(r));
    assert.match(r.results[0].text, /somar dois numeros/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tag pesa mais que texto", () => {
  const { root, store } = tempStore();
  try {
    // as duas falam de "imc"; a que tem a tag deve vir primeiro
    store.append("skills", { text: "calcular o imc de uma pessoa", tags: ["artefato"] });
    store.append("skills", { text: "explicar o que e imc em linguagem simples", tags: ["documento", "imc"] });
    const r = searchCapabilities(store, "imc");
    assert.equal(r.results[0].tags.includes("imc"), true, "a entrada com tag 'imc' vem primeiro");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ordenacao e por cobertura antes de pontos", () => {
  const { root, store } = tempStore();
  try {
    // uma entrada cobre os dois termos; a outra so cobre um, mas com tag
    store.append("skills", { text: "somar e subtrair numeros", tags: ["artefato"] });
    store.append("skills", { text: "somar", tags: ["artefato", "cli", "soma"] });
    const r = searchCapabilities(store, "somar subtrair");
    assert.equal(r.results[0].cobertura, 1, "quem cobre tudo vem primeiro");
    assert.equal(r.results[0].text, "somar e subtrair numeros");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("consulta sem termo nao quebra e devolve vazio", () => {
  const { root, store } = tempStore();
  try {
    store.append("skills", { text: "qualquer coisa", tags: [] });
    const r = searchCapabilities(store, "a o de");
    assert.equal(r.count, 0);
    assert.deepEqual(r.results, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("nao encontra o que nao existe", () => {
  const { root, store } = tempStore();
  try {
    store.append("skills", { text: "somar dois numeros", tags: ["artefato"] });
    const r = searchCapabilities(store, "criptografia quântica");
    assert.equal(r.count, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("respeita o nivel pedido e nao quebra com nivel ausente", () => {
  const { root, store } = tempStore();
  try {
    store.append("project", { text: "convencao de nomes do projeto", tags: ["decisao"] });
    const r = searchCapabilities(store, "convencao nomes", { levels: ["skills"] });
    assert.equal(r.count, 0, "skills esta vazio: nada encontrado");
    const r2 = searchCapabilities(store, "convencao nomes", { levels: ["project"] });
    assert.equal(r2.count, 1);
    assert.equal(r2.results[0].level, "project");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("limita o numero de resultados", () => {
  const { root, store } = tempStore();
  try {
    for (let i = 0; i < 10; i++) {
      store.append("skills", { text: `capacidade numero ${i} sobre parser`, tags: ["artefato"] });
    }
    const r = searchCapabilities(store, "parser", { limit: 3 });
    assert.equal(r.results.length, 3);
    assert.ok(r.count > 3, "conta o total, nao so o que devolveu");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("store invalido e recusado com mensagem clara", () => {
  assert.throws(() => searchCapabilities(null, "x"), /store válido/);
  assert.throws(() => searchCapabilities({}, "x"), /store válido/);
});