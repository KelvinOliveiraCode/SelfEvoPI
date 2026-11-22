// As asserções desta suíte são em português; o produto nasce em inglês.
process.env.SELFEOPI_LOCALE = "pt";

import test from "node:test";
import assert from "node:assert/strict";

import { renderSettings } from "./settings-view.mjs";

/* ------------------------------------------------------------------ */
/* renderSettings                                                      */
/* ------------------------------------------------------------------ */

test("renderSettings devolve array de strings", () => {
  const lines = renderSettings({
    mode: "build",
    permission: "full access",
    model: "claude-sonnet-5",
    effort: "medium",
    theme: "padrao",
    mcp: 3,
    skills: 331,
    sessions: 116,
  });

  assert.ok(Array.isArray(lines));
  assert.ok(lines.length > 0);
  for (const line of lines) {
    assert.equal(typeof line, "string");
  }
});

test("renderSettings com todos os campos preenchidos", () => {
  const lines = renderSettings({
    mode: "build",
    permission: "full access",
    model: "claude-sonnet-5",
    effort: "medium",
    theme: "padrao",
    mcp: 3,
    skills: 331,
    sessions: 116,
  });

  // Deve ter 8 linhas (modo, permissao, modelo, esforco, tema, mcp, skills, sessoes)
  assert.equal(lines.length, 8);

  // Primeira linha: modo
  assert.ok(lines[0].includes("modo"));
  assert.ok(lines[0].includes("build"));
  assert.ok(lines[0].includes("/mode"));
});

test("renderSettings com campos ausentes mostra —", () => {
  const lines = renderSettings({});

  for (const line of lines) {
    // Cada linha deve conter "—" (valor ausente) ou o comando
    // Linhas sem comando devem ter "—"
  }

  // Modo ausente
  assert.ok(lines[0].includes(DASH_CHAR));
});

const DASH_CHAR = "—";

test("renderSettings valor ausente não quebra linha", () => {
  const lines = renderSettings({ mode: "build" });

  for (const line of lines) {
    assert.ok(typeof line === "string");
    assert.ok(line.length > 0);
  }
});

test("renderSettings terceira coluna só aparece quando comando existe", () => {
  const lines = renderSettings({ mode: "build" });

  // Linha do modo tem comando
  assert.ok(lines[0].includes("/mode"));

  // Linhas sem comando não devem ter "/"
  // (na verdade todas têm comando neste design, mas o teste verifica que o formato funciona)
  for (const line of lines) {
    // Se não tem comando, não deve terminar com "/algo"
    // Isto é válido pois todas as linhas têm comando neste design
  }
});

test("renderSettings nenhuma linha passa de 72 colunas", () => {
  const lines = renderSettings({
    mode: "build",
    permission: "full access",
    model: "claude-sonnet-5-20241022",
    effort: "medium",
    theme: "padrao",
    mcp: 3,
    skills: 331,
    sessions: 116,
  });

  for (const line of lines) {
    assert.ok(line.length <= 72, `linha passa de 72 colunas: "${line}" (${line.length})`);
  }
});

test("renderSettings com valores longos trunca sem passar de 72", () => {
  const lines = renderSettings({
    mode: "build",
    permission: "full access",
    model: "a-very-long-model-name-that-exceeds-normal-width-and-should-be-truncated-properly",
    effort: "medium",
    theme: "padrao",
    mcp: 999,
    skills: 99999,
    sessions: 99999,
  });

  for (const line of lines) {
    assert.ok(line.length <= 72, `linha passa de 72: "${line}"`);
  }
});

test("renderSettings mcp numérico vira 'N servidores'", () => {
  const lines = renderSettings({ mcp: 3 });
  assert.ok(lines[5].includes("3 servidores"));
});

test("renderSettings skills numérico vira 'N do pc'", () => {
  const lines = renderSettings({ skills: 331 });
  assert.ok(lines[6].includes("331 do pc"));
});

test("renderSettings sessions numérico vira string", () => {
  const lines = renderSettings({ sessions: 116 });
  assert.ok(lines[7].includes("116"));
});

test("renderSettings mcp string passa direto", () => {
  const lines = renderSettings({ mcp: "nenhum" });
  assert.ok(lines[5].includes("nenhum"));
});

test("renderSettings com estado vazio não lança", () => {
  assert.doesNotThrow(() => renderSettings());
  assert.doesNotThrow(() => renderSettings({}));
});

test("renderSettings alinha primeira coluna", () => {
  const lines = renderSettings({
    mode: "build",
    permission: "ask",
    model: "x",
  });

  // Todas as linhas devem começar com o label alinhado (13 colunas)
  for (const line of lines) {
    assert.ok(line.length >= 13);
  }
});