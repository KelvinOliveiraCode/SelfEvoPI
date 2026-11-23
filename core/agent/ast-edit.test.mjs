import test from "node:test";
import assert from "node:assert/strict";

import {
  hashTexto,
  localizarBloco,
  planejarEdicao,
  aplicarEdicao,
  resumoEdicao,
} from "./ast-edit.mjs";

const CODIGO = [
  "const antes = 1;",
  "function saudacao(nome) {",
  '  const msg = "texto { não é chave";',
  "  // } comentário enganoso",
  "  return `olá ${nome}!`;",
  "}",
  "class Caixa {",
  "  /* } bloco enganoso */",
  '  abrir() { return "{"; }',
  "}",
  "const dobro = (n) => {",
  '  const s = "}";',
  "  return n * 2;",
  "};",
  "function config(opts = { x: 1 }) {",
  "  return opts.x;",
  "}",
].join("\n");

function hashesTrecho(trecho) {
  return trecho.split("\n").map((linha) => hashTexto(linha));
}

/* --------------------------- hash --------------------------------------- */

test("hashTexto é estável, curto e sensível a um caractere", () => {
  const h = hashTexto("const x = 1;");
  assert.match(h, /^[0-9a-f]{8}$/);
  assert.equal(h, hashTexto("const x = 1;"));
  assert.notEqual(h, hashTexto("const x = 2;"));
  assert.notEqual(hashTexto("☕"), hashTexto("☕ "));
});

/* --------------------------- localização -------------------------------- */

test("localiza função com string contendo '{' e comentário com '}'", () => {
  const r = localizarBloco(CODIGO, { simbolo: "saudacao" });
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.linhaInicio, 2);
  assert.equal(r.linhaFim, 6);
  assert.equal(r.inicio, CODIGO.indexOf("function saudacao"));
  assert.ok(r.trecho.startsWith("function saudacao"));
  assert.ok(r.trecho.includes('"texto { não é chave"'));
  assert.ok(r.trecho.includes("// } comentário enganoso"));
  assert.ok(r.trecho.includes("`olá ${nome}!`"));
  assert.ok(r.trecho.endsWith("}"));
});

test("localiza classe, const arrow e parâmetro default com objeto", () => {
  const classe = localizarBloco(CODIGO, { simbolo: "Caixa" });
  assert.equal(classe.ok, true, classe.motivo);
  assert.equal(classe.linhaInicio, 7);
  assert.equal(classe.linhaFim, 10);
  assert.ok(classe.trecho.includes("/* } bloco enganoso */"));

  const arrow = localizarBloco(CODIGO, { simbolo: "dobro" });
  assert.equal(arrow.ok, true, arrow.motivo);
  assert.equal(arrow.linhaInicio, 11);
  assert.equal(arrow.linhaFim, 14);
  assert.ok(arrow.trecho.includes('const s = "}"'));

  const param = localizarBloco(CODIGO, { simbolo: "config" });
  assert.equal(param.ok, true, param.motivo);
  assert.equal(param.linhaInicio, 15);
  assert.equal(param.linhaFim, 17);
  assert.ok(param.trecho.startsWith("function config(opts = { x: 1 })"));
});

test("âncora por hashes detecta arquivo stale", () => {
  const bloco = localizarBloco(CODIGO, { simbolo: "saudacao" });
  const hashes = hashesTrecho(bloco.trecho);

  const atual = localizarBloco(CODIGO, { simbolo: "saudacao", hashes });
  assert.equal(atual.ok, true, atual.motivo);

  const mudou = CODIGO.replace("texto { não é chave", "texto diferente");
  const stale = localizarBloco(mudou, { simbolo: "saudacao", hashes });
  assert.equal(stale.ok, false);
  assert.equal(stale.motivo, "stale");
});

test("hashes sozinhos localizam a janela exata", () => {
  const bloco = localizarBloco(CODIGO, { simbolo: "Caixa" });
  const r = localizarBloco(CODIGO, { hashes: hashesTrecho(bloco.trecho) });
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.linhaInicio, 7);
  assert.equal(r.linhaFim, 10);
});

test("intervalo 1-based não corta linha no meio", () => {
  const r = localizarBloco(CODIGO, { startLine: 2, endLine: 3 });
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.trecho, CODIGO.split("\n").slice(1, 3).join("\n"));
  assert.equal(r.trecho, "function saudacao(nome) {\n  const msg = \"texto { não é chave\";");

  const invalido = localizarBloco(CODIGO, { startLine: 3, endLine: 2 });
  assert.equal(invalido.ok, false);
  assert.equal(invalido.motivo, "intervalo-invalido");
});

test("sem âncora e símbolo ausente falham com motivo explícito", () => {
  assert.equal(localizarBloco(CODIGO, {}).motivo, "sem-ancora");
  assert.equal(localizarBloco(CODIGO, { simbolo: "inexistente" }).motivo, "simbolo-nao-encontrado");
});

/* --------------------------- plano e aplicação -------------------------- */

test("planejar + aplicar: uma edição", () => {
  const esperado = localizarBloco(CODIGO, { simbolo: "saudacao" });
  const plano = planejarEdicao(CODIGO, {
    simbolo: "saudacao",
    depois: 'function saudacao() { return "oi"; }',
  });
  assert.equal(plano.ok, true, plano.motivo);
  assert.equal(plano.edicoes.length, 1);
  assert.equal(plano.edicoes[0].antes, esperado.trecho);

  const r = aplicarEdicao(CODIGO, plano);
  assert.equal(r.ok, true, r.motivo);
  assert.ok(r.texto.includes('function saudacao() { return "oi"; }'));
  assert.ok(r.texto.includes("class Caixa {"));
  assert.equal(r.texto.split("\n").length, 13, "cinco linhas viraram uma");
});

test("planejar + aplicar: múltiplas edições em ordem reversa", () => {
  const plano = planejarEdicao(CODIGO, {
    edicoes: [
      { simbolo: "saudacao", depois: "function saudacao() { return 1; }" },
      { simbolo: "dobro", depois: "const dobro = (n) => n * 3;" },
      { simbolo: "config", depois: "function config() { return {}; }" },
    ],
  });
  assert.equal(plano.ok, true, plano.motivo);
  assert.equal(plano.edicoes.length, 3);
  const inicios = plano.edicoes.map((e) => e.inicio);
  assert.deepEqual(inicios, [...inicios].sort((a, b) => a - b), "plano vem em ordem crescente");

  const r = aplicarEdicao(CODIGO, plano);
  assert.equal(r.ok, true, r.motivo);
  assert.ok(r.texto.includes("return 1;"));
  assert.ok(r.texto.includes("n * 3"));
  assert.ok(!r.texto.includes("n * 2"), "edição antiga não pode sobreviver");
  assert.ok(r.texto.includes("class Caixa {"));
  assert.ok(r.texto.includes("const antes = 1;"));
});

test("preview e resumo cabem em 72 colunas e não usam reticências", () => {
  const plano = planejarEdicao(CODIGO, {
    edicoes: [
      { simbolo: "saudacao", depois: "function saudacao() { return 1; }" },
      { simbolo: "dobro", depois: "const dobro = (n) => n * 3;" },
    ],
  });
  assert.equal(plano.ok, true, plano.motivo);
  const resumo = resumoEdicao(plano, "pasta/arquivo.mjs");

  for (const bloco of [plano.preview, resumo]) {
    for (const linha of bloco.split("\n")) {
      assert.ok(linha.length > 0);
      assert.ok(linha.length <= 72, `linha com ${linha.length} colunas: ${linha}`);
      assert.ok(!linha.includes("…") && !linha.includes("..."), "sem reticências");
    }
  }
  assert.ok(plano.preview.includes("2 edições"));
  assert.ok(resumo.includes("arquivo.mjs"));
  assert.ok(!resumo.includes("pasta/"), "resumo não vaza diretório");
});

test("falha de staleness não altera o texto", () => {
  const bloco = localizarBloco(CODIGO, { simbolo: "saudacao" });
  const plano = planejarEdicao(CODIGO, {
    simbolo: "saudacao",
    hashes: hashesTrecho(bloco.trecho),
    depois: "function saudacao() { return 42; }",
  });
  assert.equal(plano.ok, true);

  const mudou = CODIGO.replace("texto { não é chave", "texto mudou");
  const r = aplicarEdicao(mudou, plano);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "stale");
  assert.equal(r.texto, mudou, "texto original preservado");
});

test("plano inválido falha sem mudar nada", () => {
  const plano = planejarEdicao(CODIGO, { simbolo: "saudacao", depois: "x" });
  const quebrado = { ...plano, edicoes: [{ ...plano.edicoes[0], inicio: 999 }] };
  const r = aplicarEdicao(CODIGO, quebrado);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "plano-invalido");
  assert.equal(r.texto, CODIGO);
  assert.equal(aplicarEdicao(CODIGO, { ok: false, edicoes: [] }).motivo, "plano-invalido");
});
