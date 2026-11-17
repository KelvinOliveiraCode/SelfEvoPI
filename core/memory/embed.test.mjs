import test from "node:test";
import assert from "node:assert/strict";

import {
  embed,
  cosine,
  normalize,
  expandSynonyms,
  charNgrams,
  DEFAULT_DIMS,
} from "./embed.mjs";

/* ----------------------------- determinismo ----------------------------- */

test("mesmo texto produz exatamente o mesmo vetor", () => {
  const a = embed("calcular o imc de uma pessoa");
  const b = embed("calcular o imc de uma pessoa");
  assert.deepEqual(a, b);
});

test("texto diferente produz vetor diferente", () => {
  const a = embed("calcular imc");
  const b = embed("criptografia assimetrica");
  assert.notDeepEqual(a, b);
});

test("o vetor tem a dimensão configurada", () => {
  assert.equal(embed("teste").length, DEFAULT_DIMS);
  assert.equal(embed("teste", { dims: 512 }).length, 512);
});

/* ------------------------------- norma 1 -------------------------------- */

test("o vetor tem norma L2 = 1 (texto não vazio)", () => {
  for (const texto of ["calcular imc", "subir servidor http", "parser de json", "a"]) {
    const v = embed(texto);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    assert.ok(Math.abs(norm - 1) < 1e-9, `norma ${norm} != 1 para "${texto}"`);
  }
});

test("texto vazio gera vetor nulo (norma 0) sem quebrar", () => {
  const v = embed("");
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  assert.equal(norm, 0);
});

/* --------------------------- sinônimos > não-relacionados ------------------ */

test("sinônimos têm similaridade maior que não-relacionados", () => {
  const sinonimo = cosine("calcular imc", "indice de massa corporal");
  const naoRelacionado = cosine("calcular imc", "criptografia quantica");
  assert.ok(
    sinonimo > naoRelacionado,
    `sinônimo (${sinonimo}) deve ser > não-relacionado (${naoRelacionado})`,
  );
});

test("paráfrases conhecidas pontuam acima de ruído", () => {
  const pares = [
    ["arquivo de configuracao", "settings"],
    ["subir servidor", "start server"],
    ["validar entrada", "check input"],
  ];
  for (const [a, b] of pares) {
    const similar = cosine(a, b);
    const ruido = cosine(a, "receita de bolo de cenoura");
    assert.ok(similar > ruido, `"${a}" vs "${b}" (${similar}) deve superar ruído (${ruido})`);
  }
});

test("texto idêntico tem cosseno 1", () => {
  assert.ok(Math.abs(cosine("somar dois numeros", "somar dois numeros") - 1) < 1e-9);
});

/* --------------------------- normalização ------------------------------- */

test("normalize remove acento, minúsculo e colapsa espaços", () => {
  assert.equal(normalize("  Ação   e   Reação "), "acao e reacao");
});

test("expandSynonyms liga 'indice de massa corporal' a 'imc'", () => {
  assert.equal(expandSynonyms(normalize("indice de massa corporal")), "imc");
  assert.equal(expandSynonyms(normalize("calcular o imc")), "calcular o imc");
});

test("charNgrams gera 3..5-grams e não quebra em texto curto", () => {
  const grams = charNgrams("abcd");
  assert.ok(grams.includes("abc"));
  assert.ok(grams.includes("abcd"));
  assert.ok(grams.includes("bcd"));
  // texto menor que o menor n vira um grama inteiro
  const curto = charNgrams("ab");
  assert.deepEqual(curto, ["ab", "ab", "ab"]);
});

test("embed é puro: chamar duas vezes não muda estado global", () => {
  const antes = embed("estado inicial");
  embed("outra coisa qualquer");
  embed("mais uma");
  const depois = embed("estado inicial");
  assert.deepEqual(antes, depois);
});