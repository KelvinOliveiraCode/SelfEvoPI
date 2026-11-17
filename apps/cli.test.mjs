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
  renderMarkdown,
  renderHelp,
  renderBanner,
  renderStatusLine,
  renderConversationFrame,
  parseInput,
  reduceLine,
  converse,
  engineUnavailableNote,
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
  assert.equal(code, 0);
  assert.match(stripAnsi(out), /desativada|sem motor/i);
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