import test from "node:test";
import assert from "node:assert/strict";

import { rewindSession, rewindReport, summarizeSession } from "./rewind.mjs";

/* ------------------------------------------------------------------ */
/* Fixtures no formato JSONL real do motor                             */
/* ------------------------------------------------------------------ */

function cabecalho() {
  return { type: "session", version: 3, id: "sessao-teste" };
}

function titulo() {
  return { type: "title", v: 1, title: "" };
}

function contexto(type, id, parentId) {
  return { type, id, parentId };
}

function msg(role, texto, { id, parentId, stopReason } = {}) {
  const message = { role, content: [{ type: "text", text: texto }] };
  if (stopReason) message.stopReason = stopReason;
  const evento = { type: "message", message };
  if (id) evento.id = id;
  if (parentId) evento.parentId = parentId;
  return evento;
}

function jsonl(eventos) {
  return eventos.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

function linhas(texto) {
  return texto.split(/\r?\n/).filter((l) => l.trim() !== "");
}

function selecao(texto) {
  return linhas(texto).map((l) => JSON.parse(l));
}

/* ------------------------------------------------------------------ */
/* Sessão vazia                                                        */
/* ------------------------------------------------------------------ */

test("sessão vazia: nada a recortar e resumo zerado", () => {
  const r = rewindSession("", { dropErrors: true });
  assert.deepEqual(r, { ok: true, jsonl: "", removidas: 0, motivo: "sem-mudanca" });
  assert.deepEqual(summarizeSession(""), { mensagens: 0, erros: 0, ultimoUsuario: null });
  assert.deepEqual(summarizeSession(null), { mensagens: 0, erros: 0, ultimoUsuario: null });

  const nulo = rewindSession(null, { keepLast: 1 });
  assert.equal(nulo.ok, true);
  assert.equal(nulo.jsonl, "");
  assert.equal(rewindReport(0, "sem-mudanca"), "Rewind: nada a remover.");
});

/* ------------------------------------------------------------------ */
/* dropErrors                                                         */
/* ------------------------------------------------------------------ */

test("dropErrors remove 2 erros e só o contexto ligado, na ordem", () => {
  const eventos = [
    cabecalho(),
    contexto("model_change", "m1", null),
    msg("user", "pergunta 1", { id: "u1", parentId: "m1" }),
    msg("assistant", "", { id: "e1", parentId: "u1", stopReason: "error" }),
    contexto("context_edit", "c1", "e1"),
    msg("assistant", "resposta 1", { id: "a1", parentId: "c1" }),
    msg("user", "pergunta 2", { id: "u2", parentId: "a1" }),
    msg("assistant", "", { id: "e2", parentId: "u2", stopReason: "aborted" }),
    contexto("thinking_level_change", "t1", "e2"),
    msg("user", "pergunta 3", { id: "u3", parentId: "t1" }),
    msg("assistant", "resposta final", { id: "a2", parentId: "u3" }),
  ];
  const texto = jsonl(eventos);

  const resumo = summarizeSession(texto);
  assert.equal(resumo.mensagens, 7);
  assert.equal(resumo.erros, 2);
  assert.equal(resumo.ultimoUsuario, "pergunta 3");

  const r = rewindSession(texto, { dropErrors: true });
  assert.equal(r.ok, true);
  assert.equal(r.removidas, 4); // 2 erros + 2 contextos ligados
  assert.equal(r.motivo, "erros");

  const restantes = selecao(r.jsonl);
  assert.deepEqual(
    restantes.map((e) => e.id ?? e.type),
    ["sessao-teste", "m1", "u1", "a1", "u2", "u3", "a2"],
  );
  assert.equal(restanteTipo(restantes, "session"), 1, "cabeçalho preservado uma vez");
  assert.deepEqual(
    restantes.filter((e) => e.type === "message").map((e) => e.message.role),
    ["user", "assistant", "user", "user", "assistant"],
  );
  assert.ok(!r.jsonl.includes('"stopReason":"error"'));
  assert.ok(!r.jsonl.includes('"stopReason":"aborted"'));
  assert.equal(summarizeSession(r.jsonl).erros, 0);
});

function restanteTipo(eventos, tipo) {
  return eventos.filter((e) => e.type === tipo).length;
}

test("dropErrors não remove erro de stopReason normal", () => {
  const texto = jsonl([
    cabecalho(),
    msg("user", "oi", { id: "u1" }),
    msg("assistant", "ok", { id: "a1", parentId: "u1", stopReason: "stop" }),
  ]);
  const r = rewindSession(texto, { dropErrors: true });
  assert.equal(r.ok, true);
  assert.equal(r.removidas, 0);
  assert.equal(r.jsonl, texto);
});

/* ------------------------------------------------------------------ */
/* keepLast / beforeMessageId                                         */
/* ------------------------------------------------------------------ */

function conversaTresTurnos() {
  return [
    cabecalho(),
    contexto("model_change", "m1", null),
    msg("user", "u1", { id: "u1", parentId: "m1" }),
    msg("assistant", "a1", { id: "a1", parentId: "u1" }),
    msg("user", "u2", { id: "u2", parentId: "a1" }),
    msg("assistant", "a2", { id: "a2", parentId: "u2" }),
    msg("user", "u3", { id: "u3", parentId: "a2" }),
    msg("assistant", "a3", { id: "a3", parentId: "u3" }),
  ];
}

test("keepLast mantém as últimas N mensagens do usuário", () => {
  const texto = jsonl(conversaTresTurnos());
  const r = rewindSession(texto, { keepLast: 2 });

  assert.equal(r.ok, true);
  assert.equal(r.removidas, 3); // m1, u1, a1
  assert.equal(r.motivo, "manter-ultimos");

  const restantes = selecao(r.jsonl);
  assert.deepEqual(
    restantes.map((e) => e.id ?? e.type),
    ["sessao-teste", "u2", "a2", "u3", "a3"],
  );
  assert.equal(summarizeSession(r.jsonl).ultimoUsuario, "u3");
});

test("keepLast com 0 mantém só os metadados de abertura", () => {
  const eventos = [titulo(), ...conversaTresTurnos()];
  const r = rewindSession(jsonl(eventos), { keepLast: 0 });
  assert.equal(r.removidas, 7);
  assert.deepEqual(selecao(r.jsonl).map((e) => e.type), ["title", "session"]);
});

test("beforeMessageId remove só o que vem antes do alvo", () => {
  const texto = jsonl(conversaTresTurnos());
  const r = rewindSession(texto, { beforeMessageId: "a2" });

  assert.equal(r.ok, true);
  assert.equal(r.removidas, 4); // m1, u1, a1, u2
  assert.equal(r.motivo, "antes-de");
  assert.deepEqual(
    selecao(r.jsonl).map((e) => e.id ?? e.type),
    ["sessao-teste", "a2", "u3", "a3"],
  );
});

test("beforeMessageId ausente falha sem alterar nada", () => {
  const texto = jsonl(conversaTresTurnos());
  const r = rewindSession(texto, { beforeMessageId: "nao-existe" });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "id-ausente");
  assert.equal(r.removidas, 0);
  assert.equal(r.jsonl, texto);
});

/* ------------------------------------------------------------------ */
/* Nenhuma mudança / opções inválidas                                  */
/* ------------------------------------------------------------------ */

test("nenhuma mudança devolve o texto original intacto", () => {
  const texto = jsonl(conversaTresTurnos());
  for (const opcoes of [{ keepLast: 10 }, { dropErrors: true }, { keepLast: 3 }]) {
    const r = rewindSession(texto, opcoes);
    assert.equal(r.ok, true);
    assert.equal(r.jsonl, texto);
    assert.equal(r.removidas, 0);
    assert.equal(r.motivo, "sem-mudanca");
  }
});

test("sem opção de corte ou keepLast inválido falha de forma explícita", () => {
  const texto = jsonl(conversaTresTurnos());
  for (const opcoes of [{}, { keepLast: -1 }, { keepLast: "dois" }]) {
    const r = rewindSession(texto, opcoes);
    assert.equal(r.ok, false);
    assert.equal(r.motivo, "sem-opcao");
    assert.equal(r.jsonl, texto);
  }
});

/* ------------------------------------------------------------------ */
/* Linha corrompida                                                    */
/* ------------------------------------------------------------------ */

test("linha corrompida é ignorada, preservada e nunca quebra o recorte", () => {
  const quebrada = "{ isto nao é json }";
  const eventos = conversaTresTurnos();
  const texto =
    [
      JSON.stringify(eventos[0]),
      JSON.stringify(eventos[1]),
      JSON.stringify(eventos[2]),
      quebrada, // entre a1 e u2, crua (não passa por JSON.stringify)
      ...eventos.slice(3).map((e) => JSON.stringify(e)),
    ].join("\n") + "\n";

  assert.doesNotThrow(() => rewindSession(texto, { dropErrors: true }));

  const r = rewindSession(texto, { keepLast: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.removidas, 5, "linha corrompida não entra na contagem");
  assert.ok(linhas(r.jsonl).includes(quebrada), "linha corrompida preservada");

  for (const linha of linhas(r.jsonl)) {
    if (linha === quebrada) continue;
    assert.doesNotThrow(() => JSON.parse(linha), "toda linha válida continua JSON completo");
  }
  const limpas = linhas(r.jsonl)
    .filter((l) => l !== quebrada)
    .join("\n");
  assert.equal(selecao(limpas).length, 3);
});

/* ------------------------------------------------------------------ */
/* Cabeçalho, ordem e finais de linha                                  */
/* ------------------------------------------------------------------ */

test("preserva title, cabeçalho e CRLF do arquivo real", () => {
  const eventos = [titulo(), cabecalho(), ...conversaTresTurnos().slice(1)];
  const texto = eventos.map((e) => JSON.stringify(e)).join("\r\n") + "\r\n";
  const r = rewindSession(texto, { keepLast: 1 });

  assert.ok(r.jsonl.includes("\r\n"), " mantém CRLF");
  assert.ok(
    r.jsonl.startsWith(JSON.stringify(titulo()) + "\r\n" + JSON.stringify(cabecalho()) + "\r\n"),
    "título e cabeçalho continuam no início e em ordem",
  );
  assert.equal(r.removidas, 5);
});

/* ------------------------------------------------------------------ */
/* Relatório                                                          */
/* ------------------------------------------------------------------ */

test("relatório é português, cabe em 72 colunas e não usa reticências", () => {
  const motivos = [
    "erros",
    "manter-ultimos",
    "antes-de",
    "id-ausente",
    "sem-opcao",
    "sem-mudanca",
    "motivo.desconhecido.com.reticencias...e-mais",
    "x".repeat(200),
  ];
  for (const motivo of motivos) {
    for (const n of [0, 1, 2, 25]) {
      const texto = rewindReport(n, motivo);
      assert.ok(texto.length > 0);
      for (const linha of texto.split("\n")) {
        assert.ok(linha.length > 0, "sem linha vazia");
        assert.ok(linha.length <= 72, `linha com ${linha.length} colunas: ${linha}`);
        assert.ok(!linha.includes("…") && !linha.includes("..."), "sem reticências");
      }
    }
  }
});

test("relatório concorda com o número e o motivo do recorte", () => {
  assert.equal(rewindReport(1, "erros"), "Rewind: 1 evento removido por erros.");
  assert.match(rewindReport(2, "erros"), /^Rewind: 2 eventos removidos por erros\.$/);
  assert.match(rewindReport(3, "manter-ultimos"), /mantém|manter os últimos/);
  assert.match(rewindReport(1, "id-ausente"), /não encontrado/);

  const r = rewindSession(jsonl(conversaTresTurnos()), { keepLast: 2 });
  const relatorio = rewindReport(r.removidas, r.motivo);
  assert.equal(relatorio, "Rewind: 3 eventos removidos para manter os últimos.");
});
