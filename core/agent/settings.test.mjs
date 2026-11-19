import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { collectSettings, applySetting } from "./settings.mjs";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function makeRoot() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "selfevopi-settings-"));
  // Cria estrutura mínima
  writeFileSync(path.join(dir, ".pi-settings-placeholder"), "");
  return dir;
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

/* ------------------------------------------------------------------ */
/* collectSettings                                                     */
/* ------------------------------------------------------------------ */

test("collectSettings com config mínima devolve grupos", () => {
  const root = makeRoot();
  try {
    const result = collectSettings({ root, state: {} });
    assert.ok(result.groups.length >= 3, "deve ter pelo menos 3 grupos");
    const names = result.groups.map((g) => g.name);
    assert.ok(names.includes("Conversa"));
    assert.ok(names.includes("Sessão"));
    assert.ok(names.includes("Harness"));
  } finally {
    cleanup(root);
  }
});

test("collectSettings com estado preenchido reflete valores", () => {
  const root = makeRoot();
  try {
    const result = collectSettings({
      root,
      state: {
        model: "kilo1/nemotron-3-ultra:free",
        mode: "build",
        permissionMode: "auto",
        sessionId: "abc123",
        turns: 5,
        tokens: 1500,
        costUsd: 0.05,
      },
    });

    const conv = result.groups.find((g) => g.name === "Conversa");
    const modelEntry = conv.entries.find((e) => e.key === "conversation.model");
    assert.equal(modelEntry.value, "kilo1/nemotron-3-ultra:free");

    const sess = result.groups.find((g) => g.name === "Sessão");
    const turnsEntry = sess.entries.find((e) => e.key === "session.turns");
    assert.equal(turnsEntry.value, 5);
  } finally {
    cleanup(root);
  }
});

test("collectSettings não expõe campos sensíveis", () => {
  const root = makeRoot();
  try {
    const result = collectSettings({
      root,
      state: { apiKey: "sk-secret123", token: "tok_abc" },
    });

    // Procura por qualquer entrada que might ser sensível
    const allEntries = result.groups.flatMap((g) => g.entries);
    for (const entry of allEntries) {
      if (entry.key.includes("apiKey") || entry.key.includes("token")) {
        assert.ok(
          entry.value === "configurado" || entry.value === "não configurado",
          `campo sensível ${entry.key} não deve vazar valor real, veio: ${entry.value}`
        );
      }
    }
  } finally {
    cleanup(root);
  }
});

test("collectSettings marca campos readOnly", () => {
  const root = makeRoot();
  try {
    const result = collectSettings({ root, state: {} });
    const allEntries = result.groups.flatMap((g) => g.entries);

    const readOnlyEntries = allEntries.filter((e) => e.readOnly === true);
    assert.ok(readOnlyEntries.length > 0, "deve haver campos readOnly");

    const sessionEntries = allEntries.filter((e) => e.key.startsWith("session."));
    for (const e of sessionEntries) {
      assert.equal(e.readOnly, true, `session.${e.key} deve ser readOnly`);
    }
  } finally {
    cleanup(root);
  }
});

/* ------------------------------------------------------------------ */
/* applySetting                                                        */
/* ------------------------------------------------------------------ */

test("applySetting válido persiste em settings.json", () => {
  const root = makeRoot();
  try {
    // Cria .pi/settings.json
    const piDir = path.join(root, ".pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(path.join(piDir, "settings.json"), "{}", "utf8");

    const result = applySetting({ root, key: "conversation.model", value: "kilo1/test:free" });
    assert.equal(result.ok, true);
    assert.equal(result.applied, true);
    assert.equal(result.value, "kilo1/test:free");

    // Verifica persistência
    const saved = JSON.parse(readFileSync(path.join(piDir, "settings.json"), "utf8"));
    assert.equal(saved["conversation.model"], "kilo1/test:free");
  } finally {
    cleanup(root);
  }
});

test("applySetting inválido (enum) rejeita", () => {
  const root = makeRoot();
  try {
    const result = applySetting({ root, key: "conversation.mode", value: "invalid_mode" });
    assert.equal(result.ok, false);
    assert.equal(result.applied, false);
    assert.ok(result.error.includes("inválido"));
  } finally {
    cleanup(root);
  }
});

test("applySetting inválido (número) rejeita", () => {
  const root = makeRoot();
  try {
    const result = applySetting({ root, key: "session.turns", value: "abc" });
    // session.turns é readOnly, então deve falhar por readOnly antes de validar número
    assert.equal(result.ok, false);
    assert.equal(result.applied, false);
  } finally {
    cleanup(root);
  }
});

test("applySetting campo sensível é recusado", () => {
  const root = makeRoot();
  try {
    // apiKey não está no schema, mas o sistema deve recusar por ser sensível
    const result = applySetting({ root, key: "apiKey", value: "sk-new" });
    assert.equal(result.ok, false);
    assert.equal(result.applied, false);
    // Deve conter "sensível" ou "desconhecida" — ambos são recusas válidas
    assert.ok(
      result.error.includes("sensível") || result.error.includes("desconhecida"),
      `erro deve mencionar sensível ou desconhecida, veio: ${result.error}`
    );
  } finally {
    cleanup(root);
  }
});

test("applySetting campo readOnly é recusado", () => {
  const root = makeRoot();
  try {
    const result = applySetting({ root, key: "session.turns", value: 10 });
    assert.equal(result.ok, false);
    assert.equal(result.applied, false);
    assert.ok(result.error.includes("leitura"));
  } finally {
    cleanup(root);
  }
});

test("applySetting chave desconhecida rejeita", () => {
  const root = makeRoot();
  try {
    const result = applySetting({ root, key: "nonexistent.key", value: "x" });
    assert.equal(result.ok, false);
    assert.equal(result.applied, false);
    assert.ok(result.error.includes("desconhecida"));
  } finally {
    cleanup(root);
  }
});

test("applySetting sem root/key rejeita", () => {
  const result = applySetting({ key: "conversation.model", value: "x" });
  assert.equal(result.ok, false);
  assert.equal(result.applied, false);

  const result2 = applySetting({ root: "/tmp", value: "x" });
  assert.equal(result2.ok, false);
  assert.equal(result2.applied, false);
});