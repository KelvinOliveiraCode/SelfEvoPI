import test from "node:test";
import assert from "node:assert/strict";

import { parseMagicWords, findCodeRanges, MAGIC_WORDS } from "./magic-words.mjs";

test("detecta palavra de controle em prosa e devolve alvo", () => {
  const r = parseMagicWords("orchestrate a migração dos serviços");
  assert.equal(r.diretivas.length, 1);
  assert.equal(r.diretivas[0].nome, "orchestrate");
  assert.equal(r.diretivas[0].alvo, "a migração dos serviços");
  assert.equal(r.textoLimpo, "a migração dos serviços");
});

test("sem palavra de controle devolve texto intacto e lista vazia", () => {
  const texto = "apenas uma frase comum sem gatilho";
  const r = parseMagicWords(texto);
  assert.equal(r.diretivas.length, 0);
  assert.equal(r.textoLimpo, texto);
});

test("detecta as quatro palavras sem diferenciar caixa", () => {
  const r = parseMagicWords("Ultrathink, chillax, ORCHESTRATE e workflowz juntos");
  assert.deepEqual(
    r.diretivas.map((d) => d.nome),
    ["ultrathink", "chillax", "orchestrate", "workflowz"],
  );
  for (const nome of MAGIC_WORDS) {
    const um = parseMagicWords(`por favor ${nome} agora`);
    assert.equal(um.diretivas[0].nome, nome);
  }
});

test("não detecta dentro de bloco cercado por crases", () => {
  const texto = "veja isto:\n```\norchestrate a migração\n```\nfim";
  const r = parseMagicWords(texto);
  assert.equal(r.diretivas.length, 0);
  assert.equal(r.textoLimpo, texto);
});

test("não detecta dentro de bloco cercado por til", () => {
  const texto = "~~~js\nultrathink\n~~~\nfim";
  const r = parseMagicWords(texto);
  assert.equal(r.diretivas.length, 0);
});

test("não detecta dentro de crase inline", () => {
  const texto = "use a função `orchestrate()` no código";
  const r = parseMagicWords(texto);
  assert.equal(r.diretivas.length, 0);
  assert.equal(r.textoLimpo, texto);
});

test("não detecta dentro de URL", () => {
  for (const texto of [
    "visite https://exemplo.com/orchestrate agora",
    "veja http://ultrathink.io/pagina",
    "domínio orchestrate.com sem esquema",
  ]) {
    const r = parseMagicWords(texto);
    assert.equal(r.diretivas.length, 0, `não deveria detectar em: ${texto}`);
  }
});

test("não detecta dentro de caminho de arquivo", () => {
  for (const texto of [
    "edite src/orchestrate.mjs por favor",
    "abra .\\projetos\\ultrathink\\main",
    "./workflowz/run.sh",
  ]) {
    const r = parseMagicWords(texto);
    assert.equal(r.diretivas.length, 0, `não deveria detectar em: ${texto}`);
  }
});

test("não detecta dentro de identificador colado", () => {
  for (const texto of [
    "chame orchestrateMode(true)",
    "a variável ultrathink_count está ok",
    "tipo workflowzRunner",
    "super-orchestrate",
  ]) {
    const r = parseMagicWords(texto);
    assert.equal(r.diretivas.length, 0, `não deveria detectar em: ${texto}`);
  }
});

test("não detecta glued a sinal de atribuição (cara de código)", () => {
  for (const texto of ["x=ultrathink", "flag=orchestrate", "modo=workflowz"]) {
    const r = parseMagicWords(texto);
    assert.equal(r.diretivas.length, 0, `não deveria detectar em: ${texto}`);
  }
  // Com espaços, volta a ser prosa.
  assert.equal(parseMagicWords("orchestrate = the build").diretivas.length, 1);
});

test("alvo não começa com pontuação de sentença", () => {
  assert.equal(parseMagicWords("orchestrate. Próxima frase").diretivas[0].alvo, "Próxima frase");
  assert.equal(parseMagicWords("chillax!").diretivas[0].alvo, null);
  assert.equal(parseMagicWords("orchestrate, depois").diretivas[0].alvo, "depois");
  assert.equal(parseMagicWords("orchestrate (the build)").diretivas[0].alvo, "(the build)");
});

test("remove só a palavra e preserva código inline ao lado", () => {
  const texto = "orchestrate `foo  bar` agora";
  const r = parseMagicWords(texto);
  assert.equal(r.diretivas.length, 1);
  assert.ok(r.textoLimpo.includes("foo  bar"), "código inline deve ficar intacto");
  assert.ok(!r.textoLimpo.includes("orchestrate"));
});

test("alvo é nulo quando a palavra está sozinha na linha", () => {
  const r = parseMagicWords("ultrathink");
  assert.equal(r.diretivas[0].nome, "ultrathink");
  assert.equal(r.diretivas[0].alvo, null);
});

test("entrada não textual não lança", () => {
  assert.deepEqual(parseMagicWords(undefined), { textoLimpo: "", diretivas: [] });
  assert.deepEqual(parseMagicWords(null), { textoLimpo: "", diretivas: [] });
  assert.deepEqual(parseMagicWords(42), { textoLimpo: "", diretivas: [] });
});

test("findCodeRanges marca o intervalo do bloco cercado", () => {
  const texto = "a\n```\ncode\n```\nb";
  const ranges = findCodeRanges(texto);
  assert.ok(ranges.length >= 1);
  const [a, b] = ranges[0];
  assert.ok(texto.slice(a, b).includes("code"));
});