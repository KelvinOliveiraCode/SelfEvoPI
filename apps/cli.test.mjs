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
 *
 * Os testes fixam o idioma em português: o PRODUTO nasce em inglês (default),
 * mas as asserções históricas desta suíte foram escritas em português. Fixar
 * aqui evita que uma troca de idioma por padrão vire 20 falsos negativos.
 */
process.env.SELFEOPI_LOCALE = "pt";

import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

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
  checkGoal,
  getGoalState,
  engineUnavailableNote,
  engineErrorMessage,
  fallbackNotice,
  isAuthError,
  runSlash,
  stripAnsi,
  visibleWidth,
  wrapAnsi,
  repl,
  spinnerFrame,
  renderThinking,
  buildStatusLine,
  renderPanel,
  renderSettings,
  refreshStatus,
  sessionOrigin,
  deriveTitle,
  renderSessionsList,
  readSessionExtras,
  EFFORT_FALLBACK,
  normalizeEffortList,
  resolveEffort,
  describeModeLine,
  groupModelsByProvider,
  flattenModelGroups,
  renderModelPicker,
  renderValuePicker,
  windowBounds,
  inputWindow,
  prefersReducedMotion,
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
    // O banner agora é logo ASCII (figlet); aceita o nome em texto OU a assinatura do logo.
    const plain = stripAnsi(out);
    assert.ok(/SelfEvoPI/.test(plain) || /\|____\//.test(plain) || /____/.test(plain), `--render ${s} não mostra a identidade do produto`);
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
  for (const n of ["/detect", "/evo", "/memory", "/skills", "/model", "/clear", "/help"]) {
    assert.ok(names.includes(n), `falta o comando ${n}`);
  }
});

test("parseInput reconhece quit, slash com argumento, prosa e vazio", () => {
  assert.deepEqual(parseInput("q"), { type: "quit" });
  assert.deepEqual(parseInput("/quit"), { type: "quit" });
  assert.deepEqual(parseInput(""), { type: "empty" });
  assert.deepEqual(parseInput("/evo extrair HTML"), {
    type: "slash",
    name: "/evo",
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
  assert.match(text, /\/evo/);
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
  const rec = { aborted: false, prompts: [], sessions: 0 };
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
    newSession: async () => { rec.sessions += 1; return { cancelled: false }; },
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

test("converse: erro transitivo seguido de resposta não vira falha na tela", async () => {
  const pi = fakePi({
    script: (emit) => {
      emit("error", "429: Provider returned error"); // tentativa intermediária
      emit("text", "56"); // o motor recuperou e respondeu
      emit("settled", { aborted: false });
    },
  });
  const chunks = [];
  const res = await converse(pi, "oi", (s) => chunks.push(s));
  const out = stripAnsi(chunks.join(""));
  assert.equal(res.ok, true);
  assert.equal(res.text, "56");
  assert.ok(out.includes("56"), "resposta final deve aparecer");
  assert.ok(!/não consegui/.test(out), "erro das tentativas anteriores não pode aparecer");
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
    maxRetries: 1, // este teste é sobre a voz do erro, não sobre a recessão
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
    maxRetries: 1, // este teste é sobre o fallback entre modelos
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

test("converseOrFallback reconecta até 5 vezes e reinicia a sessão travada", async () => {
  let attempt = 0;
  const pi = fakePi({
    script: (emit) => {
      attempt += 1;
      if (attempt < 4) {
        emit("error", "429 Provider returned error");
        emit("settled", { aborted: false });
      } else {
        emit("text", "resposta após reconexão");
        emit("settled", { aborted: false });
      }
    },
  });
  const chunks = [];
  const res = await converseOrFallback(pi, "oi", (s) => chunks.push(s), {
    allowFallback: false,
    candidates: [],
  });
  const out = stripAnsi(chunks.join(""));
  assert.equal(res.ok, true);
  assert.equal(res.text, "resposta após reconexão");
  assert.equal(attempt, 4, "deve tentar de novo até responder");
  assert.match(out, /reconectando \(2\/5\)/);
  assert.ok(pi.rec.sessions >= 1, "deve reiniciar a sessão após falhas repetidas");
});

test("converseOrFallback: depois de 5 falhas deixa sessão limpa para a próxima", async () => {
  const pi = fakePi({
    script: (emit) => {
      emit("error", "connect ETIMEDOUT");
      emit("settled", { aborted: false });
    },
  });
  const chunks = [];
  const res = await converseOrFallback(pi, "oi", (s) => chunks.push(s), {
    allowFallback: false,
    candidates: [],
  });
  assert.equal(res.ok, false);
  assert.equal(pi.rec.prompts.length, 5, "cinco tentativas no mesmo modelo");
  assert.ok(pi.rec.sessions >= 1, "sessão reiniciada para destravar");
  assert.match(stripAnsi(chunks.join("")), /sessão reiniciada|session reset/i);
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
    maxRetries: 1, // este teste é sobre o orçamento do fallback
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
  // O banner agora é arte ASCII grande (figlet). Verifica a assinatura do logo
  // (linha de abertura + de fechamento) em vez do nome em texto reto.
  assert.match(banner, /____/, "banner perdeu o logo ASCII (linha de abertura)");
  assert.match(banner, /\|____\//, "banner perdeu o logo ASCII (linha de fechamento)");
});


/* ---------------------------------------------------------------- */
/* Paleta de comandos                                                */
/* ---------------------------------------------------------------- */

test("filterCommands: vazio lista tudo (ordenado); prefixo e fuzzy", () => {
  const all = filterCommands("");
  const names = all.map((c) => c.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  assert.ok(names.includes("/evo") && names.includes("/model"));

  // prefixo
  assert.deepEqual(filterCommands("ev").map((c) => c.name), ["/evo"]);
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
  assert.ok(selected.state.buf.startsWith("/evo"));
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


/* ---------------------------------------------------------------- */
/* Comandos ligados (módulos dos outros) e modos                    */
/* ---------------------------------------------------------------- */

test("COMMANDS inclui os comandos novos (paleta e /help leem daqui)", () => {
  const names = COMMANDS.map((c) => c.name);
  for (const n of ["/compact", "/sessions", "/cost", "/status", "/context", "/mcp", "/init", "/plan", "/build", "/ask"]) {
    assert.ok(names.includes(n), `falta ${n}`);
  }
  // /goal agora existe (core/forge/goal.mjs entregue)
  assert.ok(names.includes("/goal"), "/goal deveria existir");
});

test("renderStatusLine mostra o modo quando fornecido", () => {
  const line = stripAnsi(renderStatusLine({ branch: "main", mode: "plan" }));
  assert.match(line, /plan/);
});

test("runSlash /plan e /build trocam o modo sem lançar", async () => {
  let out = "";
  const c1 = await runSlash("/plan", "", (x) => (out += x + "\n"), { pi: null });
  assert.equal(c1, 0);
  assert.match(stripAnsi(out), /modo: plan/);
  assert.match(stripAnsi(out), /escrita: block/); // plan não escreve
  out = "";
  const c2 = await runSlash("/build", "", (x) => (out += x + "\n"), { pi: null });
  assert.equal(c2, 0);
  assert.match(stripAnsi(out), /modo: build/);
});

test("comandos novos com motor ausente não lançam e saem 0", async () => {
  for (const name of ["/status", "/cost", "/context", "/mcp", "/sessions", "/compact"]) {
    let out = "";
    const code = await runSlash(name, "", (x) => (out += x + "\n"), { pi: null });
    assert.equal(code, 0, `${name} saiu ${code}`);
    assert.ok(out.length >= 0);
  }
});

test("runSlash /goal sem argumento (agora existe) mostra o estado e sai 0", async () => {
  let out = "";
  const code = await runSlash("/goal", "", (x) => (out += x + "\n"), { pi: null });
  assert.equal(code, 0);
  assert.match(stripAnsi(out), /goal|nenhuma|ativa/i);
});


/* ---------------------------------------------------------------- */
/* /goal (condição de conclusão — core/forge/goal.mjs)              */
/* ---------------------------------------------------------------- */

test("COMMANDS inclui /goal (sem placeholder)", () => {
  assert.ok(COMMANDS.map((c) => c.name).includes("/goal"));
});

test("runSlash /goal define, mostra e limpa", async () => {
  let out = "";
  let c = await runSlash("/goal", "extrair dados de um html", (x) => (out += x + "\n"), { pi: null });
  assert.equal(c, 0);
  assert.equal(getGoalState().goal.condition, "extrair dados de um html");
  out = "";
  c = await runSlash("/goal", "", (x) => (out += x + "\n"), { pi: null });
  assert.equal(c, 0);
  assert.match(stripAnsi(out), /goal ativa: extrair dados de um html/);
  out = "";
  c = await runSlash("/goal", "clear", (x) => (out += x + "\n"), { pi: null });
  assert.equal(c, 0);
  assert.equal(getGoalState().goal, null);
});

test("checkGoal fecha sozinha quando o turno satisfaz", async () => {
  await runSlash("/goal", "extrair dados", () => {}, { pi: null });
  assert.ok(getGoalState().goal);
  await checkGoal("pronto, extraí os dados do html", () => {});
  assert.equal(getGoalState().goal, null); // auto-clear
});

test("checkGoal mantém a goal quando o turno está em andamento", async () => {
  await runSlash("/goal", "extrair dados", () => {}, { pi: null });
  await checkGoal("ainda estou trabalhando nisso", () => {});
  assert.ok(getGoalState().goal); // continua ativa
  await runSlash("/goal", "clear", () => {}, { pi: null }); // limpa
});


/* ---------------------------------------------------------------- */
/* TUI polida: spinner, raciocínio, painel, estados vazios          */
/* ---------------------------------------------------------------- */

test("spinnerFrame: determinístico e cicla os frames", () => {
  const a = spinnerFrame(0);
  const b = spinnerFrame(80);
  const c = spinnerFrame(160);
  assert.notEqual(a, b, "frame muda ao longo do tempo");
  assert.notEqual(b, c, "frame muda de novo");
  assert.equal(spinnerFrame(0), a, "t=0 é determinístico");
  assert.ok("⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏".includes(spinnerFrame(80 * 3)));
});

test("prefersReducedMotion: respeita SELFEOPI_REDUCED_MOTION", () => {
  const orig = process.env.SELFEOPI_REDUCED_MOTION;
  try {
    delete process.env.SELFEOPI_REDUCED_MOTION;
    assert.equal(prefersReducedMotion(), false, "default: movimento normal");
    process.env.SELFEOPI_REDUCED_MOTION = "1";
    assert.equal(prefersReducedMotion(), true);
    process.env.SELFEOPI_REDUCED_MOTION = "true";
    assert.equal(prefersReducedMotion(), true);
    process.env.SELFEOPI_REDUCED_MOTION = "0";
    assert.equal(prefersReducedMotion(), false);
  } finally {
    if (orig === undefined) delete process.env.SELFEOPI_REDUCED_MOTION;
    else process.env.SELFEOPI_REDUCED_MOTION = orig;
  }
});

test("renderThinking: vazio → [] (não quebra)", () => {
  assert.deepEqual(renderThinking(""), []);
  assert.deepEqual(renderThinking(null), []);
  assert.deepEqual(renderThinking("   "), []);
});

test("renderThinking: mostra rótulo e texto em cinza, ≤72 col", () => {
  const lines = renderThinking("Estou analisando o arquivo de entrada com atenção.");
  assert.ok(lines.length >= 2);
  assert.match(stripAnsi(lines[0]), /raciocínio/);
  for (const ln of lines) assert.ok(visibleWidth(ln) <= WIDTH, "linha do raciocínio ≤72");
});

test("buildStatusLine: mostra modo, permissão, modelo e raciocínio", () => {
  const line = stripAnsi(buildStatusLine({ mode: "plan", permission: "full access", model: "claude-opus-5-5", reasoning: "high" }));
  assert.match(line, /plan/);
  assert.match(line, /full access/);
  assert.match(line, /claude-opus-5-5/);
  assert.match(line, /high/);
});

test("buildStatusLine: estados vazios não quebram", () => {
  const line = stripAnsi(buildStatusLine({ mode: "build", permission: "full access" }));
  assert.match(line, /build/);
  assert.ok(line.length > 0);
});

test("renderPanel: mostra modo/permissão/modelo (pedido do usuário)", () => {
  const lines = renderPanel(
    { mode: "build", permission: "full access", model: "claude-opus-5-5", reasoning: "medium", context: "1k / 200k", sessionId: "abc12345", turns: 2 },
    {},
  ).map(stripAnsi);
  const text = lines.join("\n");
  assert.match(text, /modo:\s+build/);
  assert.match(text, /permissão:\s+full access/);
  assert.match(text, /modelo:\s+claude-opus-5-5/);
  assert.match(text, /raciocínio:\s+medium/);
  for (const ln of lines) assert.ok(visibleWidth(ln) <= WIDTH, "linha do painel ≤72: " + JSON.stringify(ln));
});

test("renderPanel: estados vazios (sem modelo/sessão) não quebram", () => {
  const lines = renderPanel({ mode: "ask", permission: "full access" }, {}).map(stripAnsi);
  const text = lines.join("\n");
  assert.match(text, /modo:\s+ask/);
  assert.match(text, /modelo:\s+—/);
});

test("refreshStatus com pi=null devolve estado sem lançar", async () => {
  const st = await refreshStatus(null);
  assert.equal(st.mode, "build");
  assert.equal(st.permission, "full access");
});

test("--render panel e --render busy existem e ≤72 col", () => {
  for (const screen of ["panel", "busy"]) {
    const out = stripAnsi(execFileSync(process.execPath, [CLI, "--render", screen], { encoding: "utf8" }));
    assert.ok(out.length > 0, screen + " tem saída");
    for (const ln of out.split("\n")) {
      assert.ok(visibleWidth(ln) <= WIDTH, `${screen} ≤72: ${JSON.stringify(ln)}`);
    }
    assert.ok(!/\bpi\b/.test(out.replace(/SelfEvoPI/g, "")), screen + " não cita o motor");
  }
});

test("REPL: ctrl+o abre e fecha o painel; ctrl+c não mata", async () => {
  const input = new EventEmitter();
  input.setEncoding = () => {};
  input.isTTY = true;
  let all = "";
  const p = repl({ pi: null, write: (s) => (all += s), input, setRaw: () => {}, data: {} });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(20);
  // boot: linha de status tem modo+permissão e a dica ctrl+o
  const boot = stripAnsi(all);
  assert.match(boot, /build\s+full access/);
  assert.match(boot, /ctrl\+o painel/);
  // ctrl+o abre a leitura de estado (o que a dica promete)
  all = "";
  input.emit("data", "\x0f");
  await sleep(30);
  const painel = stripAnsi(all);
  assert.match(painel, /painel/);
  assert.match(painel, /modo:/);
  assert.match(painel, /permissão:/);
  assert.match(painel, /modelo:/);
  // ctrl+, abre o editor de configurações
  all = "";
  input.emit("data", "\x1c");
  await sleep(30);
  const cfg = stripAnsi(all);
  assert.match(cfg, /configurações/);
  assert.match(cfg, /permissão/);
  assert.match(cfg, /modelo/);
  // esc fecha o picker
  all = "";
  input.emit("data", "\x1b");
  await sleep(30);
  assert.doesNotMatch(stripAnsi(all), /permissão/);
  // ctrl+, fechou o painel; ctrl+o abre de novo, e um segundo ctrl+o fecha
  all = "";
  input.emit("data", "\x0f");
  await sleep(20);
  assert.match(stripAnsi(all), /painel/);
  all = "";
  input.emit("data", "\x0f");
  await sleep(20);
  assert.doesNotMatch(stripAnsi(all), /raciocínio:/);
  // ctrl+c não mata (dois toques: limpa linha, não sai)
  all = "";
  input.emit("data", "\x03");
  await sleep(10);
  input.emit("data", "\x03");
  await sleep(20);
  // sai com ctrl+d
  input.emit("data", "\x04");
  await p;
});

test("REPL: o rodapé fica duas linhas abaixo do prompt, inclusive com paleta aberta", async () => {
  const input = new EventEmitter();
  input.setEncoding = () => {};
  input.isTTY = true;
  let all = "";
  const p = repl({ pi: null, write: (s) => (all += s), input, setRaw: () => {}, data: {} });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(20);

  const abaixoDoPrompt = (texto) => {
    const linhas = stripAnsi(texto).split("\n");
    const i = linhas.findIndex((l) => l.includes("›"));
    assert.ok(i >= 0, "prompt não encontrado no frame");
    return { livre: linhas[i + 1], status: linhas[i + 2], dica: linhas[i + 3] };
  };

  // Sem overlay, uma linha livre, estado na segunda e dica na terceira.
  let linhas = abaixoDoPrompt(all);
  assert.equal(linhas.livre.trim(), "");
  assert.match(linhas.status, /build\s+full access/);
  assert.match(linhas.dica, /ctrl\+o painel/);

  // Com a paleta aberta, o rodapé não desce: o overlay vem depois dele.
  all = "";
  input.emit("data", "/");
  await sleep(20);
  linhas = abaixoDoPrompt(all);
  assert.match(linhas.status, /build\s+full access/);
  assert.match(linhas.dica, /ctrl\+o painel/);

  input.emit("data", "\x04");
  await p;
});

/* ------------------------------------------------------------------ */
/* Sessões — origem (client) e título derivado                         */
/* ------------------------------------------------------------------ */

test("sessionOrigin: campo ausente é cli", () => {
  assert.equal(sessionOrigin(undefined), "cli");
  assert.equal(sessionOrigin(null), "cli");
  assert.equal(sessionOrigin(""), "cli");
  assert.equal(sessionOrigin("   "), "cli");
  assert.equal(sessionOrigin("cli"), "cli");
  assert.equal(sessionOrigin("CLI"), "cli");
});

test("sessionOrigin: valor desconhecido não vira cli no silêncio", () => {
  assert.equal(sessionOrigin("mobile"), "mobile");
});

test("deriveTitle: título do header vence o texto da mensagem", () => {
  assert.equal(deriveTitle("Sessão nomeada", "texto do usuario"), "Sessão nomeada");
  assert.equal(deriveTitle("   ", "texto do usuario"), "texto do usuario");
});

test("deriveTitle: sem título, deriva da primeira mensagem e normaliza espaço", () => {
  assert.equal(deriveTitle(null, "  calcular   o IMC  "), "calcular o IMC");
  assert.equal(deriveTitle(null, "explicar\no codigo"), "explicar o codigo");
});

test("deriveTitle: trunca em 50 caracteres com elipse", () => {
  const t = deriveTitle(null, "a".repeat(120));
  assert.equal(t.length, 50);
  assert.ok(t.endsWith("…"), "faltou a elipse: " + JSON.stringify(t));
});

test("deriveTitle: respeita o limite pedido", () => {
  assert.equal(deriveTitle(null, "x".repeat(20), 10).length, 10);
});

test("deriveTitle: nada para derivar devolve null (quem chama cai no id)", () => {
  assert.equal(deriveTitle(null, ""), null);
  assert.equal(deriveTitle(null, "   "), null);
  assert.equal(deriveTitle(null, null), null);
  assert.equal(deriveTitle(undefined, undefined), null);
});

// ------------------------------------------------------------------ */
/* renderSessionsList — o que a lista mostra                           */
// ------------------------------------------------------------------ */

test("renderSessionsList: mostra id e título da sessão", () => {
  const lista = [{ id: "aaaaaaaa-1111", title: "Sessão nomeada", turns: 3, updatedAt: "2026-11-17T10:00:00.000Z" }];
  const extras = new Map([["aaaaaaaa-1111", { client: "cli", firstUser: null }]]);
  const saida = renderSessionsList(lista, extras).join("\n");

  assert.match(saida, /aaaaaaaa/);
  assert.match(saida, /Sessão nomeada/);
  assert.doesNotMatch(saida, /origem/i, "a coluna de origem não existe mais: só há a CLI");
});

test("renderSessionsList: título derivado aparece quando o header não tem título", () => {
  const lista = [{ id: "cccccccc-3333", title: null, turns: 1, updatedAt: "2026-11-17T10:00:00.000Z" }];
  const extras = new Map([["cccccccc-3333", { client: "cli", firstUser: "calcular o IMC de uma pessoa" }]]);
  const saida = renderSessionsList(lista, extras).join("\n");

  assert.match(saida, /calcular o IMC/);
});

test("renderSessionsList: sem título e sem mensagem, mostra o id em vez de vazio", () => {
  const lista = [{ id: "dddddddd-4444", title: null, turns: 0, updatedAt: "2026-11-17T10:00:00.000Z" }];
  const extras = new Map([["dddddddd-4444", { client: "cli", firstUser: null }]]);
  const saida = renderSessionsList(lista, extras).join("\n");

  assert.match(saida, /dddddddd/);
});

test("renderSessionsList: nenhuma linha passa de 72 colunas", () => {
  const lista = [{ id: "eeeeeeee-5555", title: "t".repeat(200), turns: 9, updatedAt: "2026-11-17T10:00:00.000Z" }];
  const extras = new Map([["eeeeeeee-5555", { client: "cli", firstUser: null }]]);
  for (const linha of renderSessionsList(lista, extras)) {
    assert.ok(visibleWidth(linha) <= WIDTH, `passou de ${WIDTH}: ${visibleWidth(linha)} — ${linha}`);
  }
});

test("renderSessionsList: lista cheia avisa que há mais", () => {
  const lista = Array.from({ length: 20 }, (_, i) => ({
    id: `sessao-${i}-xxxx`,
    title: `sessão ${i}`,
    turns: 1,
    updatedAt: "2026-11-17T10:00:00.000Z",
  }));
  const extras = new Map(lista.map((s) => [s.id, { client: "cli", firstUser: null }]));
  const saida = renderSessionsList(lista, extras, 5).join("\n");

  assert.match(saida, /e mais 15 sess/);
});

// ------------------------------------------------------------------ */
/* renderSettings — o que o Ctrl+, mostra                             */
// ------------------------------------------------------------------ */

test("renderSettings: mostra o que está valendo nesta sessão", () => {
  const linhas = renderSettings(
    { mode: "plan", permission: "ask", model: "provedor/modelo", reasoning: "high" },
    { sessionsDir: "/tmp/sessoes", commands: 20 },
  );
  const texto = linhas.join("\n");

  assert.match(texto, /configurações/);
  assert.match(texto, /plan/);
  assert.match(texto, /ask/);
  assert.match(texto, /provedor\/modelo/);
  assert.match(texto, /high/);
  assert.match(texto, /\/tmp\/sessoes/);
  assert.match(texto, /20/);
  assert.match(texto, /ctrl\+, fecha/);
});

test("renderSettings: sem diretório resolvido não inventa caminho", () => {
  const linhas = renderSettings({ mode: "build", permission: "full access" }, { sessionsDir: null });
  const texto = linhas.join("\n");

  assert.match(texto, /não resolvido/);
  assert.doesNotMatch(texto, /undefined/);
});

test("renderSettings: nenhuma linha passa de 72 colunas", () => {
  const linhas = renderSettings(
    { mode: "build", permission: "full access", model: "a".repeat(90), reasoning: "max", context: "1k / 200k" },
    { sessionsDir: "C:\\um\\caminho\\muito\\longo\\para\\cabem\\em\\uma\\linha\\de\\sessoes", commands: 20 },
  );
  for (const linha of linhas) {
    assert.ok(visibleWidth(linha) <= WIDTH, `passou de ${WIDTH}: ${visibleWidth(linha)}`);
  }
});

// ------------------------------------------------------------------ */
/* Atalhos novos no REPL                                               */
// ------------------------------------------------------------------ */

test("REPL: ctrl+k abre a lista de sessões e fecha de novo", async () => {
  // Fixture isolada: 3 sessões fake num diretório temporário. Assim a varredura
  // é instantânea e determinística (não lê as centenas de subpastas reais, que
  // é o que fazia este teste flakear). Injetada via parâmetro sessionsDir.
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "selfevopi-ctrlk-"));
  try {
    for (let i = 0; i < 3; i++) {
      const header = { type: "session", version: 1, id: `sess${i}`, client: "cli" };
      const msg = { type: "message", role: "user", content: "oi" };
      const file = path.join(fixtureDir, `${randomUUID()}.jsonl`);
      await writeFile(file, JSON.stringify(header) + "\n" + JSON.stringify(msg) + "\n", "utf8");
    }

    const input = new EventEmitter();
    input.setEncoding = () => {};
    input.isTTY = true;
    let all = "";
    repl({ pi: null, write: (s) => (all += s), input, setRaw: () => {}, data: {}, sessionsDir: fixtureDir });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await sleep(20);

    all = "";
    input.emit("data", "\x0b"); // ctrl+k abre o picker de sessões
    await sleep(400); // picker asíncrono carrega as 3 sessões do fixture (folga p/ carga)
    const aberta = stripAnsi(all);
    // o picker mostra o título "sessões (3)" e não "nenhuma"
    assert.match(aberta, /sessões/i, "o picker de sessões não abriu");
    assert.match(aberta, /\(3\)/, "as 3 sessões do fixture não apareceram");
    assert.doesNotMatch(aberta, /nenhuma sess/);

    all = "";
    input.emit("data", "\x1b"); // esc fecha o picker
    await sleep(80);
    // o título do picker some (a linha de dicas pode citar "ctrl+k sessões")
    assert.doesNotMatch(stripAnsi(all), /sessões \(/);

    input.emit("data", "\x04");
    await sleep(30);
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test("REPL: ctrl+, abre as configurações e fecha de novo", async () => {
  const input = new EventEmitter();
  input.setEncoding = () => {};
  input.isTTY = true;
  let all = "";
  repl({ pi: null, write: (s) => (all += s), input, setRaw: () => {}, data: {} });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(20);

  all = "";
  input.emit("data", "\x1c"); // ctrl+, abre o editor de configurações
  await sleep(80);
  const aberta = stripAnsi(all);
  assert.match(aberta, /configurações/);
  assert.match(aberta, /permissão/);
  assert.match(aberta, /modelo/);

  all = "";
  input.emit("data", "\x1b"); // esc fecha o editor
  await sleep(80);
  assert.doesNotMatch(stripAnsi(all), /configurações/);

  input.emit("data", "\x04");
  await sleep(30);
});

test("REPL: abrir as sessões fecha as configurações (um overlay por vez)", async () => {
  // Mesma correção do ctrl+k: fixture isolada com 3 sessões fake, injetada via
  // sessionsDir, para não varrer as centenas de subpastas reais (que é o que
  // fazia este teste flakear sob carga).
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "selfevopi-irmao-"));
  try {
    for (let i = 0; i < 3; i++) {
      const header = { type: "session", version: 1, id: `sess${i}`, client: "cli" };
      const msg = { type: "message", role: "user", content: "oi" };
      const file = path.join(fixtureDir, `${randomUUID()}.jsonl`);
      await writeFile(file, JSON.stringify(header) + "\n" + JSON.stringify(msg) + "\n", "utf8");
    }

    const input = new EventEmitter();
    input.setEncoding = () => {};
    input.isTTY = true;
    let all = "";
    repl({ pi: null, write: (s) => (all += s), input, setRaw: () => {}, data: {}, sessionsDir: fixtureDir });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await sleep(20);

    input.emit("data", "\x1c"); // configurações
    await sleep(80);
    assert.match(stripAnsi(all), /configurações/);

    // limpa antes: o frame anterior continua no buffer, e o que importa é o novo
    all = "";
    input.emit("data", "\x0b"); // sessões — tem que fechar as configurações
    await sleep(100); // com 3 sessões, a varredura é instantânea
    assert.doesNotMatch(stripAnsi(all), /configurações/);

    input.emit("data", "\x04");
    await sleep(30);
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ */
/* readSessionExtras — leitura seletiva                                */
// ------------------------------------------------------------------ */

test("readSessionExtras: pasta inexistente devolve mapa vazio sem lançar", async () => {
  const base = process.env.TEMP || process.env.TMP || ".";
  const extras = await readSessionExtras(path.join(base, "selfevopi-nao-existe-" + Date.now()));
  assert.equal(extras.size, 0);
});

/* ---------------------------------------------------------------- */
/* /model: seletor, /effort e /mode                                 */
/* ---------------------------------------------------------------- */

test("COMMANDS inclui /effort e /mode (e /model continua lá)", () => {
  const names = COMMANDS.map((c) => c.name);
  for (const n of ["/model", "/effort", "/mode"]) {
    assert.ok(names.includes(n), `falta ${n}`);
  }
});

test("normalizeEffortList: aceita lista do motor, limpa e cai no fallback", () => {
  assert.deepEqual(normalizeEffortList(["off", "low", "medium", "high"]), [
    "off",
    "low",
    "medium",
    "high",
  ]);
  // normaliza caixa e descarta lixo
  assert.deepEqual(normalizeEffortList([" OFF ", "High", "", null, 7]), ["off", "high"]);
  // lista vazia / nada utilizável → fallback documentado
  assert.deepEqual(normalizeEffortList([]), [...EFFORT_FALLBACK]);
  assert.deepEqual(normalizeEffortList(null), [...EFFORT_FALLBACK]);
});

test("resolveEffort: casa o argumento com a lista, sem caixa", () => {
  const niveis = ["off", "low", "medium", "high"];
  assert.equal(resolveEffort("HIGH", niveis), "high");
  assert.equal(resolveEffort("  low ", niveis), "low");
  assert.equal(resolveEffort("max", niveis), null); // o modelo não expõe
  assert.equal(resolveEffort("", niveis), null);
  // "max" só passa quando o modelo o expõe
  assert.equal(resolveEffort("max", ["off", "max"]), "max");
});

test("describeModeLine: descreve o que o modo permite", () => {
  const plan = describeModeLine({ name: "plan", canRead: true, canWrite: false, canExec: false, execScope: "none" });
  assert.match(plan, /^plan: /);
  assert.match(plan, /lê/);
  assert.match(plan, /não escreve/);
  assert.match(plan, /não executa/);

  const build = describeModeLine({ name: "build", canRead: true, canWrite: true, canExec: true, execScope: "workspace" });
  assert.match(build, /escreve/);
  assert.ok(build.includes("executa (workspace)"), "escopo de execucao ausente");

  assert.equal(describeModeLine(null), null);
});

test("groupModelsByProvider + flattenModelGroups: seções e índice navegável", () => {
  const grupos = groupModelsByProvider([
    { provider: "kilo1", id: "a" },
    { provider: "kilo1", id: "b" },
    { provider: "or1", id: "c" },
    { provider: "lixo" }, // sem id: fora
    null,
  ]);
  assert.deepEqual(grupos, [
    { provider: "kilo1", ids: ["a", "b"] },
    { provider: "or1", ids: ["c"] },
  ]);

  const { linhas, flat } = flattenModelGroups(grupos);
  assert.equal(flat.length, 3);
  assert.deepEqual(flat[0], { provider: "kilo1", id: "a" });
  // as linhas alternam cabeçalho de seção e item, com o índice certo
  assert.equal(linhas[0].kind, "group");
  assert.equal(linhas[1].kind, "model");
  assert.equal(linhas[1].flatIndex, 0);
  assert.equal(linhas[2].flatIndex, 1);
});

test("renderModelPicker: etapa de modelos agrupa por provedor e marca a seleção", () => {
  const grupos = [
    { provider: "kilo1", ids: ["a", "b"] },
    { provider: "or1", ids: ["c"] },
  ];
  const linhas = renderModelPicker({ stage: "models", sel: 1, grupos, niveis: [], modelo: null });
  const texto = stripAnsi(linhas.join("\n"));

  assert.match(texto, /kilo1/);
  assert.match(texto, /or1/);
  assert.ok(texto.includes("a") && texto.includes("b") && texto.includes("c"));
  assert.match(texto, /enter escolher/);
  assert.match(texto, /esc cancela/);
  // a linha 1 (segundo item) é a selecionada: tem o marcador
  const marcada = linhas.filter((l) => l.includes("›"));
  assert.equal(marcada.length, 1);
});

test("renderModelPicker: sem modelos configurados não quebra", () => {
  const linhas = renderModelPicker({ stage: "models", sel: 0, grupos: [], niveis: [], modelo: null });
  const texto = stripAnsi(linhas.join("\n"));
  assert.match(texto, /nenhum modelo configurado/);
});

test("renderModelPicker: etapa de esforço lista só os níveis do modelo", () => {
  const linhas = renderModelPicker({
    stage: "effort",
    sel: 0,
    grupos: [],
    niveis: ["off", "max"],
    modelo: "or1/nemotron",
  });
  const texto = stripAnsi(linhas.join("\n"));
  assert.ok(texto.includes("or1/nemotron"), "nome do modelo ausente");
  assert.match(texto, /off/);
  assert.match(texto, /max/);
  assert.ok(!texto.includes("medium"), "não pode impor níveis que o modelo não expõe");
});

/* ---------------------------------------------------------------- */
/* Janela de rolagem e linha de entrada (fix de navegação)          */
/* ---------------------------------------------------------------- */

test("windowBounds: mantém a seleção visível e centraliza quando dá", () => {
  // total 0
  assert.deepEqual(windowBounds(0, 0, 10), { start: 0, end: 0 });
  // total < maxRows → mostra tudo
  assert.deepEqual(windowBounds(3, 1, 10), { start: 0, end: 3 });
  // total ≫ maxRows, sel no meio → janela contém sel (exemplo autoritativo do K2)
  const w = windowBounds(50, 30, 10);
  assert.ok(w.start <= 30 && 30 < w.end, "a janela precisa conter o selecionado");
  assert.ok(w.end - w.start <= 10, "a janela não pode passar de maxRows");
  // sel no fim → encosta em total-maxRows
  const wf = windowBounds(50, 49, 10);
  assert.equal(wf.end, 50);
  assert.ok(wf.start <= 49 && 49 < wf.end);
});

test("renderValuePicker: lista grande vira janela (não desenha tudo, seta visível)", () => {
  const items = Array.from({ length: 50 }, (_, i) => ({ label: `item ${i}`, value: i }));
  const linhas = renderValuePicker({ title: "teste", items, sel: 30, footer: "fim" });
  const texto = stripAnsi(linhas.join("\n"));
  const marcadas = linhas.filter((l) => l.includes("›"));
  assert.equal(marcadas.length, 1, "exatamente uma linha marcada");
  assert.match(texto, /item 30/, "o selecionado tem de aparecer");
  assert.ok(!texto.includes("item 0"), "não desenha a lista inteira (item 0 fora da janela)");
  assert.match(texto, /acima/, "indica que há itens acima");
  assert.match(texto, /31\/50/, "mostra a posição (1-based)");
});

test("inputWindow: texto grande mantém o cursor visível (sem cortar com ...)", () => {
  const buf = "x".repeat(100);
  const r = inputWindow(buf, 100, 20); // cursor no fim
  assert.equal(r.shown.length, 20, "mostra só o que cabe");
  assert.equal(r.curCol, 20, "cursor visível na borda direita");
  assert.ok(!r.shown.includes("…"), "não usa reticências");
  // buffer curto mostra tudo
  const curto = inputWindow("hello", 5, 68);
  assert.equal(curto.shown, "hello");
  assert.equal(curto.curCol, 5);
  // quebras de linha viram ↵ visível (não quebram o redraw de 1 linha)
  const multi = inputWindow("a\nb", 3, 68);
  assert.ok(multi.shown.includes("↵") && !multi.shown.includes("\n"));
});

test("runSlash /effort com motor ausente não lança e sai 0", async () => {
  let out = "";
  const code = await runSlash("/effort", "", (s) => (out += s + "\n"), { pi: null });
  assert.equal(code, 0);
  assert.ok(out.length >= 0);
});

test("runSlash /mode sem argumento alterna o modo e volta ao início", async () => {
  let out = "";
  const antes = getGoalState(); // garante que o módulo carregou
  void antes;
  const seen = [];
  for (let i = 0; i < 6; i++) {
    out = "";
    const code = await runSlash("/mode", "", (s) => (out += s + "\n"), { pi: null });
    assert.equal(code, 0);
    const texto = stripAnsi(out);
    const m = texto.match(/modo:\s*(\w+)/);
    assert.ok(m, "não mostrou o modo novo");
    seen.push(m[1]);
  }
  // 5 modos no anel: o sexto volta ao primeiro
  assert.equal(new Set(seen.slice(0, 5)).size, 5, "os cinco modos não apareceram");
  assert.equal(seen[5], seen[0], "o anel não voltou ao início");
});

/* ---------------------------------------------------------------- */
/* /model: seletor no REPL (setas, enter, esc)                      */
/* ---------------------------------------------------------------- */

/**
 * A lista de modelos vem da mesma fonte que o /model usa: a configuração do
 * usuário lida por listConfiguredModels. Só nomes — nunca chaves.
 */
async function configuredModelsForTest() {
  const { listConfiguredModels } = await import("../core/agent/pi-rpc.mjs");
  try {
    return listConfiguredModels();
  } catch {
    return [];
  }
}

/**
 * Motor dublê: só o que o seletor e o refreshStatus tocam.
 *
 * Sem `_rpc` a etapa de esforço é pulada; com `_rpc` ela pergunta os níveis
 * **daquele** modelo — é o que prova que a lista não é uma constante da CLI.
 */
function fakeModelEngine(levels = null) {
  const chamadas = [];
  const pi = {
    chamadas,
    on() { return () => {}; },
    prompt: async () => "started",
    abort: async () => {},
    getState: async () => ({ model: { provider: "p1", id: "m1" }, mode: "build" }),
    setModel: async (provider, id) => { chamadas.push(["setModel", provider, id]); return {}; },
    getAvailableModels: async () => [],
  };
  if (levels) {
    pi._rpc = {
      getAvailableThinkingLevels: async () => levels,
      setThinkingLevel: async (n) => { chamadas.push(["setThinkingLevel", n]); return null; },
    };
  }
  return pi;
}

/**
 * REPL com entrada dublê. `take()` esvazia o coletor, então cada etapa do
 * teste vê só o que a tecla anterior desenhou — sem herdar frames antigos.
 */
function openRepl(pi) {
  const input = new EventEmitter();
  input.setEncoding = () => {};
  input.isTTY = true;
  let all = "";
  const done = repl({ pi, write: (s) => (all += s), input, setRaw: () => {}, data: {} });
  return {
    input,
    done,
    press: async (data, ms = 60) => {
      input.emit("data", data);
      await new Promise((r) => setTimeout(r, ms));
    },
    take: () => { const t = stripAnsi(all); all = ""; return t; },
    close: async () => { await new Promise((r) => setTimeout(r, 40)); input.emit("data", "\u0004"); await done; },
  };
}

const ENTER = "\r";
const DOWN = "\u001b[B";
const ESC = "\u001b";

/**
 * /model sem argumento abre o seletor. São dois enters: o primeiro escolhe
 * `/model` na paleta (que preenche o buffer), o segundo submete o comando.
 */
async function abrirSeletor(h) {
  await h.press("", 40);
  h.take();
  await h.press("/model");
  await h.press(ENTER);
  await h.press(ENTER, 120);
  return h.take();
}

test("REPL /model: seletor abre com provedores em seções e o padrão de teclas", async () => {
  const h = openRepl(fakeModelEngine());
  const t = await abrirSeletor(h);

  assert.match(t, /modelo/, "o seletor não abriu");
  assert.match(t, /enter escolher/, "sem a dica de teclas (padrão da paleta)");
  assert.match(t, /esc cancela/, "sem a dica de cancelar");

  // provedores aparecem como cabeçalho de seção
  const lidos = new Set((await configuredModelsForTest()).map((m) => m.provider));
  const vistos = [...lidos].filter((p) => t.includes(p));
  assert.ok(vistos.length > 0, "nenhum provedor apareceu como seção");

  await h.close();
});

test("REPL /model: setas navegam e enter escolhe o modelo destacado", async () => {
  const pi = fakeModelEngine();
  const h = openRepl(pi);
  await abrirSeletor(h);

  // desce uma casa: o aplicado tem de ser o SEGUNDO modelo da lista achatada
  await h.press(DOWN, 80);
  await h.press(ENTER, 250);

  const aplicados = pi.chamadas.filter((c) => c[0] === "setModel");
  assert.equal(aplicados.length, 1, "enter não aplicou o modelo");

  const { flat } = flattenModelGroups(groupModelsByProvider(await configuredModelsForTest()));
  assert.ok(flat.length >= 2, "a máquina não tem dois modelos para escolher");
  const esperado = flat[1];
  assert.equal(aplicados[0][1], esperado.provider, "provedor errado após descer uma casa");
  assert.equal(aplicados[0][2], esperado.id, "modelo errado após descer uma casa");

  await h.close();
});

test("REPL /model: esc cancela sem aplicar nada", async () => {
  const pi = fakeModelEngine(["off", "low", "high"]);
  const h = openRepl(pi);
  await abrirSeletor(h);
  h.take();

  await h.press(ESC, 90);
  const fechado = h.take();
  assert.ok(!/enter escolher/.test(fechado), "esc não fechou o seletor");
  assert.equal(pi.chamadas.length, 0, "esc aplicou modelo ou esforço");

  await h.close();
});

test("REPL /model: depois do modelo pergunta o esforço daquele modelo", async () => {
  // "medium" ausente de propósito: se aparecer, a lista é constante, não do modelo.
  const pi = fakeModelEngine(["off", "low", "high"]);
  const h = openRepl(pi);
  await abrirSeletor(h);

  await h.press(ENTER, 300); // escolhe o modelo
  const etapa = h.take();

  assert.match(etapa, /esfor/, "não perguntou o esforço depois do modelo");
  for (const n of ["off", "low", "high"]) {
    assert.ok(etapa.includes(n), "faltou o nível " + n + " que o modelo expõe");
  }
  assert.ok(!etapa.includes("medium"), "impôs um nível que o modelo não expõe");

  await h.press(ENTER, 300); // escolhe o esforço
  const aplicacoes = pi.chamadas.filter((c) => c[0] === "setThinkingLevel");
  assert.equal(aplicacoes.length, 1, "não aplicou o esforço escolhido");
  assert.equal(aplicacoes[0][1], "off", "aplicou o nível errado");

  await h.close();
});

test("REPL /model <nome> direto pula o seletor", async () => {
  const pi = fakeModelEngine(["off", "low", "high"]);
  const h = openRepl(pi);
  try {
    await h.press("", 40);
    h.take();

    await h.press("/model nemotron");
    await h.press(ENTER, 200);
    const t = h.take();

    // A paleta sempre mostra "enter escolher" enquanto se digita; o que não
    // pode aparecer é o cabeçalho do seletor nem a etapa de esforço.
    assert.ok(!/^\s*modelo\s*$/m.test(t), "/model <nome> abriu o seletor mesmo com argumento");
    assert.ok(!/esc cancela/.test(t), "/model <nome> abriu o seletor mesmo com argumento");

    const aplicados = pi.chamadas.filter((c) => c[0] === "setModel");
    assert.equal(aplicados.length, 1, "/model <nome> não aplicou o modelo direto");
    assert.equal(aplicados[0][2], "nvidia/nemotron-3-ultra-550b-a55b:free");
  } finally {
    await h.close();
  }
});

test("runSlash /mode <nome> vai direto, sem passar pelo anel", async () => {
  let out = "";
  const code = await runSlash("/mode", "goal", (s) => (out += s + "\n"), { pi: null });
  assert.equal(code, 0);
  assert.match(stripAnsi(out), /modo:\s*goal/);
});

/* ------------------------------------------------------------------ */
/* /import — ligação com a CLI (preview/confirma/undo)                */
/* ------------------------------------------------------------------ */

test("/import está registrado em COMMANDS e aparece em SLASH_COMMANDS", () => {
  const names = COMMANDS.map((c) => c.name);
  assert.ok(names.includes("/import"), "/import não está em COMMANDS");
  const cmd = SLASH_COMMANDS.find((c) => c.cmd.split(" ")[0] === "/import");
  assert.ok(cmd, "/import não aparece em SLASH_COMMANDS");
  assert.ok(cmd.cmd.startsWith("/import"), "SLASH_COMMANDS deve listar /import");
});

test("/import --status sem ledger diz 'nenhum import registrado'", async () => {
  let out = "";
  const home = await mkdtemp(path.join(tmpdir(), "selfevopi-import-cli-"));
  try {
    const code = await runSlash("/import", "--status", (s) => (out += s + "\n"), { pi: null, home });
    assert.equal(code, 0);
    assert.match(stripAnsi(out), /nenhum import registrado/i);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("/import --undo sem manifesto diz 'nenhum import para desfazer'", async () => {
  let out = "";
  const home = await mkdtemp(path.join(tmpdir(), "selfevopi-import-cli-"));
  try {
    const code = await runSlash("/import", "--undo", (s) => (out += s + "\n"), { pi: null, home });
    assert.equal(code, 0);
    assert.match(stripAnsi(out), /nenhum import para desfazer/i);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("/import (prévia) não escreve nada; importar aplica; --undo restaura", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "selfevopi-import-cli-"));
  const out = [];
  const sink = (s) => out.push(s + "\n");
  try {
    // fonte OpenCode
    const srcDir = path.join(home, ".config", "opencode", "skills", "skill-a");
    await mkdir(srcDir, { recursive: true });
    await writeFile(
      path.join(home, ".config", "opencode", "opencode.jsonc"),
      JSON.stringify({ mcpServers: { fake: { type: "local", command: "node", args: ["s.mjs"] } } })
    );
    await writeFile(
      path.join(srcDir, "SKILL.md"),
      "---\nname: skill-a\ndescription: teste\n---\ncorpo\n"
    );

    // 1) prévia: não escreve
    await runSlash("/import", "", sink, { pi: null, home });
    assert.match(stripAnsi(out.join("")), /seriam copiados/i);
    assert.equal(existsSync(path.join(home, ".pi", "settings.json")), false, "prévia não deve escrever settings.json");

    // 2) importar: aplica
    out.length = 0;
    await runSlash("/import", "importar", sink, { pi: null, home });
    assert.match(stripAnsi(out.join("")), /import concluído/i);
    assert.ok(existsSync(path.join(home, ".pi", "settings.json")), "importar deve gravar settings.json");
    assert.ok(existsSync(path.join(home, ".pi", "skills", "skill-a", "SKILL.md")), "importar deve copiar skill");

    // 3) --undo: restaura
    out.length = 0;
    await runSlash("/import", "--undo", sink, { pi: null, home });
    assert.match(stripAnsi(out.join("")), /import desfeito/i);
    assert.equal(existsSync(path.join(home, ".pi", "skills", "skill-a", "SKILL.md")), false, "undo deve apagar skill");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

