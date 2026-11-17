#!/usr/bin/env node
/**
 * apps/cli.mjs — a CLI do SelfEvoPI: uma conversa, não um catálogo.
 *
 * Gramática: REPL de conversa (estilo Claude Code / OpenCode). Herda a MARCA
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

const PX = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  fg: TRUE ? "\x1b[38;2;255;255;255m" : "", // #ffffff
  muted: TRUE ? "\x1b[38;2;120;120;120m" : "\x1b[90m", // #787878
  rule: TRUE ? "\x1b[38;2;60;60;60m" : "\x1b[90m",
  accent: TRUE ? "\x1b[38;2;120;120;120m" : "\x1b[90m",
  code: TRUE ? "\x1b[38;2;200;200;200m" : "\x1b[37m",
  ok: TRUE ? "\x1b[38;2;63;185;80m" : "\x1b[32m", // #3FB950
  warn: TRUE ? "\x1b[38;2;210;153;34m" : "\x1b[33m", // #D29922
  fail: TRUE ? "\x1b[38;2;248;81;73m" : "\x1b[31m", // #F85149
};

const STATE_KEY = { green: "ok", amber: "warn", red: "fail" };

function paint(text, key) {
  const c = PX[key];
  return c ? `${c}${text}${PX.reset}` : String(text);
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
  return fit(`  ${dot} ${branch} · ${st.label} · ${cells}`);
}

/** Banner: ◍ SelfEvoPI ... v0.5.0. Voz do produto; nunca cita o motor. */
export function renderBanner() {
  const left = `  ${paint("◍", "fg")}  ${paint("SelfEvoPI", "bold")}`;
  const right = paint(`v${VERSION}`, "muted");
  const pad = Math.max(1, WIDTH - visibleWidth(left) - visibleWidth(right));
  return left + " ".repeat(pad) + right;
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

export const SLASH_COMMANDS = [
  { cmd: "/evals", desc: "roda os grupos A/B/C (estruturais)" },
  { cmd: "/gate", desc: "gate completo (usa modelo; pode demorar)" },
  { cmd: "/detect", desc: "lacunas de ferramenta em aberto" },
  { cmd: "/forge <meta>", desc: "inicia um ciclo evolutivo rumo à meta" },
  { cmd: "/memory <termo>", desc: "busca na memória (lexical + PPMI)" },
  { cmd: "/skills", desc: "o que o loop já gerou e registrou" },
  { cmd: "/model [nome]", desc: "mostra ou troca o modelo da conversa" },
  { cmd: "/clear", desc: "limpa a conversa e começa de novo" },
  { cmd: "/help", desc: "mostra esta lista" },
];

const SLASH_NAMES = new Set(SLASH_COMMANDS.map((c) => c.cmd.split(" ")[0]));

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

/** Ajuda (/help) — voz do produto, sem citar o motor. */
export function renderHelp() {
  const out = [];
  out.push(paint("COMANDOS", "bold"));
  out.push("");
  for (const c of SLASH_COMMANDS) {
    out.push(`  ${paint(c.cmd.padEnd(16), "fg")}  ${paint(c.desc, "muted")}`);
  }
  out.push("");
  out.push(paint("CONVERSA", "bold"));
  out.push("");
  out.push(`  ${paint("escreva", "fg")} e Enter para falar; a resposta aparece em streaming.`);
  out.push(`  ${paint("Ctrl+C", "fg")} cancela a resposta em curso e devolve a linha.`);
  out.push(`  ${paint("q", "fg")} / ${paint("/quit", "fg")} / ${paint("Ctrl+D", "fg")} saem.`);
  return out.map((line) => wrapAnsi(line, WIDTH)).join("\n");
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
export async function runSlash(name, arg, out, ctx = {}) {
  switch (name) {
    case "/help":
      out(renderHelp());
      return 0;

    case "/detect": {
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

    case "/skills": {
      const { openStore } = await import("../core/memory/store.mjs");
      const store = openStore({ root: MEMORY });
      const entries = store.query({ level: "skills" }).filter((e) => !e.invalid);
      if (entries.length === 0) {
        out(paint("  nenhuma skill registrada ainda", "muted"));
        return 0;
      }
      const lines = [paint(`  ${entries.length} skill(s) registrada(s)`, "fg")];
      for (const e of entries.slice(0, 15)) {
        lines.push(`  ${paint("●", "ok")} ${String(e.text).replace(/\s+/g, " ").slice(0, 64)}`);
      }
      out(lines.join("\n"));
      return 0;
    }

    case "/memory": {
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

    case "/evals": {
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

    case "/gate": {
      out(paint("  gate completo — usa o modelo e pode demorar…", "muted"));
      const r = await runProcess(process.execPath, [path.join(ROOT, "evals", "gate.mjs")]);
      const last = tailLines(r.out, 10);
      out(last.map((l) => "  " + l).join("\n") || paint("  (sem saída)", "muted"));
      return r.code;
    }

    case "/forge": {
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

    case "/model": {
      const pi = ctx.pi;
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

    case "/clear": {
      const pi = ctx.pi;
      if (pi) {
        await pi.newSession().catch(() => {});
      }
      ctx.onClear?.();
      out(paint("  conversa limpa", "muted"));
      return 0;
    }

    default:
      out(paint(`  comando desconhecido: ${name}  (tente /help)`, "warn"));
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

  const offText = pi.on("text", (delta) => {
    buf += delta;
    redraw();
  });
  const offTool = pi.on("tool", (call) => {
    if (call.phase !== "start") return;
    flush();
    const argHint =
      call.args && typeof call.args === "object"
        ? Object.values(call.args).map((v) => String(v)).join(" ").replace(/\s+/g, " ").slice(0, 44)
        : "";
    write(`  ${paint("⏺", "fg")} ${paint(String(call.name || "tool").padEnd(10), "fg")} ${paint(argHint, "muted")}\n`);
  });
  const offError = pi.on("error", (message) => {
    hadError = true;
    rawError = String(message || "");
    flush();
  });
  const offSettled = pi.on("settled", (info) => {
    if (info && info.aborted === true) aborted = true;
  });

  setBusy(true);
  const settled = waitForSettle(pi, settleTimeoutMs); // arma o listener de settled ANTES do prompt
  try {
    await pi.prompt(text);
  } catch (err) {
    flush();
    offText();
    offTool();
    offError();
    offSettled();
    setBusy(false);
    return { ok: false, error: String(err?.message || "prompt"), text: "", aborted: false };
  }
  // espera o settled (o redesenho roda nos eventos)
  await settled;
  const answerText = buf; // markdown completo, antes de o flush limpar
  const wasError = hadError;
  const errText = rawError;
  const wasAborted = aborted;
  flush();
  offText();
  offTool();
  offError();
  offSettled();
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
  const s = { buf: st.buf ?? "", cur: Math.max(0, Math.min(st.cur ?? (st.buf ?? "").length, (st.buf ?? "").length)) };
  const effect = (e) => ({ state: s, effect: e ?? null });

  if (key === "enter") return effect("submit");
  if (key === "ctrl-c") return effect("sigint");
  if (key === "ctrl-d") return effect("eof");
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
    if (s.cur > 0) s.buf = s.buf.slice(0, s.cur - 1) + s.buf.slice(s.cur), s.cur--;
    return effect();
  }
  if (key === "delete") {
    if (s.cur < s.buf.length) s.buf = s.buf.slice(0, s.cur) + s.buf.slice(s.cur + 1);
    return effect();
  }
  // imprimível (um caractere)
  if (typeof key === "string" && key.length === 1) {
    s.buf = s.buf.slice(0, s.cur) + key + s.buf.slice(s.cur);
    s.cur++;
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
  out.push(rule());
  out.push(renderStatusLine(data));
  out.push("");
  out.push("  " + paint("›", "fg") + " " + SAMPLE_QUESTION);
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
export async function repl({ pi, write, input, setRaw, data = {} }) {
  const keymap = makeKeyMap();
  let line = { buf: "", cur: 0 };
  let history = [];
  let histIdx = -1;
  let running = false;
  let quitting = false;

  const echo = () => {
    write("\r\x1b[2K  " + paint("›", "fg") + " " + line.buf);
    // posiciona o cursor dentro do buffer
    const back = line.buf.length - line.cur;
    if (back > 0) write(`\x1b[${back}D`);
  };
  const prompt = () => echo();

  const finishRun = async () => {
    running = false;
    prompt();
  };

  const submit = async (text) => {
    write("\n");
    history.push(text);
    histIdx = history.length;
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
    await converseOrFallback(pi, text, (s) => write(s), {
      allowFallback: !process.env.SELFEOPI_MODEL,
      candidates: listConfiguredModels(),
      setBusy: (b) => (running = b),
    });
    if (quitting) return;
    await finishRun();
  };

  const onData = (chunk) => {
    for (const key of keymap(chunk)) {
      if (quitting) return;
      if (key === "__sigint") {
        if (running && pi) {
          // Ctrl+C durante a conversa: cancela e volta à linha
          pi.abort().catch(() => {});
          write("^C\n");
          running = false;
          write(engineUnavailableNote().length ? "" : "");
          prompt();
        } else {
          // Ctrl+C na linha: limpa; se já vazia duas vezes, sai
          if (line.buf === "") {
            quitting = true;
            write("\n");
          } else {
            line = { buf: "", cur: 0 };
            write("\n");
            prompt();
          }
        }
        continue;
      }
      if (running) continue; // durante a conversa, só Ctrl+C importa
      if (key === "up") {
        if (history.length > 0 && histIdx > 0) {
          histIdx--;
          line = { buf: history[histIdx] ?? "", cur: (history[histIdx] || "").length };
          echo();
        }
        continue;
      }
      if (key === "down") {
        if (histIdx < history.length) {
          histIdx++;
          line = { buf: history[histIdx] ?? "", cur: (history[histIdx] || "").length };
          echo();
        }
        continue;
      }
      const { state, effect } = reduceLine(line, key);
      line = state;
      if (effect === "submit") {
        const text = line.buf;
        line = { buf: "", cur: 0 };
        submit(text);
      } else if (effect === "eof") {
        quitting = true;
        write("\n");
      } else {
        echo();
      }
    }
  };

  setRaw(true);
  input.setEncoding("utf8");
  input.on("data", onData);
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
        yield "__ignore";
        continue;
      }
      if (code === 0x03) {
        yield "__sigint";
        continue;
      }
      if (code === 0x04) {
        yield "ctrl-d";
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
        yield "__ignore"; // Tab: ignora (sem autocompletar)
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
    else if (screen === "help") frame = [renderBanner(), rule(), renderStatusLine(data), "", renderHelp()].join("\n");
    else if (screen === "banner") frame = [renderBanner(), rule(), renderStatusLine(data)].join("\n");
    else {
      process.stderr.write(`erro: --render não reconhece "${screen || ""}" (use: conversation, help, banner)\n`);
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
      await converseOrFallback(pi, parsed.text, (s) => process.stdout.write(s), {
        allowFallback: !process.env.SELFEOPI_MODEL,
        candidates: listConfiguredModels(),
      });
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