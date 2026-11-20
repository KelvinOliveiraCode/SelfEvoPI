#!/usr/bin/env node
/**
 * apps/cli.mjs — a CLI do SelfEvoPI: uma conversa, não um catálogo.
 *
 * Gramática: REPL de conversa (estilo Claude Code). Herda a MARCA
 * (docs/design/marca.md §1.1 e docs/design/superficies.md):
 *   - banner ◍ SelfEvoPI + versão (voz do produto; nunca cita o motor);
 *   - paleta via truecolor (#000/#fff/#787878) quando o terminal aceita,
 *     degradação honesta para as cores do terminal caso contrário;
 *   - estado como ponto `●`; régua de 64 `─`; frame em 72 colunas.
 *
 * O SelfEvoPI é o produto. O motor é a conversa e é invisível: a interface
 * não diz o nome dele em lugar nenhum — banner, erros, logs ou ajuda.
 *
 * Não reimplementa nada: a conversa mora em core/agent/pi-rpc.mjs; os comandos
 * de barra chamam os módulos existentes (evals/, core/forge, core/memory).
 *
 * Uso:
 *   node apps/cli.mjs                      # conversa (TTY); sem TTY, modo linha
 *   node apps/cli.mjs --render conversation# imprime um frame como texto e sai
 *   node apps/cli.mjs --render help        # idem, a ajuda
 *   node apps/cli.mjs --render banner      # idem, só o banner + estado
 *   node apps/cli.mjs --help               # uso
 *   node apps/cli.mjs --version            # versão
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { findEngine, listConfiguredModels } from "../core/agent/pi-rpc.mjs";
import { getTheme, themeToAnsi } from "../core/agent/theme.mjs";

// Acoplamento conhecido: usamos pi._rpc (acesso interno do RpcClient) para
// getSessionStats/getMessages/switchSession, que o wrapper PiClient
// (core/agent/pi-rpc.mjs) não expõe. É deliberado e contido; mover os três
// métodos para o wrapper é mudança futura em área compartilhada (core/agent/).

const ROOT = path.resolve(import.meta.dirname, "..");
const LEDGER = path.join(ROOT, ".pi", "harness", "ledger", "evals.jsonl");
const BASELINE = path.join(ROOT, "evals", "baseline.json");
const MEMORY = path.join(ROOT, ".pi", "harness", "memory");

const WIDTH = 72; // colunas do frame (em 80 não quebra)
const RULE = 64; // régua de ─ (marca §1.1)

/* ------------------------------------------------------------------ */
/* Paleta (marca §1.1 / §2) — truecolor ou degradação honesta          */
/* ------------------------------------------------------------------ */

function detectTruecolor() {
  const ct = String(process.env.COLORTERM || "").toLowerCase();
  return ct.includes("truecolor") || ct.includes("24bit");
}

const TRUE = detectTruecolor();

// A paleta vem do TEMA ATIVO (core/agent/theme.mjs), não de um PX fixo: assim o
// comando /theme muda de fato as cores da CLI (antes o tema era persistido, mas o
// render usava um PX hardcoded — /theme não fazia nada). `rule`/`code` derivam do
// tema; reset/bold/dim/italic são SGR, não cor.
const SGR = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", italic: "\x1b[3m" };
let _pxCache = null;
let _pxTheme = null;
function px() {
  const name = getTheme();
  if (_pxCache && _pxTheme === name) return _pxCache;
  const a = themeToAnsi(name); // { fg, muted, accent, ok, warn, fail } em truecolor
  _pxCache = {
    ...SGR,
    fg: TRUE ? a.fg : "",
    muted: TRUE ? a.muted : "\x1b[90m",
    rule: TRUE ? "\x1b[38;2;74;74;74m" : "\x1b[90m",
    accent: TRUE ? a.accent : "\x1b[90m",
    code: TRUE ? "\x1b[38;2;200;200;200m" : "\x1b[37m",
    ok: TRUE ? a.ok : "\x1b[32m",
    warn: TRUE ? a.warn : "\x1b[33m",
    fail: TRUE ? a.fail : "\x1b[31m",
  };
  _pxTheme = name;
  return _pxCache;
}

const STATE_KEY = { green: "ok", amber: "warn", red: "fail" };

function paint(text, key) {
  const p = px();
  const c = p[key];
  return c ? `${c}${text}${p.reset}` : String(text);
}

export function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

export function visibleWidth(s) {
  return stripAnsi(s).length;
}

/** Trunca/preenche uma linha para a largura (colunas visíveis). */
function fit(s, width = WIDTH) {
  const plain = stripAnsi(String(s));
  if (plain.length > width) return plain.slice(0, width);
  return plain + " ".repeat(width - plain.length);
}

function rule() {
  return "  " + paint("─".repeat(RULE), "rule");
}

/* ------------------------------------------------------------------ */
/* Versão, estado, banner                                             */
/* ------------------------------------------------------------------ */

let VERSION = "0.0.0";
try {
  VERSION = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version || VERSION;
} catch {
  /* mantém 0.0.0 */
}

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

/** Estado do harness (voz do produto): ponto verde/âmbar + rótulo neutro. */
export function harnessState(data = {}) {
  const lkg = data.lkg || readJson(path.join(ROOT, ".pi", "harness", "last-known-good.json"), {});
  if (lkg && lkg.sha) return { label: "pronto", color: "green" };
  return { label: "cold start", color: "amber" };
}

/** Linha de estado: branch · estado · baseline. Sem citar o motor. */
export function renderStatusLine(data = {}) {
  const st = harnessState(data);
  const dot = paint("●", STATE_KEY[st.color] || "warn");
  const base = data.baseline || readJson(BASELINE, {});
  const t = base.totals || {};
  const cells = t.taskRuns != null && t.passes != null ? `${t.passes}/${t.taskRuns} baseline` : "baseline ?";
  const branch = data.branch || "repo";
  const state = paint(st.label, STATE_KEY[st.color] || "warn");
  const mode = data.mode ? ` · ${paint(data.mode, "accent")}` : "";
  const line = `  ${dot} ${branch} · ${state} · ${paint(cells, "muted")}${mode}`;
  // Preserva ANSI (não usa fit(), que removeria as cores e deixava a linha monocromática).
  return visibleWidth(line) > WIDTH ? truncateVisible(line, WIDTH) : line;
}

/** Banner: ◍ SelfEvoPI ... v0.5.0 + tagline. Voz do produto; nunca cita o motor. */
export function renderBanner() {
  const left = `  ${paint("◍", "accent")}  ${paint("SelfEvoPI", "bold")}`;
  const right = paint(`v${VERSION}`, "muted");
  const pad = Math.max(1, WIDTH - visibleWidth(left) - visibleWidth(right));
  return left + " ".repeat(pad) + right;
}

/**
 * Tagline do banner (voz do produto). Aparece uma vez, abaixo do banner, no
 * frame de conversa e nos frames headless — dá identidade sem citar o motor.
 */
export function renderTagline() {
  return `  ${paint("harness de código que mede o que falta e constrói.", "muted")}`;
}

/* ------------------------------------------------------------------ */
/* Markdown renderizado (negrito, listas, código, tabelas)            */
/* ------------------------------------------------------------------ */

/** Destaca um trecho de texto corrido (inline) e devolve com ANSI. */
function renderInline(text) {
  let s = String(text);
  // links [texto](url) → texto (url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, u) => `${t} ${paint("(" + u + ")", "muted")}`);
  // código inline `x` (protege contra os demais)
  const codeSpans = [];
  s = s.replace(/`([^`]+)`/g, (_m, c) => {
    codeSpans.push(c);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });
  // negrito **x** ou __x__
  s = s.replace(/\*\*([^*]+)\*\*/g, (_m, b) => paint(b, "bold"));
  s = s.replace(/__([^_]+)__/g, (_m, b) => paint(b, "bold"));
  // itálico *x* (não confunde com ** já resolvido)
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, (_m, pre, it) => pre + paint(it, "italic"));
  // restaura código inline
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i) => paint(codeSpans[Number(i)] ?? "", "code"));
  return s;
}

/** Tabela markdown → linhas alinhadas em colunas (larguras por conteúdo). */
function renderTable(rows) {
  const cells = rows.map((r) =>
    r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim()),
  );
  const header = cells[0] || [];
  const body = cells.slice(1).filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c) || c === ""));
  const ncol = header.length;
  const widths = [];
  for (let c = 0; c < ncol; c++) {
    let w = stripAnsi(header[c] || "").length;
    for (const row of body) w = Math.max(w, stripAnsi(row[c] || "").length);
    widths[c] = w;
  }
  const pad = (txt, w) => {
    const t = stripAnsi(txt);
    return txt + " ".repeat(Math.max(0, w - t.length));
  };
  const out = [];
  out.push("  " + header.map((h, i) => pad(paint(h, "bold"), widths[i])).join("  "));
  out.push("  " + widths.map((w) => paint("─".repeat(w), "rule")).join("  "));
  for (const row of body) {
    out.push("  " + row.map((c, i) => pad(c, widths[i])).join("  "));
  }
  return out;
}

/**
 * Quebra uma linha (com escapes ANSI) em largura `width` colunas visíveis,
 * quebrando em espaços e preservando os escapes. Linhas curtas ficam intactas.
 *
 * @param {string} str
 * @param {number} width
 * @returns {string} com `\n` nas quebras
 */
export function wrapAnsi(str, width) {
  const s = String(str);
  if (width <= 0 || visibleWidth(s) <= width) return s;

  // tokeniza em escapes ANSI e caracteres visíveis
  const tokens = [];
  const re = /\x1b\[[0-9;]*m/g;
  let last = 0;
  let m;
  const pushChars = (chunk) => {
    for (const ch of chunk) tokens.push(ch);
  };
  while ((m = re.exec(s))) {
    pushChars(s.slice(last, m.index));
    tokens.push({ esc: m[0] });
    last = m.index + m[0].length;
  }
  pushChars(s.slice(last));

  const outLines = [];
  let line = "";
  let visChars = []; // índices, em `line`, dos caracteres visíveis
  let vis = 0;

  const reindex = (text) => {
    const chars = [];
    let i = 0;
    while (i < text.length) {
      if (text[i] === "\x1b") {
        const mm = /^\x1b\[[0-9;]*m/.exec(text.slice(i));
        if (mm) {
          i += mm[0].length;
          continue;
        }
      }
      chars.push(i);
      i++;
    }
    return chars;
  };
  const flush = () => {
    outLines.push(line);
    line = "";
    visChars = [];
    vis = 0;
  };

  for (let ti = 0; ti < tokens.length; ) {
    const tok = tokens[ti];
    if (tok && typeof tok === "object" && tok.esc !== undefined) {
      line += tok.esc;
      ti++;
      continue;
    }
    const ch = tok;
    if (ch === "\n") {
      flush();
      ti++;
      continue;
    }
    if (vis === width) {
      // procura o último espaço visível para quebrar
      let sp = -1;
      for (let k = visChars.length - 1; k >= 0; k--) {
        if (line[visChars[k]] === " ") {
          sp = visChars[k];
          break;
        }
      }
      if (sp > 0) {
        outLines.push(line.slice(0, sp));
        line = line.slice(sp + 1); // descarta o espaço da quebra
        visChars = reindex(line);
        vis = visChars.length;
        continue; // NÃO avança ti: reprocessa o mesmo caractere
      }
      // sem espaço: quebra dura e reprocessa o caractere na linha nova
      flush();
      continue;
    }
    visChars.push(line.length);
    line += ch;
    vis++;
    ti++;
  }
  if (line !== "" || outLines.length === 0) flush();
  return outLines.join("\n");
}

/**
 * Renderiza markdown para texto ANSI (linha a linha). Cobre o que o modelo
 * escreve: blocos de código cercados, títulos, listas, citações, tabelas,
 * régua horizontal e o texto corrido com ênfase. Cada linha final é quebrada
 * em `width` colunas (respeitando a largura do frame).
 *
 * @param {string} md
 * @returns {string} texto com ANSI e \n
 */
export function renderMarkdown(md) {
  const lines = String(md ?? "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  let inCode = false;
  let codeBuf = [];
  let listIndent = 0;

  const flushCode = () => {
    if (codeBuf.length === 0) return;
    for (const cl of codeBuf) out.push("  " + paint("│", "rule") + " " + paint(cl, "code"));
    codeBuf = [];
    out.push("");
  };

  while (i < lines.length) {
    const line = lines[i];

    // bloco de código cercado ```
    if (/^\s*```/.test(line)) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        inCode = true;
      }
      i++;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      i++;
      continue;
    }

    // régua horizontal
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push("  " + paint("─".repeat(RULE - 2), "rule"));
      i++;
      continue;
    }

    // título # .. ######
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const prefix = level <= 2 ? "" : "  ".repeat(level - 2);
      out.push("");
      out.push(prefix + paint(h[2], "bold"));
      i++;
      continue;
    }

    // tabela markdown: linha com | e a próxima é separador |---|
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const block = [];
      let j = i;
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) {
        block.push(lines[j]);
        j++;
      }
      out.push(...renderTable(block));
      out.push("");
      i = j;
      continue;
    }

    // citação >
    const q = /^\s*>\s?(.*)$/.exec(line);
    if (q) {
      out.push("  " + paint("│", "rule") + " " + paint(renderInline(q[1]), "muted"));
      i++;
      continue;
    }

    // item de lista
    const li = /^(\s*)([-*+])\s+(.*)$/.exec(line);
    if (li) {
      listIndent = li[1].length;
      out.push("  ".repeat(1 + Math.floor(listIndent / 2)) + paint("•", "fg") + " " + renderInline(li[3]));
      i++;
      continue;
    }

    // item numerado
    const lo = /^(\s*)(\d+)\.\s+(.*)$/.exec(line);
    if (lo) {
      out.push("  " + paint(`${lo[2]}.`, "fg") + " " + renderInline(lo[3]));
      i++;
      continue;
    }

    // linha em branco: separa parágrafos
    if (line.trim() === "") {
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      i++;
      continue;
    }

    // parágrafo comum
    out.push("  " + renderInline(line));
    i++;
  }
  if (inCode) flushCode();
  return out.map((line) => wrapAnsi(line, WIDTH)).join("\n");
}

/* ------------------------------------------------------------------ */
/* Comandos de barra                                                  */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Comandos 1.1: settings, theme, swarm                                */
/* ------------------------------------------------------------------ */

/**
 * Trunca cada linha em 72 colunas.
 *
 * A TUI desenha em 72 e um texto mais longo desalinha o resto da tela. A
 * saida de comando e dado do usuario ou do provedor — nao da para confiar
 * que caiba. `stripAnsi` existe para medir sem contar as sequencias de cor.
 */
function capLinhas(linhas, largura = 72) {
  return linhas.map((l) => {
    const texto = String(l);
    if (visibleWidth(texto) <= largura) return texto;
    // Fatia sem quebrar sequencias ANSI: percorre a string contando largura
    // visivel e so entao corta, preservando o \x1b[0m no fim.
    let larguraV = 0;
    let corte = 0;
    let dentroAnsi = false;
    let estiloAberto = false;
    let inicioSeq = -1;
    for (let i = 0; i < texto.length && larguraV < largura - 1; i++) {
      const ch = texto[i];
      if (ch === "\x1b") { dentroAnsi = true; inicioSeq = i; continue; }
      if (dentroAnsi) {
        if (ch === "m") {
          dentroAnsi = false;
          // SGR: sequencia completa \x1b[...m. 0 = reset (fecha tudo),
          // != 0 = liga um estilo (negrito, cor, etc). Uma sequencia composta
          // como \x1b[0;33m começa com 0 e depois liga 33 — o estilo fica
          // aberto, então só \x1b[0m puro (ou \x1b[m) fecha.
          const seq = texto.slice(inicioSeq, i + 1);
          const corpo = seq.slice(2, -1); // remove \x1b[ e m
          estiloAberto = corpo !== "0" && corpo !== "";
        }
        continue;
      }
      corte = i + 1;
      larguraV++;
    }
    // Se o corte deixou algum SGR aberto (estilo ligado, \x1b[0m ainda não
    // veio), fecha com \x1b[0m antes da reticência para não vazar cor.
    return `${texto.slice(0, corte)}${estiloAberto ? "\x1b[0m" : ""}…`;
  });
}

async function runSettingsView({ out }) {
  const { renderSettings } = await import("../core/agent/settings-view.mjs");
  const { getTheme } = await import("../core/agent/theme.mjs");
  const { listConfiguredMcp } = await import("../core/agent/mcp-probe.mjs");
  const { listPcSkills } = await import("../core/agent/skills-user.mjs");

  // Cada fonte e opcional: se uma falhar, a visao mostra — e nao derruba.
  const seguro = async (fn, fallback) => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  };

  const [mcp, skills] = await Promise.all([
    seguro(() => listConfiguredMcp({}), []),
    seguro(() => listPcSkills({}), []),
  ]);

  const linhas = renderSettings({
    mode: currentMode,
    permission: permissionMode,
    model: null,
    effort: null,
    theme: getTheme(),
    mcp: mcp.length,
    skills: skills.length,
    sessions: null,
  });
  out(linhas.join("\n"));
  return 0;
}

async function runTheme({ arg, out }) {
  const { setTheme, getTheme, listThemes } = await import("../core/agent/theme.mjs");
  const nome = String(arg ?? "").trim();
  if (!nome) {
    out(`  tema atual: ${getTheme()}`);
    out(`  disponíveis: ${listThemes().join(", ")}`);
    return 0;
  }
  try {
    const antes = getTheme();
    const ok = setTheme(nome);
    if (!ok) {
      out(paint(`  tema "${nome}" nao existe. Disponiveis: ${listThemes().join(", ")}`, "fail"));
      return 1;
    }
    out(paint(`  tema: ${antes} -> ${getTheme()}`, "ok"));
    return 0;
  } catch (err) {
    out(paint(`  ${String(err?.message || err).slice(0, 120)}`, "fail"));
    return 2;
  }
}

async function runSwarm({ arg, out }) {
  const { planSwarm, renderSwarm, parseSwarmArgs } = await import("../core/agent/swarm.mjs");
  const bruto = String(arg ?? "").trim();
  if (!bruto) {
    out(paint("  uso: /swarm [n] <tarefa>", "muted"));
    return 2;
  }
  // Provedores vem do roteador; sem nenhum, o swarm diz e para.
  const provedores = (() => {
    try {
      return listConfiguredModels().map((m) => m.provider).filter((v, i, a) => a.indexOf(v) === i);
    } catch {
      return [];
    }
  })();
  if (provedores.length === 0) {
    out(paint("  nenhum provedor configurado — /swarm precisa de pelo menos um", "warn"));
    return 2;
  }
  const { n, task } = parseSwarmArgs(bruto);
  const plano = planSwarm({ task, n, providers: provedores });
  out(renderSwarm({ plan: plano }).join("\n"));
  out(paint("  (o modelo principal executa e coleta; /swarm <n> <tarefa> ajusta n)", "muted"));
  return 0;
}

// FONTE ÚNICA dos comandos de barra. A paleta e o /help leem daqui; o `run`
// é o executor. Nada de lista duplicada.
export const COMMANDS = [
  { name: "/evals", args: "", description: "roda os grupos A/B/C (estruturais)", run: runEvals },
  { name: "/gate", args: "", description: "gate completo (usa modelo; pode demorar)", run: runGate },
  { name: "/detect", args: "", description: "lacunas de ferramenta em aberto", run: runDetect },
  { name: "/forge", args: "<meta>", description: "inicia um ciclo evolutivo rumo à meta", run: runForge },
  { name: "/memory", args: "<termo>", description: "busca na memória (lexical + PPMI)", run: runMemory },
  { name: "/skills", args: "", description: "o que o loop já gerou e registrou", run: runSkills },
  { name: "/model", args: "[nome]", description: "seletor de modelo, ou troca direto", run: runModel },
  { name: "/effort", args: "[off|low|medium|high]", description: "esforço de raciocínio do modelo atual", run: runEffort },
  {
    name: "/mode",
    args: "[modo]",
    description: "alterna o modo (plan → build → manual → ask → goal)",
    run: (ctx) =>
      String(ctx?.arg ?? "").trim() === ""
        ? runModeCycle(ctx)
        : runMode(String(ctx.arg).trim(), ctx),
  },
  { name: "/clear", args: "", description: "limpa a conversa e começa de novo", run: runClear },
  { name: "/compact", args: "", description: "compacta o histórico da conversa", run: runCompact },
  { name: "/sessions", args: "[id]", description: "lista sessões ou carrega uma", run: runSessions },
  { name: "/cost", args: "", description: "tokens e custo da sessão", run: runCost },
  { name: "/status", args: "", description: "estado da sessão, modelo e modo", run: runStatus },
  { name: "/context", args: "", description: "quanto da janela de contexto está em uso", run: runContext },
  { name: "/mcp", args: "", description: "servidores MCP declarados", run: runMcp },
  { name: "/init", args: "", description: "gera um rascunho de AGENTS.md (pede confirmação)", run: runInit },
  {
    name: "/import",
    args: "[importar|--undo|--status]",
    description: "traz MCPs e skills para a config própria (pede confirmação)",
    run: runImport,
  },
  { name: "/plan", args: "", description: "modo plan: lê e propõe, não escreve", run: (ctx) => runMode("plan", ctx) },
  { name: "/build", args: "", description: "modo build: escreve e executa no workspace", run: (ctx) => runMode("build", ctx) },
  { name: "/ask", args: "", description: "modo ask: só responde, nunca toca em disco", run: (ctx) => runMode("ask", ctx) },
  { name: "/goal", args: "[condição|clear]", description: "define/limpa a condição de conclusão", run: runGoal },
  { name: "/settings", args: "", description: "visão de tudo que está configurado", run: runSettingsView },
  { name: "/theme", args: "[escuro|claro|alto-contraste]", description: "tema da interface", run: runTheme },
  { name: "/swarm", args: "[n] <tarefa>", description: "orquestra n subagentes rumo à tarefa", run: runSwarm },
  { name: "/help", args: "", description: "mostra esta lista", run: runHelp },
];

const SLASH_NAMES = new Set(COMMANDS.map((c) => c.name));

// Derivado de COMMANDS (nome+args e descrição) para quem só precisa do texto.
export const SLASH_COMMANDS = COMMANDS.map((c) => ({
  cmd: c.name + (c.args ? " " + c.args : ""),
  description: c.description,
}));

/**
 * Classifica uma linha de entrada.
 *   { type: "empty" }
 *   { type: "quit" }                         → q, /quit, /q
 *   { type: "slash", name, arg }             → /evals, /forge meta
 *   { type: "chat", text }                    → prosa para o agente
 *
 * @param {string} raw
 */
export function parseInput(raw) {
  const line = String(raw ?? "").trim();
  if (line === "") return { type: "empty" };
  if (line === "q" || line === "/quit" || line === "/q" || line === "/exit") return { type: "quit" };
  if (line.startsWith("/")) {
    const [name, ...rest] = line.slice(1).split(/\s+/);
    const withSlash = "/" + name;
    if (SLASH_NAMES.has(withSlash)) {
      return { type: "slash", name: withSlash, arg: rest.join(" ").trim() };
    }
    // barra desconhecida: trata como erro de comando, não vira prosa
    return { type: "slash", name: withSlash, arg: rest.join(" ").trim(), unknown: true };
  }
  return { type: "chat", text: line };
}

/** Ajuda (/help) — voz do produto, sem citar o motor. Lê de COMMANDS. */
/** Quebra texto plano em linhas de até `width` colunas (sem ANSI). */
function wrapPlain(text, width) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (cur === "") cur = w;
    else if ([...cur].length + 1 + [...w].length <= width) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length > 0 ? lines : [""];
}

/** Corta texto plano a `w` colunas, com "…" (sem ANSI). */
function clipPlain(text, w) {
  const chars = [...String(text ?? "")];
  if (chars.length <= w) return String(text ?? "");
  return chars.slice(0, Math.max(1, w - 1)).join("") + "…";
}

export function renderHelp() {
  const out = [];
  out.push(paint("COMANDOS", "bold"));
  out.push("");
  const LABEL = 32;
  for (const c of COMMANDS) {
    const raw = c.name + (c.args ? " " + c.args : "");
    const label = clipPlain(raw, LABEL).padEnd(LABEL);
    const descW = Math.max(8, WIDTH - LABEL - 4);
    const descLines = wrapPlain(c.description, descW);
    out.push(`  ${paint(label, "fg")}  ${paint(descLines[0], "muted")}`);
    for (let i = 1; i < descLines.length; i += 1) {
      out.push(`  ${" ".repeat(LABEL)}  ${paint(descLines[i], "muted")}`);
    }
  }
  out.push("");
  out.push(paint("CONVERSA", "bold"));
  out.push("");
  out.push(`  ${paint("escreva", "fg")} e Enter para falar; a resposta aparece em streaming.`);
  out.push(`  ${paint("Ctrl+C", "fg")} cancela a resposta em curso e devolve a linha.`);
  out.push(`  ${paint("Ctrl+O", "fg")} abre/fecha o painel de estado.`);
  out.push(`  ${paint("Ctrl+K", "fg")} abre/fecha a lista de sessões.`);
  out.push(`  ${paint("Ctrl+,", "fg")} abre/fecha as configurações.`);
  out.push(`  ${paint("q", "fg")} / ${paint("/quit", "fg")} / ${paint("Ctrl+D", "fg")} saem.`);
  return out
    .map((line) => (visibleWidth(line) > WIDTH ? truncateVisible(line, WIDTH) : line))
    .join("\n");
}

/* ------------------------------------------------------------------ */
/* Paleta de comandos (filtro puro + desenho puro)                    */
/* ------------------------------------------------------------------ */

/** Corta uma linha (com ANSI) a `w` colunas visíveis, pondo "…" no fim. */
function truncateVisible(s, w) {
  if (visibleWidth(s) <= w) return s;
  if (w <= 1) return "…";
  const tokens = [];
  const re = /\x1b\[[0-9;]*m/g;
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    for (const ch of s.slice(last, m.index)) tokens.push(ch);
    tokens.push(m[0]);
    last = m.index + m[0].length;
  }
  for (const ch of s.slice(last)) tokens.push(ch);
  let out = "";
  let vis = 0;
  for (const t of tokens) {
    if (t.startsWith("\x1b")) {
      out += t;
      continue;
    }
    if (vis >= w - 1) break;
    out += t;
    vis++;
  }
  return out + "…\x1b[0m";
}

/** Preenche/trunca uma linha para exatamente `w` colunas visíveis. */
function padVisible(s, w) {
  const vw = visibleWidth(s);
  if (vw > w) return truncateVisible(s, w);
  if (vw < w) return s + " ".repeat(w - vw);
  return s;
}

const normName = (n) => String(n).replace(/^\//, "").toLowerCase();

/** Subsequência: os caracteres de `needle` aparecem em ordem em `hay`. */
function isSubsequence(needle, hay) {
  let i = 0;
  for (const ch of hay) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return i === needle.length;
}

/**
 * Filtra os comandos por uma consulta (sem a barra inicial). Prefixo e fuzzy
 * (subsequência). Puro e determinístico — a base da paleta e do teste.
 *
 * @param {string} query
 * @returns {Array<{name:string,args:string,description:string}>}
 */
export function filterCommands(query) {
  const q = normName(query).trim();
  const all = COMMANDS.map((c) => ({ name: c.name, args: c.args, description: c.description }));
  if (q === "") return all.sort((a, b) => a.name.localeCompare(b.name));
  const scored = [];
  for (const c of all) {
    const n = normName(c.name);
    let score = -1;
    if (n.startsWith(q)) score = 0; // prefixo (melhor)
    else if (isSubsequence(q, n)) score = 1; // fuzzy
    if (score >= 0) scored.push({ c, score });
  }
  scored.sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name));
  return scored.map((s) => s.c);
}

/**
 * Desenha a paleta como linhas ANSI (caixa de largura `width` = W). Cada linha
 * tem exatamente W colunas visíveis. `selectedIndex` destaca uma linha.
 *
 * @param {Array} commands  saída de filterCommands
 * @param {number} selectedIndex
 * @param {number} width largura total (colunas)
 * @returns {string[]}
 */
export function renderPalette(commands, selectedIndex, width) {
  const W = Math.max(40, Math.floor(width));
  const top = "  ╭" + "─".repeat(W - 4) + "╮";
  const bottom = "  ╰" + "─".repeat(W - 4) + "╯";

  if (!commands || commands.length === 0) {
    const mid = "  │" + padVisible("  nenhum comando", W - 4) + "│";
    return [top, mid, bottom];
  }

  const label = (c) => c.name + (c.args ? " " + c.args : "");
  let nameW = 0;
  for (const c of commands) nameW = Math.max(nameW, visibleWidth(label(c)));
  nameW += 2;
  const inner = W - 4;
  const descW = Math.max(4, inner - 3 - nameW); // 3 = " > " / "   "
  const sel = Math.max(0, Math.min(selectedIndex | 0, commands.length - 1));
  // no máximo 8 linhas visíveis; a seleção acompanha (janela deslizante)
  const MAX_ROWS = 8;
  let winStart = 0;
  if (commands.length > MAX_ROWS) {
    winStart = Math.max(0, Math.min(sel - (MAX_ROWS >> 1), commands.length - MAX_ROWS));
  }
  const winEnd = Math.min(commands.length, winStart + MAX_ROWS);

  const lines = [top];
  for (let i = winStart; i < winEnd; i++) {
    const c = commands[i];
    const isSel = i === sel;
    const marker = isSel ? " > " : "   ";
    let name = label(c);
    name = visibleWidth(name) > nameW ? padVisible(name, nameW) : name + " ".repeat(nameW - visibleWidth(name));
    let desc = c.description;
    if (visibleWidth(desc) > descW) desc = truncateVisible(desc, descW);
    const content = padVisible(marker + name + desc, inner);
    if (isSel) {
      // Seleção: seta ">" em accent (destacada), resto em bold — visível sem poluir.
      lines.push("  │" + paint(" > ", "accent") + paint(content.slice(3), "bold") + "│");
    } else {
      lines.push("  │" + content + "│");
    }
  }
  lines.push(bottom);
  return lines;
}

/** Frame headless da paleta (para --render palette / palette-filtered). */
export function renderPaletteFrame(filterQuery = "", width = WIDTH) {
  const filtered = filterCommands(filterQuery);
  const palette = renderPalette(filtered, 0, width);
  const out = [];
  out.push(renderBanner());
  out.push(rule());
  out.push(renderStatusLine({}));
  out.push("");
  out.push(`  ${paint("›", "accent")} /${filterQuery}`);
  for (const l of palette) out.push(l);
  out.push(paint("  ↑↓ navegar  enter escolher  esc fechar", "dim"));
  return out.map((line) => wrapAnsi(line, width)).join("\n");
}

/* ------------------------------------------------------------------ */
/* Mensagens de estado (voz do produto)                               */
/* ------------------------------------------------------------------ */

/** Aviso de motor ausente. Nunca cita o motor; diz o que fazer. */
export function engineUnavailableNote() {
  return [
    paint("  não encontrei o motor do SelfEvoPI nesta máquina.", "warn"),
    paint("  a conversa fica desativada; os comandos / continuam funcionando.", "muted"),
    paint("  para reativar a conversa, reinstale o SelfEvoPI.", "muted"),
  ].join("\n");
}

/** Classifica um erro cru como de autenticação/modelo (para a mensagem certa). */
export function isAuthError(raw) {
  const s = String(raw || "").toLowerCase();
  return (
    s.includes("401") ||
    s.includes("403") ||
    s.includes("invalid bearer token") ||
    s.includes("authentication") ||
    s.includes("unauthorized") ||
    s.includes("model not found") ||
    s.includes("invalid model") ||
    s.includes("no credential") ||
    s.includes("apikey") ||
    s.includes("api key")
  );
}

/**
 * Traduz um erro cru do modelo/provedor em voz do produto, com a ação.
 * Nunca mostra o corpo cru (401, stack, etc.). `raw` é só para classificar.
 */
export function engineErrorMessage(raw) {
  const lines = [];
  if (isAuthError(raw)) {
    lines.push(paint("  não consegui falar com o modelo desta conversa.", "warn"));
    lines.push(paint("  o modelo padrão não tem credencial ativa nesta máquina.", "muted"));
  } else {
    lines.push(paint("  não consegui falar com o modelo agora.", "warn"));
    lines.push(paint("  pode ser conexão ou o modelo estar indisponível; tente de novo.", "muted"));
  }
  lines.push("");
  lines.push(paint("  /model          ver os modelos disponíveis", "fg"));
  lines.push(paint("  /model <nome>   trocar o modelo desta conversa", "fg"));
  return lines.join("\n");
}

/** Aviso de fallback: diz qual modelo passou a responder, em voz do produto. */
export function fallbackNotice(model) {
  return [
    paint(`  o modelo padrão não respondeu; usei ${model} nesta conversa.`, "warn"),
    paint("  /model          ver os disponíveis", "muted"),
    paint("  /model <nome>   trocar", "muted"),
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Processos auxiliares (comandos de barra que rodam algo)            */
/* ------------------------------------------------------------------ */

/** Roda um processo e devolve { code, out, err }. Nunca rejeita. */
function runProcess(executable, args, { onLine } = {}) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, { cwd: ROOT, windowsHide: true });
    let out = "";
    let err = "";
    let buf = "";
    const pump = (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (onLine) onLine(line);
      }
    };
    child.stdout?.on("data", pump);
    child.stderr?.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => resolve({ code: 1, out: "", err: String(e.message) }));
    child.on("close", (code) => {
      if (buf && onLine) onLine(buf);
      out += err;
      resolve({ code: code ?? 1, out, err });
    });
  });
}

/** Últimas N linhas não vazias de um texto. */
function tailLines(text, n = 8) {
  return String(text).trim().split("\n").filter((l) => l.trim() !== "").slice(-n);
}

/* ------------------------------------------------------------------ */
/* Handler de um comando de barra                                     */
/* ------------------------------------------------------------------ */

/**
 * Executa um comando de barra. Escreve no `out` (função de escrita) e devolve
 * um código de processo (0 = ok). `ctx` carrega o cliente de conversa (pi) e
 * dados de estado.
 */
/* ------------------------------------------------------------------ */
/* Executores dos comandos (usados por COMMANDS e por runSlash)        */
/* ------------------------------------------------------------------ */

async function runHelp({ out }) {
  out(renderHelp());
  return 0;
}

async function runDetect({ out }) {
  const { detectGaps } = await import("../core/forge/detect.mjs");
  const det = await detectGaps({ ledger: LEDGER, threshold: 3, maxGaps: 20 });
  const lines = [
    paint(`  execuções lidas: ${det.scanned}`, "fg"),
    paint(`  lacunas abertas: ${det.gaps.length}`, "fg"),
  ];
  for (const g of det.gaps.slice(0, 12)) {
    lines.push(`  ${paint("●", "warn")} [${g.kind}] ${g.taskId} → ${g.capability}`);
  }
  if (det.gaps.length === 0) lines.push(paint("  nenhuma lacuna acionável", "muted"));
  out(lines.join("\n"));
  return 0;
}

async function runSkills({ out, arg }) {
  const { openStore } = await import("../core/memory/store.mjs");
  const store = openStore({ root: MEMORY });
  const entries = store.query({ level: "skills" }).filter((e) => !e.invalid);

  // As skills do usuário ficam em ~/.pi/skills/*/SKILL.md.
  // O /skills nasceu lendo so o store do loop, e por isso elas nao apareciam.
  const { findPcSkills } = await import("../core/agent/skills-user.mjs");
  let pc = [];
  try {
    pc = findPcSkills({ termo: String(arg ?? "").trim() });
  } catch {
    pc = [];
  }

  const linhas = [];

  if (entries.length > 0) {
    linhas.push(paint(`  loop (geradas pelo SelfEvoPI): ${entries.length}`, "fg"));
    for (const e of entries.slice(0, 15)) {
      linhas.push(`  ${paint("●", "ok")} ${String(e.text).replace(/\s+/g, " ").slice(0, 60)}`);
    }
  }

  if (pc.length > 0) {
    if (linhas.length > 0) linhas.push("");
    linhas.push(paint(`  usuário: ${pc.length}`, "fg"));
    for (const s of pc.slice(0, 15)) {
      const nome = String(s.name || "").slice(0, 28).padEnd(28);
      const desc = String(s.description || "").replace(/\s+/g, " ").slice(0, 34);
      linhas.push(`  ${paint("○", "muted")} ${nome} ${desc}`);
    }
  }

  if (linhas.length === 0) {
    out(paint("  nenhuma skill encontrada (nem do loop, nem do usuário)", "muted"));
    return 0;
  }

  linhas.push("");
  linhas.push(paint("  /skills <termo> filtra · ● loop · ○ pc", "muted"));
  out(capLinhas(linhas).join("\n"));
  return 0;
}

async function runMemory({ arg, out }) {
  const termo = arg.trim();
  const { openStore } = await import("../core/memory/store.mjs");
  const { searchCapabilities } = await import("../core/memory/search.mjs");
  const store = openStore({ root: MEMORY });
  if (!termo) {
    const all = store.query({ level: "skills" }).filter((e) => !e.invalid);
    out(paint(`  memória: ${all.length} skill(s). Use /memory <termo> para buscar.`, "muted"));
    return 0;
  }
  const res = searchCapabilities(store, termo, { levels: ["skills", "project", "session"], limit: 10 });
  if (res.count === 0) {
    out(paint(`  nada encontrado para "${termo}" — talvez ainda não tenha sido gerado`, "muted"));
    return 0;
  }
  const lines = [paint(`  "${termo}" — ${res.count} resultado(s)`, "fg")];
  for (const r of res.results) {
    lines.push(`  ${paint("●", "ok")} [${r.score}] ${String(r.text).replace(/\s+/g, " ").slice(0, 70)}`);
  }
  out(lines.join("\n"));
  return 0;
}

async function runEvals({ out }) {
  out(paint("  rodando os grupos estruturais (A/B/C)…", "muted"));
  const results = [];
  for (const g of ["A", "B", "C"]) {
    const r = await runProcess(process.execPath, [path.join(ROOT, "evals", "run.mjs"), "--group", g, "--no-ledger"]);
    const last = tailLines(r.out, 1)[0] || `grupo ${g}: sem saída`;
    results.push({ g, code: r.code, last });
  }
  const lines = [""];
  for (const r of results) {
    lines.push(`  ${paint(r.g, "fg")}  ${r.last}`);
  }
  out(lines.join("\n"));
  return results.every((r) => r.code === 0) ? 0 : 1;
}

async function runGate({ out }) {
  out(paint("  gate completo — usa o modelo e pode demorar…", "muted"));
  const r = await runProcess(process.execPath, [path.join(ROOT, "evals", "gate.mjs")]);
  const last = tailLines(r.out, 10);
  out(last.map((l) => "  " + l).join("\n") || paint("  (sem saída)", "muted"));
  return r.code;
}

async function runForge({ arg, out }) {
  const meta = arg.trim();
  if (!meta) {
    out(paint("  uso: /forge <meta>  (ex.: /forge \"extrair HTML com seletor\")", "muted"));
    return 2;
  }
  out(paint(`  iniciando ciclo evolutivo rumo a: ${meta}`, "muted"));
  out(paint("  (um ciclo mexe em arquivos e pode demorar; Ctrl+C interrompe)", "muted"));
  const r = await runProcess(process.execPath, [path.join(ROOT, "core", "forge", "cli.mjs"), "evolve", "--goal", meta], {
    onLine: (line) => out(paint("  · " + line, "muted")),
  });
  out(paint(`  outcome: ${r.code === 0 ? "concluído" : "interrompido ou reprovado"}`, r.code === 0 ? "ok" : "warn"));
  return r.code;
}

/* ------------------------------------------------------------------ */
/* Esforço (thinking) e modos — o que /effort e /mode mostram           */
/* ------------------------------------------------------------------ */

/**
 * Níveis de esforço aceitos quando o motor não pode ser consultado.
 *
 * A fonte de verdade é o motor: `get_available_thinking_levels` devolve o que
 * **aquele** modelo expõe, e modelos diferentes têm listas diferentes. Este
 * conjunto só aparece quando não há sessão — e o chamador diz isso ao usuário
 * em vez de fingir que consultou.
 */
export const EFFORT_FALLBACK = Object.freeze(["off", "low", "medium", "high"]);

/** Valida a lista vinda do motor; lista vazia ou lixo cai no fallback. */
export function normalizeEffortList(levels) {
  const arr = Array.isArray(levels)
    ? levels.filter((l) => typeof l === "string" && l.trim() !== "").map((l) => l.trim().toLowerCase())
    : [];
  return arr.length > 0 ? arr : [...EFFORT_FALLBACK];
}

/** Casa o argumento com a lista, sem caixa. Devolve o nome canônico ou null. */
export function resolveEffort(arg, levels) {
  const list = normalizeEffortList(levels);
  const alvo = String(arg ?? "").trim().toLowerCase();
  if (alvo === "") return null;
  return list.find((l) => l === alvo) ?? null;
}

/**
 * Uma linha do que o modo permite — a explicação que o /mode mostra junto do
 * nome novo. Sai dos campos de `resolveMode`, não de texto decorativo.
 */
export function describeModeLine(m) {
  if (!m || typeof m !== "object") return null;
  const pode = [];
  pode.push(m.canRead ? "lê" : "não lê");
  pode.push(m.canWrite ? "escreve" : "não escreve");
  pode.push(m.canExec ? "executa (" + m.execScope + ")" : "não executa");
  return m.name + ": " + pode.join(", ");
}

/** Lista de modelos agrupada por provedor, pronta para o seletor. */
export function groupModelsByProvider(models) {
  const lista = Array.isArray(models) ? models : [];
  const mapa = new Map();
  for (const m of lista) {
    if (!m || typeof m.provider !== "string" || typeof m.id !== "string") continue;
    if (!mapa.has(m.provider)) mapa.set(m.provider, []);
    mapa.get(m.provider).push(m.id);
  }
  return [...mapa.entries()].map(([provider, ids]) => ({ provider, ids }));
}

/** Achata os grupos numa lista navegável (índice de cada modelo). */
export function flattenModelGroups(groups) {
  const flat = [];
  const linhas = [];
  for (const g of groups) {
    linhas.push({ kind: "group", label: g.provider });
    for (const id of g.ids) {
      linhas.push({ kind: "model", provider: g.provider, id, label: id, flatIndex: flat.length });
      flat.push({ provider: g.provider, id });
    }
  }
  return { linhas, flat };
}

/**
 * Monta as linhas do seletor de modelo (etapa "models") ou de esforço
 * (etapa "effort"). Função pura: o REPL só desenha o que ela devolve.
 */
export function renderModelPicker({ stage, sel, grupos, niveis, modelo }) {
  const linhas = [];

  if (stage === "effort") {
    linhas.push(paint("  esforço — " + modelo, "fg"));
    for (let i = 0; i < niveis.length; i++) {
      const marcador = i === sel ? paint("›", "accent") : " ";
      const nome = i === sel ? paint(niveis[i], "bold") : niveis[i];
      linhas.push("    " + marcador + " " + nome);
    }
    linhas.push("");
    linhas.push(paint("  ↑↓ navegar  enter escolher  esc cancela", "dim"));
    return linhas;
  }

  linhas.push(paint("  modelo", "fg"));
  let idx = 0;
  for (const g of grupos) {
    linhas.push("");
    linhas.push(paint("  " + g.provider, "bold"));
    for (const id of g.ids) {
      const marcador = idx === sel ? paint("›", "accent") : " ";
      const nome = idx === sel ? paint(id, "bold") : id;
      linhas.push("    " + marcador + " " + nome);
      idx += 1;
    }
  }
  if (grupos.length === 0) linhas.push(paint("  nenhum modelo configurado.", "warn"));
  linhas.push("");
  linhas.push(paint("  ↑↓ navegar  enter escolher  esc cancela", "dim"));
  return linhas;
}

async function runModel({ arg, out, pi }) {
  const nome = arg.trim();
  const configured = listConfiguredModels(); // [{ provider, id }] — só nomes, sem chaves
  if (!nome) {
    // lista o que está configurado, agrupado por provedor (nunca imprime chaves)
    let current = null;
    if (pi) {
      const state = await pi.getState().catch(() => ({}));
      current = state.model ? `${state.model.provider}/${state.model.id}` : null;
    }
    const lines = [];
    if (current) lines.push(paint(`  modelo atual: ${current}`, "fg"));
    if (configured.length === 0) {
      lines.push(paint("  nenhum modelo configurado encontrado.", "warn"));
      out(lines.join("\n"));
      return 0;
    }
    const byProv = new Map();
    for (const m of configured) {
      if (!byProv.has(m.provider)) byProv.set(m.provider, []);
      byProv.get(m.provider).push(m.id);
    }
    for (const [prov, ids] of byProv) {
      lines.push("");
      lines.push(paint(`  ${prov}`, "bold"));
      for (const id of ids) lines.push(`    ${id}`);
    }
    out(lines.join("\n"));
    return 0;
  }
  if (!pi) {
    out(paint("  a conversa está desativada; não dá para trocar o modelo agora", "muted"));
    return 2;
  }
  const alvo = configured.find((m) =>
    nome.includes("/") ? `${m.provider}/${m.id}` === nome : m.id === nome || m.id.includes(nome),
  );
  if (!alvo) {
    out(paint(`  não encontrei o modelo "${nome}" entre os configurados. Use /model para ver a lista.`, "warn"));
    return 2;
  }
  await pi.setModel(alvo.provider, alvo.id).catch(() => {});
  out(paint(`  modelo: ${alvo.provider}/${alvo.id}`, "ok"));
  return 0;
}

/**
 * /effort [nível] — mostra ou troca o esforço de raciocínio.
 *
 * A lista vem do motor em uso (get_available_thinking_levels), não de uma
 * constante: modelos diferentes expõem conjuntos diferentes. Sem sessão, cai no
 * conjunto documentado e diz que não consultou — para ninguém achar que um nível
 * foi validado quando não foi.
 */
async function runEffort({ arg, out, pi }) {
  const alvo = String(arg ?? "").trim();

  if (!pi) {
    // Sem sessão não há o que consultar nem trocar: mostra o conjunto padrão
    // e diz que não consultou. Sair 0 — listar não é erro.
    out(paint("  esforço", "fg"));
    out(`    atual:     ${(statusInfo.reasoning || "-")}`);
    out(`    aceitos:   ${EFFORT_FALLBACK.join(", ")}`);
    out("");
    out(paint("  (sem conversa ativa; não consultei o modelo)", "warn"));
    return 0;
  }

  let niveis;
  let doMotor = false;
  try {
    if (pi._rpc && typeof pi._rpc.getAvailableThinkingLevels === "function") {
      niveis = normalizeEffortList(await pi._rpc.getAvailableThinkingLevels());
      doMotor = true;
    }
  } catch {
    doMotor = false;
  }
  if (!doMotor) niveis = normalizeEffortList(null);

  const atual = (statusInfo.reasoning || "").toLowerCase() || null;

  if (alvo === "") {
    const lines = [paint("  esforço", "fg")];
    lines.push(`    atual:     ${atual ?? "-"}`);
    lines.push(`    aceitos:   ${niveis.join(", ")}`);
    lines.push("");
    lines.push(
      doMotor
        ? paint("  (lista lida do modelo em uso)", "muted")
        : paint("  (não consegui ler do modelo; mostrando o conjunto padrão)", "warn"),
    );
    out(lines.join("\n"));
    return 0;
  }

  const escolhido = resolveEffort(alvo, niveis);
  if (!escolhido) {
    out(paint(`  "${alvo}" não está entre os níveis deste modelo: ${niveis.join(", ")}`, "warn"));
    return 2;
  }

  if (typeof pi._rpc?.setThinkingLevel !== "function") {
    out(paint("  não consegui aplicar o esforço sem consultar o modelo.", "warn"));
    return 2;
  }

  await pi._rpc.setThinkingLevel(escolhido).catch(() => null);
  statusInfo.reasoning = escolhido;
  out(paint(`  esforço: ${escolhido}`, "ok"));
  return 0;
}

async function runClear({ out, pi, onClear }) {
  if (pi) {
    await pi.newSession().catch(() => {});
  }
  onClear?.();
  out(paint("  conversa limpa", "muted"));
  return 0;
}


/* ------------------------------------------------------------------ */
/* Estado do agente (status, custo, contexto) e modos                 */
/* ------------------------------------------------------------------ */

let currentMode = "build"; // modo de permissão da conversa (plan/build/ask)
let goalState = {}; // estado da goal (core/forge/goal.mjs) — persistido pelo chamador
let goalTag = null; // indicador cacheado (rodapé), atualizado quando a goal muda
const HOME = process.env.USERPROFILE || process.env.HOME || ".";
const SESSIONS_DIR = path.join(HOME, ".pi", "agent", "sessions");
let pendingInit = null; // rascunho de AGENTS.md aguardando confirmação
let pendingImport = null; // plano de /import aguardando confirmação (null = nenhum)

function samePath(a, b) {
  const n = (p) => String(p).replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
  return n(a) === n(b);
}

/** Descobre a pasta de sessões do projeto atual (por header.cwd), ou a base. */
async function sessionDir() {
  const base = SESSIONS_DIR;
  let entries = [];
  try {
    const { readdir } = await import("node:fs/promises");
    entries = await readdir(base, { withFileTypes: true });
  } catch {
    return base;
  }
  let parseSession = () => ({ header: null });
  try {
    ({ parseSession } = await import("../core/agent/sessions.mjs"));
  } catch {
    /* sem o módulo: usa a base */
    return base;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const sub = path.join(base, e.name);
    let files = [];
    try {
      const { readdir: rd } = await import("node:fs/promises");
      files = (await rd(sub)).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    if (files.length === 0) continue;
    try {
      const first = readFileSync(path.join(sub, files[0]), "utf8");
      const { header } = parseSession(first);
      if (header && typeof header.cwd === "string" && samePath(header.cwd, ROOT)) return sub;
    } catch {
      /* segue */
    }
  }
  return base;
}

/** Monta o estado do agente para inspect.mjs (status/custo/contexto). */
async function buildAgentState(pi) {
  const state = {
    version: VERSION,
    mode: currentMode,
    sessionId: null,
    model: null,
    provider: null,
    turns: 0,
    ledger: [],
    usedTokens: 0,
    budgetTokens: 200000,
    breakdown: {},
  };
  if (!pi) return state;
  const st = await pi.getState().catch(() => ({}));
  if (st && st.model) {
    state.provider = st.model.provider ?? null;
    state.model = st.model.id ?? null;
  }
  state.sessionId = st?.sessionId ?? null;
  const stats = await Promise.resolve(pi._rpc && pi._rpc.getSessionStats && pi._rpc.getSessionStats()).catch(() => ({}));
  if (stats?.contextUsage) {
    state.usedTokens = Number(stats.contextUsage.tokens) || 0;
    state.budgetTokens = Number(stats.contextUsage.contextWindow) || 200000;
  }
  const msgs = await Promise.resolve(pi._rpc && pi._rpc.getMessages && pi._rpc.getMessages()).catch(() => []);
  for (const m of Array.isArray(msgs) ? msgs : []) {
    if (m && m.role === "assistant" && m.usage) {
      state.ledger.push({
        usage: { input: m.usage.input ?? 0, output: m.usage.output ?? 0, cacheRead: m.usage.cacheRead ?? 0 },
        costUsd: m.usage.cost?.total ?? null,
      });
    }
  }
  if (state.ledger.length === 0 && stats?.tokens) {
    state.ledger.push({
      usage: { input: stats.tokens.input ?? 0, output: stats.tokens.output ?? 0, cacheRead: stats.tokens.cacheRead ?? 0 },
      costUsd: stats.cost ?? null,
    });
  }
  state.turns = state.ledger.length || Number(stats?.totalMessages) || 0;
  return state;
}

/* ------------------------------------------------------------------ */
/* Executores novos (importam e usam os módulos dos outros)           */
/* ------------------------------------------------------------------ */

async function runStatus({ out, pi }) {
  const { sessionStatus } = await import("../core/agent/inspect.mjs");
  const s = sessionStatus(await buildAgentState(pi));
  const lines = [paint("  sessão", "fg")];
  lines.push(`    versão:   ${s.version || "—"}`);
  lines.push(`    modelo:   ${s.provider ? s.provider + "/" : ""}${s.model || "—"}`);
  lines.push(`    sessão:   ${s.sessionId ? String(s.sessionId).slice(0, 8) : "—"}`);
  lines.push(`    turnos:   ${s.turns}`);
  lines.push(`    modo:     ${paint(currentMode, "bold")}`);
  out(lines.join("\n"));
  return 0;
}

async function runCost({ out, pi }) {
  const { sessionCost, formatTokens, formatCost } = await import("../core/agent/inspect.mjs");
  const c = sessionCost(await buildAgentState(pi));
  const lines = [paint("  custo da sessão", "fg")];
  lines.push(`    entrada:  ${formatTokens(c.tokensIn)} tokens`);
  lines.push(`    saída:    ${formatTokens(c.tokensOut)} tokens`);
  lines.push(`    cache:    ${formatTokens(c.tokensCacheRead)} tokens (leitura)`);
  lines.push(`    custo:    ${formatCost(c.costUsd)}`);
  if (c.byTurn.length > 0) {
    lines.push("");
    lines.push(paint("    por turno", "muted"));
    for (const t of c.byTurn.slice(-8)) {
      lines.push(`      ${String(t.turn).padStart(2)}  in ${formatTokens(t.tokensIn)}  out ${formatTokens(t.tokensOut)}  ${formatCost(t.costUsd)}`);
    }
  } else {
    lines.push("");
    lines.push(paint("    (sem uso registrado nesta conversa)", "muted"));
  }
  out(lines.join("\n"));
  return 0;
}

async function runContext({ out, pi }) {
  const { contextUsage, formatTokens } = await import("../core/agent/inspect.mjs");
  const c = contextUsage(await buildAgentState(pi));
  const bar = 24;
  const filled = Math.max(0, Math.min(bar, Math.round((c.percent / 100) * bar)));
  const lines = [paint("  contexto", "fg")];
  lines.push(`    em uso:   ${formatTokens(c.usedTokens)} / ${formatTokens(c.budgetTokens)} tokens (${c.percent}%)`);
  lines.push(`    [${paint("█".repeat(filled), "fg")}${"░".repeat(bar - filled)}]`);
  out(lines.join("\n"));
  return 0;
}

async function runMcp({ out }) {
  const { listMcpServers } = await import("../core/agent/mcp.mjs");
  const servers = await listMcpServers({ root: ROOT });
  if (!servers || servers.length === 0) {
    out(paint("  nenhum servidor MCP declarado (confira .mcp.json ou as configurações do projeto)", "muted"));
    return 0;
  }
  const lines = [paint(`  ${servers.length} servidor(es) MCP`, "fg")];
  for (const s of servers) {
    const dot = s.status === "configured" ? paint("●", "ok") : s.status === "disabled" ? paint("●", "muted") : paint("●", "fail");
    const cmd = [s.command, ...(s.args || [])].filter(Boolean).join(" ");
    lines.push(`  ${dot} ${s.name.padEnd(18)} ${paint(s.status, "muted")}`);
    if (cmd) lines.push(`      ${paint(cmd, "muted")}`);
  }
  out(lines.join("\n"));
  return 0;
}

async function runInit({ out }) {
  const { renderAgentDoc } = await import("../core/agent/init.mjs");
  const md = renderAgentDoc({ project: { name: "SelfEvoPI", version: VERSION } });
  pendingInit = md; // guarda o rascunho; só grava com confirmação explícita
  out(md);
  out("");
  out(paint("  rascunho — nada foi gravado. Responda sim para gravar AGENTS.md, ou outra coisa para descartar.", "muted"));
  return 0;
}

async function runImport({ arg, out, home: homeInjetado } = {}) {
  const { planImport, applyImport, undoImport } = await import("../core/agent/import.mjs");
  const a = String(arg ?? "").trim();
  const home = homeInjetado; // undefined → import.mjs usa o home do processo

  // /import --undo → desfaz o último import
  if (a === "--undo") {
    let r;
    try {
      r = await undoImport({ home });
    } catch (err) {
      out(paint(`  não consegui desfazer: ${err?.message ?? err}`, "fail"));
      return 1;
    }
    if (!r.manifesto) {
      out(paint("  nenhum import para desfazer.", "muted"));
      return 0;
    }
    const linhas = [paint("  import desfeito", "fg")];
    if (r.restaurado) {
      linhas.push(`    MCPs removidos: ${r.mcpRemovidos.length ? r.mcpRemovidos.join(", ") : "(nenhum)"}`);
    }
    if (r.skillsRemovidas.length) {
      linhas.push(`    skills removidas: ${r.skillsRemovidas.join(", ")}`);
    }
    linhas.push(paint(`    manifesto: ${r.manifesto}`, "muted"));
    out(linhas.join("\n"));
    return 0;
  }

  // /import --status → mostra o manifesto mais recente
  if (a === "--status") {
    const { readdir, readFile } = await import("node:fs/promises");
    const ledger = path.join(home ?? HOME, ".pi", "harness", "ledger");
    let entries = [];
    try {
      entries = await readdir(ledger);
    } catch {
      out(paint("  nenhum import registrado ainda.", "muted"));
      return 0;
    }
    const manifestos = entries.filter((n) => n.startsWith("import-") && n.endsWith(".json")).sort().reverse();
    if (manifestos.length === 0) {
      out(paint("  nenhum import registrado ainda.", "muted"));
      return 0;
    }
    const linhas = [];
    for (const nome of manifestos.slice(0, 5)) {
      try {
        const m = JSON.parse(await readFile(path.join(ledger, nome), "utf8"));
        const estado = m.desfeito ? "desfeito" : "ativo";
        linhas.push(
          `  ${paint(nome, "fg")} · ${estado} · ${m.quando ?? "?"} · ${(m.mcpAdicionados ?? []).length} MCPs, ${(m.skillsAdicionadas ?? []).length} skills`
        );
      } catch {
        /* manifesto corrompido: pula */
      }
    }
    out(linhas.join("\n"));
    return 0;
  }

  // /import importar (ou --confirm) → aplica o plano (pendente ou novo)
  if (a === "importar" || a === "--confirm" || a === "sim" || a === "y") {
    let r;
    try {
      const plan = pendingImport ?? (await planImport({ home }));
      r = await applyImport({ home, plan });
    } catch (err) {
      out(paint(`  não consegui importar: ${err?.message ?? err}`, "fail"));
      return 1;
    } finally {
      pendingImport = null;
    }
    const linhas = [paint("  import concluído", "fg")];
    if (r.added.mcp.length) linhas.push(`    MCPs copiados:    ${r.added.mcp.join(", ")}`);
    if (r.added.skills.length) linhas.push(`    skills copiadas:  ${r.added.skills.join(", ")}`);
    const mantidos = [...(r.skipped?.mcp ?? []), ...(r.skipped?.skills ?? [])];
    if (mantidos.length) linhas.push(paint(`    mantidos (já existiam): ${mantidos.join(", ")}`, "muted"));
    if (r.avisos && r.avisos.length) {
      linhas.push(paint("    avisos:", "warn"));
      for (const av of r.avisos) linhas.push(paint(`      ${av.nome}: ${av.aviso}`, "warn"));
    }
    if (r.backup) linhas.push(paint(`    backup: ${r.backup}`, "muted"));
    if (r.manifesto) linhas.push(paint(`    manifesto: ${r.manifesto}`, "muted"));
    out(linhas.join("\n"));
    return 0;
  }

  // /import sem argumento (ou qualquer outro) → prévia (nada é escrito)
  let plano;
  try {
    plano = await planImport({ home });
  } catch (err) {
    out(paint(`  não consegui planejar o import: ${err?.message ?? err}`, "fail"));
    return 1;
  }

  if (!plano.origemExiste) {
    out(paint("  não achei config do OpenCode (~/.config/opencode) — nada para importar.", "muted"));
    return 0;
  }

  pendingImport = plano; // guarda o plano; só aplica com confirmação explícita

  const linhas = [paint("  prévia do import (nada foi escrito)", "fg")];
  linhas.push(
    `    MCPs:   ${plano.mcpAdd.length} seriam copiados, ${plano.mcpSkip.length} já existem (mantidos)`
  );
  linhas.push(
    `    skills: ${plano.skillsAdd.length} seriam copiadas, ${plano.skillsSkip.length} já existem (mantidas)`
  );
  if (plano.mcpAdd.length === 0 && plano.skillsAdd.length === 0) {
    linhas.push(paint("    tudo já está importado — nada a fazer.", "muted"));
    pendingImport = null;
    out(linhas.join("\n"));
    return 0;
  }
  out(linhas.join("\n"));
  out("");
  out(paint("  responda 'importar' para confirmar, ou outra coisa para cancelar.", "muted"));
  return 0;
}

async function runCompact({ out, pi }) {
  const { compactHistory } = await import("../core/agent/compact.mjs");
  const state = await buildAgentState(pi);
  let messages = [];
  if (pi) messages = await Promise.resolve(pi._rpc && pi._rpc.getMessages && pi._rpc.getMessages()).catch(() => []);
  if (!Array.isArray(messages) || messages.length === 0) {
    out(paint("  não há conversa para compactar ainda", "muted"));
    return 0;
  }
  const maxTokens = state.budgetTokens || 200000;
  const res = compactHistory(messages, { maxTokens, keepLast: 6 });
  const lines = [paint("  histórico compactado", "fg")];
  lines.push(`    antes:    ${res.tokensBefore} tokens`);
  lines.push(`    depois:   ${res.tokensAfter} tokens`);
  lines.push(`    saíram:   ${res.removed} mensagem(ns) (resumidas ou descartadas)`);
  out(lines.join("\n"));
  return 0;
}

/* ------------------------------------------------------------------ */
/* Sessões — origem, título derivado e leitura seletiva                */
/* ------------------------------------------------------------------ */

/**
 * De onde veio a sessão, segundo o campo `client` do header (contrato
 * desktop 1.0, seção 1). Sessão antiga, sem o campo, é `cli` — é o que o
 * contrato manda, e é o que faz sentido: o desktop é que passou a escrever
 * esse campo depois.
 *
 * Valor desconhecido não vira "cli" no silêncio: devolve como está, para o
 * diagnóstico não mentir sobre um header que veio de outro lugar.
 */
export function sessionOrigin(client) {
  const raw = typeof client === "string" ? client.trim() : "";
  if (raw === "") return "cli";
  const low = raw.toLowerCase();
  if (low === "desktop") return "desktop";
  if (low === "cli") return "cli";
  return raw;
}

/**
 * Título da sessão: o do header, quando existe. Quando não existe, deriva da
 * primeira mensagem do usuário — truncada, para a lista não virar parágrafo.
 *
 * O id cru é o último recurso, e é responsabilidade de quem chama.
 */
export function deriveTitle(headerTitle, firstUserText, maxLen = 50) {
  const titulo = typeof headerTitle === "string" ? headerTitle.trim() : "";
  if (titulo !== "") return titulo;

  const texto = String(firstUserText ?? "").replace(/\s+/g, " ").trim();
  if (texto === "") return null;
  if (texto.length <= maxLen) return texto;
  return texto.slice(0, maxLen - 1).trimEnd() + "…";
}

/**
 * Lê o que a lista de sessões precisa e o `listSessions` não devolve:
 * `client` (contrato desktop 1.0) e o primeiro texto do usuário (para o
 * título derivado).
 *
 * Lê o começo de cada arquivo, não o inteiro: o header é a linha 1 e a
 * primeira mensagem do usuário vem logo depois. Uma sessão de dezenas de
 * megabytes não vira string na memória por causa de uma lista.
 *
 * @returns {Promise<Map<string, { client: string, firstUser: string|null }>>}
 */
export async function readSessionExtras(dir, { maxBytes = 256 * 1024 } = {}) {
  const { readdir, open } = await import("node:fs/promises");
  const { parseSession } = await import("../core/agent/sessions.mjs");

  const out = new Map();
  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return out;
  }

  for (const f of files) {
    const full = path.join(dir, f);
    let header = null;
    let firstUser = null;

    try {
      const fh = await open(full, "r");
      try {
        const buf = Buffer.alloc(maxBytes);
        const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
        const { header: h, messages } = parseSession(buf.subarray(0, bytesRead).toString("utf8"));
        header = h;
        for (const m of messages) {
          if (m && m.role === "user") {
            firstUser = typeof m.content === "string"
              ? m.content
              : Array.isArray(m.content)
                ? m.content.map((c) => (c && typeof c.text === "string" ? c.text : "")).join(" ")
                : "";
            break;
          }
        }
      } finally {
        await fh.close().catch(() => {});
      }
    } catch {
      // arquivo ilegível: cai no fallback do chamador
    }

    const id = (header && header.id) || f.replace(/\.jsonl$/, "");
    out.set(id, { client: sessionOrigin(header && header.client), firstUser });
  }

  return out;
}

/**
 * Monta as linhas da lista de sessões. Separada do comando para que a paleta
 * (Ctrl+K) mostre exatamente o mesmo que /sessions mostra.
 */
export function renderSessionsList(list, extras, limit = 12) {
  const lines = [paint(`  ${list.length} sessão(es)`, "fg")];

  // cabeçalho só quando há o que listar — coluna a mais sem tabela é ruído
  const temDesktop = list.slice(0, limit).some((se) => (extras.get(se.id)?.client ?? "cli") === "desktop");
  const idW = 8;
  const originW = temDesktop ? 8 : 0;
  const titleW = Math.max(24, WIDTH - idW - originW - 26 - 8);

  for (const se of list.slice(0, limit)) {
    const extra = extras.get(se.id);
    const origin = extra?.client ?? "cli";
    const title = deriveTitle(se.title, extra?.firstUser) ?? String(se.id).slice(0, 8);
    const id = se.id ? String(se.id).slice(0, idW) : "?";

    const colOrigin = temDesktop ? String(origin).padEnd(originW) + "  " : "";
    const colTitle = fit(String(title), titleW).padEnd(titleW);
    lines.push(`  ${id}  ${colOrigin}${colTitle}  ${se.turns} turnos  ${String(se.updatedAt || "").slice(0, 10)}`);
  }

  if (list.length > limit) {
    lines.push(paint(`  … e mais ${list.length - limit} sessão(es)`, "muted"));
  }

  return lines;
}

async function runSessions({ out, arg, pi }) {
  const { listSessions, loadSession } = await import("../core/agent/sessions.mjs");
  const dir = await sessionDir();
  if (arg) {
    const { messages, meta } = await loadSession(dir, arg);
    if (!meta || !messages || messages.length === 0) {
      out(paint(`  sessão "${arg}" não encontrada`, "warn"));
      return 2;
    }
    const extras = await readSessionExtras(dir);
    const extra = extras.get(meta.id) ?? null;
    const idCurto = meta.id ? String(meta.id).slice(0, 8) : arg;
    const origin = sessionOrigin(extra?.client);
    const lines = [paint(`  sessão ${idCurto}`, "fg")];
    lines.push(`    título:  ${deriveTitle(meta.title, extra?.firstUser) ?? "-"}`);
    lines.push(`    origem:  ${origin}`);
    lines.push(`    turnos:  ${meta.turns}`);
    lines.push(`    tokens:  ${meta.tokens}`);
    out(lines.join("\n"));
    if (pi && pi._rpc && typeof pi._rpc.switchSession === "function") {
      // procura o arquivo para alternar a sessão ativa
      let target = null;
      try {
        const { readdir } = await import("node:fs/promises");
        for (const f of (await readdir(dir)).filter((x) => x.endsWith(".jsonl"))) {
          if (f.includes(arg)) { target = path.join(dir, f); break; }
        }
      } catch { /* segue */ }
      if (target) {
        const ok = await pi._rpc.switchSession(target).then(() => true).catch(() => false);
        out(ok ? paint("  conversa agora nesta sessão.", "ok") : paint("  não consegui trocar de sessão.", "warn"));
        return 0;
      }
    }
    out(paint("  (carregada; a troca da sessão ativa depende do orquestrador)", "muted"));
    return 0;
  }
  const list = await listSessions(dir);
  if (!list || list.length === 0) {
    out(paint("  nenhuma sessão encontrada", "muted"));
    return 0;
  }
  const extras = await readSessionExtras(dir);
  out(renderSessionsList(list, extras).join("\n"));
  return 0;
}


/**
 * /mode sem argumento: anda no anel plan → build → manual → ask → goal e volta.
 *
 * A ordem não é minha: é a de MODE_NAMES em core/governance/modes.mjs.
 * Com argumento, /mode <nome> vai direto (igual a /plan, /build, /ask).
 */
async function runModeCycle({ out }) {
  const { MODE_NAMES, resolveMode } = await import("../core/governance/modes.mjs");

  const atual = String(currentMode || "").toLowerCase();
  const i = MODE_NAMES.findIndex((m) => m.toLowerCase() === atual);
  const proximo = MODE_NAMES[(i + 1) % MODE_NAMES.length];

  const m = resolveMode(proximo);
  currentMode = m.name;
  statusInfo.mode = m.name;

  const linhas = [paint(`  modo: ${m.name}`, "ok")];
  const linha = describeModeLine(m);
  if (linha) linhas.push(`    ${linha}`);
  const anel = paint(`  anel: ${MODE_NAMES.join(" → ")}`, "muted");
  linhas.push("");
  linhas.push(anel);

  out(capLinhas(linhas).join("\n"));
  return 0;
}

async function runMode(name, { out }) {
  const { resolveMode, guardWrite } = await import("../core/governance/modes.mjs");
  const m = resolveMode(name); // lança se desconhecido
  currentMode = m.name;
  statusInfo.mode = m.name; // painel reflete o modo sem refresh completo
  const lines = [paint(`  modo: ${m.name}`, "bold")];
  lines.push(`    lê ${m.canRead ? "sim" : "não"} · escreve ${m.canWrite ? "sim" : "não"} · executa ${m.canExec ? "sim" : "não"} (${m.execScope})`);
  if (m.name === "plan") {
    const g = guardWrite({ mode: "plan", path: "exemplo.txt", workspace: ROOT });
    lines.push("");
    lines.push(paint(`    escrita: ${g.decision} - ${g.reason}`, g.decision === "block" ? "warn" : "muted"));
  }
  out(capLinhas(lines).join("\n"));
  return 0;
}


/* ------------------------------------------------------------------ */
/* Goal (condição de conclusão — core/forge/goal.mjs)                 */
/* ------------------------------------------------------------------ */

export function getGoalState() {
  return goalState;
}

async function refreshGoalTag() {
  try {
    const { goalIndicator } = await import("../core/forge/goal.mjs");
    goalTag = goalIndicator(goalState);
  } catch {
    goalTag = null;
  }
}

async function runGoal({ arg, out }) {
  const { setGoal, clearGoal } = await import("../core/forge/goal.mjs");
  const cond = String(arg || "").trim();
  if (cond === "") {
    if (goalState && goalState.goal && goalState.goal.condition) {
      out(paint(`  goal ativa: ${goalState.goal.condition}`, "fg"));
      out(paint("  (◎ /goal active — avalio ao fim de cada turno; /goal clear remove)", "muted"));
    } else {
      out(paint("  não há goal ativa. Defina com /goal <condição>.", "muted"));
    }
    return 0;
  }
  if (cond.toLowerCase() === "clear") {
    goalState = clearGoal(goalState);
    await refreshGoalTag();
    out(paint("  goal removida.", "muted"));
    return 0;
  }
  try {
    goalState = setGoal(goalState, cond);
  } catch (err) {
    out(paint(`  ${String(err?.message || err).slice(0, 160)}`, "fail"));
    return 2;
  }
  await refreshGoalTag();
  // A condição vem do usuário e pode ter qualquer tamanho; sem teto, uma linha
  // de 400 chars estoura as 72 colunas da TUI e desalinha o resto da tela.
  // Trunca a linha inteira (não o argumento) para valer para qualquer prefixo.
  const linhaGoal = `  goal definida: ${goalState.goal.condition}`;
  out(paint(linhaGoal.length > 72 ? `${linhaGoal.slice(0, 71)}…` : linhaGoal, "ok"));
  out(paint("  (◎ /goal active — avalio ao fim de cada turno)", "muted"));
  return 0;
}

/** Avalia a goal ao fim de um turno; fecha sozinha (done/impossible). */
export async function checkGoal(lastTurn, out) {
  if (!goalState || !goalState.goal) return;
  try {
    const { evaluateGoal, clearGoal } = await import("../core/forge/goal.mjs");
    const v = evaluateGoal(goalState, { lastTurn: String(lastTurn || "") });
    if (v && (v.done || v.impossible)) {
      const msg = v.done
        ? `  ◎ goal concluída: ${v.reason}`
        : `  ◎ goal impossível: ${v.reason}`;
      out(paint(msg, v.done ? "ok" : "warn"));
      goalState = clearGoal(goalState);
      await refreshGoalTag();
    }
  } catch {
    /* avaliação é best-effort; nunca derruba o turno */
  }
}

export async function runSlash(name, arg, out, ctx = {}) {
  const cmd = COMMANDS.find((c) => c.name === name);
  if (!cmd) {
    out(paint(`  comando desconhecido: ${name}  (tente /help)`, "warn"));
    return 2;
  }
  try {
    return await cmd.run({ arg, out, pi: ctx.pi, onClear: ctx.onClear, home: ctx.home });
  } catch (err) {
    out(paint(`  ${String(err?.message || err).slice(0, 200)}`, "fail"));
    return 2;
  }
}

/* ------------------------------------------------------------------ */
/* Conversa (streaming)                                               */
/* ------------------------------------------------------------------ */

/**
 * Conversa uma mensagem (uma tentativa): inscreve handlers, envia o prompt, faz
 * streaming do texto com redesenho ao vivo e mostra as linhas de ferramenta.
 * `write` escreve no terminal; `setBusy` liga/desliga o estado de execução.
 *
 * NÃO imprime erro: devolve `{ ok, error, text }` e quem chama decide (mostrar
 * o erro ou tentar outro modelo). `text` é o markdown final em caso de sucesso.
 */

/* ------------------------------------------------------------------ */
/* Spinner (indicador de andamento) e painel de estado                */
/* ------------------------------------------------------------------ */

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Movimento reduzido (acessibilidade): respeita `SELFEOPI_REDUCED_MOTION`
 * (1/true/sim) e o pedido do sistema operacional quando disponível. Com
 * movimento reduzido, o spinner vira um indicador ESTÁTICO (sem piscar).
 */
export function prefersReducedMotion() {
  const v = String(process.env.SELFEOPI_REDUCED_MOTION || "").trim().toLowerCase();
  if (["1", "true", "sim", "on"].includes(v)) return true;
  if (["0", "false", "nao", "off"].includes(v)) return false;
  return false; // terminal não expõe prefers-reduced-motion nativamente
}
const SPINNER_MS = 80;

/** Frame do spinner como função pura do tempo (determinístico, testável). */
export function spinnerFrame(t) {
  const i = Math.floor((Number(t) || 0) / SPINNER_MS) % SPINNER_FRAMES.length;
  return SPINNER_FRAMES[(i + SPINNER_FRAMES.length) % SPINNER_FRAMES.length];
}

/**
 * Renderiza o raciocínio do modelo (thinking) em bloco discreto: rótulo
 * sutil + texto em cinza, quebrado em WIDTH. Aceita o texto cru acumulado
 * dos deltas "thinking_delta"; devolve [] quando não há nada.
 */
export function renderThinking(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];
  const out = [paint("  ⤷ raciocínio", "muted")];
  const inner = Math.max(20, WIDTH - 6);
  for (const para of text.split(/\n{2,}/)) {
    const flat = para.replace(/\s+/g, " ").trim();
    if (!flat) continue;
    for (const ln of wrapAnsi(flat, inner).split("\n")) out.push("    " + paint(ln, "dim"));
  }
  return out;
}

/**
 * Spinner controlado: aparece com um rótulo, redesenha no lugar (sem piscar) e
 * some no stop (limpa a linha). O timer é limpo ao parar/sair.
 */
function createSpinner(write) {
  let timer = null;
  let start = 0;
  let label = "";
  let active = false;
  const render = () => {
    // Movimento reduzido: indicador estático (sem piscar).
    const frame = prefersReducedMotion() ? "●" : spinnerFrame(Date.now() - start);
    write("\r\x1b[2K  " + paint(frame, "fg") + " " + paint(label, "muted"));
  };
  return {
    start(l) {
      if (active) {
        label = l;
        render();
        return;
      }
      label = l || "";
      start = Date.now();
      active = true;
      render();
      // Sem animação quando movimento reduzido: um único render basta.
      if (!prefersReducedMotion()) {
        timer = setInterval(render, SPINNER_MS);
        if (timer && typeof timer.unref === "function") timer.unref();
      }
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (active) write("\r\x1b[2K");
      active = false;
    },
    get active() {
      return active;
    },
  };
}

// Permissão do SelfEvoPI (postura da CLI). O modo (plan/build/ask) é ortogonal.
let permissionMode = "full access";

// Painel de estado (cacheado; atualizado por refreshStatus).
let statusInfo = {
  mode: currentMode,
  permission: permissionMode,
  model: null,
  reasoning: null,
  context: null,
  sessionId: null,
  turns: 0,
};

/** Atualiza o painel de estado a partir do motor (best-effort). */
export async function refreshStatus(pi) {
  statusInfo.mode = currentMode;
  statusInfo.permission = permissionMode;
  if (!pi) return statusInfo;
  const st = await pi.getState().catch(() => ({}));
  statusInfo.model = st && st.model ? `${st.model.provider}/${st.model.id}` : null;
  statusInfo.reasoning = st && st.thinkingLevel ? st.thinkingLevel : null;
  statusInfo.sessionId = st && st.sessionId ? st.sessionId : null;
  const stats = await Promise.resolve(
    pi._rpc && pi._rpc.getSessionStats && pi._rpc.getSessionStats(),
  ).catch(() => ({}));
  if (stats && stats.contextUsage) {
    statusInfo.context = `${stats.contextUsage.tokens} / ${stats.contextUsage.contextWindow}`;
  }
  statusInfo.turns = Number(stats?.totalMessages) || 0;
  return statusInfo;
}

/** Linha de status compacta (rodapé): modo · permissão · modelo · raciocínio. */
export function buildStatusLine(info = statusInfo) {
  const parts = [paint(info.mode, "fg"), paint(info.permission, "muted")];
  if (info.model) parts.push(paint(info.model, "muted"));
  if (info.reasoning) parts.push(paint("think:" + info.reasoning, "muted"));
  return parts.join(" · ");
}

/** Painel completo (Ctrl+O): estado da conversa em detalhe. */
export function renderPanel(info = statusInfo, data = {}) {
  const base = data.baseline || readJson(BASELINE, {});
  const t = base.totals || {};
  const lines = [];
  lines.push(paint("  painel", "fg"));
  lines.push(`    modo:        ${paint(info.mode, "bold")}`);
  lines.push(`    permissão:   ${paint(info.permission, "fg")}`);
  lines.push(`    modelo:      ${paint(info.model || "—", "fg")}`);
  lines.push(`    raciocínio:  ${info.reasoning || "—"}`);
  if (info.context) lines.push(`    contexto:    ${info.context}`);
    if (info.sessionId) lines.push(`    sessão:      ${String(info.sessionId).slice(0, 8)} · ${info.turns} turnos`);
  if (t.taskRuns != null) lines.push(`    baseline:    ${t.passes}/${t.taskRuns}`);
  lines.push("");
  lines.push(paint("  ctrl+o fecha", "dim"));
  return lines;
}

/**
 * Painel de configurações (Ctrl+,): o que está valendo nesta sessão.
 *
 * Não é um editor — é a mesma leitura que o desktop mostra em Ctrl+, vista
 * daqui. Quem muda configuração continua mudando por comando (/model, /plan,
 * /build, /ask); este painel só mostra o estado, para os dois lados
 * concordarem sem o usuário adivinhar.
 */
export function renderSettings(info = statusInfo, { sessionsDir = null, commands = COMMANDS.length } = {}) {
  // rótulo ocupa 17 colunas ("    modelo:      "); o resto é do valor, e o
  // valor é cortado para o frame não estourar as 72 colunas com um caminho
  // longo ou um id de modelo comprido.
  const cut = (valor) => {
    const plain = stripAnsi(String(valor ?? ""));
    const max = WIDTH - 17;
    if (max <= 1) return "…";
    return plain.length > max ? plain.slice(0, max - 1) + "…" : plain;
  };

  const lines = [];
  lines.push(paint("  configurações", "fg"));
  lines.push(`    modelo:      ${paint(cut(info.model || "-"), "fg")}`);
  lines.push(`    modo:        ${paint(cut(info.mode), "bold")}`);
  lines.push(`    permissão:   ${paint(cut(info.permission), "fg")}`);
  if (info.reasoning) lines.push(`    raciocínio:  ${cut(info.reasoning)}`);
  if (info.context) lines.push(`    contexto:    ${cut(info.context)}`);
  lines.push(`    sessões:     ${cut(sessionsDir ?? "(não resolvido)")}`);
  lines.push(`    comandos:    ${commands}`);
  lines.push("");
  lines.push(paint("  ctrl+, fecha", "dim"));
  return lines;
}


export async function converse(pi, text, write, setBusy = () => {}, opts = {}) {
  const settleTimeoutMs = opts.settleTimeoutMs ?? 120_000;
  let buf = "";
  let drawn = 0;
  let hadError = false;
  let rawError = "";
  let aborted = false;
  const redraw = () => {
    if (drawn > 0) write(`\x1b[${drawn}A`); // sobe para o topo do bloco
    const rendered = buf ? renderMarkdown(buf).split("\n") : [];
    for (const line of rendered) write("\x1b[2K" + line + "\n"); // limpa a linha e escreve
    if (rendered.length === 0) write("\x1b[2K\n");
    if (drawn > 0 && rendered.length > 0) {
      // se o bloco encolheu, limpa as sobras
      for (let k = rendered.length; k < drawn; k++) write("\x1b[2K\n");
    }
    drawn = Math.max(rendered.length, 1);
    // devolve o cursor ao fim do bloco
    if (drawn > 0) write(`\x1b[${drawn - 1}A`);
  };
  const flush = () => {
    if (drawn > 0) {
      write("\n"); // deixa o bloco committed
      drawn = 0;
    }
    buf = "";
  };

  // Spinner: aparece a cada turno, some quando o texto/ferramenta comanda.
  const spin = createSpinner(write);
  // Raciocínio (thinking_delta) vem no stream rpc interno; o wrapper PiClient
  // não o repassa (normalizeEvent só deixa text_delta). Capturamos via _rpc.
  let thinkBuf = "";
  let thinkCommitted = false;
  const commitThink = () => {
    if (thinkCommitted || thinkBuf.trim() === "") return;
    if (buf && buf.length > 0) return; // já há resposta; não injeta no meio
    const lines = renderThinking(thinkBuf);
    if (lines.length === 0) return;
    thinkCommitted = true;
    spin.stop();
    write(lines.join("\n") + "\n");
  };

  const offText = pi.on("text", (delta) => {
    commitThink(); // raciocínio vem antes da resposta
    spin.stop();
    buf += delta;
    redraw();
  });
  const offTool = pi.on("tool", (call) => {
    if (call.phase !== "start") return;
    commitThink(); // raciocínio vem antes da chamada de ferramenta
    spin.stop();
    flush();
    const argHint =
      call.args && typeof call.args === "object"
        ? Object.values(call.args).map((v) => String(v)).join(" ").replace(/\s+/g, " ").slice(0, 44)
        : "";
    write(`  ${paint("⏺", "accent")} ${paint(String(call.name || "tool").padEnd(10), "fg")} ${paint(argHint, "muted")}\n`);
    spin.start("executando " + String(call.name || "ferramenta"));
  });
  const offError = pi.on("error", (message) => {
    hadError = true;
    rawError = String(message || "");
    spin.stop();
    flush();
  });
  const offSettled = pi.on("settled", (info) => {
    spin.stop();
    if (info && info.aborted === true) aborted = true;
  });

  // Toca o stream rpc interno para capturar thinking_delta (opcional).
  let offThink = () => {};
  try {
    const rpc = pi && pi._rpc;
    if (rpc && typeof rpc.onEvent === "function") {
      offThink = rpc.onEvent((ev) => {
        if (ev && ev.type === "message_update") {
          const inner = ev.assistantMessageEvent;
          if (inner && inner.type === "thinking_delta" && typeof inner.delta === "string") {
            thinkBuf += inner.delta;
          }
        }
      }) || (() => {});
    }
  } catch {
    /* raciocínio é opcional; nunca derruba o turno */
  }

  setBusy(true);
  spin.start("pensando…");
  const settled = waitForSettle(pi, settleTimeoutMs); // arma o listener de settled ANTES do prompt
  try {
    await pi.prompt(text);
  } catch (err) {
    spin.stop();
    flush();
    offText();
    offTool();
    offError();
    offSettled();
    offThink();
    setBusy(false);
    return { ok: false, error: String(err?.message || "prompt"), text: "", aborted: false };
  }
  // espera o settled (o redesenho roda nos eventos)
  await settled;
  const answerText = buf; // markdown completo, antes de o flush limpar
  const wasError = hadError;
  const errText = rawError;
  const wasAborted = aborted;
  spin.stop();
  commitThink(); // mostra raciocínio de um turno sem texto (ex.: só ferramenta)
  flush();
  offText();
  offTool();
  offError();
  offSettled();
  offThink();
  setBusy(false);
  if (wasError) {
    write("\n");
    return { ok: false, error: errText, text: "", aborted: false };
  }
  if (wasAborted) {
    write("\n");
    return { ok: true, error: null, text: "", aborted: true };
  }
  if (answerText.trim() === "") write("\n");
  write("\n");
  return { ok: true, error: null, text: answerText, aborted: false };
}

/**
 * Conversa uma mensagem com fallback transparente: tenta o modelo atual; se
 * falhar e `allowFallback` for true, percorre os modelos configurados (por id,
 * pulando o atual, até `maxCandidates`) até um responder, avisa qual usou e
 * mostra a resposta. Se nada responder, mostra o erro em voz de produto.
 * `SELFEOPI_MODEL` (allowFallback=false) desliga o fallback: a escolha do
 * usuário vence e o erro aparece.
 */
export async function converseOrFallback(pi, text, write, opts = {}) {
  const {
    allowFallback = false,
    candidates = [],
    setBusy = () => {},
    maxCandidates = 5,
    budgetMs = 30_000, // teto TOTAL da varredura (evita "travamento" perceptível)
    perCandidateMs = 25_000, // teto por candidato (cobre um modelo real, ~13-20 s)
  } = opts;
  const usable = (x) => Boolean(x && x.ok && x.text && String(x.text).trim() !== "");

  const res = await converse(pi, text, write, setBusy);
  if (res.aborted) return res; // usuário cancelou: silencioso, sem fallback
  if (usable(res)) return res;
  if (!allowFallback || !Array.isArray(candidates) || candidates.length === 0) {
    write(engineErrorMessage(res.error) + "\n");
    return res;
  }

  // modelo atual (para não repetir o que acabou de falhar)
  const state = await pi.getState().catch(() => ({}));
  const curKey = state.model ? `${state.model.provider}/${state.model.id}` : null;

  // dedupe por id de modelo, pula o atual, limita tentativas
  const seen = new Set();
  const tried = [];
  for (const m of candidates) {
    if (!m || !m.id) continue;
    if (`${m.provider}/${m.id}` === curKey) continue;
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    tried.push(m);
    if (tried.length >= maxCandidates) break;
  }

  const sweepStart = Date.now();
  let lastErr = res.error;
  for (const m of tried) {
    const remaining = budgetMs - (Date.now() - sweepStart);
    if (remaining <= 0) break; // estourou o orçamento total: mostra o erro
    await pi.setModel(m.provider, m.id).catch(() => {});
    const r = await converse(pi, text, () => {}, setBusy, {
      settleTimeoutMs: Math.min(perCandidateMs, remaining),
    });
    if (r.aborted) return r; // cancelou durante o fallback
    if (usable(r)) {
      const model = `${m.provider}/${m.id}`;
      write(fallbackNotice(model) + "\n");
      write(renderMarkdown(r.text) + "\n");
      write("\n");
      return { ok: true, error: null, text: r.text, model };
    }
    if (r.error) lastErr = r.error; // guarda o último erro (p/ a mensagem final)
  }
  write(engineErrorMessage(lastErr) + "\n");
  return { ok: false, error: lastErr };
}

/** Espera o próximo `settled` (ou timeout de segurança). */
function waitForSettle(pi, timeoutMs = 120_000) {
  return new Promise((resolve) => {
    let done = false;
    const off = pi.on("settled", () => {
      if (done) return;
      done = true;
      off();
      resolve();
    });
    setTimeout(() => {
      if (done) return;
      done = true;
      off();
      resolve();
    }, timeoutMs).unref?.();
  });
}

/* ------------------------------------------------------------------ */
/* Linha de comando (editor puro, testável)                           */
/* ------------------------------------------------------------------ */

/**
 * Reduz uma tecla sobre o estado de edição { buf, cur } e devolve o efeito.
 * Cobre o que o REPL precisa: imprimíveis, backspace/delete, mover o cursor,
 * Enter (submit), Ctrl+C (sigint), Ctrl+D (eof).
 *
 * @param {{buf:string, cur:number}} st
 * @param {string} key  caractere, ou "backspace"|"delete"|"left"|"right"|"home"|"end"|"enter"|"ctrl-c"|"ctrl-d"
 * @returns {{ state:{buf:string,cur:number}, effect:("submit"|"sigint"|"eof"|null) }}
 */
export function reduceLine(st, key) {
  const s = {
    buf: st.buf ?? "",
    cur: Math.max(0, Math.min(st.cur ?? (st.buf ?? "").length, (st.buf ?? "").length)),
    sel: st.sel ?? 0,
    dismissed: st.dismissed ?? false,
  };
  const effect = (e) => ({ state: s, effect: e ?? null });
  const open = () => !s.dismissed && s.buf.startsWith("/") && !s.buf.includes(" ");
  const resetDismissed = () => {
    if (s.buf === "" || !s.buf.startsWith("/") || s.buf.includes(" ")) s.dismissed = false;
  };
  const selectCurrent = () => {
    const filtered = filterCommands(s.buf.slice(1));
    if (filtered.length === 0) return false;
    const c = filtered[Math.max(0, Math.min(s.sel, filtered.length - 1))];
    const fill = c.name + (c.args ? " " : "");
    s.buf = fill;
    s.cur = fill.length;
    s.dismissed = true; // não reabre após selecionar
    return true;
  };

  if (key === "enter") {
    // paleta aberta: Enter seleciona (preenche), não executa
    if (open() && selectCurrent()) return effect("selected");
    return effect("submit");
  }
  if (key === "tab") {
    if (open() && selectCurrent()) return effect("selected");
    return effect();
  }
  if (key === "esc") {
    if (open()) {
      s.dismissed = true;
      return effect("palette-closed");
    }
    return effect();
  }
  if (key === "ctrl-c") return effect("sigint");
  if (key === "ctrl-d") return effect("eof");
  if (key === "up") {
    const n = open() ? filterCommands(s.buf.slice(1)).length : 0;
    if (n > 0) {
      s.sel = (s.sel - 1 + n) % n;
      return effect("palette-move");
    }
    return effect("history-up");
  }
  if (key === "down") {
    const n = open() ? filterCommands(s.buf.slice(1)).length : 0;
    if (n > 0) {
      s.sel = (s.sel + 1) % n;
      return effect("palette-move");
    }
    return effect("history-down");
  }
  if (key === "left") {
    s.cur = Math.max(0, s.cur - 1);
    return effect();
  }
  if (key === "right") {
    s.cur = Math.min(s.buf.length, s.cur + 1);
    return effect();
  }
  if (key === "home") {
    s.cur = 0;
    return effect();
  }
  if (key === "end") {
    s.cur = s.buf.length;
    return effect();
  }
  if (key === "backspace") {
    if (s.cur > 0) {
      s.buf = s.buf.slice(0, s.cur - 1) + s.buf.slice(s.cur);
      s.cur--;
      resetDismissed();
      s.sel = 0;
    }
    return effect();
  }
  if (key === "delete") {
    if (s.cur < s.buf.length) {
      s.buf = s.buf.slice(0, s.cur) + s.buf.slice(s.cur + 1);
      resetDismissed();
      s.sel = 0;
    }
    return effect();
  }
  // imprimível (um caractere)
  if (typeof key === "string" && key.length === 1) {
    s.buf = s.buf.slice(0, s.cur) + key + s.buf.slice(s.cur);
    s.cur++;
    resetDismissed();
    s.sel = 0; // digitar volta a seleção ao topo
    return effect();
  }
  return effect();
}

/* ------------------------------------------------------------------ */
/* Frames headless (--render)                                         */
/* ------------------------------------------------------------------ */

const SAMPLE_QUESTION = "como está a cobertura de testes?";
const SAMPLE_ANSWER = [
  "86 de 87 tarefas passam.",
  "",
  "A única abaixo é a **B11** (extração de HTML), que é estocástica.",
  "",
  "Grupos estruturais:",
  "",
  "- **A**: 8 tarefas, todas verdes",
  "- **B**: 8 tarefas (B11 estocástica)",
  "- **C**: 6 tarefas",
].join("\n");

/** Monta o frame de uma conversa de exemplo (para --render conversation). */
export function renderConversationFrame(data = {}) {
  const out = [];
  out.push(renderBanner());
  out.push(renderTagline());
  out.push(rule());
  out.push(renderStatusLine(data));
  out.push("");
  out.push("  " + paint("›", "accent") + " " + SAMPLE_QUESTION);
  out.push("");
  // resposta renderizada (markdown), recuada por "SelfEvoPI  "
  const rendered = renderMarkdown(SAMPLE_ANSWER).split("\n");
  rendered.forEach((line, idx) => {
    if (idx === 0) out.push("  " + paint("SelfEvoPI", "bold") + "  " + line.replace(/^  /, ""));
    else out.push(line);
  });
  out.push("");
  out.push(`  ${paint("⏺", "fg")} ${paint("read".padEnd(10), "fg")} ${paint("evals/baseline.json", "muted")}`);
  out.push(`  ${paint("⏺", "fg")} ${paint("bash".padEnd(10), "fg")} ${paint("npm test", "muted")}`);
  out.push("");
  out.push(rule());
  out.push("  " + SLASH_COMMANDS.slice(0, 7).map((c) => paint(c.cmd.split(" ")[0], "muted")).join("  "));
  out.push(rule());
  return out.map((line) => wrapAnsi(line, WIDTH)).join("\n");
}

/* ------------------------------------------------------------------ */
/* REPL                                                               */
/* ------------------------------------------------------------------ */

/** Detecta o branch atual lendo o .git (diretoria ou ponteiro de worktree). */
function detectBranch() {
  const readHead = (gitPath) => {
    try {
      const head = readFileSync(path.join(gitPath, "HEAD"), "utf8").trim();
      const m = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
      if (m) return m[1];
      if (/^[0-9a-f]{7,40}$/.test(head)) return head.slice(0, 8); // detached HEAD
    } catch {
      /* segue */
    }
    return null;
  };
  try {
    const dotGit = path.join(ROOT, ".git");
    const asFile = readFileSync(dotGit, "utf8"); // só funciona se .git for arquivo (worktree)
    if (asFile.startsWith("gitdir:")) return readHead(asFile.slice(7).trim()) || "repo";
    return readHead(dotGit) || "repo";
  } catch {
    return readHead(path.join(ROOT, ".git")) || "repo";
  }
}

/** Escreve o banner + estado no topo. */
function printHeader(write, data) {
  write(renderBanner() + "\n");
  write(rule() + "\n");
  write(renderStatusLine(data) + "\n");
}

/**
 * Loop interativo (TTY, modo cru). `pi` pode ser null (conversa desativada;
 * comandos de barra seguem). `write` escreve no terminal.
 */
export async function repl({ pi, write, input, setRaw, data = {}, sessionsDir: sessionsDirInjetado } = {}) {
  const keymap = makeKeyMap();
  let line = { buf: "", cur: 0, sel: 0, dismissed: false };
  let history = [];
  let histIdx = -1;
  let running = false;
  let quitting = false;
  let panelOpen = false; // painel de estado (ctrl+o)
  let sessionsOpen = false; // lista de sessões (ctrl+k)
  let settingsOpen = false; // configurações (ctrl+,)
  let sessionsCache = null; // linhas já montadas, para o overlay não esperar
  let settingsCache = null;
  let sessionsDirCache = null; // resolvido uma vez (sessionDir é varredura)
  let modelPicker = null; // seletor de /model: { stage, sel, grupos, flat, niveis, modelo }

  const paletteWidth = () => {
    const cols = (process.stdout && process.stdout.columns) || 80;
    return Math.max(40, Math.min(cols - 4, 116));
  };

  const shortModel = (m) => {
    if (!m) return null;
    const parts = String(m).split("/");
    const tail = parts[parts.length - 1] || String(m);
    return tail.length > 24 ? tail.slice(0, 23) + "…" : tail;
  };

  // Redesenho incremental: limpa SÓ da linha de entrada para baixo.
  const drawInput = () => {
    const open = !line.dismissed && line.buf.startsWith("/") && !line.buf.includes(" ");
    const filtered = open ? filterCommands(line.buf.slice(1)) : [];
    const sel = filtered.length ? Math.max(0, Math.min(line.sel, filtered.length - 1)) : 0;
    const paletteLines = open ? renderPalette(filtered, sel, paletteWidth()) : [];

    // Linha de status (sempre visível): modo · permissão · modelo · goal.
    const statusParts = [paint(currentMode, "fg"), paint(permissionMode, "muted")];
    const model = shortModel(statusInfo.model);
    if (model) statusParts.push(paint(model, "muted"));
    if (statusInfo.reasoning) statusParts.push(paint("think:" + statusInfo.reasoning, "muted"));
    if (goalTag) statusParts.push(paint(goalTag, "warn"));
    const statusLine = "  " + statusParts.join(" · ");

    const keysLine = "  " + paint(
      panelOpen
        ? "ctrl+o fechar · enter enviar · q sair"
        : open
          ? "↑↓ navegar  enter escolher  esc fechar  ctrl+o painel"
          : "enter enviar · / comandos · ctrl+o painel · ctrl+k sessões · q sair",
      "dim",
    );

    // Linhas abaixo da entrada (redesenho incremental: limpa daqui para baixo).
    const belowLines = [];
    for (const pl of paletteLines) belowLines.push(pl);
    if (panelOpen) for (const pl of renderPanel(statusInfo, data)) belowLines.push(pl);
    if (settingsOpen && settingsCache) for (const pl of settingsCache) belowLines.push(pl);
    if (sessionsOpen && sessionsCache) for (const pl of sessionsCache) belowLines.push(pl);
    for (const pl of modelPickerRows()) belowLines.push(pl);
    belowLines.push(statusLine);
    belowLines.push(keysLine);

    write("\r\x1b[J");
    write("  " + paint("›", "accent") + " " + line.buf);
    for (const bl of belowLines) write("\n" + bl);
    const below = belowLines.length;
    if (below > 0) write(`\x1b[${below}A`);
    const col = 4 + line.cur;
    write("\r");
    if (col > 0) write(`\x1b[${col}C`);
  };

  // ------------------------------------------------------------- overlays
  // Os dois são montados uma vez e guardados: o overlay é redesenhado a cada
  // tecla, e varrer a pasta de sessões a cada tecla seria trabalho jogado fora.
  // A geração protege contra dois carregamentos se sobrepondo.

  let sessionsGen = 0;
  async function refreshSessionsOverlay() {
    const my = ++sessionsGen;
    try {
      const { listSessions } = await import("../core/agent/sessions.mjs");
      if (!sessionsDirCache) sessionsDirCache = sessionsDirInjetado ?? await sessionDir();
      const list = await listSessions(sessionsDirCache);
      const extras = await readSessionExtras(sessionsDirCache);
      if (my !== sessionsGen) return;
      sessionsCache = list.length === 0
        ? [paint("  nenhuma sessão encontrada", "muted")]
        : renderSessionsList(list, extras, 8);
    } catch (err) {
      if (my !== sessionsGen) return;
      sessionsCache = [paint(`  não consegui ler as sessões: ${err?.message ?? err}`, "warn")];
    }
    if (sessionsOpen) drawInput();
  }

  let settingsGen = 0;
  async function refreshSettingsOverlay() {
    const my = ++settingsGen;
    if (!sessionsDirCache) {
      try { sessionsDirCache = await sessionDir(); } catch { sessionsDirCache = null; }
    }
    if (my !== settingsGen) return;
    settingsCache = renderSettings(statusInfo, { sessionsDir: sessionsDirCache });
    if (settingsOpen) drawInput();
  }


  // --------------------------------------------------------- /model picker
  // O seletor vive no REPL, não no comando: /model sem argumento devolve o
  // controle para cá, e as teclas (↑ ↓ enter esc) são tratadas antes do editor
  // de linha. Com argumento, /model <nome> continua indo direto e nunca abre.

  const modelPickerRows = () => {
    if (!modelPicker) return [];
    return renderModelPicker({
      stage: modelPicker.stage,
      sel: modelPicker.sel,
      grupos: modelPicker.stage === "models" ? modelPicker.grupos : [],
      niveis: modelPicker.stage === "effort" ? modelPicker.niveis : [],
      modelo: modelPicker.modelo,
    });
  };

  const startModelPicker = () => {
    const grupos = groupModelsByProvider(listConfiguredModels());
    const { flat } = flattenModelGroups(grupos);
    modelPicker = { stage: "models", sel: 0, grupos, flat, niveis: [], modelo: null };
    drawInput();
  };

  /** Fecha o seletor sem mudar nada (Esc). */
  const cancelModelPicker = () => {
    modelPicker = null;
    drawInput();
  };

  /** Quantos itens a etapa atual oferece (para o wrap de ↑/↓). */
  const modelPickerCount = () => {
    if (!modelPicker) return 0;
    return modelPicker.stage === "models" ? modelPicker.flat.length : modelPicker.niveis.length;
  };

  const moveModelPicker = (delta) => {
    if (!modelPicker) return;
    const n = modelPickerCount();
    if (n === 0) return;
    modelPicker.sel = (modelPicker.sel + delta + n) % n;
    drawInput();
  };

  /**
   * Fecha a etapa do modelo e abre a do esforço — só os níveis que aquele
   * modelo expõe. Sem sessão (ou sem o RPC), a etapa é pulada e o seletor
   * fecha: não faz sentido perguntar esforço sem ter onde aplicar.
   */
  const afterModelChosen = async () => {
    const escolha = modelPicker?.flat?.[modelPicker.sel];
    modelPicker = null;
    if (!escolha) { drawInput(); return; }

    if (!pi || typeof pi.setModel !== "function") {
      drawInput();
      return;
    }

    await pi.setModel(escolha.provider, escolha.id).catch(() => null);
    statusInfo.model = escolha.id;

    let niveis = [];
    let doMotor = false;
    try {
      if (pi._rpc && typeof pi._rpc.getAvailableThinkingLevels === "function") {
        niveis = normalizeEffortList(await pi._rpc.getAvailableThinkingLevels());
        doMotor = true;
      }
    } catch {
      doMotor = false;
    }

    if (!doMotor || niveis.length <= 1) {
      // sem lista utilizável, não inventa pergunta: só confirma o modelo
      write("  modelo: " + escolha.provider + "/" + escolha.id + "\n");
      if (!doMotor) write("  (não consegui ler os níveis de esforço deste modelo)\n");
      drawInput();
      return;
    }

    const atual = String(statusInfo.reasoning || "").toLowerCase();
    const i = niveis.findIndex((l) => l === atual);
    modelPicker = {
      stage: "effort",
      sel: i >= 0 ? i : 0,
      grupos: [],
      flat: [],
      niveis,
      modelo: escolha.provider + "/" + escolha.id,
    };
    drawInput();
  };

  /** Enter na etapa de esforço: aplica e fecha. */
  const applyEffortChoice = async () => {
    const nivel = modelPicker?.niveis?.[modelPicker.sel];
    modelPicker = null;
    if (!nivel) { drawInput(); return; }

    if (pi?._rpc && typeof pi._rpc.setThinkingLevel === "function") {
      await pi._rpc.setThinkingLevel(nivel).catch(() => null);
    }
    statusInfo.reasoning = nivel;
    write("  esforço: " + nivel + "\n");
    drawInput();
  };

  const prompt = () => drawInput();

  const finishRun = async () => {
    running = false;
    prompt();
  };

  const submit = async (text) => {
    write("\n");
    history.push(text);
    histIdx = history.length;
    if (pendingInit) {
      const ans = String(text).trim().toLowerCase();
      if (ans === "sim" || ans === "y" || ans === "yes") {
        try {
          const { writeFile } = await import("node:fs/promises");
          await writeFile(path.join(ROOT, "AGENTS.md"), pendingInit, "utf8");
          write("  AGENTS.md gravado.\n");
        } catch {
          write("  não consegui gravar AGENTS.md.\n");
        }
      } else {
        write("  descartado (nada gravado).\n");
      }
      pendingInit = null;
      prompt();
      return;
    }
    if (pendingImport) {
      const ans = String(text).trim().toLowerCase();
      if (ans === "importar" || ans === "sim" || ans === "y" || ans === "yes") {
        const { applyImport } = await import("../core/agent/import.mjs");
        try {
          const r = await applyImport({ plan: pendingImport });
          const linhas = ["  import concluído"];
          if (r.added.mcp.length) linhas.push(`    MCPs copiados:    ${r.added.mcp.join(", ")}`);
          if (r.added.skills.length) linhas.push(`    skills copiadas:  ${r.added.skills.join(", ")}`);
          if (r.backup) linhas.push(`    backup: ${r.backup}`);
          if (r.manifesto) linhas.push(`    manifesto: ${r.manifesto}`);
          write(linhas.join("\n") + "\n");
        } catch (err) {
          write("  não consegui importar: " + (err?.message ?? err) + "\n");
        }
      } else {
        write("  import cancelado (nada gravado).\n");
      }
      pendingImport = null;
      prompt();
      return;
    }
    const parsed = parseInput(text);
    if (parsed.type === "quit") {
      quitting = true;
      return;
    }
    if (parsed.type === "empty") {
      prompt();
      return;
    }
    if (parsed.type === "slash") {
      // /model sem argumento não lista na tela: abre o seletor aqui no REPL,
      // onde as setas e o esc existem. Com argumento segue direto.
      if (parsed.name === "/model" && String(parsed.arg ?? "").trim() === "") {
        startModelPicker();
        return;
      }
      await runSlash(parsed.name, parsed.arg, (s) => write(s + "\n"), { pi, onClear: () => write("\x1b[2J\x1b[H") });
      prompt();
      return;
    }
    // conversa
    if (!pi) {
      write(engineUnavailableNote() + "\n");
      prompt();
      return;
    }
    running = true;
    const res = await converseOrFallback(pi, text, (s) => write(s), {
      allowFallback: !process.env.SELFEOPI_MODEL,
      candidates: listConfiguredModels(),
      setBusy: (b) => (running = b),
    });
    if (quitting) return;
    await checkGoal(res?.text, (s) => write(s + "\n"));
    await finishRun();
  };

  const onData = async (chunk) => {
    for (const key of keymap(chunk)) {
      if (quitting) return;
      if (key === "ctrl-o" && !running) {
        panelOpen = !panelOpen;
        drawInput();
        continue;
      }
      if (key === "ctrl-k" && !running) {
        sessionsOpen = !sessionsOpen;
        settingsOpen = false;
        if (sessionsOpen) {
          // abre na hora com um "lendo"; a varredura chega depois e redesenha
          sessionsCache = [paint("  lendo sessões…", "muted")];
          drawInput();
          void refreshSessionsOverlay();
        } else drawInput();
        continue;
      }
      if (key === "ctrl-comma" && !running) {
        settingsOpen = !settingsOpen;
        sessionsOpen = false;
        if (settingsOpen) {
          // idem: mostra já, resolve o caminho das sessões em segundo plano
          settingsCache = renderSettings(statusInfo, { sessionsDir: sessionsDirCache });
          drawInput();
          void refreshSettingsOverlay();
        } else drawInput();
        continue;
      }
      // O seletor tem prioridade: enquanto ele está aberto, as setas andam
      // na lista, enter escolhe e esc cancela — nada disso chega ao editor.
      if (modelPicker) {
        if (key === "up") { moveModelPicker(-1); continue; }
        if (key === "down") { moveModelPicker(1); continue; }
        if (key === "enter") {
          if (modelPicker.stage === "models") await afterModelChosen();
          else await applyEffortChoice();
          continue;
        }
        if (key === "esc") { cancelModelPicker(); continue; }
      }
      if (running) {
        if (key === "ctrl-c") {
          if (pi) pi.abort().catch(() => {});
          write("^C\n");
          running = false;
          drawInput();
        }
        continue;
      }
      const { state, effect } = reduceLine(line, key);
      switch (effect) {
        case "submit": {
          const text = state.buf;
          line = { buf: "", cur: 0, sel: 0, dismissed: false };
          submit(text);
          break;
        }
        case "sigint": {
          if (state.buf === "") {
            quitting = true;
            write("\n");
          } else {
            line = { buf: "", cur: 0, sel: 0, dismissed: false };
            write("\n");
            drawInput();
          }
          break;
        }
        case "eof":
          quitting = true;
          write("\n");
          break;
        case "history-up":
        case "history-down": {
          if (effect === "history-up") {
            if (history.length > 0 && histIdx > 0) histIdx--;
          } else if (histIdx < history.length) {
            histIdx++;
          }
          const buf = history[histIdx] ?? "";
          line = { buf, cur: buf.length, sel: 0, dismissed: false };
          drawInput();
          break;
        }
        default:
          line = state;
          drawInput();
          break;
      }
    }
  };

  setRaw(true);
  input.setEncoding("utf8");
  input.on("data", onData);
  await refreshStatus(pi); // painel já nasce com modo/permissão/modelo
  prompt();

  return new Promise((resolve) => {
    const check = setInterval(() => {
      if (quitting) {
        clearInterval(check);
        resolve();
      }
    }, 20);
  });
}

/** Traduz um chunk de teclado em tokens do editor (chars, "enter", "ctrl-c"…). */
function makeKeyMap() {
  return function* keymap(chunk) {
    const s = String(chunk);
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      // sequências de escape (setas)
      if (code === 0x1b) {
        const next = s[i + 1];
        if (next === "[") {
          const code2 = s[i + 2];
          if (code2 === "A") {
            yield "up";
            i += 2;
            continue;
          }
          if (code2 === "B") {
            yield "down";
            i += 2;
            continue;
          }
          if (code2 === "C") {
            yield "right";
            i += 2;
            continue;
          }
          if (code2 === "D") {
            yield "left";
            i += 2;
            continue;
          }
          if (code2 === "H") {
            yield "home";
            i += 2;
            continue;
          }
          if (code2 === "F") {
            yield "end";
            i += 2;
            continue;
          }
          // outra sequência CSI: pula até a letra final
          let j = i + 2;
          while (j < s.length && !/[A-Za-z~]/.test(s[j])) j++;
          i = j;
          continue;
        }
        // Esc sozinho
        yield "esc";
        continue;
      }
      if (code === 0x03) {
        yield "ctrl-c";
        continue;
      }
      if (code === 0x04) {
        yield "ctrl-d";
        continue;
      }
      if (code === 0x0f) {
        yield "ctrl-o";
        continue;
      }
      if (code === 0x0b) { // Ctrl+K — a mesma tecla do desktop
        yield "ctrl-k";
        continue;
      }
      if (code === 0x1c) { // Ctrl+, não tem código ASCII próprio; 0x1C é o que
        yield "ctrl-comma"; // a maioria dos terminais manda (Ctrl+ inclusive)
        continue;
      }
      if (code === 0x0d || code === 0x0a) {
        yield "enter";
        continue;
      }
      if (code === 0x7f || code === 0x08) {
        yield "backspace";
        continue;
      }
      if (code === 0x09) {
        yield "tab"; // Tab: seleciona na paleta
        continue;
      }
      if (code >= 0x20) {
        yield String.fromCharCode(code);
        continue;
      }
      yield "__ignore";
    }
  };
}

/** Cria o cliente de conversa e aplica SELFEOPI_MODEL (formato "provedor/modelo"). */
async function startEngine() {
  const { createPiClient } = await import("../core/agent/pi-rpc.mjs");
  const client = await createPiClient({ cwd: ROOT }).catch(() => null);
  if (client) {
    const m = process.env.SELFEOPI_MODEL;
    if (m && m.includes("/")) {
      const i = m.indexOf("/");
      await client.setModel(m.slice(0, i), m.slice(i + 1)).catch(() => {});
    }
  }
  return client;
}

/* ------------------------------------------------------------------ */
/* main                                                               */
/* ------------------------------------------------------------------ */

function printHelpText() {
  const out = [];
  out.push(paint("SelfEvoPI", "bold") + " — conversa com o agente do SelfEvoPI.");
  out.push("");
  out.push("  uso:");
  out.push("    node apps/cli.mjs                      inicia a conversa");
  out.push("    node apps/cli.mjs --render conversation  mostra um frame de exemplo");
  out.push("    node apps/cli.mjs --render help          mostra os comandos");
  out.push("    node apps/cli.mjs --render banner        mostra só o banner + estado");
  out.push("    node apps/cli.mjs --help                 esta ajuda");
  out.push("    node apps/cli.mjs --version              mostra a versão");
  out.push("");
  out.push("  comandos de barra: " + SLASH_COMMANDS.map((c) => c.cmd).join("  "));
  out.push("  modelo da conversa:  SELFEOPI_MODEL=provedor/modelo");
  out.push("  sair: q / /quit / Ctrl+D");
  process.stdout.write(out.join("\n") + "\n");
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--version") || args.includes("-v")) {
    process.stdout.write(VERSION + "\n");
    process.exit(0);
  }
  if (args.includes("--help") || args.includes("-h")) {
    printHelpText();
    process.exit(0);
  }

  const renderIdx = args.indexOf("--render");
  if (renderIdx !== -1) {
    const screen = args[renderIdx + 1];
    const data = { branch: "main" };
    let frame;
    if (screen === "conversation") frame = renderConversationFrame(data);
    else if (screen === "help") frame = [renderBanner(), renderTagline(), rule(), renderStatusLine(data), "", renderHelp()].join("\n");
    else if (screen === "banner") frame = [renderBanner(), renderTagline(), rule(), renderStatusLine(data)].join("\n");
    else if (screen === "palette") frame = renderPaletteFrame("", 72);
    else if (screen === "menu") frame = renderPaletteFrame("", 72);
    else if (screen === "palette-filtered") frame = renderPaletteFrame("ev", 72);
    else if (screen === "status") frame = [
      renderBanner(),
      rule(),
      renderStatusLine({ ...data, mode: currentMode }),
      "",
      paint("  sessão", "fg"),
      `    versão:   ${VERSION}`,
      "    modelo:   —",
      `    modo:     ${paint(currentMode, "bold")}`,
      `    goal:     ${goalState && goalState.goal && goalState.goal.condition ? paint("◎ /goal active — " + goalState.goal.condition, "warn") : paint("(nenhuma)", "muted")}`,
    ].join("\n");
    else if (screen === "panel") {
      const sample = {
        mode: currentMode,
        permission: permissionMode,
        model: "anthropic/claude-opus-5-5",
        reasoning: "medium",
        context: "12.4k / 200k",
        sessionId: "01a1ead6",
        turns: 3,
      };
      frame = [
        renderBanner(),
        rule(),
        renderStatusLine({ ...data, mode: currentMode }),
        "",
        ...renderPanel(sample, data),
      ].join("\n");
    } else if (screen === "busy") {
      // Simula o rodapé com spinner + rótulos de estado (pensando / ferramenta).
      const f = spinnerFrame(SPINNER_MS * 3);
      frame = [
        renderBanner(),
        rule(),
        renderStatusLine({ ...data, mode: currentMode }),
        "",
        "  " + paint("›", "accent") + " " + SAMPLE_QUESTION,
        "",
        "  " + paint(f, "fg") + " " + paint("pensando…", "muted"),
        "  " + paint("⏺", "fg") + " " + paint("read".padEnd(10), "fg") + " " + paint("src/index.ts", "muted"),
        "  " + paint(spinnerFrame(SPINNER_MS * 6), "fg") + " " + paint("executando read", "muted"),
        "",
        rule(),
        "  " + buildStatusLine({ mode: currentMode, permission: permissionMode, model: "claude-opus-5-5", reasoning: "medium" }),
      ].join("\n");
    } else {
      process.stderr.write(`erro: --render não reconhece "${screen || ""}" (use: conversation, menu, help, banner, palette, palette-filtered, status, panel, busy)\n`);
      process.exit(2);
    }
    process.stdout.write(frame + "\n");
    process.exit(0);
  }

  const data = { branch: detectBranch() };
  const engine = findEngine();

  const isTTY = process.stdin.isTTY && process.stdout.isTTY;

  if (!isTTY) {
    // Modo linha (pipe/CI): lê linhas, processa, sai em q / EOF. Nunca pendura.
    printHeader((s) => process.stdout.write(s + "\n"), data);
    if (!engine.available) process.stdout.write(engineUnavailableNote() + "\n");
    let pi = null;
    if (engine.available) {
      pi = await startEngine();
    }
    let buf = "";
    process.stdin.setEncoding("utf8");
    let chain = Promise.resolve();
    const handle = (raw) => {
      chain = chain.then(() => handleOne(raw));
      return chain;
    };
    const handleOne = async (raw) => {
      if (pendingInit) {
        const ans = String(raw).trim().toLowerCase();
        if (ans === "sim" || ans === "y" || ans === "yes") {
          const { writeFile } = await import("node:fs/promises");
          await writeFile(path.join(ROOT, "AGENTS.md"), pendingInit, "utf8")
            .then(() => process.stdout.write("  AGENTS.md gravado.\n"))
            .catch(() => process.stdout.write("  não consegui gravar AGENTS.md.\n"));
        } else {
          process.stdout.write("  descartado (nada gravado).\n");
        }
        pendingInit = null;
        return;
      }
      if (pendingImport) {
        const ans = String(raw).trim().toLowerCase();
        if (ans === "importar" || ans === "sim" || ans === "y" || ans === "yes") {
          const { applyImport } = await import("../core/agent/import.mjs");
          try {
            const r = await applyImport({ plan: pendingImport });
            const linhas = ["  import concluído"];
            if (r.added.mcp.length) linhas.push(`    MCPs copiados:    ${r.added.mcp.join(", ")}`);
            if (r.added.skills.length) linhas.push(`    skills copiadas:  ${r.added.skills.join(", ")}`);
            if (r.backup) linhas.push(`    backup: ${r.backup}`);
            if (r.manifesto) linhas.push(`    manifesto: ${r.manifesto}`);
            process.stdout.write(linhas.join("\n") + "\n");
          } catch (err) {
            process.stdout.write("  não consegui importar: " + (err?.message ?? err) + "\n");
          }
        } else {
          process.stdout.write("  import cancelado (nada gravado).\n");
        }
        pendingImport = null;
        return;
      }
      const parsed = parseInput(raw);
      if (parsed.type === "quit") {
        if (pi) await pi.close().catch(() => {});
        process.exit(0);
      }
      if (parsed.type === "empty") return;
      if (parsed.type === "slash") {
        await runSlash(parsed.name, parsed.arg, (s) => process.stdout.write(s + "\n"), { pi });
        return;
      }
      // conversa
      if (!pi) {
        process.stdout.write(engineUnavailableNote() + "\n");
        return;
      }
      const res = await converseOrFallback(pi, parsed.text, (s) => process.stdout.write(s), {
        allowFallback: !process.env.SELFEOPI_MODEL,
        candidates: listConfiguredModels(),
      });
      await checkGoal(res?.text, (s) => process.stdout.write(s + "\n"));
    };
    process.stdin.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        handle(line);
      }
    });
    process.stdin.on("end", () => {
      if (buf.trim() !== "") handle(buf);
      chain
        .then(() => (pi ? pi.close().catch(() => {}) : undefined))
        .then(() => process.exit(0))
        .catch(() => process.exit(0));
    });
    return;
  }

  // TTY: conversa
  printHeader((s) => process.stdout.write(s + "\n"), data);
  let pi = null;
  if (engine.available) {
    pi = await startEngine();
  } else {
    process.stdout.write(engineUnavailableNote() + "\n\n");
  }

  const stdin = process.stdin;
  const stdout = process.stdout;
  const setRaw = (on) => {
    try {
      if (stdin.isTTY) stdin.setRawMode(on);
    } catch {
      /* idem */
    }
  };
  await repl({ pi, write: (s) => stdout.write(s), input: stdin, setRaw, data });
  setRaw(false);
  if (pi) await pi.close().catch(() => {});
  process.exitCode = 0;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`SelfEvoPI: ${err?.stack || err?.message || err}\n`);
    process.exitCode = 2;
  });
}