import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openStore } from "./store.mjs";
import { searchCapabilities, tokenize } from "./search.mjs";
import { embed } from "./embed.mjs";

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

/* --------------------- busca semântica (sinônimos) ---------------------- */

test("busca por glossário acha sinônimo coberto (imc ↔ indice de massa corporal)", () => {
  const { root, store } = tempStore();
  try {
    store.append("skills", {
      text: "calcular o índice de massa corporal de uma pessoa — artefato em `skills/saude/cli.mjs`",
      tags: ["artefato", "cli"],
    });
    const r = searchCapabilities(store, "imc");
    assert.ok(r.count >= 1, JSON.stringify(r));
    assert.match(r.results[0].text, /massa corporal/);
    // a camada que decide aqui é o glossário (imc está no SYNONYM_GROUPS).
    assert.ok(r.results[0].glossaryScore > 0, "glossário deve pontuar > 0");
    assert.ok(["glossario", "ppmi", "lexical"].includes(r.results[0].via));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("busca por glossário recupera 'settings' como 'arquivo de configuracao'", () => {
  const { root, store } = tempStore();
  try {
    store.append("skills", {
      text: "ler um arquivo de configuracao do projeto — artefato em `skills/config/cli.mjs`",
      tags: ["artefato"],
    });
    const r = searchCapabilities(store, "settings");
    assert.ok(r.count >= 1, JSON.stringify(r));
    assert.match(r.results[0].text, /configuracao/);
    assert.ok(r.results[0].glossaryScore > 0, "glossário deve pontuar > 0");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("literal continua sendo caminho válido (via lexical quando o termo é exato)", () => {
  const { root, store } = tempStore();
  try {
    // "repositório" é literal e NÃO está no glossário: só a via léxica pode achar.
    store.append("skills", { text: "listar arquivos do repositorio local", tags: ["artefato"] });
    const r = searchCapabilities(store, "repositorio", { glossary: false, ppmi: false });
    assert.ok(r.count >= 1);
    const top = r.results[0];
    assert.ok(top.lexScore >= 1, "termo literal deve casar na via léxica");
    assert.equal(top.via, "lexical");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("desligar glossário + PPMI mantém só o caminho léxico", () => {
  const { root, store } = tempStore();
  try {
    store.append("skills", {
      text: "calcular o índice de massa corporal — artefato em `skills/saude/cli.mjs`",
      tags: ["artefato"],
    });
    const r = searchCapabilities(store, "imc", { glossary: false, ppmi: false });
    assert.equal(r.count, 0, "sem glossário/PPMI, 'imc' não casa com 'massa corporal'");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("camada PPMI aprende co-ocorrência do corpus (sinônimo não coberto)", () => {
  const { root, store } = tempStore();
  try {
    // corpus com o par "remover"/"excluir" no mesmo registro — NÃO está no glossário.
    store.append("project", { text: "remover um item da lista: excluir item da lista", tags: [] });
    store.append("project", { text: "criar um arquivo: gerar um novo arquivo", tags: [] });
    const r = searchCapabilities(store, "excluir", { glossary: false });
    assert.ok(r.count >= 1, JSON.stringify(r));
    assert.ok(r.results[0].ppmiScore > 0, "PPMI deve pontuar o par co-ocorrido");
    assert.ok(r.results[0].glossaryScore === 0, "glossário desligado");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sinônimo não coberto e sem glossário não é recuperado (falso em pares não vistos)", () => {
  const { root, store } = tempStore();
  try {
    // corpus não tem "remover"/"excluir"; glossário também não cobre.
    store.append("project", { text: "somar dois numeros", tags: [] });
    const r = searchCapabilities(store, "excluir item", { glossary: false });
    assert.equal(r.count, 0, "sem sinal, não deve inventar casamento");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resultado traz campos de diagnóstico por camada (lexScore, ppmiScore, glossaryScore)", () => {
  const { root, store } = tempStore();
  try {
    store.append("skills", { text: "somar dois numeros", tags: ["artefato"] });
    const r = searchCapabilities(store, "somar");
    const top = r.results[0];
    assert.equal(typeof top.score, "number");
    assert.equal(typeof top.lexScore, "number");
    assert.equal(typeof top.ppmiScore, "number");
    assert.equal(typeof top.glossaryScore, "number");
    assert.equal(typeof top.rawScore, "number");
    assert.ok(["lexical", "ppmi", "glossario"].includes(top.via));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("busca por camada não acha o que não existe (ruído)", () => {
  const { root, store } = tempStore();
  try {
    store.append("skills", { text: "somar dois numeros", tags: ["artefato"] });
    const r = searchCapabilities(store, "criptografia quantica");
    assert.equal(r.count, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});