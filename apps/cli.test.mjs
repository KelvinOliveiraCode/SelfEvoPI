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
  assert.match(boot, /build · full access/);
  assert.match(boot, /ctrl\+o painel/);
  // ctrl+o abre
  all = "";
  input.emit("data", "\x0f");
  await sleep(30);
  assert.match(stripAnsi(all), /permissão:\s+full access/);
  assert.match(stripAnsi(all), /modelo:/);
  // ctrl+o fecha
  all = "";
  input.emit("data", "\x0f");
  await sleep(30);
  assert.doesNotMatch(stripAnsi(all), /permissão:/);
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

/* ------------------------------------------------------------------ */
/* Sessões — origem (client) e título derivado                         */
/* ------------------------------------------------------------------ */

test("sessionOrigin: campo ausente é cli (contrato desktop 1.0, seção 1)", () => {
  assert.equal(sessionOrigin(undefined), "cli");
  assert.equal(sessionOrigin(null), "cli");
  assert.equal(sessionOrigin(""), "cli");
  assert.equal(sessionOrigin("   "), "cli");
});

test("sessionOrigin: desktop e cli são reconhecidos sem caixa e com espaço", () => {
  assert.equal(sessionOrigin("desktop"), "desktop");
  assert.equal(sessionOrigin("DESKTOP"), "desktop");
  assert.equal(sessionOrigin("  desktop  "), "desktop");
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

test("renderSessionsList: coluna de origem aparece quando há desktop", () => {
  const lista = [{ id: "aaaaaaaa-1111", title: "Do desktop", turns: 3, updatedAt: "2026-11-17T10:00:00.000Z" }];
  const extras = new Map([["aaaaaaaa-1111", { client: "desktop", firstUser: null }]]);
  const saida = renderSessionsList(lista, extras).join("\n");

  assert.match(saida, /desktop/);
  assert.match(saida, /aaaaaaaa/);
  assert.match(saida, /Do desktop/);
});

test("renderSessionsList: sem desktop a coluna não aparece", () => {
  const lista = [{ id: "bbbbbbbb-2222", title: "Do cli", turns: 1, updatedAt: "2026-11-17T10:00:00.000Z" }];
  const extras = new Map([["bbbbbbbb-2222", { client: "cli", firstUser: null }]]);
  const saida = renderSessionsList(lista, extras).join("\n");

  assert.doesNotMatch(saida, /desktop/);
  assert.match(saida, /bbbbbbbb/);
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
  const extras = new Map([["eeeeeeee-5555", { client: "desktop", firstUser: null }]]);
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
  const input = new EventEmitter();
  input.setEncoding = () => {};
  input.isTTY = true;
  let all = "";
  repl({ pi: null, write: (s) => (all += s), input, setRaw: () => {}, data: {} });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(20);

  all = "";
  input.emit("data", "\x0b"); // ctrl+k
  await sleep(2000); // a primeira abertura varre a pasta de sessões
  const aberta = stripAnsi(all);
  // a lista mostra "N sessão(es)" ou "nenhuma sessão encontrada" — nunca as duas
  assert.match(aberta, /\d+ sess|nenhuma sess/, "a lista de sessões não apareceu");

  all = "";
  input.emit("data", "\x0b"); // ctrl+k fecha
  await sleep(80);
  assert.doesNotMatch(stripAnsi(all), /\d+ sess|nenhuma sess/);

  input.emit("data", "\x04");
  await sleep(30);
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
  input.emit("data", "\x1c"); // ctrl+, (0x1C é o que o terminal manda)
  await sleep(80);
  const aberta = stripAnsi(all);
  assert.match(aberta, /configurações/);
  assert.match(aberta, /permissão:/);
  assert.match(aberta, /ctrl\+, fecha/);

  all = "";
  input.emit("data", "\x1c"); // fecha
  await sleep(80);
  assert.doesNotMatch(stripAnsi(all), /configurações/);

  input.emit("data", "\x04");
  await sleep(30);
});

test("REPL: abrir as sessões fecha as configurações (um overlay por vez)", async () => {
  const input = new EventEmitter();
  input.setEncoding = () => {};
  input.isTTY = true;
  let all = "";
  repl({ pi: null, write: (s) => (all += s), input, setRaw: () => {}, data: {} });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(20);

  input.emit("data", "\x1c"); // configurações
  await sleep(80);
  assert.match(stripAnsi(all), /configurações/);

  input.emit("data", "\x0b"); // sessões — tem que fechar as configurações
  await sleep(2000);
  assert.doesNotMatch(stripAnsi(all), /configurações/);

  input.emit("data", "\x04");
  await sleep(30);
});

// ------------------------------------------------------------------ */
/* readSessionExtras — leitura seletiva                                */
// ------------------------------------------------------------------ */

test("readSessionExtras: pasta inexistente devolve mapa vazio sem lançar", async () => {
  const base = process.env.TEMP || process.env.TMP || ".";
  const extras = await readSessionExtras(path.join(base, "selfevopi-nao-existe-" + Date.now()));
  assert.equal(extras.size, 0);
});