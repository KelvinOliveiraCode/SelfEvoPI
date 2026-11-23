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
  responseFrame,
  contextBar,
  renderBanner,
  makeOut,
  parseTerminalReports,
  currentModelRole,
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

test("bloco de resposta tem moldura, negrito renderizado e largura fixa", () => {
  const frame = responseFrame("Resumo **importante** com uma linha bem longa que precisa quebrar sem sobrepor nada na tela.");
  const plain = stripAnsi(frame.join("\n"));
  assert.match(plain, /╭─ ◆ SelfEvoPI/);
  assert.match(plain, /╰/);
  assert.equal(plain.includes("**"), false);
  for (const linha of frame) {
    assert.ok(visibleWidth(linha) <= 72, `linha do bloco >72: ${visibleWidth(linha)}`);
    const aberto = (linha.match(/\x1b\[(?!0m)[0-9;]*m/g) || []).length;
    const fechado = (linha.match(/\x1b\[0m/g) || []).length;
    assert.equal(aberto, fechado, "estilo ANSI deve fechar na mesma linha");
  }
});

test("medidor de contexto e banner respeitam a moldura", () => {
  assert.equal(visibleWidth(stripAnsi(contextBar(0))), 8);
  assert.equal(visibleWidth(stripAnsi(contextBar(100))), 8);
  const banner = stripAnsi(renderBanner());
  assert.match(banner, /◈ SelfEvoPI/);
  assert.match(banner, /____/, "logo ASCII continua presente");
  for (const linha of banner.split("\n")) {
    assert.ok(visibleWidth(linha) <= 72, `linha do banner >72: ${visibleWidth(linha)}`);
  }
});

test("verbos do spinner existem nos dois idiomas", () => {
  process.env.SELFEOPI_LOCALE = "en";
  assert.match(t("spin.verbs"), /processing/);
  process.env.SELFEOPI_LOCALE = "pt";
  assert.match(t("spin.verbs"), /processando/);
  restore();
});

test("makeOut aplica o crivo da tela à saída de comandos longos", () => {
  const escrito = [];
  const out = makeOut((s) => escrito.push(s), 40);
  const longo = "disponíveis: " +
    "padrao, violeta, azul, ciano, verde, esmeralda, laranja, rosa, vermelho, magenta, dourado, grafite";
  out("\x1b[38;2;255;200;87m" + longo + "\x1b[0m");
  const bruto = escrito.join("");
  assert.ok(!bruto.includes("…"), "nunca pode truncar com reticência");
  assert.ok(bruto.includes("grafite"), "última palavra não pode se perder");
  for (const linha of bruto.split("\n")) {
    assert.ok(visibleWidth(stripAnsi(linha)) <= 40, `linha > 40: ${visibleWidth(stripAnsi(linha))}`);
    const aberto = (linha.match(/\x1b\[(?!0m)[0-9;]*m/g) || []).length;
    const fechado = (linha.match(/\x1b\[0m/g) || []).length;
    assert.equal(aberto, fechado, "SGR deve fechar na mesma linha visual");
  }
});

test("/lsp sem argumentos lista servidores configurados sem lance", async () => {
  const escrito = [];
  const codigo = await runSlash("/lsp", "", (s) => escrito.push(s), {});
  assert.equal(codigo, 0);
  assert.match(stripAnsi(escrito.join("")), /servidores LSP/);
});

test("/role troca o papel e valida nome desconhecido", async () => {
  const escrito = [];
  const pi = {
    setModel: async (provider, id) => { pi.ref = `${provider}/${id}`; },
    getState: async () => ({ model: { provider: "kilo1", id: "modelo-grande:free" } }),
  };
  const codigo = await runSlash("/role", "slow", (s) => escrito.push(s), { pi });
  assert.equal(codigo, 0);
  assert.equal(currentModelRole(), "slow");
  assert.match(stripAnsi(escrito.join("")), /slow/);
  assert.ok(pi.ref, "deve ter aplicado um modelo");

  escrito.length = 0;
  const invalido = await runSlash("/role", "inexistente", (s) => escrito.push(s), { pi });
  assert.equal(invalido, 2);
  assert.equal(currentModelRole(), "slow", "papel inválido não muda o atual");
  await runSlash("/role", "default", () => {}, { pi });
});

test("frameWidth e responseFrame acompanham uma janela estreita", () => {
  const out = process.stdout;
  const eraTty = out.isTTY;
  const cols = out.columns;
  try {
    Object.defineProperty(out, "isTTY", { value: true, configurable: true });
    Object.defineProperty(out, "columns", { value: 50, configurable: true });
    assert.equal(frameWidth(), 48);
    const quadro = responseFrame("Uma resposta longa que precisa caber na janela estreita sem sobrepor nada na tela do usuario.");
    for (const linha of quadro) {
      assert.ok(visibleWidth(stripAnsi(linha)) <= 48, `linha vazou: ${visibleWidth(stripAnsi(linha))}`);
    }
  } finally {
    Object.defineProperty(out, "isTTY", { value: eraTty, configurable: true });
    Object.defineProperty(out, "columns", { value: cols, configurable: true });
  }
});

test("parseTerminalReports separa clique e posição do cursor do comando", () => {
  const r = parseTerminalReports("\x1b[<0;12;7Mabc\x1b[9;1Rz");
  assert.equal(r.text, "abcz");
  assert.equal(r.cliques.length, 1);
  assert.deepEqual(r.cliques[0], { button: 0, col: 12, row: 7, down: true });
  assert.deepEqual(r.cursos, [{ row: 9, col: 1 }]);
});

test("parseTerminalReports ignora soltura de botão e mantém texto íntegro", () => {
  const r = parseTerminalReports("oi\x1b[<0;3;4m");
  assert.equal(r.text, "oi");
  assert.equal(r.cliques[0].down, false);
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
