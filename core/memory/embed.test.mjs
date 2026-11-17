import test from "node:test";
import assert from "node:assert/strict";

import {
  embed,
  cosine,
  normalize,
  expandSynonyms,
  charNgrams,
  rawSimilarity,
  glossarySimilarity,
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

/* --------------------- honestidade das camadas -------------------------- */

test("camada crua NÃO liga sinônimos sem forma (comportamento correto)", () => {
  // Strings diferentes, sem caractere em comum: a forma crua dá ~0. Isso é o
  // esperado — não existe semântica mágica no n-grama cru.
  const cru = rawSimilarity("imc", "indice de massa corporal");
  assert.ok(cru < 0.15, `cru deveria ser baixo, deu ${cru}`);
  assert.ok(cosine("imc", "indice de massa corporal") < 0.15);
});

test("glossário liga sinônimos cobertos (identidade após substituição)", () => {
  // "imc" está no SYNONYM_GROUPS; a expansão colapsa os dois no mesmo canônico.
  const g = glossarySimilarity("imc", "indice de massa corporal");
  assert.ok(g > 0.9, `glossário deveria pontuar alto, deu ${g}`);
});

test("glossário NÃO cobre sinônimo fora do glossário", () => {
  // "remover"/"excluir" não está no glossário: deve dar ~0.
  const g = glossarySimilarity("remover", "excluir item da lista");
  assert.ok(g < 0.15, `glossário não deveria cobrir, deu ${g}`);
});

test("texto idêntico tem similaridade 1 em ambas as camadas", () => {
  assert.ok(Math.abs(cosine("somar dois numeros", "somar dois numeros") - 1) < 1e-9);
  assert.ok(Math.abs(glossarySimilarity("somar dois numeros", "somar dois numeros") - 1) < 1e-9);
  assert.ok(Math.abs(rawSimilarity("somar dois numeros", "somar dois numeros") - 1) < 1e-9);
});

test("cosine é simétrico e limitado a [-1,1]", () => {
  const a = cosine("subir servidor", "start server");
  const b = cosine("start server", "subir servidor");
  assert.ok(Math.abs(a - b) < 1e-9, "cosine deve ser simétrico");
  assert.ok(a >= -1 && a <= 1);
});

test("rawSimilarity é limitado a [0,1] (contém direção, não simétrico)", () => {
  const a = rawSimilarity("subir servidor", "start server");
  assert.ok(a >= 0 && a <= 1, `deve estar em [0,1], deu ${a}`);
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