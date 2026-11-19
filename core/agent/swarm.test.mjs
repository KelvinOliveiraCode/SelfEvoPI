import test from "node:test";
import assert from "node:assert/strict";

import {
  planSwarm,
  normalizeResults,
  renderSwarm,
  parseSwarmArgs,
  resolveProvider,
  MAX_SUBAGENTS,
  DEFAULT_SUBAGENTS,
  WIDTH,
} from "./swarm.mjs";

/* ------------------------------------------------------------------ */
/* parseSwarmArgs                                                      */
/* ------------------------------------------------------------------ */

test("parseSwarmArgs: /swarm <tarefa> usa N default", () => {
  const { n, task } = parseSwarmArgs("refatorar o modulo de auth");
  assert.equal(n, DEFAULT_SUBAGENTS);
  assert.equal(task, "refatorar o modulo de auth");
});

test("parseSwarmArgs: /swarm 5 <tarefa> define N", () => {
  const { n, task } = parseSwarmArgs("5 refatorar o modulo de auth");
  assert.equal(n, 5);
  assert.equal(task, "refatorar o modulo de auth");
});

test("parseSwarmArgs: N acima do teto vira teto", () => {
  const { n } = parseSwarmArgs("99 tarefa");
  assert.equal(n, MAX_SUBAGENTS);
});

test("parseSwarmArgs: N zero vira 1", () => {
  const { n } = parseSwarmArgs("0 tarefa");
  assert.equal(n, 1);
});

test("parseSwarmArgs: primeiro token não-numérico fica na tarefa", () => {
  const { n, task } = parseSwarmArgs("abc def ghi");
  assert.equal(n, DEFAULT_SUBAGENTS);
  assert.equal(task, "abc def ghi");
});

test("parseSwarmArgs: vazio dá task vazia e N default", () => {
  const { n, task } = parseSwarmArgs("");
  assert.equal(n, DEFAULT_SUBAGENTS);
  assert.equal(task, "");
});

/* ------------------------------------------------------------------ */
/* resolveProvider                                                     */
/* ------------------------------------------------------------------ */

test("resolveProvider: pedido existente é respeitado", () => {
  const r = resolveProvider({ requested: "kilo2", available: ["kilo1", "kilo2"], index: 0 });
  assert.equal(r.provider, "kilo2");
  assert.equal(r.fallback, null);
});

test("resolveProvider: pedido inexistente cai no primeiro e avisa", () => {
  const r = resolveProvider({ requested: "fantasma", available: ["kilo1", "kilo2"], index: 0 });
  assert.equal(r.provider, "kilo1");
  assert.deepEqual(r.fallback, { from: "fantasma", to: "kilo1" });
});

test("resolveProvider: sem pedido distribui em volta (round-robin)", () => {
  const avail = ["a", "b", "c"];
  assert.equal(resolveProvider({ available: avail, index: 0 }).provider, "a");
  assert.equal(resolveProvider({ available: avail, index: 1 }).provider, "b");
  assert.equal(resolveProvider({ available: avail, index: 2 }).provider, "c");
  assert.equal(resolveProvider({ available: avail, index: 3 }).provider, "a");
});

test("resolveProvider: nenhum provedor configurado dá provider null", () => {
  const r = resolveProvider({ available: [], index: 0 });
  assert.equal(r.provider, null);
});

/* ------------------------------------------------------------------ */
/* planSwarm                                                           */
/* ------------------------------------------------------------------ */

test("planSwarm: cria N subtarefas com ids sequenciais", () => {
  const { subtasks } = planSwarm({
    task: "melhorar a CLI",
    n: 3,
    providers: ["kilo1", "kilo2", "kilo3"],
  });
  assert.equal(subtasks.length, 3);
  assert.deepEqual(subtasks.map((s) => s.id), ["s1", "s2", "s3"]);
});

test("planSwarm: default N é 3", () => {
  const { subtasks } = planSwarm({ task: "x", providers: ["a"] });
  assert.equal(subtasks.length, 3);
});

test("planSwarm: teto de 8 subtarefas", () => {
  const { subtasks } = planSwarm({ task: "x", n: 50, providers: ["a", "b"] });
  assert.equal(subtasks.length, 8);
});

test("planSwarm: distribui provedores em round-robin quando não pede um", () => {
  const { subtasks } = planSwarm({ task: "x", n: 4, providers: ["a", "b"] });
  assert.deepEqual(subtasks.map((s) => s.provider), ["a", "b", "a", "b"]);
});

test("planSwarm: provedor pedido que não existe cai no primeiro e avisa", () => {
  const { subtasks, notices } = planSwarm({
    task: "x",
    n: 2,
    providers: ["kilo1", "kilo2"],
    requested: "fantasma",
  });
  assert.equal(subtasks[0].provider, "kilo1");
  assert.ok(notices.some((n) => n.includes("fantasma") && n.includes("kilo1")));
});

test("planSwarm: escolhe modelo do provedor quando há", () => {
  const models = [
    { provider: "a", id: "a-model-1" },
    { provider: "b", id: "b-model-1" },
  ];
  const { subtasks } = planSwarm({ task: "x", n: 2, providers: ["a", "b"], models });
  assert.equal(subtasks[0].model, "a-model-1");
  assert.equal(subtasks[1].model, "b-model-1");
});

test("planSwarm: sem modelo do provedor, cai no primeiro e avisa", () => {
  const models = [{ provider: "a", id: "a-model-1" }];
  const { subtasks, notices } = planSwarm({ task: "x", n: 1, providers: ["b"], models });
  assert.equal(subtasks[0].model, "a-model-1");
  assert.ok(notices.some((n) => n.includes("b") && n.includes("a-model-1")));
});

test("planSwarm: goal menciona a tarefa e a fatia", () => {
  const { subtasks } = planSwarm({ task: "escrever testes", n: 2, providers: ["a"] });
  assert.match(subtasks[0].goal, /1\/2/);
  assert.match(subtasks[0].goal, /escrever testes/);
});

test("planSwarm: recusa tarefa vazia", () => {
  assert.throws(() => planSwarm({ task: "  ", providers: ["a"] }), /task/);
});

test("planSwarm: determinístico", () => {
  const args = { task: "x", n: 3, providers: ["a", "b", "c"] };
  assert.deepEqual(planSwarm(args), planSwarm(args));
});

/* ------------------------------------------------------------------ */
/* normalizeResults                                                    */
/* ------------------------------------------------------------------ */

test("normalizeResults: separa úteis de falhas", () => {
  const subtasks = [
    { id: "s1", provider: "a", model: "m1" },
    { id: "s2", provider: "b", model: "m2" },
  ];
  const results = [
    { text: "resultado do s1" },
    { error: "timeout" },
  ];
  const { ok, failed } = normalizeResults({ results, subtasks });
  assert.equal(ok.length, 1);
  assert.equal(failed.length, 1);
  assert.equal(ok[0].id, "s1");
  assert.equal(failed[0].id, "s2");
  assert.match(failed[0].reason, /timeout/);
});

test("normalizeResults: resultado vazio vira falha", () => {
  const { ok, failed } = normalizeResults({ results: [{ text: "   " }, { text: "ok" }] });
  assert.equal(ok.length, 1);
  assert.equal(failed.length, 1);
});

test("normalizeResults: string pura é aceita como resultado", () => {
  const { ok } = normalizeResults({ results: ["texto útil"] });
  assert.equal(ok.length, 1);
  assert.equal(ok[0].text, "texto útil");
});

test("normalizeResults: ok:false explícito vira falha mesmo com texto", () => {
  const { ok, failed } = normalizeResults({ results: [{ ok: false, text: "quase" }] });
  assert.equal(ok.length, 0);
  assert.equal(failed.length, 1);
});

test("normalizeResults: síntese cita o subagente e o que ele disse", () => {
  const subtasks = [{ id: "s1", provider: "kilo1", model: "m1" }];
  const { synthesis } = normalizeResults({ results: [{ text: "achei o bug" }], subtasks });
  const joined = synthesis.join("\n");
  assert.match(joined, /s1/);
  assert.match(joined, /kilo1/);
  assert.match(joined, /achei o bug/);
});

test("normalizeResults: síntese menciona falha com motivo", () => {
  const subtasks = [{ id: "s1", provider: "kilo1", model: "m1" }];
  const { synthesis } = normalizeResults({ results: [{ error: "boom" }], subtasks });
  const joined = synthesis.join("\n");
  assert.match(joined, /s1/);
  assert.match(joined, /falhou/);
  assert.match(joined, /boom/);
});

test("normalizeResults: nenhum resultado dá síntese honesta", () => {
  const { synthesis } = normalizeResults({ results: [] });
  assert.ok(synthesis.length >= 1);
  assert.match(synthesis.join("\n"), /nenhum subagente/);
});

test("normalizeResults: cada linha de síntese cabe em 72 colunas", () => {
  const subtasks = [{ id: "s1", provider: "kilo1", model: "m1" }];
  const longText = "a".repeat(500);
  const { synthesis } = normalizeResults({ results: [{ text: longText }], subtasks });
  for (const line of synthesis) {
    assert.ok([...line].length <= WIDTH + 2, `linha longa: ${[...line].length}`);
  }
});

/* ------------------------------------------------------------------ */
/* renderSwarm                                                         */
/* ------------------------------------------------------------------ */

test("renderSwarm: mostra um provedor por linha e o estado", () => {
  const { subtasks } = planSwarm({ task: "x", n: 2, providers: ["kilo1", "kilo2"] });
  const results = normalizeResults({
    results: [{ text: "ok do s1" }, { error: "falhou s2" }],
    subtasks,
  });
  const lines = renderSwarm({ plan: subtasks, results });
  const joined = lines.join("\n");
  assert.match(joined, /s1/);
  assert.match(joined, /kilo1/);
  assert.match(joined, /\[ok\]/);
  assert.match(joined, /\[x\]/);
});

test("renderSwarm: aceita o objeto inteiro de planSwarm (notices viajam no plano)", () => {
  const plan = planSwarm({ task: "x", n: 2, providers: ["kilo1"], requested: "fantasma" });
  const results = normalizeResults({ results: [], subtasks: plan.subtasks });
  // passa `plan` (objeto { subtasks, notices }) direto, sem separar notices
  const joined = renderSwarm({ plan, results }).join("\n");
  assert.match(joined, /fantasma/);
  assert.match(joined, /kilo1/);
});

test("renderSwarm: mostra avisos de fallback", () => {
  const { subtasks, notices } = planSwarm({
    task: "x",
    n: 1,
    providers: ["kilo1"],
    requested: "fantasma",
  });
  const lines = renderSwarm({ plan: subtasks, notices });
  const joined = lines.join("\n");
  assert.match(joined, /fantasma/);
});

test("renderSwarm: todas as linhas <= 72 colunas", () => {
  const { subtasks } = planSwarm({ task: "tarefa longa ".repeat(10), n: 8, providers: ["a", "b"] });
  const results = normalizeResults({ results: subtasks.map(() => ({ text: "x".repeat(300) })), subtasks });
  for (const line of renderSwarm({ plan: subtasks, results, width: 72 })) {
    assert.ok([...line].length <= 72, `estourou: ${[...line].length} -> ${line}`);
  }
});

test("renderSwarm: plano sem resultados mostra pending e o goal", () => {
  const { subtasks } = planSwarm({ task: "planejar", n: 1, providers: ["a"] });
  const lines = renderSwarm({ plan: subtasks });
  const joined = lines.join("\n");
  assert.match(joined, /s1/);
  assert.match(joined, /planejar/);
});

test("renderSwarm: respeita a largura pedida", () => {
  const { subtasks } = planSwarm({ task: "x", n: 2, providers: ["a"] });
  for (const line of renderSwarm({ plan: subtasks, width: 40 })) {
    assert.ok([...line].length <= 40);
  }
});

/* ------------------------------------------------------------------ */
/* Integração leve (sem modelo)                                        */
/* ------------------------------------------------------------------ */

test("fluxo completo: planSwarm -> normalizeResults -> renderSwarm", () => {
  const { subtasks, notices } = planSwarm({
    task: "auditar a CLI",
    n: 3,
    providers: ["kilo1", "kilo2", "kilo3"],
  });
  // simula execução: s1 e s3 voltam, s2 falha
  const results = [
    { text: "s1: revisei os comandos" },
    { error: "modelo fora do ar" },
    { text: "s3: sugeri três melhorias" },
  ];
  const norm = normalizeResults({ results, subtasks });
  assert.equal(norm.ok.length, 2);
  assert.equal(norm.failed.length, 1);

  const lines = renderSwarm({ plan: subtasks, results: norm, notices });
  assert.ok(lines.length >= 3);
  const joined = lines.join("\n");
  assert.match(joined, /auditar|comandos|melhorias/);
  // uma linha por subagente no mínimo (3) + cabeçalho
  assert.ok(lines.length >= 4);
});