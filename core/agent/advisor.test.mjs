import test from "node:test";
import assert from "node:assert/strict";
import {
  parseNotes, formatNote, shouldInterrupt, observeTurn, compilarRegras, verificarStream,
} from "./advisor.mjs";

test("parseNotes classifica NOTE/CONCERN/BLOCKER e ignora linhas soltas", () => {
  const notas = parseNotes([
    "texto sem marcador",
    "NOTE: considere usar Arc",
    "CONCERN: isso quebra o critério",
    "BLOCKER: não faça isso",
  ].join("\n"));
  assert.deepEqual(notas.map((n) => n.severity), ["note", "concern", "blocker"]);
  assert.match(notas[0].text, /Arc/);
});

test("formatNote cabe em 72 colunas e não usa reticências", () => {
  const nota = { severity: "concern", text: "essa correção não atende o critério literal de aceitação do usuário porque o escopo do catch ficou amplo demais e engole erros" };
  const linhas = formatNote(nota).split("\n");
  assert.ok(linhas.every((l) => l.length <= 72), JSON.stringify(linhas));
  assert.ok(!formatNote(nota).includes("…"));
});

test("shouldInterrupt só interrompe em blocker e respeita allowBlock", () => {
  const notas = parseNotes("NOTE: ok\nBLOCKER: pare");
  assert.equal(shouldInterrupt(notas), true);
  assert.equal(shouldInterrupt(notas, { allowBlock: false }), false);
  assert.equal(shouldInterrupt([{ severity: "concern" }]), false);
});

test("observTurn usa revisor injetado e sobrevive a timeout", async () => {
  const ok = await observeTurn({ user: "oi", assistant: "ola" }, async (p) => {
    assert.equal(p.user, "oi");
    return "NOTE: revisado";
  });
  assert.equal(ok.length, 1);
  const lento = await observeTurn({}, () => new Promise((r) => setTimeout(r, 500)), { timeoutMs: 50 });
  assert.deepEqual(lento, []);
  assert.deepEqual(await observeTurn({}, null), []);
});

test("compilarRegras descarta regex inválida e normaliza action", () => {
  const regras = compilarRegras([
    { name: "ruim", pattern: "[" },
    { name: "bom", pattern: "Box::leak", note: "use Arc", action: "abort" },
    { name: "aviso", pattern: /TODO/i, action: "warn" },
  ]);
  assert.equal(regras.length, 2);
  assert.equal(regras[0].action, "abort");
  assert.equal(regras[1].action, "warn");
});

test("verificarStream pega padrão que cruza deltas", () => {
  const regras = compilarRegras([{ name: "vazamento", pattern: "Box::leak", note: "use Arc" }]);
  let carry = "";
  let r = verificarStream(regras, "vou usar Box:", carry);
  assert.equal(r.rule, null);
  carry = r.carry;
  r = verificarStream(regras, ":leak aqui", carry);
  assert.ok(r.rule, "deveria detectar o padrão cruzando o delta");
  assert.equal(r.rule.name, "vazamento");
});

test("verificarStream sem regra válida devolve rule null", () => {
  const r = verificarStream([], "qualquer coisa");
  assert.equal(r.rule, null);
  assert.ok(typeof r.carry === "string");
});
