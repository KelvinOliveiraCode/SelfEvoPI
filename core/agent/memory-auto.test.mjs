import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { retain, recall, learn, digestSession, redact, hashDoTexto } from "./memory-auto.mjs";

/** Banco temporário único por teste (Windows nativo, sem lixo compartilhado). */
function bancoNovo() {
  return mkdtempSync(join(tmpdir(), "mem-auto-"));
}

test("retain guarda fato com hash e timestamp", () => {
  const banco = bancoNovo();
  const r = retain(banco, { text: "O projeto usa Node puro", scope: "project", source: "teste" });
  assert.equal(r.ok, true);
  assert.equal(r.deduped, false);
  assert.equal(r.entry.text, "O projeto usa Node puro");
  assert.equal(r.entry.scope, "project");
  assert.equal(r.entry.source, "teste");
  assert.match(r.entry.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(typeof r.entry.hash, "string");
  assert.equal(r.entry.hash.length, 16);

  // Está gravado em disco como JSONL.
  const linhas = readFileSync(join(banco, "auto.jsonl"), "utf8").trim().split("\n");
  assert.equal(linhas.length, 1);
  assert.equal(JSON.parse(linhas[0]).text, "O projeto usa Node puro");
});

test("retain não duplica fato com mesmo conteúdo (dedup por hash)", () => {
  const banco = bancoNovo();
  const a = retain(banco, { text: "sempre verificar antes de afirmar" });
  const b = retain(banco, { text: "sempre verificar antes de afirmar" });
  assert.equal(a.deduped, false);
  assert.equal(b.deduped, true);
  assert.equal(a.entry.id, b.entry.id);
  const linhas = readFileSync(join(banco, "auto.jsonl"), "utf8").trim().split("\n");
  assert.equal(linhas.length, 1, "não deve gravar duplicata");
});

test("recall recupera por sobreposição de termos", () => {
  const banco = bancoNovo();
  retain(banco, { text: "o gate de regressão roda evals determinísticos" });
  retain(banco, { text: "a interface usa paleta de bronze e ouro" });
  retain(banco, { text: "sessão nova por padrão, retomada só por pedido" });

  const r = recall(banco, "como funciona o gate");
  assert.equal(r.ok, true);
  assert.ok(r.results.length >= 1);
  assert.equal(r.results[0].text, "o gate de regressão roda evals determinísticos");
  assert.ok(r.results[0].score >= 1);

  // Consulta sem sobreposição -> vazio.
  const vazio = recall(banco, "zzzzz inexistente");
  assert.deepEqual(vazio.results, []);
});

test("recall respeita limite e filtro de escopo", () => {
  const banco = bancoNovo();
  for (let i = 0; i < 5; i++) retain(banco, { text: `fato numero ${i} sobre topico comum`, scope: "project" });
  retain(banco, { text: "fato de sessao sobre topico comum", scope: "session" });

  const limitado = recall(banco, "topico comum", { limit: 2 });
  assert.equal(limitado.results.length, 2);

  const porEscopo = recall(banco, "topico comum", { scope: "session" });
  assert.ok(porEscopo.results.every((r) => r.scope === "session"));
});

test("recall em banco corrompido devolve lista vazia e erro explícito", () => {
  const banco = bancoNovo();
  retain(banco, { text: "fato valido" });
  // Injeta uma linha inválida no JSONL.
  writeFileSync(join(banco, "auto.jsonl"), readFileSync(join(banco, "auto.jsonl"), "utf8") + "{ isto nao e json\n", "utf8");

  const r = recall(banco, "fato");
  assert.equal(r.ok, false);
  assert.deepEqual(r.results, []);
  assert.match(r.error, /corrompido/);
});

test("recall em banco inexistente não lança e devolve vazio", () => {
  const banco = join(bancoNovo(), "nao-existe");
  const r = recall(banco, "qualquer coisa");
  assert.equal(r.ok, true);
  assert.deepEqual(r.results, []);
});

test("learn promove lição durável com rule opcional", () => {
  const banco = bancoNovo();
  const r = learn(banco, { lesson: "falha de modelo pede reconexão", rule: "tente ate cinco vezes" });
  assert.equal(r.ok, true);
  assert.equal(r.entry.kind, "lesson");
  assert.equal(r.entry.scope, "skills");
  assert.equal(r.entry.rule, "tente ate cinco vezes");

  const linhas = readFileSync(join(banco, "lessons.jsonl"), "utf8").trim().split("\n");
  assert.equal(linhas.length, 1);
  assert.equal(JSON.parse(linhas[0]).kind, "lesson");
});

test("learn não duplica lição idêntica", () => {
  const banco = bancoNovo();
  const a = learn(banco, { lesson: "nunca truncar com reticencias" });
  const b = learn(banco, { lesson: "nunca truncar com reticencias" });
  assert.equal(b.deduped, true);
  assert.equal(a.entry.id, b.entry.id);
});

test("learn exige conteúdo", () => {
  const banco = bancoNovo();
  assert.equal(learn(banco, {}).ok, false);
  assert.equal(learn(banco, { lesson: "   " }).ok, false);
});

test("redact remove chaves, tokens, senhas e e-mails", () => {
  assert.equal(redact("minha chave é sk-abcdef1234567890"), "minha chave é [chave redigida]");
  assert.match(redact("Authorization: Bearer abc123XYZ"), /Bearer \[redigido\]/);
  assert.match(redact("api_key = segredo123"), /api_key = \[redigido\]/);
  assert.match(redact("fale com maria@exemplo.com"), /\[email redigido\]/);
  assert.match(redact("token: " + "a".repeat(40)), /\[redigido\]/);
});

test("retain redige segredo antes de gravar", () => {
  const banco = bancoNovo();
  const r = retain(banco, { text: "contato do dev é dev@empresa.com e chave sk-999988887777" });
  assert.equal(r.ok, true);
  assert.ok(!r.entry.text.includes("sk-999988887777"), "chave não pode ser gravada");
  assert.ok(!r.entry.text.includes("dev@empresa.com"), "e-mail não pode ser gravado");
  assert.ok(r.entry.text.includes("[chave redigida]"));
  assert.ok(r.entry.text.includes("[email redigido]"));
});

test("digestSession resume sessão em poucos fatos", () => {
  const banco = bancoNovo();
  const mensagens = [
    { role: "user", content: "Preciso que o gate rode evals antes de promover. Isso é regra do projeto." },
    { role: "assistant", content: "Entendido. Vou rodar os evals primeiro e só promover se passar." },
    { role: "user", content: "Ok. E lembre: nunca devemos truncar saída com reticencias." },
    { role: "assistant", content: "Concordo, vou quebrar linha em vez de cortar." },
  ];
  const r = digestSession(banco, mensagens, { maxFacts: 2 });
  assert.equal(r.ok, true);
  assert.ok(r.count >= 1 && r.count <= 2);
  // O fato com marcador de decisão deve estar entre os escolhidos.
  const textos = r.facts.map((f) => f.text.toLowerCase());
  assert.ok(textos.some((t) => t.includes("regra") || t.includes("nunca")));
  // Ficaram gravados no banco.
  const gravados = recall(banco, "regra truncar gate");
  assert.equal(gravados.ok, true);
});

test("digestSession aceita mensagens string e rejeita entrada não-array", () => {
  const banco = bancoNovo();
  const ok = digestSession(banco, ["sempre testar antes de commitar no repositorio"]);
  assert.equal(ok.ok, true);
  assert.ok(ok.count >= 1);
  assert.equal(digestSession(banco, "não é array").ok, false);
});

test("digestSession não retém conversa fiada do assistente como fato", () => {
  const banco = bancoNovo();
  const r = digestSession(banco, [
    { role: "assistant", content: "Entendido, vou aplicar isso agora mesmo." },
    { role: "assistant", content: "Concordo plenamente com a sua ideia." },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.count, 0, "confirmação do assistente não é fato durável");
});

test("funções nunca lançam com entrada inválida", () => {
  const banco = bancoNovo();
  assert.equal(retain(banco, {}).ok, false);
  assert.equal(retain(banco, { text: 123 }).ok, false);
  assert.doesNotThrow(() => recall(banco, null));
  assert.doesNotThrow(() => retain(null, { text: "x" }));
});

test("hashDoTexto é estável e normaliza caixa e espaços", () => {
  assert.equal(hashDoTexto("Sempre Testar"), hashDoTexto("  sempre   testar  "));
  assert.equal(hashDoTexto("a").length, 16);
});