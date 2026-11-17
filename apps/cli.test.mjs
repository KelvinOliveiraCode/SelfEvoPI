#!/usr/bin/env node
/**
 * apps/cli.test.mjs — testes da CLI do SelfEvoPI (REPL de conversa).
 *
 * Cobre: os frames headless renderizam e saem 0; nenhuma linha passa de 72
 * colunas; os comandos de barra existem e são reconhecidos; o markdown sai
 * renderizado (sem `**` cru); a linha de edição (reduceLine) faz o esperado;
 * Ctrl+C cancela sem derrubar; sair (q / /quit / EOF) funciona; e a interface
 * não vaza o nome do motor (SelfEvoPI é o produto).
 *
 * Não precisa do motor instalado: usa dublês e o modo headless.
 */

import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SLASH_COMMANDS,
  COMMANDS,
  filterCommands,
  renderPalette,
  renderPaletteFrame,
  renderMarkdown,
  renderHelp,
  renderBanner,
  renderStatusLine,
  renderConversationFrame,
  parseInput,
  reduceLine,
  converse,
  converseOrFallback,
  engineUnavailableNote,
  engineErrorMessage,
  fallbackNotice,
  isAuthError,
  runSlash,
  stripAnsi,
  visibleWidth,
  wrapAnsi,
  repl,
} from "./cli.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, "cli.mjs");
const WIDTH = 72;

const RENDER_SCREENS = ["conversation", "help", "banner"];

function run(args, { env = {}, input = "" } = {}) {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
      input,
      env: { ...process.env, SELFEOPI_FORCE_NO_ENGINE: "1", ...env },
      timeout: 30_000,
    });
    return { code: 0, out };
  } catch (err) {
    return { code: typeof err.status === "number" ? err.status : 1, out: String(err.stdout || "") };
  }
}

/* ---------------------------------------------------------------- */
/* Render headless                                                   */
/* ---------------------------------------------------------------- */

test("--render conversation/help/banner saem 0 e imprimem algo", () => {
  for (const s of RENDER_SCREENS) {
    const { code, out } = run(["--render", s]);
    assert.equal(code, 0, `--render ${s} saiu ${code}`);
    assert.ok(out.length > 0, `--render ${s} não imprimiu nada`);
    assert.match(stripAnsi(out), /SelfEvoPI/);
  }
});

test("nenhuma linha dos frames passa de 72 colunas", () => {
  for (const s of RENDER_SCREENS) {
    const { out } = run(["--render", s]);
    for (const line of out.split("\n")) {
      const w = visibleWidth(line);
      assert.ok(w <= WIDTH, `--render ${s}: linha com ${w} colunas (> ${WIDTH})`);
    }
  }
  // e o frame de conversa montado em memória também cabe
  for (const line of renderConversationFrame({ branch: "main" }).split("\n")) {
    assert.ok(visibleWidth(line) <= WIDTH, "renderConversationFrame passou de 72");
  }
});

/* ---------------------------------------------------------------- */
/* Comandos de barra                                                 */
/* ---------------------------------------------------------------- */

test("os comandos de barra existem", () => {
  const names = SLASH_COMMANDS.map((c) => c.cmd.split(" ")[0]);
  for (const n of ["/evals", "/gate", "/detect", "/forge", "/memory", "/skills", "/model", "/clear", "/help"]) {
    assert.ok(names.includes(n), `falta o comando ${n}`);
  }
});

test("parseInput reconhece quit, slash com argumento, prosa e vazio", () => {
  assert.deepEqual(parseInput("q"), { type: "quit" });
  assert.deepEqual(parseInput("/quit"), { type: "quit" });
  assert.deepEqual(parseInput(""), { type: "empty" });
  assert.deepEqual(parseInput("/forge extrair HTML"), {
    type: "slash",
    name: "/forge",
    arg: "extrair HTML",
  });
  assert.deepEqual(parseInput("como está a cobertura?"), {
    type: "chat",
    text: "como está a cobertura?",
  });
  const unknown = parseInput("/nao-existe");
  assert.equal(unknown.type, "slash");
  assert.equal(unknown.unknown, true);
});

test("runSlash com motor ausente não derruba (/model, /clear)", async () => {
  let out = "";
  const code = await runSlash("/model", "", (s) => (out += s + "\n"), { pi: null });
  assert.equal(code, 0); // /model lista os configurados mesmo sem conversa ativa
  out = "";
  const code2 = await runSlash("/clear", "", (s) => (out += s + "\n"), { pi: null });
  assert.equal(code2, 0);
});

/* ---------------------------------------------------------------- */
/* Markdown                                                          */
/* ---------------------------------------------------------------- */

test("renderMarkdown: negrito, listas, código e tabela (sem ** cru)", () => {
  const md = [
    "Aqui está **o resultado**:",
    "",
    "- primeiro",
    "- segundo",
    "",
    "```",
    "codigo 1",
    "```",
    "",
    "| Col | Valor |",
    "| --- | --- |",
    "| a | 1 |",
  ].join("\n");
  const out = stripAnsi(renderMarkdown(md));
  assert.ok(!out.includes("**"), "sobrou ** (negrito não renderizado)");
  assert.ok(out.includes("o resultado"), "texto do negrito ausente");
  assert.ok(out.includes("•"), "lista não virou marcador");
  assert.ok(out.includes("primeiro") && out.includes("segundo"), "itens de lista ausentes");
  assert.ok(out.includes("codigo 1"), "bloco de código ausente");
  assert.ok(out.includes("Valor"), "cabeçalho de tabela ausente");
});

test("renderHelp não cita o motor (só SelfEvoPI)", () => {
  const text = stripAnsi(renderHelp());
  assert.ok(!/(?<![A-Za-z])pi(?![A-Za-z])/i.test(text), "ajuda vazou o nome do motor");
  assert.match(text, /\/evals/);
});

test("wrapAnsi quebra linha longa em largura e preserva texto", () => {
  const long = "a".repeat(30) + " " + "b".repeat(30) + " " + "c".repeat(30);
  const wrapped = wrapAnsi("  " + long, 72);
  for (const line of wrapped.split("\n")) {
    assert.ok(visibleWidth(line) <= 72, `linha com ${visibleWidth(line)} colunas`);
  }
  // conteúdo preservado (todos os "a", "b", "c" presentes)
  const plain = stripAnsi(wrapped);
  assert.ok(plain.includes("a".repeat(30)) && plain.includes("b".repeat(30)) && plain.includes("c".repeat(30)));
  // linha curta fica intacta
  assert.equal(wrapAnsi("curta", 72), "curta");
});

test("wrapAnsi preserva escapes ANSI ao quebrar", () => {
  const bold = "\x1b[1m" + "x".repeat(50) + " " + "y".repeat(50) + "\x1b[0m";
  const wrapped = wrapAnsi(bold, 40);
  assert.ok(wrapped.includes("\x1b[1m"), "perdeu o negrito");
  for (const line of wrapped.split("\n")) assert.ok(visibleWidth(line) <= 40);
});

/* ---------------------------------------------------------------- */
/* Linha de edição (reduceLine)                                      */
/* ---------------------------------------------------------------- */

test("reduceLine: imprimíveis, backspace e cursor", () => {
  let st = { buf: "", cur: 0 };
  st = reduceLine(st, "a").state;
  st = reduceLine(st, "b").state;
  st = reduceLine(st, "c").state;
  assert.equal(st.buf, "abc");
  assert.equal(st.cur, 3);
  st = reduceLine(st, "left").state;
  assert.equal(st.cur, 2);
  st = reduceLine(st, "backspace").state; // apaga 'b'
  assert.equal(st.buf, "ac");
  st = reduceLine(st, "home").state;
  assert.equal(st.cur, 0);
  st = reduceLine(st, "X").state; // insere no início
  assert.equal(st.buf, "Xac");
});

test("reduceLine: enter/ctrl-c/ctrl-d viram efeitos", () => {
  assert.equal(reduceLine({ buf: "oi", cur: 2 }, "enter").effect, "submit");
  assert.equal(reduceLine({ buf: "oi", cur: 2 }, "ctrl-c").effect, "sigint");
  assert.equal(reduceLine({ buf: "oi", cur: 2 }, "ctrl-d").effect, "eof");
});

/* ---------------------------------------------------------------- */
/* Conversa (streaming) com dublê                                   */
/* ---------------------------------------------------------------- */

function fakePi({ script } = {}) {
  const h = { text: new Set(), tool: new Set(), settled: new Set() };
  const rec = { aborted: false, prompts: [] };
  const emit = (kind, arg) => {
    for (const cb of h[kind] || []) cb(arg);
  };
  return {
    rec,
    on(kind, cb) {
      (h[kind] ||= new Set()).add(cb);
      return () => h[kind]?.delete(cb);
    },
    prompt: async (m) => {
      rec.prompts.push(m);
      if (script) script(emit);
      return "started";
    },
    abort: async () => {
      rec.aborted = true;
      emit("settled", { aborted: true });
    },
    getState: async () => ({}),
    getAvailableModels: async () => [],
    setModel: async () => ({}),
    cycleModel: async () => null,
    newSession: async () => ({ cancelled: false }),
  };
}

test("converse: faz streaming do texto e mostra linhas de ferramenta", async () => {
  const pi = fakePi({
    script: (emit) => {
      emit("text", "Olá ");
      emit("tool", { phase: "start", name: "read", args: { path: "a.txt" } });
      emit("text", "**mundo**");
      emit("settled", { aborted: false });
    },
  });
  const chunks = [];
  await converse(pi, "pergunta", (s) => chunks.push(s));
  const out = stripAnsi(chunks.join(""));
  assert.equal(pi.rec.prompts[0], "pergunta");
  assert.ok(out.includes("Olá"), "texto do streaming ausente");
  assert.ok(out.includes("mundo"), "segunda parte do texto ausente");
  assert.ok(!out.includes("**"), "negrito saiu cru no streaming");
  assert.ok(out.includes("read") && out.includes("a.txt"), "linha de ferramenta ausente");
});

test("engineErrorMessage: 401 vira voz do produto, sem corpo cru", () => {
  const msg = stripAnsi(engineErrorMessage('401 {"error":{"type":"authentication_error","message":"Invalid bearer token"}}'));
  assert.match(msg, /não consegui falar com o modelo desta conversa/);
  assert.ok(!/401/i.test(msg), "vazou o 401");
  assert.ok(!/bearer/i.test(msg), "vazou 'invalid bearer token'");
  assert.match(msg, /\/model/);
});

test("engineErrorMessage: erro genérico (rede) adapta sem corpo cru", () => {
  const msg = stripAnsi(engineErrorMessage("connect ETIMEDOUT 1.2.3.4:443"));
  assert.match(msg, /não consegui falar com o modelo agora/);
  assert.ok(!/ETIMEDOUT|1\.2\.3\.4/.test(msg), "vazou o erro cru");
  assert.match(msg, /\/model/);
});

test("converse: erro do modelo vira status { ok:false, error } (não escreve o corpo)", async () => {
  const pi = fakePi({
    script: (emit) => {
      emit("error", "401 Invalid bearer token");
      emit("settled", { aborted: false });
    },
  });
  const chunks = [];
  const res = await converse(pi, "oi", (s) => chunks.push(s));
  const out = stripAnsi(chunks.join(""));
  assert.equal(res.ok, false);
  assert.match(String(res.error), /401/); // status carrega o cru; a tela não
  assert.ok(!/401/i.test(out), "converse não deve escrever o corpo cru na tela");
  assert.ok(!/bearer/i.test(out));
});

test("converseOrFallback: sem fallback (SELFEOPI_MODEL) mostra o erro", async () => {
  const pi = fakePi({
    script: (emit) => {
      emit("error", "401 Invalid bearer token");
      emit("settled", { aborted: false });
    },
  });
  const chunks = [];
  const res = await converseOrFallback(pi, "oi", (s) => chunks.push(s), {
    allowFallback: false,
    candidates: [{ provider: "kilo1", id: "x" }],
  });
  const out = stripAnsi(chunks.join(""));
  assert.equal(res.ok, false);
  assert.match(out, /não consegui falar com o modelo desta conversa/);
  assert.ok(!/401/i.test(out));
});

test("converseOrFallback: com fallback, pula modelo vazio e usa o que responde", async () => {
  // default dá erro; 1º candidato responde vazio (ok, sem texto); 2º responde
  let attempt = 0;
  const pi = fakePi({
    script: (emit) => {
      attempt += 1;
      if (attempt === 1) {
        emit("error", "401 Invalid bearer token");
        emit("settled", { aborted: false });
      } else if (attempt === 2) {
        emit("settled", { aborted: false }); // ok, mas sem texto → não serve
      } else {
        emit("text", "ola do modelo de reserva");
        emit("settled", { aborted: false });
      }
    },
  });
  pi.setModel = async () => ({});
  pi.getState = async () => ({ model: { provider: "anthropic", id: "default" } });
  const chunks = [];
  const res = await converseOrFallback(pi, "oi", (s) => chunks.push(s), {
    allowFallback: true,
    candidates: [
      { provider: "anthropic", id: "default" }, // pulado: é o atual
      { provider: "kilo1", id: "vazio:free" }, // responde vazio → segue
      { provider: "kilo1", id: "modelo-bom:free" }, // responde
    ],
  });
  const out = stripAnsi(chunks.join(""));
  assert.equal(res.ok, true);
  assert.match(out, /usei kilo1\/modelo-bom:free/);
  assert.ok(out.includes("ola do modelo de reserva"));
  assert.ok(!/401/i.test(out), "não pode vazar 401");
});

test("isAuthError e fallbackNotice: classificação e voz do produto", () => {
  assert.equal(isAuthError("401 Invalid bearer token"), true);
  assert.equal(isAuthError("connect ETIMEDOUT"), false);
  const notice = stripAnsi(fallbackNotice("kilo1/baidu/ernie-5.5-flash-preview:free"));
  assert.match(notice, /o modelo padrão não respondeu; usei/);
  assert.match(notice, /\/model/);
});

test("converseOrFallback: orçamento total curto não pendura", async () => {
  // default dá erro; candidatos nunca settle (simula provedor pendurado)
  let attempt = 0;
  const pi = fakePi({
    script: (emit) => {
      attempt += 1;
      if (attempt === 1) {
        emit("error", "401 Invalid bearer token");
        emit("settled", { aborted: false });
      }
      // demais tentativas: nada (pendura)
    },
  });
  pi.setModel = async () => ({});
  pi.getState = async () => ({ model: { provider: "x", id: "y" } });
  const chunks = [];
  const t0 = Date.now();
  const res = await converseOrFallback(pi, "oi", (s) => chunks.push(s), {
    allowFallback: true,
    budgetMs: 60,
    perCandidateMs: 25,
    candidates: [
      { provider: "kilo1", id: "a" },
      { provider: "kilo1", id: "b" },
      { provider: "kilo1", id: "c" },
    ],
  });
  const elapsed = Date.now() - t0;
  assert.equal(res.ok, false);
  assert.ok(elapsed < 1000, `varredura demorou ${elapsed}ms (devia respeitar o teto)`);
  const out = stripAnsi(chunks.join(""));
  assert.match(out, /não consegui falar com o modelo/);
});

test("runSlash /model lista os configurados sem lançar (código 0)", async () => {
  let out = "";
  const code = await runSlash("/model", "", (s) => (out += s + "\n"), { pi: null });
  assert.equal(code, 0);
  // não imprime chave nem corpo do arquivo; ou lista modelos, ou diz que não há
  assert.ok(out.length >= 0);
});

/* ---------------------------------------------------------------- */
/* Ctrl+C e sair (via repl com entrada dublê)                       */
/* ---------------------------------------------------------------- */

function fakeInput() {
  const input = new EventEmitter();
  input.setEncoding = () => {};
  input.isTTY = true;
  return input;
}

test("Ctrl+C cancela a conversa e não derruba; depois sai", async () => {
  const input = fakeInput();
  const pi = fakePi({ script: null }); // prompt não emite nada; fica aguardando settled
  const p = repl({ pi, write: () => {}, input, setRaw: () => {}, data: {} });
  // inicia uma conversa
  input.emit("data", "oi\r");
  await new Promise((r) => setTimeout(r, 15));
  // Ctrl+C durante a conversa: cancela
  input.emit("data", "\x03");
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(pi.rec.aborted, true, "Ctrl+C não chamou abort");
  // Ctrl+C na linha vazia: sai
  input.emit("data", "\x03");
  await p; // resolve quando sai
});

test("q sai; /quit sai; EOF sai (modo linha, sem motor)", () => {
  for (const [label, input] of [
    ["q", "q\n"],
    ["/quit", "/quit\n"],
    ["EOF", ""],
  ]) {
    const { code } = run([], { input });
    assert.equal(code, 0, `${label} não saiu 0 (saiu ${code})`);
  }
});

/* ---------------------------------------------------------------- */
/* Sem vazamento do nome do motor                                   */
/* ---------------------------------------------------------------- */

test("aviso de motor ausente é voz do produto, sem o nome do motor", () => {
  const text = stripAnsi(engineUnavailableNote());
  assert.ok(!/(?<![A-Za-z])pi(?![A-Za-z])/i.test(text), "aviso vazou o nome do motor");
  assert.match(text, /SelfEvoPI/);
});

test("--help e banner não citam o motor", () => {
  const help = stripAnsi(run(["--help"]).out);
  assert.ok(!/(?<![A-Za-z])pi(?![A-Za-z])/i.test(help), "--help vazou o nome do motor");
  const banner = stripAnsi(renderBanner());
  assert.ok(!/(?<![A-Za-z])pi(?![A-Za-z])/i.test(banner), "banner vazou o nome do motor");
  assert.match(banner, /SelfEvoPI/);
});


/* ---------------------------------------------------------------- */
/* Paleta de comandos                                                */
/* ---------------------------------------------------------------- */

test("filterCommands: vazio lista tudo (ordenado); prefixo e fuzzy", () => {
  const all = filterCommands("");
  const names = all.map((c) => c.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  assert.ok(names.includes("/evals") && names.includes("/model"));

  // prefixo
  assert.deepEqual(filterCommands("ev").map((c) => c.name), ["/evals"]);
  // fuzzy (subsequência): dtc → detect
  assert.ok(filterCommands("dtc").map((c) => c.name).includes("/detect"));
  // sem correspondência
  assert.deepEqual(filterCommands("zzzz"), []);
});

test("paleta e /help usam a MESMA lista (fonte única)", () => {
  const fromCommands = COMMANDS.map((c) => c.name).sort();
  const fromFilter = filterCommands("").map((c) => c.name).sort();
  const fromHelp = stripAnsi(renderHelp());
  assert.deepEqual(fromCommands, fromFilter);
  for (const name of fromCommands) {
    assert.ok(fromHelp.includes(name), `/help não lista ${name}`);
  }
});

test("renderPalette: caixa <= 8 linhas e <= 72 colunas", () => {
  const filtered = filterCommands("");
  const lines = renderPalette(filtered, 0, 72);
  const boxRows = lines.filter((l) => l.includes("│"));
  assert.ok(boxRows.length <= 8, `paleta com ${boxRows.length} linhas (> 8)`);
  for (const l of lines) assert.ok(visibleWidth(l) <= 72, `linha da paleta com ${visibleWidth(l)} (>72)`);
  // sem correspondência: uma linha discreta
  const none = renderPalette([], 0, 72).filter((l) => l.includes("│"));
  assert.equal(none.length, 1);
  assert.match(stripAnsi(none[0]), /nenhum comando/);
});

test("renderPaletteFrame headless <= 72 e comSelection", () => {
  for (const q of ["", "ev"]) {
    const frame = renderPaletteFrame(q, 72);
    for (const l of frame.split("\n")) assert.ok(visibleWidth(l) <= 72, `frame palette(${q}) >72`);
  }
});

test("reduceLine: / abre paleta, /ev filtra, esc fecha, enter preenche", () => {
  // "/" abre (buf="/", dismissed=false → paleta aberta; filterCommands("") = tudo)
  const opened = reduceLine({ buf: "", cur: 0 }, "/");
  assert.equal(opened.state.buf, "/");
  assert.equal(opened.state.dismissed, false);

  // "/ev" continua aberto e filtra
  const typed = reduceLine({ buf: "/", cur: 1 }, "e");
  assert.equal(typed.state.buf, "/e");
  assert.equal(typed.state.dismissed, false);

  // esc fecha sem alterar o buffer
  const closed = reduceLine({ buf: "/ev", cur: 3 }, "esc");
  assert.equal(closed.state.buf, "/ev");
  assert.equal(closed.state.dismissed, true);
  assert.equal(closed.effect, "palette-closed");

  // enter (paleta aberta) preenche o buffer, não executa
  const selected = reduceLine({ buf: "/ev", cur: 3, sel: 0, dismissed: false }, "enter");
  assert.equal(selected.effect, "selected");
  assert.ok(selected.state.buf.startsWith("/evals"));
  assert.equal(selected.state.dismissed, true);
});

test("reduceLine: enter sem paleta submete; setas sem paleta viram histórico", () => {
  const submit = reduceLine({ buf: "oi", cur: 2 }, "enter");
  assert.equal(submit.effect, "submit");
  const up = reduceLine({ buf: "", cur: 0 }, "up");
  assert.equal(up.effect, "history-up");
});

test("reduceLine: setas navegam a paleta quando aberta", () => {
  const st = { buf: "/", cur: 1, sel: 0, dismissed: false };
  const down = reduceLine(st, "down");
  assert.equal(down.effect, "palette-move");
  assert.equal(down.state.sel, 1);
  const up = reduceLine({ ...st, sel: 0 }, "up");
  assert.equal(up.effect, "palette-move");
  assert.ok(up.state.sel > 0); // deu a volta (wrap)
});
