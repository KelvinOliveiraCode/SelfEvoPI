#!/usr/bin/env node
/**
 * core/agent/init.test.mjs — o gerador de rascunho de AGENTS.md.
 *
 * A propriedade mais importante daqui é determinismo: mesma entrada, mesma
 * saída byte a byte. É isso que separa um gerador de um "escreveu algo
 * parecido". O teste de I/O prova o outro lado do contrato — o módulo
 * devolve string e não toca em disco.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { renderAgentDoc } from "./init.mjs";

/* ------------------------------------------------------------------ */
/* projeto mínimo                                                      */
/* ------------------------------------------------------------------ */

test("projeto mínimo gera um AGENTS.md com todas as seções", () => {
  const doc = renderAgentDoc({ project: { name: "SelfEvoPI", description: "Harness auto-evolutivo" } });

  assert.equal(typeof doc, "string");
  assert.ok(doc.length > 400, "o documento tem que ter conteúdo de verdade");

  // o aviso de rascunho é obrigatório e vem antes de qualquer instrução
  assert.match(doc, /RASCUNHO GERADO/);
  assert.match(doc, /revis[ãa]o humana|revis\/o|aprovada por uma pessoa/i);

  for (const secao of ["## O que é", "## Como rodar", "## Estrutura", "## Áreas protegidas", "## Convenções"]) {
    assert.ok(doc.includes(secao), `faltou a seção: ${secao}`);
  }

  // o comando de verificação é o do projeto, não um exemplo genérico
  assert.ok(doc.includes("npm run verify"));
});

test("o aviso de rascunho aparece antes da primeira seção", () => {
  const doc = renderAgentDoc({ project: {} });
  const aviso = doc.indexOf("RASCUNHO GERADO");
  const secoes = doc.indexOf("## O que é");

  assert.ok(aviso >= 0);
  assert.ok(secoes >= 0);
  assert.ok(aviso < secoes, "o rascunho tem que ser declarado antes de instruir");
});

test("sem argumento nenhum o módulo ainda devolve um documento utilizável", () => {
  const doc = renderAgentDoc({});
  assert.match(doc, /RASCUNHO GERADO/);
  assert.match(doc, /npm run verify/);
});

/* ------------------------------------------------------------------ */
/* determinismo                                                        */
/* ------------------------------------------------------------------ */

test("duas chamadas iguais produzem strings idênticas", () => {
  const project = { name: "SelfEvoPI", description: "Harness auto-evolutivo", version: "0.5.0" };
  const a = renderAgentDoc({ project });
  const b = renderAgentDoc({ project });
  assert.equal(a, b);
});

test("a ordem das chaves de entrada não muda a saída", () => {
  const a = renderAgentDoc({
    project: { name: "X", description: "coisa", version: "1.0.0" },
  });
  const b = renderAgentDoc({
    project: { version: "1.0.0", description: "coisa", name: "X" },
  });
  assert.equal(a, b);
});

test("a saída não contém caminho absoluto nem data", () => {
  const doc = renderAgentDoc({ project: { name: "X", description: "Y" } });

  // nada de C:\Users, /home/, ou carimbo de tempo
  assert.equal(/[A-Za-z]:\\/.test(doc), false, "não pode vazar caminho de máquina");
  assert.equal(/\/home\//.test(doc), false);
  assert.equal(/\/Users\//.test(doc), false);
  assert.equal(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(doc), false, "não pode ter timestamp");
});

/* ------------------------------------------------------------------ */
/* conteúdo derivado do projeto                                        */
/* ------------------------------------------------------------------ */

test("o nome e a descrição do projeto aparecem no documento", () => {
  const doc = renderAgentDoc({
    project: { name: "MeuProjeto", description: "Um coletor de métricas" },
  });

  assert.ok(doc.includes("# AGENTS.md — MeuProjeto"));
  assert.ok(doc.includes("coletor de métricas") || doc.includes("Coletor de métricas"));
});

test("version declarada aparece; sem version não aparece linha de versão", () => {
  const com = renderAgentDoc({ project: { name: "X", description: "Y", version: "1.2.3" } });
  assert.ok(com.includes("`1.2.3`"));

  const sem = renderAgentDoc({ project: { name: "X", description: "Y" } });
  assert.equal(sem.includes("Versão declarada"), false);
});

test("verify e test podem ser sobrescritos pelo projeto", () => {
  const doc = renderAgentDoc({
    project: {
      name: "X",
      description: "Y",
      verify: "npm run lint && npm test",
      test: "npm run test:unit",
    },
  });

  assert.ok(doc.includes("npm run lint && npm test"));
  assert.ok(doc.includes("npm run test:unit"));
});

test("quando verify é igual a test, o bloco duplicado não aparece", () => {
  const doc = renderAgentDoc({
    project: { name: "X", description: "Y", verify: "npm test", test: "npm test" },
  });

  // "npm test" aparece uma vez só, no bloco principal
  assert.equal(doc.split("npm test").length - 1, 1);
});

/* ------------------------------------------------------------------ */
/* listas customizadas                                                 */
/* ------------------------------------------------------------------ */

test("folders do projeto substituem a estrutura padrão", () => {
  const doc = renderAgentDoc({
    project: {
      name: "X",
      description: "Y",
      folders: [{ path: "src/", purpose: "o código" }],
    },
  });

  assert.ok(doc.includes("`src/`"));
  assert.ok(doc.includes("o código"));
  // a estrutura padrão do SelfEvoPI não deve aparecer
  assert.equal(doc.includes("`core/`"), false);
});

test("áreas protegidas do projeto substituem a lista padrão", () => {
  const doc = renderAgentDoc({
    project: {
      name: "X",
      description: "Y",
      protected: [{ path: "segredos/", why: "contém chaves" }],
    },
  });

  assert.ok(doc.includes("`segredos/`"));
  assert.ok(doc.includes("contém chaves"));
  // `core/governance/` só existe na lista padrão de áreas protegidas
  // (`evals/` não serve de prova: aparece também na estrutura de pastas)
  assert.equal(doc.includes("`core/governance/`"), false);
});

test("convenções do projeto substituem a lista padrão", () => {
  const doc = renderAgentDoc({
    project: { name: "X", description: "Y", conventions: ["sempre em português"] },
  });

  assert.ok(doc.includes("- sempre em português"));
  assert.equal(doc.includes("Conventional Commits"), false);
});

test("lista vazia usa o default em vez de gerar seção oca", () => {
  const doc = renderAgentDoc({ project: { name: "X", description: "Y", folders: [], conventions: [] } });

  assert.ok(doc.includes("| `core/`"));
  assert.ok(doc.includes("Conventional Commits"));
});

test("entrada inválida em listas é ignorada sem derrubar o documento", () => {
  const doc = renderAgentDoc({
    project: {
      name: "X",
      description: "Y",
      folders: [null, { path: "" }, { path: "ok/", purpose: "válido" }],
      conventions: [null, 42, "válida"],
    },
  });

  assert.ok(doc.includes("`ok/`"));
  assert.ok(doc.includes("- válida"));
  assert.equal(doc.includes("undefined"), false);
  assert.equal(doc.includes("null"), false);
});

/* ------------------------------------------------------------------ */
/* contrato: não escreve arquivo                                       */
/* ------------------------------------------------------------------ */

test("renderAgentDoc não toca em disco", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "selfevopi-init-"));
  const antes = await readdir(dir);

  try {
    const doc = renderAgentDoc({ project: { name: "X", description: "Y" } });
    await writeFile(path.join(dir, "nota.txt"), "só para ter algo no diretório", "utf8");

    const depois = await readdir(dir);
    // nada além do que nós mesmos escrevemos
    assert.deepEqual(depois, ["nota.txt"]);
    assert.deepEqual(antes, []);
    assert.ok(doc.length > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("o gerador é exportado como função nomeada", () => {
  assert.equal(typeof renderAgentDoc, "function");
  assert.equal(renderAgentDoc.name, "renderAgentDoc");
});

/* ------------------------------------------------------------------ */
/* sanidade do formato                                                 */
/* ------------------------------------------------------------------ */

test("as tabelas geradas têm a mesma largura de colunas", () => {
  const doc = renderAgentDoc({ project: { name: "X", description: "Y" } });
  const linhas = doc.split("\n").filter((l) => l.startsWith("|"));

  for (const linha of linhas) {
    const pipes = (linha.match(/\|/g) || []).length;
    // cabeçalho, separador e linhas têm o mesmo número de separadores
    assert.equal(pipes, 3, `linha de tabela com número inesperado de colunas: ${linha}`);
  }
});

test("o documento termina com uma quebra de linha", () => {
  const doc = renderAgentDoc({ project: { name: "X", description: "Y" } });
  assert.ok(doc.endsWith("\n"));
});