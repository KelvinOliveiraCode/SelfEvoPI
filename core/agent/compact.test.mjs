import test from "node:test";
import assert from "node:assert/strict";

import { compactHistory, estimateTokens, MARKER } from "./compact.mjs";

/** Mensagem sintética longa o bastante para ter meio cortável. */
function msg(role, text) {
  return { role, content: text };
}

function longText(units) {
  return Array.from({ length: units }, (_, i) => `palavra${i}`).join(" ");
}

test("estimateTokens é determinístico e cresce com o texto", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.ok(estimateTokens("a".repeat(400)) > estimateTokens("a".repeat(40)));
});

test("abaixo do teto: não faz nada, removed 0", () => {
  const messages = [msg("user", "oi"), msg("assistant", "olá")];
  const r = compactHistory(messages, { maxTokens: 100_000, keepLast: 6 });
  assert.equal(r.removed, 0);
  assert.equal(r.tokensBefore, r.tokensAfter);
  assert.deepEqual(r.messages, messages); // intactas
});

test("acima do teto: preserva as últimas keepLast intactas", () => {
  const messages = [
    msg("user", longText(200)),
    msg("assistant", longText(200)),
    msg("user", "última 1"),
    msg("assistant", "última 2"),
  ];
  const r = compactHistory(messages, { maxTokens: 20, keepLast: 2 });
  // as duas últimas intactas
  assert.deepEqual(r.messages.slice(-2), messages.slice(-2));
  // tokensAfter <= tokensBefore
  assert.ok(r.tokensAfter <= r.tokensBefore);
  // removed > 0 (houve compactação)
  assert.ok(r.removed > 0);
});

test("acima do teto: as anteriores são resumidas com marcador", () => {
  const messages = [
    msg("user", longText(100)), // longa, deve ser resumida
    msg("assistant", "curta"), // curta, pode ficar inteira
    msg("user", "final"),
  ];
  const r = compactHistory(messages, { maxTokens: 200, keepLast: 1 });
  const first = r.messages[0];
  const text = typeof first === "string" ? first : first.content;
  // a mensagem longa foi resumida e contém o marcador
  assert.ok(text.includes(MARKER), "mensagem longa deve conter o marcador [cut]");
  // começa e termina com conteúdo (início/fim preservados)
  assert.ok(text.startsWith("palavra0"));
});

test("remove as resumidas mais antigas até caber no teto", () => {
  const messages = [
    msg("user", longText(400)),
    msg("assistant", longText(400)),
    msg("user", longText(400)),
    msg("assistant", "última"),
  ];
  const r = compactHistory(messages, { maxTokens: 5, keepLast: 1 });
  assert.ok(r.tokensAfter <= 5, `tokensAfter=${r.tokensAfter} deve caber no teto`);
});

test("determinístico: mesma entrada, mesma saída", () => {
  const messages = [msg("user", longText(200)), msg("assistant", longText(200)), msg("user", "fim")];
  const a = compactHistory(messages, { maxTokens: 20, keepLast: 1 });
  const b = compactHistory(messages, { maxTokens: 20, keepLast: 1 });
  assert.deepEqual(a.messages, b.messages);
  assert.equal(a.removed, b.removed);
  assert.equal(a.tokensAfter, b.tokensAfter);
});

test("keepLast maior que o histórico: nada a resumir", () => {
  const messages = [msg("user", longText(300)), msg("assistant", longText(300))];
  const r = compactHistory(messages, { maxTokens: 10, keepLast: 10 });
  assert.deepEqual(r.messages, messages); // nada resumido
  assert.equal(r.removed, 0);
});

test("recusa entrada inválida", () => {
  assert.throws(() => compactHistory("não é array", { maxTokens: 100 }), /precisa ser um array/);
  assert.throws(() => compactHistory([], { maxTokens: -1 }), /maxTokens/);
  assert.throws(() => compactHistory([], {}), /maxTokens/);
});

test("mensagens string são aceitas", () => {
  const messages = [longText(200), longText(200), "fim"];
  const r = compactHistory(messages, { maxTokens: 10, keepLast: 1 });
  assert.equal(r.messages[r.messages.length - 1], "fim");
  assert.ok(r.tokensAfter <= r.tokensBefore);
});

test("tokensAfter <= tokensBefore sempre", () => {
  const messages = Array.from({ length: 10 }, (_, i) => msg("user", longText(100 + i)));
  const r = compactHistory(messages, { maxTokens: 30, keepLast: 3 });
  assert.ok(r.tokensAfter <= r.tokensBefore);
});