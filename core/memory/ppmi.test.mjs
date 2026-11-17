import test from "node:test";
import assert from "node:assert/strict";

import { buildPpmiModel, ppmiSimilarity, tokenizeCorpus } from "./ppmi.mjs";

test("tokenizeCorpus normaliza e tira stopwords", () => {
  const t = tokenizeCorpus("Artefato de Configuração do projeto");
  assert.ok(!t.includes("artefato"));
  assert.ok(!t.includes("de"));
  assert.ok(!t.includes("do"));
  assert.ok(t.includes("configuracao"));
  assert.ok(t.includes("projeto"));
});

test("modelo PPMI é determinístico", () => {
  const corpus = ["remover excluir lista", "criar gerar arquivo", "somar adicao"];
  const a = buildPpmiModel(corpus);
  const b = buildPpmiModel(corpus);
  assert.equal(a.docCount, b.docCount);
  assert.deepEqual(a.terms.slice().sort(), b.terms.slice().sort());
});

test("sinônimos co-ocorrentes no corpus ficam próximos (PPMI > 0)", () => {
  const corpus = [
    "remover um item: excluir item da lista",
    "criar um arquivo: gerar um novo arquivo",
  ];
  const model = buildPpmiModel(corpus);
  const sim = ppmiSimilarity(model, "excluir", "remover um item da lista");
  assert.ok(sim > 0.2, `PPMI deveria pontuar o par co-ocorrido, deu ${sim}`);
});

test("termos sem co-ocorrência no corpus dão PPMI 0", () => {
  const corpus = ["somar dois numeros", "subtrair dois numeros"];
  const model = buildPpmiModel(corpus);
  const sim = ppmiSimilarity(model, "criptografia", "somar dois numeros");
  assert.equal(sim, 0, "termo ausente do corpus não deve casar");
});

test("modelo vazio não quebra e devolve 0", () => {
  const model = buildPpmiModel([]);
  assert.equal(model.docCount, 0);
  assert.equal(ppmiSimilarity(model, "x", "y"), 0);
});

test("par co-ocorrido pontua mais que par ausente do corpus", () => {
  // "remover"/"excluir" coocorrem em vários docs; "criptografia" nunca aparece.
  const corpus = [
    "remover excluir lista de itens",
    "remover excluir duplicatas",
    "criar gerar arquivo novo",
  ];
  const model = buildPpmiModel(corpus);
  const coocor = ppmiSimilarity(model, "remover", "remover excluir lista de itens");
  const ausente = ppmiSimilarity(model, "criptografia", "criar gerar arquivo novo");
  assert.ok(coocor > 0, `co-ocorrido deveria pontuar, deu ${coocor}`);
  assert.ok(coocor > ausente, `co-ocorrido (${coocor}) deve superar ausente (${ausente})`);
});