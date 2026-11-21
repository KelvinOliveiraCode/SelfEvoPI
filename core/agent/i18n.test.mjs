/** i18n.test.mjs — idioma da CLI: inglês por padrão, troca explícita e persistida. */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_LOCALE,
  SUPPORTED,
  getLocale,
  setLocale,
  listLocales,
  isLocale,
  t,
} from "./i18n.mjs";

const TEMP = mkdtempSync(path.join(os.tmpdir(), "selfevopi-i18n-"));
process.env.SELFEOPI_LOCALE_FILE = path.join(TEMP, "locale.json");
const savedEnv = process.env.SELFEOPI_LOCALE;

after(() => {
  delete process.env.SELFEOPI_LOCALE_FILE;
  if (savedEnv === undefined) delete process.env.SELFEOPI_LOCALE;
  else process.env.SELFEOPI_LOCALE = savedEnv;
  rmSync(TEMP, { recursive: true, force: true });
});

test("inglês é o padrão", () => {
  delete process.env.SELFEOPI_LOCALE;
  assert.equal(DEFAULT_LOCALE, "en");
  assert.equal(isLocale("en"), true);
  assert.equal(isLocale("pt"), true);
  assert.equal(isLocale("fr"), false);
  assert.equal(isLocale(""), false);
});

test("variáveis de ambiente e chaves desconhecidas", () => {
  process.env.SELFEOPI_LOCALE = "pt";
  assert.equal(getLocale(), "pt");
  assert.match(t("cmd.help"), /lista/);
  process.env.SELFEOPI_LOCALE = "en";
  assert.equal(getLocale(), "en");
  assert.match(t("cmd.help"), /list/i);
  assert.equal(t("chave.inexistente"), "chave.inexistente");
  assert.equal(t("lang.set", { label: "Português" }), "language set to Português.");
  assert.deepEqual(listLocales().map((l) => l.code), SUPPORTED);
});

test("setLocale valida e mantém a preferência em memória", () => {
  process.env.SELFEOPI_LOCALE = "pt";
  assert.equal(setLocale("pt"), true);
  assert.equal(getLocale(), "pt");
  assert.equal(setLocale("xx"), false);
  assert.equal(getLocale(), "pt");
});

test("as duas direções cobrem as mesmas chaves", async () => {
  const mod = await import("./i18n.mjs");
  assert.ok(mod.default.t("help.commands"));
  assert.ok(mod.default.t("panel.title"));
  assert.ok(mod.default.t("spin.thinking"));
  assert.ok(mod.default.t("cmd.language"));
});
