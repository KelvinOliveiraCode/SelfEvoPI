import test from "node:test";
import assert from "node:assert/strict";

import { specifyGap, heuristicRequest, buildSpecPrompt, extractJson } from "./specify.mjs";
import { ARTIFACT_KINDS } from "./contract.mjs";

const GAP = {
  kind: "tool-failing",
  taskId: "D1-cria-soma",
  capability: "ferramenta confiável para D1-cria-soma",
  goal: "tornar confiável a tarefa D1-cria-soma que falhou 4 vezes",
  evidence: ["D1-cria-soma@2026-11-15T22:16:08Z", "D1-cria-soma@2026-11-15T22:19:56Z"],
  meta: { failures: 4, runs: 15, threshold: 3 },
};

const CONTRATO_JSON = {
  goal: "somar dois números",
  kind: "cli",
  inputs: { a: "primeiro número", b: "segundo número" },
  outputs: { soma: "a + b" },
  permissions: [],
  forbidden: ["acessar rede"],
  tests: [{ name: "soma", command: "node cli.mjs --a 2 --b 2", expect: '"soma"' }],
};

test("heuristicRequest produz uma skill válida, sem inventar interface", () => {
  const req = heuristicRequest(GAP);
  assert.equal(req.kind, "skill");
  assert.deepEqual(req.inputs, {}, "skill não tem entradas — não inventa flags");
  assert.deepEqual(req.outputs, {});
  assert.ok(req.forbidden.length > 0, "forbidden nunca vazio");
  assert.ok(req.tests.length > 0, "sempre há ao menos um teste");
});

test("heuristicRequest recusa lacuna sem objetivo", () => {
  assert.throws(() => heuristicRequest({ kind: "tool-missing", taskId: "X" }), /goal nem capability/);
});

test("buildSpecPrompt leva a lacuna, a evidência e o formato", () => {
  const p = buildSpecPrompt({ gap: GAP, context: { arquivo: "slugify.mjs" } });
  assert.match(p, /D1-cria-soma/);
  assert.match(p, /tool-failing/);
  assert.match(p, /D1-cria-soma@2026-11-15T22:16:08Z/);
  assert.match(p, /slugify\.mjs/);
  assert.ok(ARTIFACT_KINDS.every((k) => p.includes(k)), "todos os kinds aparecem no formato");
  assert.match(p, /forbidden NUNCA pode ser vazio/);
});

test("extractJson aceita fences, texto ao redor e JSON puro", () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('claro:\n{"a":2}\npronto'), { a: 2 });
  assert.deepEqual(extractJson('{"a":3}'), { a: 3 });
  assert.equal(extractJson("não é json"), null);
});

test("specifyGap usa o contrato do modelo quando ele é válido", async () => {
  const res = await specifyGap({
    gap: GAP,
    runModel: async () => ({ text: JSON.stringify(CONTRATO_JSON) }),
  });
  assert.equal(res.basis, "model");
  assert.equal(res.request.kind, "cli");
  assert.deepEqual(res.request.inputs, { a: "primeiro número", b: "segundo número" });
});

test("specifyGap cai para skill quando não há modelo", async () => {
  const res = await specifyGap({ gap: GAP });
  assert.equal(res.basis, "heuristic");
  assert.equal(res.request.kind, "skill");
  assert.match(res.notes[0], /sem modelo/);
});

test("specifyGap cai para skill quando o modelo devolve lixo", async () => {
  const res = await specifyGap({ gap: GAP, runModel: async () => ({ text: "não sei" }) });
  assert.equal(res.basis, "heuristic");
  assert.equal(res.request.kind, "skill");
  assert.match(res.notes.join(" "), /JSON inválido/);
});

test("specifyGap cai para skill quando o contrato do modelo é inválido", async () => {
  const res = await specifyGap({
    gap: GAP,
    // kind inexistente: createArtifactRequest rejeita
    runModel: async () => ({ text: JSON.stringify({ ...CONTRATO_JSON, kind: " mágico" }) }),
  });
  assert.equal(res.basis, "heuristic");
  assert.equal(res.request.kind, "skill");
  assert.match(res.notes.join(" "), /contrato inválido/);
});

test("specifyGap com allowHeuristic:false propaga o erro em vez de mascarar", async () => {
  await assert.rejects(
    () => specifyGap({ gap: GAP, runModel: async () => ({ text: "lixo" }), allowHeuristic: false }),
    (err) => err.code === "no-code-block",
  );
  await assert.rejects(
    () => specifyGap({ gap: GAP, allowHeuristic: false }),
    (err) => err.code === "no-model",
  );
});

test("specifyGap não inventa: o pedido do modelo é devolvido como está", async () => {
  const res = await specifyGap({
    gap: GAP,
    runModel: async () => ({ text: JSON.stringify(CONTRATO_JSON) }),
  });
  assert.equal(res.request.goal, CONTRATO_JSON.goal);
  assert.deepEqual(res.request.forbidden, CONTRATO_JSON.forbidden);
  assert.equal(res.request.tests[0].command, CONTRATO_JSON.tests[0].command);
});

test("o prompt não vaza a lacuna inteira: evidência limitada a 6", () => {
  const gap = { ...GAP, evidence: Array.from({ length: 20 }, (_, i) => `ev${i}`) };
  const p = buildSpecPrompt({ gap });
  assert.ok(!p.includes("ev6"), "evidência além da 6ª não entra");
  assert.ok(p.includes("ev5"));
});