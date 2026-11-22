/**
 * cli-features.test.mjs — idioma e comandos novos da CLI 1.2.
 * A preferência em disco é preservada: o teste não muda o idioma do usuário.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { getLocale, setLocale, listLocales, t } from "../core/agent/i18n.mjs";
import {
  COMMANDS,
  localizedCommands,
  filterCommands,
  renderHelp,
  renderPaletteFrame,
  renderSettings,
  runSlash,
  renderMarkdown,
  recordEvent,
  listEvents,
  clearEvents,
  metadataEfforts,
  frameWidth,
  stripAnsi,
  visibleWidth,
} from "./cli.mjs";

const TEMP = mkdtempSync(path.join(os.tmpdir(), "selfevopi-lang-"));
process.env.SELFEOPI_LOCALE_FILE = path.join(TEMP, "locale.json");
const savedEnv = process.env.SELFEOPI_LOCALE;

function restore() {
  if (savedEnv === undefined) delete process.env.SELFEOPI_LOCALE;
  else process.env.SELFEOPI_LOCALE = savedEnv;
}

test.after(() => {
  restore();
  delete process.env.SELFEOPI_LOCALE_FILE;
  rmSync(TEMP, { recursive: true, force: true });
});

test("novos comandos estão registrados", () => {
  const names = COMMANDS.map((c) => c.name);
  for (const name of ["/language", "/fork", "/diff", "/export", "/undo", "/redo", "/copy", "/reload", "/verbosity", "/history"]) {
    assert.ok(names.includes(name), `falta ${name}`);
  }
});

test("comandos novos não lançam sem motor", async () => {
  process.env.SELFEOPI_LOCALE = "en";
  for (const name of ["/language", "/fork", "/diff", "/export", "/undo", "/redo", "/reload", "/verbosity", "/history"]) {
    let out = "";
    const code = await runSlash(name, "", (s) => (out += s + "\n"), { pi: null });
    assert.equal(code, 0, `${name} saiu ${code}`);
    assert.ok(out.length > 0, `${name} não respondeu nada`);
  }
  restore();
});

test("inglês é o padrão da interface", () => {
  process.env.SELFEOPI_LOCALE = "en";
  const detect = localizedCommands().find((c) => c.name === "/detect");
  assert.match(detect.description, /open capability gaps/i);
  assert.match(stripAnsi(renderHelp()), /COMMANDS/);
  assert.match(stripAnsi(renderHelp()), /Ctrl\+O opens\/closes the status panel/);
  assert.match(stripAnsi(renderPaletteFrame()), /navigate/);
  const settings = renderSettings({ mode: "build", permission: "full access", model: "m/x", theme: "dark" }).join("\n");
  assert.match(settings, /mode/);
  assert.match(settings, /permission/);
  assert.match(settings, /model/);
});

test("português troca ajuda, paleta, painel e configurações", () => {
  process.env.SELFEOPI_LOCALE = "pt";
  const detect = localizedCommands().find((c) => c.name === "/detect");
  assert.match(detect.description, /lacunas de ferramenta/);
  assert.match(stripAnsi(renderHelp()), /COMANDOS/);
  assert.match(stripAnsi(renderPaletteFrame()), /navegar/);
  const settings = renderSettings({ mode: "build", permission: "full access", model: "m/x", theme: "escuro" }).join("\n");
  assert.match(settings, /modo/);
  assert.match(settings, /permissão/);
  assert.match(settings, /modelo/);
});

test("/language valida, troca e persiste", async () => {
  process.env.SELFEOPI_LOCALE = "en";
  let out = "";
  assert.equal(await runSlash("/language", "xx", (s) => (out += s), {}), 2);
  assert.match(out, /unsupported/i);

  out = "";
  assert.equal(await runSlash("/language", "pt", (s) => (out += s), {}), 0);
  delete process.env.SELFEOPI_LOCALE;
  assert.equal(getLocale(), "pt");
  assert.match(out, /Português/);

  assert.equal(setLocale("en"), true);
  delete process.env.SELFEOPI_LOCALE;
  assert.equal(getLocale(), "en");
  restore();
});

test("efforts e largura do frame vêm de fontes reais", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "selfevopi-efforts-"));
  const file = path.join(dir, "models.json");
  writeFileSync(
    file,
    JSON.stringify({
      providers: {
        or1: {
          models: [
            {
              id: "baidu/ernie-5.5-flash-preview:free",
              reasoning: true,
              thinkingLevelMap: { high: "high", off: null, low: null, medium: null },
            },
          ],
        },
      },
    }),
    "utf8",
  );
  const savedModels = process.env.PI_MODELS_FILE;
  process.env.PI_MODELS_FILE = file;
  try {
    assert.deepEqual(metadataEfforts("or1/baidu/ernie-5.5-flash-preview:free"), ["high"]);
    assert.equal(frameWidth(), 72); // headless é determinístico
  } finally {
    if (savedModels === undefined) delete process.env.PI_MODELS_FILE;
    else process.env.PI_MODELS_FILE = savedModels;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("histórico registra tools, raciocínio e respostas", async () => {
  clearEvents();
  recordEvent("user", "resuma o link");
  recordEvent("reasoning", "Vou abrir a página e resumir.");
  recordEvent("tool", "web_open https://exemplo", { name: "web_open" });
  recordEvent("tool_result", "⎿ 3 linhas", { name: "web_open" });
  recordEvent("assistant", "Resumo em **duas** linhas.");
  assert.equal(listEvents().length, 5);
  assert.equal(listEvents(2).length, 2);

  let out = "";
  assert.equal(await runSlash("/history", "10", (s) => (out += s + "\n"), {}), 0);
  const plain = stripAnsi(out);
  assert.match(plain, /tool/);
  assert.match(plain, /reasoning/);
  assert.match(plain, /Resumo em/);
  for (const ln of plain.split("\n")) assert.ok(visibleWidth(ln) <= 72, `linha de histórico >72: ${ln}`);

  assert.equal(await runSlash("/history", "clear", (s) => (out += s), {}), 0);
  assert.equal(listEvents().length, 0);
});

test("tabela markdown larga não quebra a tela nem deixa ** cru", () => {
  const md = [
    "| Aspecto | Detalhes | Outro |",
    "|---|---|---|",
    "| **Foco** | Workflows agênticos, arquitetura multiagente aplicados a software, infra, cibersegurança, dados, backend e redes. | 131 itens |",
    "| **Números** | 105 repositórios públicos, 13 páginas no ar. | 219h formação |",
  ].join("\n");
  const out = stripAnsi(renderMarkdown(md));
  assert.equal(out.includes("**"), false, "negrito deve ser renderizado, inclusive em células");
  assert.match(out, /Foco/);
  for (const ln of out.split("\n")) assert.ok(visibleWidth(ln) <= 72, `linha de tabela >72: ${ln}`);
});

test("nenhuma linha dos frames passa de 72 colunas em qualquer idioma", () => {
  for (const locale of ["en", "pt"]) {
    process.env.SELFEOPI_LOCALE = locale;
    for (const frame of [renderHelp(), renderPaletteFrame()]) {
      for (const line of stripAnsi(frame).split("\n")) {
        assert.ok(visibleWidth(line) <= 72, `${locale}: linha com ${visibleWidth(line)} colunas`);
      }
    }
  }
  restore();
});
