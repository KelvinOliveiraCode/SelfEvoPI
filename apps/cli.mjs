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
import {
  getTheme,
  getThemeColors,
  themeToAnsi,
  themeToAnsi256,
  themeToAnsiFromColors,
  themeToAnsi256FromColors,
} from "../core/agent/theme.mjs";
import { t as tr, getLocale, setLocale, listLocales, isLocale } from "../core/agent/i18n.mjs";
import {
  LEVELS as VERBOSITY_LEVELS,
  getVerbosity,
  setVerbosity,
  normalize as normalizeVerbosity,
  shows,
} from "../core/agent/verbosity.mjs";
import { effortLevelsFor, listModelMetadata } from "../core/agent/model-metadata.mjs";
import {
  captureClipboardImage,
  imageContent,
  isImageFile,
  prepareAttachmentDir,
} from "../core/agent/attachments.mjs";

// Acoplamento conhecido: usamos pi._rpc (acesso interno do RpcClient) para
// getSessionStats/getMessages/switchSession, que o wrapper PiClient
// (core/agent/pi-rpc.mjs) não expõe. É deliberado e contido; mover os três
// métodos para o wrapper é mudança futura em área compartilhada (core/agent/).

const ROOT = path.resolve(import.meta.dirname, "..");
// Diretório onde os agentes AGEM (workspace). Começa na raiz do repo; o
// comando /workspace troca em tempo real (outro diretório, a máquina toda…).
let workspaceRoot = ROOT;
const LEDGER = path.join(ROOT, ".pi", "harness", "ledger", "evals.jsonl");
const BASELINE = path.join(ROOT, "evals", "baseline.json");
const MEMORY = path.join(ROOT, ".pi", "harness", "memory");

const WIDTH = 72; // largura usada em --render (headless), estável para testes
const RULE = 64; // régua de ─ (marca §1.1)

/**
 * Largura real do frame. Num TTY usa as colunas do terminal (até 160) para
 * que textos longos caibam sem reticências; fora de TTY mantém 72 para que
 * `--render` seja determinístico. Nunca encosta na última coluna: evita o
 * "deferred wrap" que faz a linha seguinte subir e sobrepor.
 */
export function frameWidth() {
  const cols = process.stdout?.isTTY ? Number(process.stdout.columns) || 80 : WIDTH;
  return Math.max(WIDTH, Math.min(cols - 2, 160));
}

/* ------------------------------------------------------------------ */
/* Paleta (marca §1.1 / §2) — truecolor ou degradação honesta          */
/* ------------------------------------------------------------------ */

function detectTruecolor() {
  // Truecolor SÓ quando o terminal anuncia (COLORTERM=truecolor/24bit). Sem isso,
  // usamos ANSI-256 (aceito por praticamente todo terminal moderno, inclusive
  // xterm-256color e o console do Windows) — evita o bug de "nada muda" quando o
  // terminal é 256 cores e ignorava os códigos truecolor.
  if (process.env.NO_COLOR) return false;
  const ct = String(process.env.COLORTERM || "").toLowerCase();
  if (ct.includes("truecolor") || ct.includes("24bit")) return true;
  const term = String(process.env.TERM || "").toLowerCase();
  if (term === "dumb" || term === "linux") return false;
  return false; // sem anúncio de truecolor → 256 cores
}

const TRUE = detectTruecolor();

// A paleta vem do TEMA ATIVO (core/agent/theme.mjs), não de um PX fixo: assim o
// comando /theme muda de fato as cores da CLI (antes o tema era persistido, mas o
// render usava um PX hardcoded — /theme não fazia nada). `rule`/`code` derivam do
// tema; reset/bold/dim/italic são SGR, não cor.
const SGR = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", italic: "\x1b[3m" };
let _pxCache = null;
let _pxKey = null;
let _customHex = null; // paleta hex do tema custom ativo (pré-carregada)

/** Paleta hex do tema ativo (built-in ou custom). */
function currentPaletteHex() {
  const name = getTheme();
  if (String(name).startsWith("custom")) return _customHex || getThemeColors("escuro");
  return getThemeColors(name);
}

function px() {
  const name = getTheme();
  const key = String(name).startsWith("custom") ? "custom:" + JSON.stringify(_customHex) : String(name);
  if (_pxCache && _pxKey === key) return _pxCache;
  // truecolor quando o terminal anuncia; senão ANSI-256. Tudo vem do tema
  // (inclui code/tool/link/rule, cada um com sua cor).
  const colors = currentPaletteHex();
  const a = TRUE ? themeToAnsiFromColors(colors) : themeToAnsi256FromColors(colors);
  _pxCache = {
    ...SGR,
    fg: a.fg,
    muted: a.muted,
    accent: a.accent,
    ok: a.ok,
    warn: a.warn,
    fail: a.fail,
    code: a.code,
    tool: a.tool,
    link: a.link,
    rule: a.rule,
  };
  _pxKey = key;
  return _pxCache;
}

/**
 * (Re)carrega a paleta do tema custom ativo. Chamar após setTheme("custom:N")
 * ou após salvar um slot custom. Deixa px() síncrono (lê do cache).
 */
async function refreshThemeCache() {
  const name = getTheme();
  if (String(name).startsWith("custom")) {
    const slot = Number(String(name).split(":")[1]);
    try {
      const { getCustomTheme } = await import("../core/agent/theme-custom.mjs");
      const c = await getCustomTheme(slot);
      _customHex = { ...getThemeColors("escuro"), ...(c?.colors || {}) };
    } catch {
      _customHex = null;
    }
  } else {
    _customHex = null;
  }
  _pxCache = null;
  _pxKey = null;
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

/**
 * Logo ASCII grande do SelfEvoPI (figlet "standard"). Aparece no início da
 * sessão e nos frames headless. Largura ~45 col — cabe em 72.
 */
export const LOGO = [
  "  ____       _  __ _____            ____ ___ ",
  " / ___|  ___| |/ _| ____|_   _____ |  _ \\_ _|",
  " \\___ \\ / _ \\ | |_|  _| \\ \\ / / _ \\| |_) | | ",
  "  ___) |  __/ |  _| |___ \\ V / (_) |  __/| | ",
  " |____/ \\___|_|_| |_____| \\_/ \\___/|_|  |___|",
];

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
  if (lkg && lkg.sha) return { label: tr("state.ready"), color: "green" };
  return { label: tr("state.cold"), color: "amber" };
}

/** Linha de estado: branch · estado. Sem citar o motor nem baseline. */
export function renderStatusLine(data = {}) {
  const st = harnessState(data);
  const dot = paint("●", STATE_KEY[st.color] || "warn");
  const branch = data.branch || "repo";
  const state = paint(st.label, STATE_KEY[st.color] || "warn");
  const mode = data.mode ? ` · ${paint(data.mode, "accent")}` : "";
  const line = `  ${dot} ${branch} · ${state}${mode}`;
  // Preserva ANSI (não usa fit(), que removeria as cores e deixava a linha monocromática).
  return visibleWidth(line) > WIDTH ? truncateVisible(line, WIDTH) : line;
}

/**
 * Banner: logo ASCII grande + versão. Voz do produto; nunca cita o motor nem
 * baseline. Substituiu a antiga linha "◍ SelfEvoPI ... v0.5.0".
 */
export function renderBanner() {
  const logo = LOGO.map((l) => "  " + paint(l, "accent")).join("\n");
  const ver = paint(`v${VERSION}`, "muted");
  return `${logo}\n  ${ver}`;
}

/**
 * Tagline do banner. Removida do fluxo visual (o logo grande já dá identidade);
 * mantida como função por compatibilidade com --render frames existentes.
 */
export function renderTagline() {
  return "";
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

/** Estado do último SGR de uma linha: usado para fechar estilo ao quebrar. */
function sgrState(text) {
  let open = false;
  let style = "";
  const re = /\x1b\[[0-9;]*m/g;
  let m;
  while ((m = re.exec(String(text)))) {
    const body = m[0].slice(2, -1);
    if (body === "0" || body === "") {
      open = false;
      style = "";
    } else {
      open = true;
      style = m[0];
    }
  }
  return { open, style };
}

/** Quebra sem perder texto e sem deixar SGR aberto no fim de cada linha visual. */
function wrapBalanced(text, width) {
  const pieces = String(text ?? "").split("\n");
  const out = [];
  for (const piece of pieces) {
    if (visibleWidth(piece) <= width) {
      out.push(piece);
      continue;
    }
    let carry = "";
    for (const part of wrapAnsi(piece, width).split("\n")) {
      const state = sgrState(part);
      let line = carry + part;
      if (sgrState(line).open) line += "\x1b[0m";
      out.push(line);
      carry = state.open ? state.style : "";
    }
  }
  return out;
}

/**
 * Quebra cada linha em `largura` colunas sem perder texto.
 *
 * A saída de comando é dado do usuário ou do provedor: nunca deve aparecer
 * como "con…" na borda. `wrapAnsi` preserva as sequências de cor.
 */
function capLinhas(linhas, largura = WIDTH) {
  // Nada de reticência: o texto continua inteiro, apenas quebra na largura
  // disponível. O chamador imprime cada elemento como uma linha da TUI.
  const out = [];
  for (const l of linhas) out.push(...wrapBalanced(l, largura));
  return out;
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

  const [mcp, skills, sessions] = await Promise.all([
    seguro(() => listConfiguredMcp({}), []),
    seguro(() => listPcSkills({}), []),
    seguro(async () => {
      const dir = await sessionDir();
      const { listSessions } = await import("../core/agent/sessions.mjs");
      return (await listSessions(dir)).length;
    }, null),
  ]);

  const linhas = renderSettings({
    mode: currentMode,
    permission: permissionMode,
    model: shortModelSafe(statusInfo.model),
    effort: statusInfo.reasoning,
    theme: getTheme(),
    mcp: mcp.length,
    skills: skills.length,
    sessions,
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
      const disp = [...listThemes(), "custom:1", "custom:2", "custom:3"].join(", ");
      out(paint(`  tema "${nome}" nao existe. Disponiveis: ${disp}`, "fail"));
      return 1;
    }
    // tema customizado: recarrega a paleta do slot para px() usar
    if (String(nome).startsWith("custom")) await refreshThemeCache();
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
    out(paint("  molda N subagentes (provider/modelo em round-robin) e os executa.", "muted"));
    out(paint("  para um subagente único e nomeado: /subagent <nome> <tarefa>", "muted"));
    return 2;
  }
  // Provedores/modelos vêm do roteador; sem nenhum, o swarm diz e para.
  const modelos = (() => {
    try { return listConfiguredModels(); } catch { return []; }
  })();
  const provedores = [...new Set(modelos.map((m) => m.provider))];
  if (provedores.length === 0) {
    out(paint("  nenhum provedor configurado — /swarm precisa de pelo menos um", "warn"));
    return 2;
  }
  const { n, task } = parseSwarmArgs(bruto);
  const plano = planSwarm({ task, n, providers: provedores, models: modelos });
  out(renderSwarm({ plan: plano }).join("\n"));

  // Execução real: precisa do motor. Sem ele, só o plano (não finge executar).
  const { findEngine } = await import("../core/agent/pi-rpc.mjs");
  const engine = findEngine();
  if (!engine.available) {
    out(paint("  (motor ausente — só o plano; instale o motor para executar)", "muted"));
    return 0;
  }

  out(paint(`  executando ${plano.subtasks.length} subagentes (temporários)…`, "muted"));
  const { runSwarmExecution, synthesizeSubagents } = await import("../core/agent/subagent.mjs");
  const specs = plano.subtasks.map((st) => ({
    name: st.id,
    provider: st.provider,
    model: st.model,
    effort: "medium",
    mode: "build",
    task: st.goal,
  }));
  const resultados = await runSwarmExecution(specs, { cwd: workspaceRoot });
  const ok = resultados.filter((r) => r.ok).length;
  out("");
  out(synthesizeSubagents(resultados));
  out("");
  out(ok === resultados.length
    ? paint(`  ✓ ${ok}/${resultados.length} subagentes concluíram`, "ok")
    : paint(`  ${ok}/${resultados.length} subagentes concluíram`, "warn"));
  return ok === resultados.length ? 0 : 1;
}

/* ------------------------------------------------------------------ */
/* /subagent — subagente nomeado e moldado (persistente ou temporário) */
/* ------------------------------------------------------------------ */

/**
 * /subagent <nome> <tarefa> [--provider p] [--model m] [--effort e] [--mode m] [--persistent]
 * Cria um subagente moldado pelo modelo principal (filosofia dsh): escolhe
 * provider/modelo/esforço/modo e como chamá-lo. `list` lista persistentes,
 * `close <nome>` encerra um.
 */
async function runSubagentCmd({ arg, out }) {
  const { runSubagent, listPersistent, closePersistent } = await import("../core/agent/subagent.mjs");
  const bruto = String(arg ?? "").trim();
  if (!bruto || bruto === "list") {
    const nomes = listPersistent();
    out(nomes.length ? paint(`  subagentes persistentes: ${nomes.join(", ")}`, "fg") : paint("  nenhum subagente persistente", "muted"));
    return 0;
  }
  if (bruto === "close") {
    out(paint("  uso: /subagent close <nome>", "muted"));
    return 2;
  }

  const tokens = bruto.split(/\s+/);
  // extrai flags --x valor / --x=valor
  const flags = {};
  const resto = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith("--")) {
      const [k, v] = t.slice(2).split("=");
      if (v !== undefined) flags[k] = v;
      else if (i + 1 < tokens.length) flags[k] = tokens[++i];
      else flags[k] = true;
    } else resto.push(t);
  }
  if (resto[0] === "close") {
    await closePersistent(resto[1]);
    out(paint(`  subagente "${resto[1]}" encerrado`, "ok"));
    return 0;
  }

  const nome = resto.shift();
  const tarefa = resto.join(" ");
  if (!nome || !tarefa) {
    out(paint("  uso: /subagent <nome> <tarefa> [--provider p --model m --effort e --mode plan|build|ask --persistent]", "muted"));
    return 2;
  }

  const spec = {
    name: nome,
    task: tarefa,
    provider: flags.provider || null,
    model: flags.model || null,
    effort: flags.effort || null,
    mode: flags.mode || null,
    persistent: Boolean(flags.persistent),
  };
  const { findEngine } = await import("../core/agent/pi-rpc.mjs");
  if (!findEngine().available) {
    out(paint("  (motor ausente — não consigo executar o subagente)", "warn"));
    return 1;
  }
  out(paint(`  subagente "${nome}"${spec.persistent ? " (persistente)" : ""} executando…`, "muted"));
  const r = await runSubagent(spec, { cwd: workspaceRoot });
  out("");
  out(r.ok ? paint(`  ✓ ${nome}:`, "ok") + "\n" + String(r.text).trim() : paint(`  ✗ ${nome}: ${r.error}`, "fail"));
  return r.ok ? 0 : 1;
}

/* ------------------------------------------------------------------ */
/* /worktree — worktrees git isoladas (core/agent/worktree.mjs)       */
/* ------------------------------------------------------------------ */

async function runWorktree({ arg, out }) {
  const wt = await import("../core/agent/worktree.mjs");
  const bruto = String(arg ?? "").trim();
  const [sub, ...resto] = bruto ? bruto.split(/\s+/) : [];
  const nome = resto.join(" ").trim();
  const cwd = ROOT;
  try {
    if (!sub || sub === "list" || sub === "ls") {
      const lista = await wt.listWorktrees({ cwd });
      if (lista.length === 0) {
        out(paint("  nenhuma worktree", "muted"));
        return 0;
      }
      out(paint("  worktrees:", "fg"));
      for (const w of lista) out(`    ${w.branch || "(detached)"}  ${w.path}`);
      return 0;
    }
    if (sub === "new" || sub === "add") {
      if (!nome) {
        out(paint("  uso: /worktree new <nome> [branch]", "muted"));
        return 2;
      }
      const [nome2, branch] = nome.split(/\s+/);
      const r = await wt.createWorktree({ cwd, name: nome2, branch: branch || undefined });
      out(paint(`  worktree criada: ${r.branch} em ${r.path}`, "ok"));
      return 0;
    }
    if (sub === "rm" || sub === "remove") {
      if (!nome) {
        out(paint("  uso: /worktree rm <path> [--force]", "muted"));
        return 2;
      }
      const force = /(^|\s)--force(\s|$)/.test(nome);
      const alvo = nome.replace(/\s*--force\s*/, "").trim();
      const r = await wt.removeWorktree({ cwd, path: alvo, force });
      out(paint(`  worktree removada${r.removed ? "" : " (nada a remover)"}`, r.removed ? "ok" : "muted"));
      return 0;
    }
    out(paint("  uso: /worktree [list|new <nome> [branch]|rm <path>]", "muted"));
    return 2;
  } catch (err) {
    const msg = String(err?.message || err).slice(0, 160);
    out(paint(`  worktree: ${msg}`, "fail"));
    return 1;
  }
}

/* ------------------------------------------------------------------ */
/* /workspace — onde os agentes agem (troca o diretório de trabalho)  */
/* ------------------------------------------------------------------ */

async function runWorkspace({ arg, out }) {
  const bruto = String(arg ?? "").trim();
  if (!bruto) {
    out(paint(`  workspace atual: ${workspaceRoot}`, "fg"));
    out(paint("  troque com /workspace <caminho> ou /workspace (menu)", "muted"));
    return 0;
  }
  // valida e troca (recria o motor). O onChoose do picker faz o mesmo caminho.
  const alvo = path.resolve(bruto);
  try {
    const stat = (await import("node:fs/promises")).stat(alvo);
    if (!stat.isDirectory()) {
      out(paint(`  workspace: "${bruto}" não é um diretório`, "fail"));
      return 1;
    }
  } catch {
    out(paint(`  workspace: "${bruto}" não existe`, "fail"));
    return 1;
  }
  out(paint(`  workspace: ${alvo} (recrie a sessão para valer nas conversas)`, "ok"));
  return 0;
}

/* ------------------------------------------------------------------ */
/* /providers — registro manual de provedores (core/agent/providers)  */
/* ------------------------------------------------------------------ */

async function runProviders({ arg, out, pi }) {
  const pv = await import("../core/agent/providers.mjs");
  const bruto = String(arg ?? "").trim();
  try {
    if (!bruto || bruto === "list" || bruto === "ls") {
      const lista = await pv.listProviders();
      if (lista.length === 0) {
        out(paint("  nenhum provedor registrado", "muted"));
        out(paint("  adicione com: /providers add <id> <baseUrl> <apiKey>", "muted"));
        return 0;
      }
      out(paint("  provedores:", "fg"));
      for (const p of lista) {
        const n = Array.isArray(p.models) ? p.models.length : 0;
        out(`    ${p.id}  ${p.baseUrl}  (${n} modelos)`);
      }
      return 0;
    }
    const [sub, ...resto] = bruto.split(/\s+/);
    if (sub === "add") {
      // /providers add <id> <baseUrl> <apiKey>  (apiKey pode ficar de fora p/ colar depois)
      const [id, baseUrl, apiKey] = resto;
      if (!id || !baseUrl) {
        out(paint("  uso: /providers add <id> <baseUrl> [apiKey]", "muted"));
        return 2;
      }
      const r = await pv.addProvider({ id, baseUrl, apiKey });
      out(paint(`  provedor "${r.id}" salvo (${r.models.length} modelos, chave ${r.apiKeyRedacted})`, "ok"));
      return 0;
    }
    if (sub === "rm" || sub === "remove") {
      const id = resto[0];
      if (!id) {
        out(paint("  uso: /providers rm <id>", "muted"));
        return 2;
      }
      const r = await pv.removeProvider({ id });
      out(paint(r.removed ? `  provedor "${id}" removado` : `  provedor "${id}" não existia`, r.removed ? "ok" : "muted"));
      return 0;
    }
    if (sub === "models") {
      const baseUrl = resto[0];
      if (!baseUrl) {
        out(paint("  uso: /providers models <baseUrl> [apiKey]", "muted"));
        return 2;
      }
      const apiKey = resto[1] || "";
      const models = await pv.fetchModels({ baseUrl, apiKey });
      if (models.length === 0) {
        out(paint("  nenhum modelo retornado", "muted"));
        return 0;
      }
      out(paint(`  ${models.length} modelos em ${baseUrl}:`, "fg"));
      for (const m of models.slice(0, 40)) out(`    ${m.id}`);
      return 0;
    }
    out(paint("  uso: /providers [list|add|rm|models]", "muted"));
    return 2;
  } catch (err) {
    const msg = String(err?.message || err).slice(0, 160);
    out(paint(`  providers: ${msg}`, "fail"));
    return 1;
  }
}

/* ------------------------------------------------------------------ */
/* Comandos de sessão e interface                                      */
/* ------------------------------------------------------------------ */

/** /language — troca o idioma da interface. Inglês é o padrão. */
async function runLanguage({ arg, out }) {
  const value = String(arg ?? "").trim().toLowerCase();
  if (value) {
    if (!isLocale(value)) {
      out(paint(`  ${tr("lang.invalid", { value })}`, "fail"));
      return 2;
    }
    setLocale(value);
    const label = listLocales().find((l) => l.code === getLocale())?.label || value;
    out(paint(`  ${tr("lang.set", { label })}`, "ok"));
    return 0;
  }
  const current = getLocale();
  const label = listLocales().find((l) => l.code === current)?.label || current;
  out(
    capLinhas([
      paint(`  ${tr("lang.title")}`, "fg"),
      `    ${padLabel(tr("lang.current"))}${current} · ${label}`,
      `    ${padLabel(tr("lang.available"))}${listLocales().map((l) => `${l.code} (${l.label})`).join(", ")}`,
      "",
      paint(`  /language en | pt · ${tr("lang.apply")}`, "muted"),
    ]).join("\n"),
  );
  return 0;
}

/** /fork — bifurca a sessão atual preservando a original. */
async function runFork({ arg, out }) {
  try {
    const dir = await sessionDir();
    const { listSessions } = await import("../core/agent/sessions.mjs");
    const list = await listSessions(dir);
    const id = String(arg ?? "").trim() || list[0]?.id;
    if (!id) {
      out(paint(`  ${tr("fork.none")}`, "warn"));
      return 0;
    }
    const { forkSession } = await import("../core/agent/sessions.mjs");
    const newId = await forkSession(dir, id, null, "cli");
    out(paint(`  ${tr("fork.done", { id: newId })}`, "ok"));
    return 0;
  } catch (err) {
    out(paint(`  ${String(err?.message || err).slice(0, 160)}`, "fail"));
    return 2;
  }
}

/** /diff — mudanças git no workspace, em texto curto. */
async function runDiff({ out }) {
  const stat = await runProcess("git", ["-C", workspaceRoot, "diff", "--stat"]);
  if (!String(stat.out || "").trim()) {
    out(paint(`  ${tr("diff.clean")}`, "muted"));
    return 0;
  }
  const det = await runProcess("git", ["-C", workspaceRoot, "diff", "--unified=2"]);
  const lines = [paint(`  ${tr("diff.title")}`, "fg"), ""];
  for (const l of String(det.out || "").split("\n").slice(0, 80)) {
    lines.push(paint("  " + (l.length > 68 ? l.slice(0, 67) + "…" : l), "muted"));
  }
  out(lines.join("\n"));
  return 0;
}

/** /export — conversa em markdown ou JSON, fora do caminho de execução. */
async function runExport({ arg, out, pi }) {
  let messages = [];
  if (pi) messages = await Promise.resolve(pi._rpc?.getMessages?.()).catch(() => []);
  if (!Array.isArray(messages) || messages.length === 0) {
    out(paint(`  ${tr("export.none")}`, "warn"));
    return 0;
  }
  const fmt = String(arg ?? "md").trim().toLowerCase() === "json" ? "json" : "md";
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const dir = path.join(ROOT, ".pi", "harness", "exports");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `conversation-${new Date().toISOString().replace(/[:.]/g, "-")}.${fmt}`);
  const content = fmt === "json"
    ? JSON.stringify(messages, null, 2) + "\n"
    : messages.map((m) => `## ${m.role}\n\n${String(m.content ?? "")}`).join("\n\n") + "\n";
  writeFileSync(file, content, "utf8");
  out(capLinhas([paint(`  ${tr("export.done", { file })}`, "ok")]).join("\n"));
  return 0;
}

/** /undo e /redo — desfaz/refaz a última troca na interface. */
function runUndo({ out }) {
  const item = undoStack.pop();
  if (!item) {
    out(paint(`  ${tr("undo.none")}`, "muted"));
    return 0;
  }
  redoStack.push(item);
  out(paint(`  ${tr("undo.done")}`, "ok"));
  out(paint(`    › ${String(item.text).slice(0, 64)}`, "muted"));
  return 0;
}

function runRedo({ out }) {
  const item = redoStack.pop();
  if (!item) {
    out(paint(`  ${tr("redo.none")}`, "muted"));
    return 0;
  }
  undoStack.push(item);
  out(paint(`  ${tr("redo.done")}`, "ok"));
  out(paint(`    › ${String(item.text).slice(0, 64)}`, "muted"));
  return 0;
}

/** /copy — última resposta para a área de transferência do Windows. */
async function runCopy({ out }) {
  if (!lastAnswer) {
    out(paint(`  ${tr("copy.none")}`, "muted"));
    return 0;
  }
  const ok = await new Promise((resolve) => {
    const child = spawn("powershell", ["-NoProfile", "-Command", "$input | Set-Clipboard"], { windowsHide: true });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
    child.stdin.end(lastAnswer);
  });
  out(paint(`  ${ok ? tr("copy.done") : tr("common.unavailable")}`, ok ? "ok" : "warn"));
  return ok ? 0 : 2;
}

/** /reload — reaplica tema e estado sem reiniciar o processo. */
async function runReload({ out, pi }) {
  await refreshThemeCache();
  await refreshStatus(pi);
  out(paint(`  ${tr("reload.done")}`, "ok"));
  return 0;
}

/** /paste — lê a área de transferência e anexa a imagem ao próximo prompt. */
async function runPaste({ out }) {
  prepareAttachmentDir(ROOT);
  const file = await captureClipboardImage({ root: ROOT });
  if (!file) {
    out(paint(`  ${tr("img.none")}`, "muted"));
    return 0;
  }
  pendingImages.push(file);
  out(capLinhas([paint(`  ${tr("img.attached", { file })}`, "ok")]).join("\n"));
  return 0;
}

/** /attach <arquivo> — anexa um arquivo de imagem existente. */
async function runAttach({ arg, out }) {
  const file = path.resolve(workspaceRoot, String(arg ?? "").trim().replace(/^"|"$/g, ""));
  if (!isImageFile(file)) {
    out(paint(`  ${tr("img.notImage", { file })}`, "warn"));
    return 2;
  }
  pendingImages.push(file);
  out(capLinhas([paint(`  ${tr("img.attached", { file })}`, "ok")]).join("\n"));
  return 0;
}

/** /images [clear] — mostra ou limpa os anexos pendentes. */
function runImages({ arg, out }) {
  const acao = String(arg ?? "").trim().toLowerCase();
  if (acao === "clear" || acao === "limpar") {
    pendingImages = [];
    out(paint(`  ${tr("img.cleared")}`, "ok"));
    return 0;
  }
  if (pendingImages.length === 0) {
    out(paint(`  ${tr("img.none")}`, "muted"));
    return 0;
  }
  const lines = [paint(`  ${tr("img.list", { n: pendingImages.length })}`, "fg")];
  for (const f of pendingImages) lines.push(paint("    " + path.basename(f), "muted"));
  out(capLinhas(lines).join("\n"));
  return 0;
}

/** /verbosity [nível] — quanto feedback aparece durante o turno. */
function runVerbosity({ arg, out }) {
  const alvo = String(arg ?? "").trim().toLowerCase();
  if (alvo) {
    const nivel = normalizeVerbosity(alvo);
    if (!nivel) {
      out(paint(`  ${tr("verb.invalid", { value: alvo })}`, "fail"));
      out(paint(`  ${VERBOSITY_LEVELS.join(" | ")}`, "muted"));
      return 2;
    }
    setVerbosity(nivel);
    reasoningToggle = null;
    out(paint(`  ${tr("verb.set", { level: nivel })}`, "ok"));
    out(paint(`    ${tr(`verb.${nivel}`)}`, "muted"));
    return 0;
  }
  const atual = getVerbosity();
  const lines = [
    paint(`  ${tr("verb.title")}`, "fg"),
    `    ${padLabel(tr("verb.current"))}${atual} · ${tr(`verb.${atual}`)}`,
    "",
  ];
  for (const nivel of VERBOSITY_LEVELS) {
    lines.push(`    ${nivel.padEnd(10)} ${tr(`verb.${nivel}`)}`);
  }
  lines.push("");
  lines.push(paint(`  /verbosity <nível> · ${VERBOSITY_LEVELS.join(" | ")}`, "muted"));
  out(capLinhas(lines).join("\n"));
  return 0;
}

// FONTE ÚNICA dos comandos de barra. A paleta e o /help leem daqui; o `run`
// é o executor. Nada de lista duplicada.
export const COMMANDS = [
  { name: "/detect", args: "", description: tr("cmd.detect"), run: runDetect },
  { name: "/evo", args: "<meta>", description: tr("cmd.evo"), run: runForge },
  { name: "/memory", args: "<termo>", description: tr("cmd.memory"), run: runMemory },
  { name: "/skills", args: "", description: tr("cmd.skills"), run: runSkills },
  { name: "/model", args: "[nome]", description: tr("cmd.model"), run: runModel },
  { name: "/effort", args: "[off|low|medium|high]", description: tr("cmd.effort"), run: runEffort },
  {
    name: "/mode",
    args: "[modo]",
    description: tr("cmd.mode"),
    run: (ctx) =>
      String(ctx?.arg ?? "").trim() === ""
        ? runModeCycle(ctx)
        : runMode(String(ctx.arg).trim(), ctx),
  },
  { name: "/clear", args: "", description: tr("cmd.clear"), run: runClear },
  { name: "/compact", args: "", description: tr("cmd.compact"), run: runCompact },
  { name: "/sessions", args: "[id]", description: tr("cmd.sessions"), run: runSessions },
  { name: "/cost", args: "", description: tr("cmd.cost"), run: runCost },
  { name: "/status", args: "", description: tr("cmd.status"), run: runStatus },
  { name: "/context", args: "", description: tr("cmd.context"), run: runContext },
  { name: "/mcp", args: "", description: tr("cmd.mcp"), run: runMcp },
  { name: "/plugins", args: "[nome|test]", description: tr("cmd.plugins"), run: runPlugins },
  { name: "/init", args: "", description: tr("cmd.init"), run: runInit },
  {
    name: "/import",
    args: "[importar|--undo|--status]",
    description: tr("cmd.import"),
    run: runImport,
  },
  { name: "/plan", args: "", description: tr("cmd.plan"), run: (ctx) => runMode("plan", ctx) },
  { name: "/build", args: "", description: tr("cmd.build"), run: (ctx) => runMode("build", ctx) },
  { name: "/ask", args: "", description: tr("cmd.ask"), run: (ctx) => runMode("ask", ctx) },
  { name: "/goal", args: "[condição|clear]", description: tr("cmd.goal"), run: runGoal },
  { name: "/settings", args: "", description: tr("cmd.settings"), run: runSettingsView },
  { name: "/theme", args: "[escuro|violeta|alto-contraste]", description: tr("cmd.theme"), run: runTheme },
  { name: "/language", args: "[en|pt]", description: tr("cmd.language"), run: runLanguage },
  { name: "/fork", args: "[nome]", description: tr("cmd.fork"), run: runFork },
  { name: "/diff", args: "", description: tr("cmd.diff"), run: runDiff },
  { name: "/export", args: "[md|json]", description: tr("cmd.export"), run: runExport },
  { name: "/undo", args: "", description: tr("cmd.undo"), run: runUndo },
  { name: "/redo", args: "", description: tr("cmd.redo"), run: runRedo },
  { name: "/copy", args: "", description: tr("cmd.copy"), run: runCopy },
  { name: "/reload", args: "", description: tr("cmd.reload"), run: runReload },
  { name: "/paste", args: "", description: tr("cmd.paste"), run: runPaste },
  { name: "/attach", args: "<arquivo>", description: tr("cmd.attach"), run: runAttach },
  { name: "/images", args: "[clear]", description: tr("cmd.images"), run: runImages },
  { name: "/verbosity", args: "[nível]", description: tr("cmd.verbosity"), run: runVerbosity },
  { name: "/swarm", args: "[n] <tarefa>", description: tr("cmd.swarm"), run: runSwarm },
  { name: "/subagent", args: "<nome> <tarefa> [--provider --model --effort --mode --persistent]", description: tr("cmd.subagent"), run: runSubagentCmd },
  { name: "/worktree", args: "[list|new|rm]", description: tr("cmd.worktree"), run: runWorktree },
  { name: "/workspace", args: "[caminho]", description: tr("cmd.workspace"), run: runWorkspace },
  { name: "/explorer", args: "", description: tr("cmd.explorer"), run: (ctx) => runWorkspace(ctx) },
  { name: "/providers", args: "[list|add|rm|models]", description: tr("cmd.providers"), run: runProviders },
  { name: "/help", args: "", description: tr("cmd.help"), run: runHelp },
];

/** Argumentos também são interface: mudam com /language. */
const ARG_TR = {
  en: {
    "<meta>": "<goal>",
    "<termo>": "<term>",
    "[nome]": "[name]",
    "[modo]": "[mode]",
    "[nome|test]": "[name|test]",
    "[importar|--undo|--status]": "[import|--undo|--status]",
    "[condição|clear]": "[condition|clear]",
    "[escuro|violeta|alto-contraste]": "[dark|violet|high-contrast]",
    "[n] <tarefa>": "[n] <task>",
    "<nome> <tarefa> [--provider --model --effort --mode --persistent]":
      "<name> <task> [--provider --model --effort --mode --persistent]",
    "[list|new|rm]": "[list|new|rm]",
    "[caminho]": "[path]",
    "[nível]": "[level]",
    "[list|add|rm|models]": "[list|add|rm|models]",
  },
  pt: {},
};

/**
 * A paleta e o /help são derivados de COMMANDS no momento em que são chamados:
 * trocar /language troca nomes, argumentos e descrições sem reiniciar a CLI.
 */
export function localizedCommands() {
  const args = ARG_TR[getLocale()] || ARG_TR.en;
  return COMMANDS.map((c) => {
    const key = `cmd.${String(c.name).slice(1)}`;
    return {
      name: c.name,
      args: args[c.args] ?? c.args,
      description: tr(key) === key ? c.description : tr(key),
    };
  });
}

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
  out.push(paint(tr("help.commands"), "bold"));
  out.push("");
  const LABEL = 32;
  for (const c of localizedCommands()) {
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
  out.push(paint(tr("help.conversation"), "bold"));
  out.push("");
  out.push(`  ${paint("Ctrl+C", "fg")} ${tr("help.cancel")}`);
  out.push(`  ${paint("Ctrl+O", "fg")} ${tr("help.openPanel")}`);
  out.push(`  ${paint("Ctrl+K", "fg")} ${tr("help.openSessions")}`);
  out.push(`  ${paint("Ctrl+,", "fg")} ${tr("help.openConfig")}`);
  out.push(`  ${paint("Ctrl+P", "fg")} ${tr("help.activity")}`);
  out.push(`  ${paint("q", "fg")} / ${paint("/quit", "fg")} / ${paint("Ctrl+D", "fg")} ${tr("help.quit")}`);
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

/**
 * Janela horizontal da linha de entrada: em vez de cortar o texto com "…" e
 * jogar o cursor para fora da tela (o bug de "o texto corta e aparece ..."),
 * devolve a fatia do buffer que cabe em `avail` colunas MANTENDO o cursor
 * visível. O texto completo continua no buffer (é ele que vai pro harness);
 * só o que se vê é uma janela que acompanha o cursor.
 *
 * @param {string} buf  texto completo (sem ANSI — é entrada crua do usuário)
 * @param {number} cur  índice do cursor (unidades de código, como reduceLine)
 * @param {number} avail colunas disponíveis para o texto (WIDTH - prefixo)
 * @returns {{ shown: string, curCol: number, start: number, end: number }}
 */
export function inputWindow(buf, cur, avail) {
  const s = String(buf ?? "");
  const n = s.length;
  const c = Math.max(0, Math.min(n, cur | 0));
  const cols = Math.max(1, avail | 0);
  if (n <= cols) return { shown: s.replace(/\r\n|\r|\n/g, "↵"), curCol: c, start: 0, end: n };
  // cursor ~60% à esquerda, com margem; encosta nas bordas
  let start = c - Math.floor(cols * 0.6);
  if (start < 0) start = 0;
  if (start + cols > n) start = n - cols;
  const fatia = s.slice(start, start + cols).replace(/\r\n|\r|\n/g, "↵");
  return {
    shown: fatia,
    curCol: c - start,
    start,
    end: start + cols,
  };
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
  const all = localizedCommands();
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
    const mid = "  │" + padVisible("  " + tr("palette.empty"), W - 4) + "│";
    return [top, mid, bottom];
  }

  // Coluna do nome = só o nome (sem args). Os args vão para a descrição,
  // senão um comando com args longos (ex.: /subagent) espremia a descrição
  // de todos os outros para 4 chars com "...".
  const label = (c) => c.name;
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
    // descrição = args (se houver) + descrição; args em dim para distinguir
    let desc = c.args ? paint(c.args, "muted") + " " + c.description : c.description;
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
export function renderPaletteFrame(filterQuery = "", width = frameWidth()) {
  const filtered = filterCommands(filterQuery);
  const palette = renderPalette(filtered, 0, width);
  const out = [];
  out.push(renderBanner());
  out.push(renderStatusLine({}));
  out.push("");
  out.push(`  ${paint("›", "accent")} /${filterQuery}`);
  for (const l of palette) out.push(l);
  out.push(paint("  " + tr("palette.nav"), "dim"));
  return out.map((line) => wrapAnsi(line, width)).join("\n");
}

/* ------------------------------------------------------------------ */
/* Mensagens de estado (voz do produto)                               */
/* ------------------------------------------------------------------ */

/** Aviso de motor ausente. Nunca cita o motor; diz o que fazer. */
export function engineUnavailableNote() {
  return [
    paint("  " + tr("engine.missing1"), "warn"),
    paint("  " + tr("engine.missing2"), "muted"),
    paint("  " + tr("engine.missing3"), "muted"),
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
    lines.push(paint("  " + tr("engine.auth1"), "warn"));
    lines.push(paint("  " + tr("engine.auth2"), "muted"));
  } else {
    lines.push(paint("  " + tr("engine.generic1"), "warn"));
    lines.push(paint("  " + tr("engine.generic2"), "muted"));
  }
  lines.push("");
  lines.push(paint("  /model          " + tr("engine.models"), "fg"));
  lines.push(paint("  /model <nome>   " + tr("engine.switch"), "fg"));
  return lines.join("\n");
}

/** Aviso de fallback: diz qual modelo passou a responder, em voz do produto. */
export function fallbackNotice(model) {
  return [
    paint("  " + tr("engine.fallback", { model }), "warn"),
    paint(`  /model          ${tr("engine.models")}`, "muted"),
    paint(`  /model <nome>   ${tr("engine.switch")}`, "muted"),
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Processos auxiliares (comandos de barra que rodam algo)            */
/* ------------------------------------------------------------------ */

/**
 * Expande menções @arquivo no texto do usuário. O arquivo é lido do workspace
 * e injetado como contexto explícito — sem isso, `@README.md` chega ao modelo
 * como literal e o agente não sabe o que o usuário quis dizer.
 */
async function expandAtMentions(text) {
  const { readFile } = await import("node:fs/promises");
  const found = [...String(text).matchAll(/@("[^"]+"|[^\s]+)/g)].slice(0, 6);
  if (found.length === 0) return { text, files: [], images: [] };
  let out = text;
  const files = [];
  const images = [];
  for (const m of found) {
    const target = m[1].replace(/^"|"$/g, "");
    const full = path.resolve(workspaceRoot, target);
    if (isImageFile(full)) {
      images.push(full);
      out = out.replace(m[0], "").trim();
      continue;
    }
    try {
      const content = (await readFile(full, "utf8")).slice(0, 32000);
      files.push(full);
      out = out.replace(m[0], `<<file ${full}>>\n${content}\n<</file>>`);
    } catch {
      /* se não der para ler, mantém o literal — nunca inventa conteúdo */
    }
  }
  return { text: out, files, images };
}

/** Roda um processo e devolve { code, out, err }. Nunca rejeita. */
function runProcess(executable, args, { onLine, cwd = ROOT } = {}) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, { cwd, windowsHide: true });
    let out = "";
    let err = "";
    let buf = "";
    const pump = (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        out += line + "\n";
        if (onLine) onLine(line);
      }
    };
    child.stdout?.on("data", pump);
    child.stderr?.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => resolve({ code: 1, out, err: String(e.message) }));
    child.on("close", (code) => {
      if (buf) {
        out += buf;
        if (onLine) onLine(buf);
      }
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
    out(paint("  uso: /evo <meta>  (ex.: /evo \"extrair HTML com seletor\")", "muted"));
    out(paint("  /evo é o MODO PRINCIPAL: o harness evolui, modela e modifica a si", "muted"));
    out(paint("  mesmo rumo à meta — mais profundo que /goal, que só define um alvo.", "muted"));
    return 2;
  }
  out(paint(`  modo principal · evoluindo o harness rumo a: ${meta}`, "fg"));
  out(paint("  (o ciclo lê lacunas, propõe, aplica e valida; mexe em arquivos e pode", "muted"));
  out(paint("   demorar; Ctrl+C interrompe)", "muted"));
  const r = await runProcess(process.execPath, [path.join(ROOT, "core", "forge", "cli.mjs"), "evolve", "--goal", meta], {
    onLine: (line) => out(paint("  · " + line, "muted")),
  });
  out(paint(`  outcome: ${r.code === 0 ? "concluído — o harness evoluiu" : "interrompido ou reprovado"}`, r.code === 0 ? "ok" : "warn"));
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

/**
 * Níveis declarados no models.json para um modelo "provedor/id" (ou só id).
 * O catálogo do motor é a fonte preferida, mas quando ele devolve só `off`
 * para um modelo que o catálogo público marca como reasoning, a config local
 * é a correção honesta — é exatamente o caso do ERNIE 5.5 Flash Preview,
 * cujo único effort aceito é `high`.
 */
export function metadataEfforts(providerAndId) {
  const ref = String(providerAndId || "").trim();
  if (!ref) return null;
  if (ref.includes("/")) {
    const i = ref.indexOf("/");
    return effortLevelsFor(ref.slice(0, i), ref.slice(i + 1));
  }
  for (const m of listModelMetadata()) {
    if (m.id === ref || m.id.endsWith("/" + ref)) return m.efforts;
  }
  return null;
}

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
/* ------------------------------------------------------------------ */
/* Picker genérico (overlay de lista única)                           */
/* ------------------------------------------------------------------ */

/**
 * Renderiza um picker de lista única (usado por /theme, /mode, /providers,
 * /worktree e pelo editor de settings). Estilo alinhado ao renderPalette:
 * caixa arredondada, marcador "›" no item selecionado, rótulos em negrito.
 *
 * @param {{title:string, items:Array<{label:string, hint?:string, value?:string}>, sel:number, footer?:string, active?:boolean}} o
 * @returns {string[]} linhas prontas para write()
 */
/** Máximo de linhas de ITENS visíveis num picker (a seta sempre aparece). */
const PICKER_ROWS = 10;

/**
 * Janela de rolagem: devolve { start, end } (0-based, end exclusivo) da maior
 * fatia contígua de tamanho ≤ maxRows dentro de [0,total] que CONTÉM `sel`,
 * centralizando quando dá e encostando nas bordas. É o que faz a tela "seguir
 * a seta" em listas grandes, em vez de desenhar tudo e a seleção sumir.
 */
export function windowBounds(total, sel, maxRows = PICKER_ROWS) {
  const n = Math.max(0, Math.floor(total));
  if (n === 0) return { start: 0, end: 0 };
  let rows = Math.floor(maxRows);
  if (!(rows >= 1)) rows = 1;
  if (n <= rows) return { start: 0, end: n };
  let s = Math.max(0, Math.min(n - 1, Math.floor(sel)));
  let start = s - Math.floor(rows / 2);
  if (start < 0) start = 0;
  if (start + rows > n) start = n - rows;
  return { start, end: start + rows };
}

export function renderValuePicker({ title, items, sel, footer, active }) {
  const linhas = [];
  const titulo = active === false ? title : paint(title, "accent");
  const total = items.length;
  const s = Math.max(0, Math.min(total - 1, sel | 0));
  const win = windowBounds(total, s, PICKER_ROWS);
  linhas.push("  " + titulo + (total > 0 ? paint(`  ${s + 1}/${total}`, "muted") : ""));
  if (total === 0) {
    linhas.push(paint("    (nada a escolher)", "muted"));
  }
  if (win.start > 0) linhas.push(paint(`    … ${win.start} acima`, "dim"));
  for (let i = win.start; i < win.end; i++) {
    const it = items[i];
    const marcador = i === s ? paint("›", "accent") : " ";
    const label = i === s ? paint(it.label, "bold") : it.label;
    const hint = it.hint ? paint("  " + it.hint, "muted") : "";
    linhas.push("    " + marcador + " " + label + hint);
  }
  if (win.end < total) linhas.push(paint(`    … ${total - win.end} abaixo`, "dim"));
  if (footer) linhas.push(paint("  " + footer, "dim"));
  return linhas;
}

export function renderModelPicker({ stage, sel, grupos, niveis, modelo }) {
  const linhas = [];

  if (stage === "effort") {
    const total = niveis.length;
    const s = Math.max(0, Math.min(total - 1, sel | 0));
    const win = windowBounds(total, s, PICKER_ROWS);
    linhas.push(paint("  esforço — " + modelo, "fg"));
    if (win.start > 0) linhas.push(paint(`    … ${win.start} acima`, "dim"));
    for (let i = win.start; i < win.end; i++) {
      const marcador = i === s ? paint("›", "accent") : " ";
      const nome = i === s ? paint(niveis[i], "bold") : niveis[i];
      linhas.push("    " + marcador + " " + nome);
    }
    if (win.end < total) linhas.push(paint(`    … ${total - win.end} abaixo`, "dim"));
    linhas.push("");
    linhas.push(paint("  ↑↓ navegar  enter escolher  esc cancela", "dim"));
    return linhas;
  }

  // Achata os grupos num índice único para poder aplicar a janela de rolagem.
  const flat = [];
  for (const g of grupos) for (const id of g.ids) flat.push({ provider: g.provider, id });
  const total = flat.length;
  const s = Math.max(0, Math.min(total - 1, sel | 0));
  const win = windowBounds(total, s, PICKER_ROWS);

  linhas.push(paint("  modelo", "fg") + (total > 0 ? paint(`  ${s + 1}/${total}`, "muted") : ""));
  if (total === 0) linhas.push(paint("  nenhum modelo configurado.", "warn"));
  if (win.start > 0) linhas.push(paint(`    … ${win.start} acima`, "dim"));
  let ultimoProvider = null;
  for (let i = win.start; i < win.end; i++) {
    const { provider, id } = flat[i];
    if (provider !== ultimoProvider) {
      linhas.push(paint("  " + provider, "bold"));
      ultimoProvider = provider;
    }
    const marcador = i === s ? paint("›", "accent") : " ";
    const nome = i === s ? paint(id, "bold") : id;
    linhas.push("    " + marcador + " " + nome);
  }
  if (win.end < total) linhas.push(paint(`    … ${total - win.end} abaixo`, "dim"));
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
  // "none" não é nível real; filtra e, se sobrar vazio, usa o padrão.
  const reais = niveis.filter((n) => n !== "none");
  if (reais.length > 0) niveis = reais;
  else niveis = [...EFFORT_FALLBACK];

  // O motor devolve `off` para modelos sem `reasoning` no models.json. Quando
  // o catálogo público diz que o modelo raciocina, a config local corrige isso.
  const meta = metadataEfforts(statusInfo.model);
  let origem = doMotor ? "motor" : "padrão";
  if (meta && meta.some((n) => n !== "off") && niveis.length === 1 && (niveis[0] === "off" || niveis[0] === "none")) {
    niveis = meta;
    origem = "configuração do modelo";
  }

  const atual = (statusInfo.reasoning || "").toLowerCase() || null;

  if (alvo === "") {
    const lines = [paint("  esforço", "fg")];
    lines.push(`    atual:     ${atual ?? "-"}`);
    lines.push(`    aceitos:   ${niveis.join(", ")}`);
    lines.push("");
    lines.push(
      paint(
        origem === "motor"
          ? "  (lista lida do modelo em uso)"
          : origem === "configuração do modelo"
            ? "  (lista da configuração do modelo; o motor não a declarou)"
            : "  (não consegui ler do modelo; mostrando o conjunto padrão)",
        origem === "padrão" ? "warn" : "muted",
      ),
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

let sessionDirMemo = null;

/** Cache da pasta de sessões: a varredura custa ~100 ms e não muda na sessão. */
async function sessionDir() {
  if (sessionDirMemo) return sessionDirMemo;
  sessionDirMemo = await discoverSessionDir();
  return sessionDirMemo;
}

/** Descobre a pasta de sessões do projeto atual (por header.cwd), ou a base. */
async function discoverSessionDir() {
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
  // Lê do settings global (~/.pi/settings.json), a mesma fonte do /plugins:
  // antes lia só .mcp.json/.pi/settings.json do PROJETO (repo) e aparecia vazio.
  const { listConfiguredMcp } = await import("../core/agent/mcp-probe.mjs");
  let servers;
  try {
    servers = await listConfiguredMcp({});
  } catch (err) {
    out(paint(`  não consegui ler os MCPs: ${String(err?.message || err).slice(0, 140)}`, "fail"));
    return 1;
  }
  if (!servers || servers.length === 0) {
    out(paint("  nenhum servidor MCP configurado (importe com /import ou registre com /providers)", "muted"));
    return 0;
  }
  const lines = [paint(`  ${servers.length} servidor(es) MCP:`, "fg")];
  for (const s of servers) {
    const dot = s.status === "configured" ? paint("●", "ok") : s.status === "disabled" ? paint("○", "muted") : paint("✗", "fail");
    const cmd = [s.command, ...(s.args || [])].filter(Boolean).join(" ");
    lines.push(`  ${dot} ${s.name.padEnd(18)} ${paint(s.status, "muted")}`);
    if (cmd) lines.push(`      ${paint(cmd, "muted")}`);
  }
  out(lines.join("\n"));
  return 0;
}

/**
 * /plugins — lista os plugins (servidores MCP) ativos e permite sondar um
 * (handshake JSON-RPC + tools/list) ou todos (test). "Plugin" aqui é um
 * servidor MCP configurado em ~/.pi/settings.json.
 *
 *   /plugins            lista com status
 *   /plugins <nome>     sonda um (mostra as tools que ele expõe)
 *   /plugins test       sonda todos
 */
async function runPlugins({ arg, out }) {
  const { listConfiguredMcp, probeMcpServer } = await import("../core/agent/mcp-probe.mjs");
  let servers;
  try {
    servers = await listConfiguredMcp({});
  } catch (err) {
    out(paint(`  não consegui ler os plugins: ${String(err?.message || err).slice(0, 140)}`, "fail"));
    return 1;
  }

  const bruto = String(arg ?? "").trim();

  // sonda um (ou todos)
  if (bruto && bruto !== "list" && bruto !== "ls") {
    const alvos = bruto === "test" || bruto === "all" ? servers.filter((s) => s.status !== "disabled").map((s) => s.name) : [bruto];
    if (alvos.length === 0) {
      out(paint("  nenhum plugin ativo para sondar", "muted"));
      return 0;
    }
    for (const name of alvos) {
      out(paint(`  sondando ${name}…`, "muted"));
      const r = await probeMcpServer({ name, timeoutMs: 6000 });
      if (r.ok) {
        const amostra = r.tools.slice(0, 6).join(", ");
        out(paint(`  ✓ ${name}: ${r.tools.length} tools`, "ok") + (amostra ? paint(` (${amostra}${r.tools.length > 6 ? "…" : ""})`, "muted") : ""));
      } else {
        out(paint(`  ✗ ${name}: ${r.error || "sem resposta"}`, "fail"));
      }
    }
    return 0;
  }

  // lista
  if (servers.length === 0) {
    out(paint("  nenhum plugin (MCP) configurado", "muted"));
    out(paint("  importe com /import ou registre com /providers", "dim"));
    return 0;
  }
  const cont = { configured: 0, disabled: 0, broken: 0 };
  for (const s of servers) cont[s.status] = (cont[s.status] || 0) + 1;

  const lines = [paint(`  ${servers.length} plugin(s) MCP:`, "fg")];
  for (const s of servers) {
    const dot = s.status === "configured" ? paint("●", "ok") : s.status === "disabled" ? paint("○", "muted") : paint("✗", "fail");
    lines.push(`  ${dot} ${s.name.padEnd(16)} ${paint(s.status, "muted")}`);
  }
  lines.push("");
  lines.push(paint(`  ${cont.configured} ativos · ${cont.disabled} desabilitados · ${cont.broken} quebrados`, "muted"));
  lines.push(paint("  /plugins <nome> sonda um · /plugins test sonda todos", "dim"));
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
 * De onde veio a sessão, segundo o campo `client` do header. Sessão antiga,
 * sem o campo, é `cli`: antes dele, toda sessão já era da CLI. Valores antigos
 * continuam normalizados para não quebrar a leitura de histórico.
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
 * `client` e o primeiro texto do usuário (para o
 * título derivado).
 *
 * Lê o começo de cada arquivo, não o inteiro: o header é a linha 1 e a
 * primeira mensagem do usuário vem logo depois. Uma sessão de dezenas de
 * megabytes não vira string na memória por causa de uma lista.
 *
 * @returns {Promise<Map<string, { client: string, firstUser: string|null }>>}
 */
export async function readSessionExtras(dir, { maxBytes = 64 * 1024 } = {}) {
  const { readdir, open } = await import("node:fs/promises");
  const { parseSession } = await import("../core/agent/sessions.mjs");
  const CHUNK = 8 * 1024;

  const out = new Map();
  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return out;
  }

  const firstUserOf = (messages) => {
    for (const m of messages || []) {
      if (m && m.role === "user") {
        return typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content)
            ? m.content.map((c) => (c && typeof c.text === "string" ? c.text : "")).join(" ")
            : "";
      }
    }
    return null;
  };

  for (const f of files) {
    const full = path.join(dir, f);
    let header = null;
    let firstUser = null;

    try {
      const fh = await open(full, "r");
      try {
        let text = "";
        // Lê em fatias e PARA no primeiro user: antes eram 256 KB por sessão,
        // mesmo quando a primeira mensagem cabia nos primeiros 200 bytes.
        for (let offset = 0; offset < maxBytes && !firstUser; offset += CHUNK) {
          const size = Math.min(CHUNK, maxBytes - offset);
          const buf = Buffer.alloc(size);
          const { bytesRead } = await fh.read(buf, 0, size, offset);
          if (!bytesRead) break;
          text += buf.subarray(0, bytesRead).toString("utf8");
          const parsed = parseSession(text);
          if (parsed.header) header = parsed.header;
          firstUser = firstUserOf(parsed.messages);
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
  const label = getLocale() === "pt" ? "sessão(es)" : "session(s)";
  const lines = [paint(`  ${list.length} ${label}`, "fg")];
  const idW = 8;
  const titleW = Math.max(24, WIDTH - idW - 26 - 8);

  for (const se of list.slice(0, limit)) {
    const extra = extras.get(se.id);
    const title = deriveTitle(se.title, extra?.firstUser) ?? String(se.id).slice(0, 8);
    const id = se.id ? String(se.id).slice(0, idW) : "?";
    const colTitle = fit(String(title), titleW).padEnd(titleW);
    lines.push(`  ${id}  ${colTitle}  ${se.turns} ${getLocale() === "pt" ? "turnos" : "turns"}  ${String(se.updatedAt || "").slice(0, 10)}`);
  }

  if (list.length > limit) {
    lines.push(paint(`  … ${getLocale() === "pt" ? "e mais" : "and"} ${list.length - limit} ${label}`, "muted"));
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
export function renderThinking(raw, { collapsed = false, seconds = 0 } = {}) {
  const text = String(raw || "").trim();
  if (!text) return [];
  const label = collapsed ? tr("think.summary", { s: seconds }) : tr("think.label");
  const out = [paint(`  ⤷ ${label}`, "muted")];
  if (collapsed) return out;
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
function createSpinner(write, stats = () => ({})) {
  let timer = null;
  let start = 0;
  let label = "";
  let active = false;
  const render = () => {
    // Movimento reduzido: indicador estático (sem piscar). Os números continuam:
    // são eles que dizem "está trabalhando" vs "está travado".
    const now = Date.now();
    const frame = prefersReducedMotion() ? "●" : spinnerFrame(now - start);
    const s = stats() || {};
    const parts = [paint(frame, "fg"), paint(label, "muted")];
    if (shows("metrics")) {
      const seconds = Math.floor(((s.elapsedMs ?? (now - start)) / 1000));
      parts.push(paint(tr("spin.elapsed", { s: seconds }), "muted"));
      if (Number(s.tokens) > 0 && Number.isFinite(Number(s.tokens))) {
        parts.push(paint(tr("spin.tokens", { n: s.tokens }), "muted"));
      }
    }
    write("\r\x1b[2K  " + parts.join(" "));
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

// Estado leve da sessão de interface: fila de mensagens, última resposta e
// pilha de desfazer. Fora do REPL para que os comandos de barra leiam o mesmo
// estado sem plumbagem — a CLI é um processo por sessão.
// null = segue o /verbosity; Alt+T define um override apenas nesta sessão.
let reasoningToggle = null;
function reasoningOn() {
  return reasoningToggle ?? shows("reasoning");
}
let pendingImages = []; // caminhos de imagens anexadas ao próximo prompt
let queued = [];
let lastAnswer = "";
const undoStack = [];
const redoStack = [];

// Painel de estado (cacheado; atualizado por refreshStatus).
let statusInfo = {
  mode: currentMode,
  permission: permissionMode,
  model: null,
  reasoning: null,
  context: null,
  contextPct: null,
  branch: null,
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
  // "none" não é um nível real (o motor devolve assim quando não expõe); não
  // polui o status com "think:none".
  statusInfo.reasoning = st && st.thinkingLevel && st.thinkingLevel !== "none" ? st.thinkingLevel : null;
  statusInfo.sessionId = st && st.sessionId ? st.sessionId : null;
  const stats = await Promise.resolve(
    pi._rpc && pi._rpc.getSessionStats && pi._rpc.getSessionStats(),
  ).catch(() => ({}));
  if (stats && stats.contextUsage) {
    statusInfo.context = `${stats.contextUsage.tokens} / ${stats.contextUsage.contextWindow}`;
    const used = Number(stats.contextUsage.tokens);
    const total = Number(stats.contextUsage.contextWindow);
    statusInfo.contextPct = total > 0 && Number.isFinite(used) ? Math.min(100, Math.round((used / total) * 100)) : null;
  }
  statusInfo.turns = Number(stats?.totalMessages) || 0;
  try {
    statusInfo.branch = detectBranch() || null;
  } catch {
    statusInfo.branch = null;
  }
  return statusInfo;
}

/** Linha de status compacta (rodapé): modo · permissão · modelo · raciocínio. */
export function buildStatusLine(info = statusInfo) {
  const parts = [paint(info.mode, "fg"), paint(info.permission, "fg")];
  if (info.model) parts.push(paint(info.model, "fg"));
  if (info.reasoning) parts.push(paint("think:" + info.reasoning, "muted"));
  if (info.contextPct != null) parts.push(paint(tr("panel.context") + " " + info.contextPct + "%", "muted"));
  if (info.branch) parts.push(paint(info.branch, "muted"));
  const line = parts.join(" · ");
  return visibleWidth(line) > WIDTH ? truncateVisible(line, WIDTH - 1) : line;
}

/** Nome curto do modelo para linhas de 72 colunas (mesmo corte da barra de estado). */
function shortModelSafe(m) {
  if (!m) return null;
  const tail = String(m).split("/").pop() || String(m);
  return tail.length > 24 ? tail.slice(0, 23) + "…" : tail;
}

/** Rótulo alinhado a 13 colunas (o painel e as configurações usam o mesmo passo). */
function padLabel(label) {
  const s = String(label || "");
  return s.length >= 13 ? s + " " : s + " ".repeat(13 - s.length);
}

/** Painel completo (Ctrl+O): estado da conversa em detalhe. */
export function renderPanel(info = statusInfo, data = {}) {
  const base = data.baseline || readJson(BASELINE, {});
  const t = base.totals || {};
  const lines = [];
  lines.push(paint("  " + tr("panel.title"), "fg"));
  lines.push(`    ${padLabel(tr("panel.mode"))}${paint(info.mode, "bold")}`);
  lines.push(`    ${padLabel(tr("panel.permission"))}${paint(info.permission, "fg")}`);
  lines.push(`    ${padLabel(tr("panel.model"))}${paint(info.model || "—", "fg")}`);
  lines.push(`    ${padLabel(tr("panel.reasoning"))}${info.reasoning || "—"}`);
  if (info.context) lines.push(`    ${padLabel(tr("panel.context"))}${info.context}`);
  if (info.sessionId) lines.push(`    ${padLabel(tr("panel.session"))}${String(info.sessionId).slice(0, 8)} · ${info.turns} ${tr("panel.turns")}`);
  if (t.taskRuns != null) lines.push(`    ${padLabel(tr("panel.baseline"))}${t.passes}/${t.taskRuns}`);
  lines.push("");
  lines.push(paint("  " + tr("panel.close"), "dim"));
  return lines;
}

/**
 * Painel de configurações (Ctrl+,): o que está valendo nesta sessão.
 *
 * Quem muda configuração continua mudando por comando (/model, /plan, /build,
 * /ask, /language) ou pelo editor em Ctrl+,; esta leitura só mostra o estado.
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
  lines.push(paint("  " + tr("settings.title"), "fg"));
  lines.push(`    ${padLabel(tr("settings.model"))}${paint(cut(info.model || "-"), "fg")}`);
  lines.push(`    ${padLabel(tr("settings.mode"))}${paint(cut(info.mode), "bold")}`);
  lines.push(`    ${padLabel(tr("settings.permission"))}${paint(cut(info.permission), "fg")}`);
  if (info.reasoning) lines.push(`    ${padLabel(tr("settings.reasoning"))}${cut(info.reasoning)}`);
  if (info.context) lines.push(`    ${padLabel(tr("settings.context"))}${cut(info.context)}`);
  lines.push(`    ${padLabel(tr("settings.sessions"))}${cut(sessionsDir ?? tr("settings.notResolved"))}`);
  lines.push(`    ${padLabel(tr("settings.commands"))}${commands}`);
  lines.push("");
  lines.push(paint("  " + tr("settings.close"), "dim"));
  return lines;
}


export async function converse(pi, text, write, setBusy = () => {}, opts = {}) {
  const settleTimeoutMs = opts.settleTimeoutMs ?? 120_000;
  const images = Array.isArray(opts.images) ? opts.images : [];
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
  // O contador de tokens vem do motor em segundo plano; nunca bloqueia o turno.
  let liveTokens = null;
  const spin = createSpinner(write, () => ({ tokens: liveTokens }));
  const pollTokens = async () => {
    for (let i = 0; i < 600 && spin.active; i += 1) {
      const st = await Promise.resolve(pi._rpc?.getSessionStats?.()).catch(() => null);
      const used = st?.contextUsage?.tokens ?? st?.tokens;
      if (used != null) liveTokens = used;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 400);
        timer.unref?.(); // nunca segura o processo só por causa do contador
      });
    }
  };
  // Raciocínio (thinking_delta) vem no stream rpc interno; o wrapper PiClient
  // não o repassa (normalizeEvent só deixa text_delta). Capturamos via _rpc.
  let thinkBuf = "";
  let thinkCommitted = false;
  let thinkStart = 0;
  const commitThink = (force = false) => {
    if (!reasoningOn()) return;
    if (thinkCommitted || thinkBuf.trim() === "") return;
    // Não injeta no meio do streaming; no fim do turno o force=true garante
    // que o raciocínio tardio apareça em vez de ser descartado.
    if (buf && buf.length > 0 && !force) return;
    const seconds = Math.floor((Date.now() - (thinkStart || Date.now())) / 1000);
    const lines = renderThinking(thinkBuf, { collapsed: !reasoningOn(), seconds });
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
  const toolStart = new Map();
  const offTool = pi.on("tool", (call) => {
    if (call.phase === "start") {
      commitThink(); // raciocínio vem antes da chamada de ferramenta
      spin.stop();
      flush();
      const args = call.args && typeof call.args === "object" ? call.args : {};
      // Mostre o ALVO da ferramenta, não o conteúdo que ela escreve. O
      // princípio da interface compacta (ACI) vale também aqui.
      const target = args.path ?? args.file ?? args.filename ?? args.command ?? args.pattern ?? "";
      let argHint = String(target).replace(/\s+/g, " ").slice(0, 44);
      if (argHint.length === 44 && target) {
        const parts = String(target).replace(/\\/g, "/").split("/").filter(Boolean);
        argHint = (parts.slice(-2).join("/") || argHint).slice(0, 44);
      }
      toolStart.set(call.id, Date.now());
      if (shows("tools")) {
        write(`  ${paint("⏺", "accent")} ${paint(String(call.name || "tool").padEnd(10), "fg")} ${paint(argHint, "muted")}\n`);
      }
      if (shows("activity")) spin.start(tr("spin.running", { name: String(call.name || "tool") }));
      return;
    }
    if (call.phase !== "end") return;
    spin.stop();
    const begun = toolStart.get(call.id);
    toolStart.delete(call.id);
    const secs = begun != null ? Math.floor((Date.now() - begun) / 1000) : null;
    const raw = call.result == null ? "" : typeof call.result === "string" ? call.result : JSON.stringify(call.result);
    const lines = raw ? raw.split("\n").length : 0;
    const kb = raw ? Math.round(Buffer.byteLength(raw, "utf8") / 1024) : 0;
    const detail = lines
      ? tr("tool.result", { n: lines }) + (kb ? ` (${tr("tool.resultBytes", { n: kb })})` : "")
      : secs != null
        ? tr("spin.elapsed", { s: secs })
        : tr("tool.done");
    if (shows("toolResult") || call.isError) {
      const marker = call.isError ? paint(tr("tool.failed"), "fail") : paint(detail, "muted");
      write(`    ${paint("⎿", "muted")} ${marker}\n`);
    }
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
            if (!thinkStart) thinkStart = Date.now();
            thinkBuf += inner.delta;
          }
        }
      }) || (() => {});
    }
  } catch {
    /* raciocínio é opcional; nunca derruba o turno */
  }

  setBusy(true);
  if (shows("activity")) {
    spin.start(tr("spin.thinking"));
    void pollTokens(); // depois do start: o loop depende de spin.active
  }
  const settled = waitForSettle(pi, settleTimeoutMs); // arma o listener de settled ANTES do prompt
  try {
    await pi.prompt(text, images.length ? images : undefined);
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
  let answerText = buf; // markdown completo, antes de o flush limpar
  // Alguns modelos não emitem text_delta: o texto só existe na mensagem final.
  // Sem isso a conversa parecia vazia embora o modelo tivesse respondido.
  if (!answerText.trim() && !hadError && !aborted && typeof pi.getLastAssistantText === "function") {
    const finalText = await pi.getLastAssistantText().catch(() => "");
    if (String(finalText || "").trim()) {
      answerText = String(finalText);
      write(renderMarkdown(answerText) + "\n");
    }
  }
  const wasError = hadError;
  const errText = rawError;
  const wasAborted = aborted;
  spin.stop();
  commitThink(true); // mostra até o raciocínio que chegou depois do texto
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
    images = [],
  } = opts;
  const usable = (x) => Boolean(x && x.ok && x.text && String(x.text).trim() !== "");

  const res = await converse(pi, text, write, setBusy, { images });
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
      images,
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

/** Escreve o banner ASCII + estado no topo. */
function printHeader(write, data) {
  write(renderBanner() + "\n");
  write(renderStatusLine(data) + "\n");
}

/**
 * Loop interativo (TTY, modo cru). `pi` pode ser null (conversa desativada;
 * comandos de barra seguem). `write` escreve no terminal.
 */
export async function repl({ pi, engineRef, write, input, setRaw, data = {}, sessionsDir: sessionsDirInjetado } = {}) {
  const keymap = makeKeyMap();
  let line = { buf: "", cur: 0, sel: 0, dismissed: false };
  let history = [];
  let histIdx = -1;
  let running = false;
  let quitting = false;
  let panelOpen = false; // painel de estado (ctrl+o)
  let taskOpen = false; // lista de tarefas da interface (ctrl+t)
  let sessionsOpen = false; // lista de sessões (ctrl+k)
  let settingsOpen = false; // configurações (ctrl+,)
  let sessionsCache = null; // linhas já montadas, para o overlay não esperar
  let settingsCache = null;
  let sessionsDirCache = null; // resolvido uma vez (sessionDir é varredura)
  let modelPicker = null; // seletor de /model: { stage, sel, grupos, flat, niveis, modelo }
  let valuePicker = null; // seletor genérico de valor único: { title, items, sel, onChoose }

  const paletteWidth = () => {
    // Nunca passa de WIDTH: uma linha de paleta maior que a tela wrapa em 2
    // linhas visuais mas conta como 1, e o \x1b[<n>A do redraw desalinha
    // (causa do texto sobrepondo/acumulando ao navegar).
    return Math.max(40, frameWidth() - 2);
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
    // permission/model em "fg" (branco, legível); think em "muted" (secundário).
    // Antes tudo era "muted" (cinza fraco) e a barra ficava difícil de ler.
    const statusParts = [paint(currentMode, "fg"), paint(permissionMode, "fg")];
    const model = shortModel(statusInfo.model);
    if (model) statusParts.push(paint(model, "fg"));
    if (statusInfo.reasoning) statusParts.push(paint("think:" + statusInfo.reasoning, "muted"));
    if (statusInfo.contextPct != null) statusParts.push(paint(tr("panel.context") + " " + statusInfo.contextPct + "%", "muted"));
    if (statusInfo.branch) statusParts.push(paint(statusInfo.branch, "muted"));
    if (goalTag) statusParts.push(paint(goalTag, "warn"));
    if (queued.length) statusParts.push(paint(tr("queue.hint", { n: queued.length }), "warn"));
    // Sem reticência: a linha é quebrada pelo mesmo mecanismo das outras
    // linhas abaixo, e o redraw conta as linhas visuais de verdade.
    const statusLine = "  " + statusParts.join(" · ");

    const keysLine = "  " + paint(
      panelOpen
        ? tr("hints.panel")
        : open
          ? tr("hints.palette")
          : tr("hints.idle"),
      "dim",
    );

    // Linhas abaixo da entrada (redesenho incremental: limpa daqui para baixo).
    const belowLines = [];
    for (const pl of paletteLines) belowLines.push(pl);
    if (panelOpen) for (const pl of renderPanel(statusInfo, data)) belowLines.push(pl);
    if (taskOpen) {
      const rows = [
        paint("  tarefas", "fg"),
        `    · ${goalTag || tr("goal.none")}`,
        `    · ${running ? tr("spin.thinking") : tr("common.done")}`,
        `    · ${tr("queue.hint", { n: queued.length })}`,
        "",
        paint("  ctrl+t fecha", "dim"),
      ];
      for (const pl of capLinhas(rows)) belowLines.push(pl);
    }
    if (settingsOpen && settingsCache) for (const pl of settingsCache) belowLines.push(pl);
    if (sessionsOpen && sessionsCache) for (const pl of sessionsCache) belowLines.push(pl);
    for (const pl of modelPickerRows()) belowLines.push(pl);
    for (const pl of valuePickerRows()) belowLines.push(pl);
    belowLines.push(statusLine);
    belowLines.push(keysLine);

    // Janela horizontal: mostra a fatia do buffer que cabe, mantendo o cursor
    // visível. Assim um prompt grande NÃO corta com "…" nem some da tela — o
    // texto completo continua no buffer (é ele que vai pro harness).
    const fw = frameWidth();
    const avail = fw - 4;
    const win = inputWindow(line.buf, line.cur, avail);
    const shown = win.shown;
    // Anti-flicker: o Windows Terminal repinta por chunk de write(); montar o
    // frame INTEIRO numa string e escrever UMA vez (cursor escondido durante a
    // repintura) é o que mais reduz o piscar a cada tecla de seta.
    const parts = ["\x1b[?25l"]; // esconde o cursor durante o redraw
    parts.push("\r\x1b[J"); // CR + limpa da linha de entrada para baixo
    parts.push("  " + paint("›", "accent") + " " + shown);
    // Quebra cada linha na largura real do terminal. O contador `below` usa as
    // linhas VISUAIS resultantes — é isso que mantém o \x1b[<n>A alinhado sem
    // precisar cortar nenhuma palavra no meio.
    const visualLines = [];
    for (const bl of belowLines) visualLines.push(...wrapBalanced(bl, fw));
    for (const linha of visualLines) parts.push("\n" + linha);
    const below = visualLines.length;
    if (below > 0) parts.push(`\x1b[${below}A`);
    const col = 4 + win.curCol;
    parts.push("\r");
    if (col > 0) parts.push(`\x1b[${col}C`);
    parts.push("\x1b[?25h"); // mostra o cursor na posição de entrada
    write(parts.join(""));
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

  const valuePickerRows = () => {
    if (!valuePicker) return [];
    return renderValuePicker({
      title: valuePicker.query ? `${valuePicker.title} /${valuePicker.query}` : valuePicker.title,
      items: valuePicker.items,
      sel: valuePicker.sel,
      footer: valuePicker.footer,
    });
  };

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
    valuePicker = null;
    drawInput();
  };

  // ------------------------------------------------------ value picker
  // Picker genérico de lista única. Enquanto aberto, ↑↓ andam, enter escolhe,
  // esc cancela — nada chega ao editor de linha. onChoose(item) roda no enter.
  const startValuePicker = (opts) => {
    modelPicker = null;
    const items = Array.isArray(opts?.items) ? opts.items : [];
    valuePicker = {
      title: String(opts?.title ?? "escolha"),
      items,
      allItems: items,
      query: "",
      sel: 0,
      footer: opts?.footer ?? "↑↓ navegar · enter escolher · esc cancela",
      onChoose: typeof opts?.onChoose === "function" ? opts.onChoose : null,
    };
    drawInput();
  };

  const cancelValuePicker = () => {
    valuePicker = null;
    drawInput();
  };

  const moveValuePicker = (delta) => {
    if (!valuePicker) return;
    const n = valuePicker.items.length;
    if (n === 0) return;
    valuePicker.sel = (valuePicker.sel + delta + n) % n;
    drawInput();
  };

  const chooseValuePicker = async () => {
    if (!valuePicker) return;
    const vp = valuePicker;
    // se o sel ficou inválido (itens mudaram entre abrir e enter), avisa em vez
    // de fechar em silêncio
    const item = vp.items[vp.sel] ?? (vp.items.length === 1 ? vp.items[0] : null);
    valuePicker = null;
    if (!item) {
      if (vp.items.length === 0) write(paint("  (nada a escolher)", "muted"));
      drawInput();
      return;
    }
    if (!vp.onChoose) { drawInput(); return; }
    // onChoose pode devolver "keep" para reabrir o picker (ex.: submenus).
    const r = await vp.onChoose(item);
    if (r === "keep") return; // onChoose já chamou startValuePicker/drawInput
    drawInput();
  };

  // ------------------------------------------------- atalhos de comandos
  // Cada função abre um valuePicker sob medida. Chamadas pelo submit quando o
  // comando vem sem argumento; com argumento o comando segue direto (runSlash).

  const startThemePicker = async () => {
    const _th = await import("../core/agent/theme.mjs");
    const tc = await import("../core/agent/theme-custom.mjs");
    const atual = _th.getTheme();
    const customs = await tc.listCustomThemes();
    const items = [
      ..._th.listThemes().map((nome) => ({
        label: nome,
        hint: nome === atual ? "(atual)" : "",
        value: nome,
      })),
      ...customs.map((c) => ({
        label: `custom ${c.slot}`,
        hint: `custom:${c.slot} · ${c.name || "(vazio)"}`,
        value: `custom:${c.slot}`,
      })),
      { label: "gerenciar temas custom…", hint: "editar os 3 slots (geral/detalhado)", value: "__manage" },
    ];
    startValuePicker({
      title: "tema",
      items,
      onChoose: async (it) => {
        if (it.value === "__manage") {
          startValuePicker({
            title: "qual slot custom editar?",
            items: [
              { label: "custom 1", hint: customs[0]?.name || "vazio", value: 1 },
              { label: "custom 2", hint: customs[1]?.name || "vazio", value: 2 },
              { label: "custom 3", hint: customs[2]?.name || "vazio", value: 3 },
            ],
            onChoose: (s) => {
              startThemeEditor(s.value);
              return "keep";
            },
          });
          return "keep";
        }
        const ok = _th.setTheme(it.value);
        if (ok && String(it.value).startsWith("custom")) await refreshThemeCache();
        write(ok ? `  tema: ${atual} -> ${_th.getTheme()}\n` : `  tema "${it.value}" indisponível\n`);
      },
    });
  };

  // Paleta de cores para escolher a cor de cada papel do tema.
  const SWATCHES = [
    { name: "branco", hex: "#ffffff" }, { name: "preto", hex: "#000000" },
    { name: "cinza", hex: "#9a9a9a" }, { name: "vermelho", hex: "#ef4444" },
    { name: "laranja", hex: "#f59e0b" }, { name: "amarelo", hex: "#facc15" },
    { name: "verde", hex: "#22c55e" }, { name: "ciano", hex: "#00d4ff" },
    { name: "azul", hex: "#4a9eff" }, { name: "roxo", hex: "#a78bfa" },
    { name: "rosa", hex: "#ec4899" }, { name: "marrom", hex: "#b45309" },
  ];

  // Editor de um tema custom: geral (5 papéis) ou detalhado (todos).
  const startThemeEditor = async (slot) => {
    const tc = await import("../core/agent/theme-custom.mjs");
    // getThemeColors devolve { name, bg, fg, ... }; "name" não é papel de cor,
    // então separa antes de compor a paleta (senão validateColors rejeita).
    const { name: _nomeBase, ...baseCores } = getThemeColors("escuro");
    const custom = (await tc.getCustomTheme(slot)) || { name: `meu tema ${slot}`, colors: {} };
    let colors = { ...baseCores, ...(custom.colors || {}) };
    let nome = custom.name || `meu tema ${slot}`;
    let detalhado = false;

    // save nunca lança: um erro de validação não pode derrubar a CLI.
    const save = async (ativar) => {
      try {
        await tc.saveCustomTheme(slot, { name: nome, colors: { ...colors } });
        if (ativar) {
          setTheme(`custom:${slot}`);
          await refreshThemeCache();
        }
        return true;
      } catch (err) {
        write(paint(`  erro ao salvar tema: ${String(err?.message || err).slice(0, 120)}`, "fail"));
        return false;
      }
    };

    const render = () => {
      const roles = detalhado ? tc.CUSTOM_ROLES : tc.GENERAL_ROLES;
      const itens = roles.map((r) => ({ label: r, hint: colors[r] || "(padrão)", value: r }));
      itens.push(
        { label: detalhado ? "→ modo geral" : "→ modo detalhado", hint: detalhado ? "5 papéis" : "todos os papéis", value: "__toggle" },
        { label: "salvar e ativar", hint: `custom:${slot}`, value: "__save" },
        { label: "salvar sem ativar", hint: "mantém o tema atual", value: "__saveonly" },
        { label: "voltar", hint: "sem salvar", value: "__back" },
      );
      startValuePicker({
        title: `editar tema ${slot} · ${nome} · ${detalhado ? "detalhado" : "geral"}`,
        items: itens,
        footer: "enter escolhe o papel · depois a cor · salvar",
        onChoose: async (it) => {
          if (it.value === "__toggle") { detalhado = !detalhado; render(); return "keep"; }
          if (it.value === "__save") { const ok = await save(true); if (ok) write(paint(`  tema custom ${slot} salvo e ativo`, "ok")); return; }
          if (it.value === "__saveonly") { const ok = await save(false); if (ok) write(paint(`  tema custom ${slot} salvo`, "ok")); return; }
          if (it.value === "__back") { return; }
          const role = it.value;
          startValuePicker({
            title: `cor de "${role}"`,
            items: SWATCHES.map((s) => ({ label: s.name, hint: colors[role] === s.hex ? "• atual" : "", value: s.hex })),
            onChoose: async (sw) => {
              colors[role] = sw.value;
              render();
              return "keep";
            },
          });
          return "keep";
        },
      });
    };
    render();
  };

  // ------------------------------------------------------ atividade (Ctrl+P)
  // Lista shells e subagentes em execução. Subagente persistente pode ser
  // inspecionado/interagido; temporário é read-only (só parar).
  const startActivityPanel = async () => {
    const ac = await import("../core/agent/activity.mjs");
    const itens = ac.listActivity();
    const linhas = itens.map((a) => {
      const st = a.status === "running" ? "●" : a.status === "done" ? "✓" : a.status === "crashed" ? "✗" : "○";
      const meta = a.meta
        ? [a.meta.persistent ? "persistente" : "temporário", a.meta.provider && a.meta.model ? `${a.meta.provider}/${a.meta.model}` : null, a.meta.effort ? `think:${a.meta.effort}` : null]
            .filter(Boolean).join(" · ")
        : "";
      return { label: `${st} ${a.name}`, hint: `${a.kind} · ${a.status} · ${meta}`, value: a.id };
    });
    if (linhas.length === 0) linhas.push({ label: "(nada rodando)", hint: "shells e subagentes", value: "__empty" });
    linhas.push({ label: "atualizar", hint: "reler", value: "__refresh" });
    startValuePicker({
      title: `atividade (${itens.length})`,
      items: linhas,
      footer: "enter inspecionar/parar · esc voltar",
      onChoose: async (it) => {
        if (it.value === "__refresh") { startActivityPanel(); return "keep"; }
        if (it.value === "__empty") return;
        const a = ac.getActivity(it.value);
        if (!a) { write(paint("  atividade não encontrada", "muted")); return; }
        // detalhe + ações
        const meta = a.meta || {};
        const info = [
          `  ${a.name} · ${a.kind} · ${a.status}`,
          meta.task ? `    tarefa: ${String(meta.task).slice(0, 100)}` : null,
          meta.persistent ? "    persistente (sessão própria)" : "    temporário (read-only)",
        ].filter(Boolean);
        info.forEach((l) => write(l + "\n"));
        if (a.kind !== "subagent" || !meta.persistent) {
          // temporário/shell: só pode parar
          startValuePicker({
            title: `${a.name} (temporário — read-only)`,
            items: [{ label: "parar", hint: "encerra", value: "__stop" }, { label: "voltar", value: "__back" }],
            onChoose: async (c) => {
              if (c.value === "__stop") {
                if (a.kind === "subagent") { const { closePersistent } = await import("../core/agent/subagent.mjs"); await closePersistent(a.name); }
                else ac.unregisterActivity(a.id);
                write(paint(`  ${a.name} parado`, "ok"));
                startActivityPanel();
                return "keep";
              }
            },
          });
          return "keep";
        }
        // persistente: ver / interagir / parar
        startValuePicker({
          title: `${a.name} (persistente)`,
          items: [
            { label: "ver detalhes", hint: `${a.kind} · ${a.status}`, value: "__info" },
            { label: "parar", hint: "encerra a sessão", value: "__stop" },
            { label: "voltar", value: "__back" },
          ],
          onChoose: async (c) => {
            if (c.value === "__info") { startActivityPanel(); return "keep"; }
            if (c.value === "__stop") {
              const { closePersistent } = await import("../core/agent/subagent.mjs");
              await closePersistent(a.name);
              write(paint(`  subagente "${a.name}" parado`, "ok"));
              startActivityPanel();
              return "keep";
            }
          },
        });
        return "keep";
      },
    });
  };

  const startModePicker = async () => {
    const { MODE_NAMES, resolveMode } = await import("../core/governance/modes.mjs");
    const atual = String(currentMode || "").toLowerCase();
    const items = MODE_NAMES.map((nome) => ({
      label: nome,
      hint: nome.toLowerCase() === atual ? "(atual)" : "",
      value: nome,
    }));
    startValuePicker({
      title: "modo",
      items,
      onChoose: async (it) => {
        const m = resolveMode(it.value);
        currentMode = m.name;
        statusInfo.mode = m.name;
        const linha = describeModeLine(m);
        write(`  modo: ${m.name}\n`);
        if (linha) write(`    ${linha}\n`);
      },
    });
  };

  const startVerbosityPicker = async () => {
    const atual = getVerbosity();
    startValuePicker({
      title: tr("verb.title"),
      items: VERBOSITY_LEVELS.map((nivel) => ({
        label: `${nivel} · ${tr(`verb.${nivel}`)}`,
        hint: nivel === atual ? "•" : "",
        value: nivel,
      })),
      footer: tr("verb.hint"),
      onChoose: async (it) => {
        runVerbosity({ arg: it.value, out: (s) => write(s + "\n") });
      },
    });
  };

  const startLanguagePicker = async () => {
    startValuePicker({
      title: tr("lang.title"),
      items: listLocales().map((l) => ({
        label: `${l.code} · ${l.label}`,
        hint: l.code === getLocale() ? "•" : "",
        value: l.code,
      })),
      footer: tr("lang.hint"),
      onChoose: async (it) => {
        await runLanguage({ arg: it.value, out: (s) => write(s + "\n") });
      },
    });
  };

  const startSettingsPicker = async () => {
    const _th = await import("../core/agent/theme.mjs");
    const refresh = () => {
      const atual = _th.getTheme();
      const itens = [
        { label: tr("cmd.theme"), hint: atual, value: "__theme" },
        { label: tr("cmd.mode"), hint: currentMode || "—", value: "__mode" },
        { label: tr("panel.permission").replace(":", ""), hint: permissionMode, value: "__perm" },
        { label: tr("cmd.model"), hint: shortModel(statusInfo.model) || "—", value: "__model" },
        { label: tr("cmd.effort"), hint: statusInfo.reasoning || "—", value: "__effort" },
        { label: tr("cmd.language"), hint: getLocale(), value: "__language" },
        { label: tr("cmd.verbosity"), hint: getVerbosity(), value: "__verbosity" },
      ];
      startValuePicker({
        title: tr("settings.title"),
        items: itens,
        onChoose: async (it) => {
          if (it.value === "__theme") { startThemePicker(); return "keep"; }
          if (it.value === "__mode") { await startModePicker(); return "keep"; }
          if (it.value === "__perm") { startPermissionPicker(); return "keep"; }
          if (it.value === "__model") { startModelPicker(); return "keep"; }
          if (it.value === "__effort") { await startEffortPicker(); return "keep"; }
          if (it.value === "__language") { await startLanguagePicker(); return "keep"; }
          if (it.value === "__verbosity") { await startVerbosityPicker(); return "keep"; }
        },
      });
    };
    refresh();
  };

  // Permissões disponíveis (o que o /settings deixa escolher). Duas hoje;
  // aberto como menu (não toggle) para o usuário VER a atual e escolher.
  const PERMISSION_MODES = ["full access", "ask"];
  const startPermissionPicker = () => {
    const atual = permissionMode;
    startValuePicker({
      title: "permissão",
      items: PERMISSION_MODES.map((p) => ({ label: p, hint: p === atual ? "(atual)" : "", value: p })),
      onChoose: async (it) => {
        permissionMode = it.value;
        if (statusInfo) statusInfo.permission = permissionMode;
        write(`  permissão: ${permissionMode}\n`);
      },
    });
  };

  const startEffortPicker = async () => {
    let niveis = [];
    if (pi?._rpc && typeof pi._rpc.getAvailableThinkingLevels === "function") {
      try { niveis = normalizeEffortList(await pi._rpc.getAvailableThinkingLevels()); } catch { niveis = []; }
    }
    const meta = metadataEfforts(statusInfo.model);
    if (meta && meta.some((n) => n !== "off") && niveis.length === 1 && (niveis[0] === "off" || niveis[0] === "none")) {
      niveis = meta;
      write(paint("  níveis lidos da configuração do modelo", "muted") + "\n");
    }
    const reais = niveis.filter((n) => n !== "none");
    if (reais.length > 0) niveis = reais;
    if (niveis.length === 0) {
      write("  (sem sessão ativa e sem metadados para este modelo)\n");
      return;
    }
    const atual = String(statusInfo.reasoning || "").toLowerCase();
    startValuePicker({
      title: "esforço",
      items: niveis.map((n) => ({ label: n, hint: n === atual ? "(atual)" : "", value: n })),
      onChoose: async (it) => {
        if (pi?._rpc && typeof pi._rpc.setThinkingLevel === "function") {
          await pi._rpc.setThinkingLevel(it.value).catch(() => null);
        }
        statusInfo.reasoning = it.value;
        write(`  esforço: ${it.value}\n`);
      },
    });
  };

  // ------------------------------------------------------ workspace
  // Onde os agentes agem. Trocar recria o motor com o novo cwd (o engineRef
  // mantém main sabendo qual client fechar no fim).
  const switchWorkspace = async (destino) => {
    const alvo = path.resolve(destino);
    let stat = null;
    try { stat = (await import("node:fs/promises")).stat(alvo); } catch { /* segue */ }
    if (!stat || !stat.isDirectory()) {
      write(paint(`  workspace: "${destino}" não é um diretório válido`, "fail"));
      return false;
    }
    const antes = workspaceRoot;
    workspaceRoot = alvo;
    sessionDirMemo = null; // o workspace muda, a pasta de sessões também
    // Recria o motor (fecha o antigo) para o novo diretório valer nas conversas.
    const novo = await startEngine(workspaceRoot);
    if (!novo) {
      // não conseguiu recriar: mantém o antigo e avisa
      workspaceRoot = antes;
      write(paint("  workspace: não consegui recriar o motor no novo diretório", "warn"));
      return false;
    }
    if (pi && typeof pi.close === "function") await pi.close().catch(() => {});
    pi = novo;
    if (engineRef) engineRef.current = novo;
    write(paint(`  workspace: ${workspaceRoot}`, "ok"));
    return true;
  };

  const startWorkspacePicker = async () => {
    const home = (await import("node:os")).homedir();
    const candidates = [
      { label: "raiz do repo", hint: ROOT, value: ROOT },
      { label: "diretório atual", hint: process.cwd(), value: process.cwd() },
      { label: "home", hint: home, value: home },
      { label: "desktop", hint: path.join(home, "Desktop"), value: path.join(home, "Desktop") },
      { label: "máquina toda (raiz)", hint: path.parse(process.cwd()).root, value: path.parse(process.cwd()).root },
    ];
    // remove duplicados mantendo a ordem
    const seen = new Set();
    const items = candidates.filter((c) => (seen.has(c.value) ? false : (seen.add(c.value), true)))
      .map((c) => ({ label: c.label, hint: (c.value === workspaceRoot ? "(atual) " : "") + c.hint, value: c.value }));
    items.push({ label: "explorer… escolher pelo Windows", hint: "abre o explorador de arquivos", value: "__explorer" });
    items.push({ label: "digitar caminho…", hint: "/workspace <caminho>", value: "__manual" });
    startValuePicker({
      title: "workspace (onde os agentes agem)",
      items,
      footer: "↑↓ navegar · enter escolher · esc cancela · ou /workspace <caminho>",
      onChoose: async (it) => {
        if (it.value === "__manual") {
          write(paint("  digite: /workspace <caminho>", "muted"));
          return;
        }
        if (it.value === "__explorer") {
          await pickAndSwitchWorkspace();
          return "keep";
        }
        await switchWorkspace(it.value);
      },
    });
  };

  // Abre o explorador de arquivos do Windows e usa a pasta escolhida como
  // workspace (onde os agentes agem).
  const pickAndSwitchWorkspace = async () => {
    let pickFolder;
    try {
      ({ pickFolder } = await import("../core/agent/file-explorer.mjs"));
    } catch {
      write(paint("  explorador de arquivos indisponível neste ambiente", "warn"));
      return;
    }
    write(paint("  abrindo o explorador… escolha uma pasta", "muted"));
    const dest = await pickFolder({ title: "SelfEvoPI — escolha a pasta/workspace" });
    if (!dest) {
      write(paint("  (cancelado)", "muted"));
      return;
    }
    await switchWorkspace(dest);
  };

  // ------------------------------------------------------ providers
  // Menu de 2 opções (adicionar / remover) + listar. Configurar = guia para a
  // forma com argumento (/providers add <id> <baseUrl> <apiKey>), que grava e
  // espelha a chave com ACL.
  const startProvidersPicker = async () => {
    let pv;
    try {
      pv = await import("../core/agent/providers.mjs");
    } catch {
      write(paint("  módulo de provedores indisponível", "warn"));
      return;
    }
    let lista = [];
    try { lista = await pv.listProviders(); } catch { lista = []; }
    const resumo = lista.length
      ? lista.map((p) => `${p.id} (${Array.isArray(p.models) ? p.models.length : 0} modelos)`).join(", ")
      : "nenhum provedor registrado";
    const items = [
      { label: "adicionar provedor", hint: "configurar id + endpoint + chave", value: "__add" },
      { label: "remover provedor", hint: resumo, value: "__rm" },
      { label: "listar provedores", hint: resumo, value: "__list" },
    ];
    startValuePicker({
      title: "provedores",
      items,
      footer: "↑↓ navegar · enter escolher · esc cancela",
      onChoose: async (it) => {
        if (it.value === "__add") {
          write(paint("  configure com: /providers add <id> <baseUrl> [apiKey]", "muted"));
          write(paint("  exemplo: /providers add openai https://api.openai.com sk-...", "muted"));
          write(paint("  (depois /providers models <baseUrl> lista os modelos do endpoint)", "muted"));
          return;
        }
        if (it.value === "__list") {
          if (!lista.length) write(paint("  nenhum provedor registrado", "muted"));
          else for (const p of lista) write(`  ${p.id}  ${p.baseUrl}  (${Array.isArray(p.models) ? p.models.length : 0} modelos)`);
          return;
        }
        if (it.value === "__rm") {
          if (!lista.length) {
            write(paint("  nenhum provedor para remover", "muted"));
            return;
          }
          // submenu: qual remover
          startValuePicker({
            title: "remover qual provedor?",
            items: lista.map((p) => ({ label: p.id, hint: p.baseUrl, value: p.id })),
            onChoose: async (alvo) => {
              try {
                const r = await pv.removeProvider({ id: alvo.value });
                write(r.removed ? paint(`  provedor "${alvo.value}" removido`, "ok") : paint(`  "${alvo.value}" não existia`, "muted"));
              } catch (err) {
                write(paint(`  erro: ${String(err?.message || err).slice(0, 120)}`, "fail"));
              }
            },
          });
          return "keep";
        }
      },
    });
  };

  // ------------------------------------------------------ sessions
  // Ctrl+K agora abre um picker navegável (setas + enter carrega + esc fecha),
  // em vez de um overlay estático que ficava na tela para sempre.
  const switchToSession = async (id) => {
    let target = null;
    try {
      const { readdir } = await import("node:fs/promises");
      if (!sessionsDirCache) sessionsDirCache = await sessionDir();
      for (const f of (await readdir(sessionsDirCache)).filter((x) => x.endsWith(".jsonl"))) {
        if (f.includes(id)) { target = path.join(sessionsDirCache, f); break; }
      }
    } catch { /* segue */ }
    if (target && pi?._rpc && typeof pi._rpc.switchSession === "function") {
      const ok = await pi._rpc.switchSession(target).then(() => true).catch(() => false);
      write(ok ? paint(`  sessão ${String(id).slice(0, 8)} ativa.`, "ok") : paint("  não consegui trocar de sessão.", "warn"));
      return;
    }
    write(paint(`  sessão ${String(id).slice(0, 8)} selecionada (troca ativa depende do orquestrador).`, "muted"));
  };

  const startSessionsPicker = async () => {
    let list = [];
    let extras = new Map();
    try {
      const { listSessions } = await import("../core/agent/sessions.mjs");
      if (!sessionsDirCache) {
        try { sessionsDirCache = sessionsDirInjetado ?? await sessionDir(); } catch { sessionsDirCache = null; }
      }
      list = await listSessions(sessionsDirCache);
      extras = await readSessionExtras(sessionsDirCache);
    } catch (err) {
      write(paint(`  não consegui ler as sessões: ${err?.message ?? err}`, "warn"));
      return;
    }
    if (!list || list.length === 0) {
      write(paint("  nenhuma sessão encontrada", "muted"));
      return;
    }
    const items = list.map((se) => {
      const extra = extras.get(se.id);
      const title = deriveTitle(se.title, extra?.firstUser) ?? String(se.id).slice(0, 8);
      const when = String(se.updatedAt || "").slice(0, 10);
      const preview = String(extra?.firstUser || "").replace(/\s+/g, " ").slice(0, 28);
      return {
        label: String(title),
        hint: [String(se.id).slice(0, 8), `${se.turns} turnos`, when, preview].filter(Boolean).join(" · "),
        value: se.id,
      };
    });
    startValuePicker({
      title: `sessões (${items.length})`,
      items,
      footer: "↑↓ navegar · enter carregar · esc cancela",
      onChoose: async (it) => {
        // submenu: abrir ou deletar a sessão
        startValuePicker({
          title: `sessão ${String(it.value).slice(0, 8)}`,
          items: [
            { label: "abrir", hint: "carregar esta sessão", value: "__open" },
            { label: "deletar", hint: "remove o arquivo da sessão", value: "__del" },
            { label: "voltar", value: "__back" },
          ],
          onChoose: async (c) => {
            if (c.value === "__open") { await switchToSession(it.value); return; }
            if (c.value === "__back") { return; }
            if (c.value === "__del") {
              // confirmação antes de apagar
              startValuePicker({
                title: `deletar ${String(it.value).slice(0, 8)}?`,
                items: [
                  { label: "sim, deletar", hint: "remove o arquivo", value: "__yes" },
                  { label: "não", value: "__no" },
                ],
                onChoose: async (d) => {
                  if (d.value !== "__yes") { startSessionsPicker(); return "keep"; }
                  try {
                    const { readdir, unlink } = await import("node:fs/promises");
                    const dir = sessionsDirCache || (await sessionDir());
                    const arq = (await readdir(dir)).find((f) => f.includes(it.value));
                    if (arq) { await unlink(path.join(dir, arq)); write(paint("  sessão deletada", "ok")); }
                    else write(paint("  sessão não encontrada (já removida?)", "warn"));
                  } catch (err) {
                    write(paint(`  erro ao deletar: ${String(err?.message || err).slice(0, 120)}`, "fail"));
                  }
                  startSessionsPicker();
                  return "keep";
                },
              });
              return "keep";
            }
          },
        });
        return "keep";
      },
    });
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

    // A config local tem prioridade quando o motor ainda não declarou o
    // reasoning do modelo (caso do ERNIE 5.5: único effort aceito é `high`).
    const meta = metadataEfforts(escolha.provider + "/" + escolha.id) || metadataEfforts(escolha.id);
    if (meta && meta.some((n) => n !== "off") && niveis.length === 1 && (niveis[0] === "off" || niveis[0] === "none")) {
      niveis = meta;
      doMotor = true; // lista confirmada pela config do modelo, não inventada
    }

    if (niveis.length === 0 || (niveis.length === 1 && niveis[0] === "off")) {
      // modelo sem raciocínio: só confirma a troca, sem picker inútil
      write("  modelo: " + escolha.provider + "/" + escolha.id + "\n");
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
    if (queued.length) {
      const next = queued.shift();
      write(paint("  " + tr("queue.sent"), "muted") + "\n");
      drawInput();
      await submit(next);
      return;
    }
    prompt();
  };

  const submit = async (rawText) => {
    let text = rawText;
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
    // !comando: shell direto, sem passar pelo modelo.
    if (text.startsWith("!")) {
      const cmdline = text.slice(1).trim();
      if (cmdline) {
        const r = await runProcess(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", cmdline], { cwd: workspaceRoot });
        const body = capLinhas(String(r.out || "").split("\n").slice(0, 120));
        write(body.join("\n") + "\n");
      }
      prompt();
      return;
    }
    // @arquivo: injeta o conteúdo como contexto antes de enviar ao modelo.
    const expanded = await expandAtMentions(text);
    if (expanded.files.length || expanded.images.length) {
      const names = [...expanded.files, ...expanded.images].map((f) => path.basename(f));
      write(paint("  @ " + names.join(", "), "muted") + "\n");
      text = expanded.text;
    }
    pendingImages.push(...expanded.images);
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
      const semArg = String(parsed.arg ?? "").trim() === "";
      // Comandos com opções abrem um picker interativo quando vêm sem argumento.
      // Com argumento, seguem direto (runSlash).
      if (semArg) {
        if (parsed.name === "/model") { startModelPicker(); return; }
        if (parsed.name === "/theme") { await startThemePicker(); return; }
        if (parsed.name === "/mode") { await startModePicker(); return; }
        if (parsed.name === "/effort") { await startEffortPicker(); return; }
        if (parsed.name === "/settings") { await startSettingsPicker(); return; }
        if (parsed.name === "/language") { await startLanguagePicker(); return; }
        if (parsed.name === "/verbosity") { await startVerbosityPicker(); return; }
        if (parsed.name === "/workspace") { await startWorkspacePicker(); return; }
        if (parsed.name === "/providers") { await startProvidersPicker(); return; }
      }
      // /workspace <caminho> troca direto (sem picker)
      if (parsed.name === "/workspace") {
        await switchWorkspace(String(parsed.arg ?? "").trim());
        prompt();
        return;
      }
      // /explorer abre o explorador do Windows e usa a escolha como workspace.
      if (parsed.name === "/explorer") {
        await pickAndSwitchWorkspace();
        prompt();
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
    const images = [...pendingImages];
    const imageBlocks = images.map(imageContent).filter(Boolean);
    if (images.length > 0 && imageBlocks.length === 0) {
      write(paint(`  ${tr("img.unavailable")}`, "warn") + "\n");
    }
    if (imageBlocks.length > 0) {
      const modelRef = statusInfo.model || "";
      const prov = modelRef.includes("/") ? modelRef.slice(0, modelRef.indexOf("/")) : null;
      const id = modelRef.includes("/") ? modelRef.slice(modelRef.indexOf("/") + 1) : modelRef;
      const meta = listModelMetadata().find((m) => (prov ? m.provider === prov && m.id === id : m.id === id));
      if (meta && !meta.image) write(paint(`  ${tr("img.noVision")}`, "warn") + "\n");
    }
    const res = await converseOrFallback(pi, text || "(veja a imagem anexa)", (s) => write(s), {
      allowFallback: !process.env.SELFEOPI_MODEL,
      candidates: listConfiguredModels(),
      setBusy: (b) => (running = b),
      images: imageBlocks,
    });
    if (imageBlocks.length > 0) pendingImages = [];
    if (quitting) return;
    if (res?.text) lastAnswer = res.text;
    undoStack.push({ text, answer: res?.text || "" });
    await checkGoal(res?.text, (s) => write(s + "\n"));
    await finishRun();
  };

  const onData = async (chunk) => {
    for (const key of keymap(chunk)) {
      if (quitting) return;
      if (key === "alt-t") {
        reasoningToggle = !reasoningOn();
        write(paint("  " + (reasoningToggle ? tr("think.show") : tr("think.hide")), "muted") + "\n");
        drawInput();
        continue;
      }
      if (key === "ctrl-t" && !running) {
        taskOpen = !taskOpen;
        panelOpen = false;
        settingsOpen = false;
        sessionsOpen = false;
        modelPicker = null;
        valuePicker = null;
        drawInput();
        continue;
      }
      if (key === "ctrl-o" && !running) {
        // Ctrl+O = painel de estado (o que /help e a dica prometem). Um overlay
        // por vez: fecha os demais. O editor de configuração é Ctrl+,.
        panelOpen = !panelOpen;
        settingsOpen = false;
        sessionsOpen = false;
        modelPicker = null;
        valuePicker = null;
        drawInput();
        continue;
      }
      if (key === "ctrl-k" && !running) {
        // Ctrl+K abre o picker de sessões (navegável, enter carrega, esc fecha).
        // Fecha as configurações estáticas e o painel (um overlay por vez).
        settingsOpen = false;
        panelOpen = false;
        taskOpen = false;
        sessionsOpen = false;
        modelPicker = null;
        valuePicker = null;
        await startSessionsPicker();
        continue;
      }
      if (key === "ctrl-comma" && !running) {
        // Ctrl+, abre o EDITOR de configurações (tema/modo/permissão/modelo/
        // esforço/idioma). A leitura estática continua em /settings.
        modelPicker = null;
        valuePicker = null;
        panelOpen = false;
        taskOpen = false;
        sessionsOpen = false;
        await startSettingsPicker();
        continue;
      }
      if (key === "ctrl-p" && !running) {
        // Ctrl+P: lista de atividade (shells e subagentes)
        settingsOpen = false;
        sessionsOpen = false;
        panelOpen = false;
        taskOpen = false;
        modelPicker = null;
        valuePicker = null;
        await startActivityPanel();
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
      if (valuePicker) {
        if (key === "up") { moveValuePicker(-1); continue; }
        if (key === "down") { moveValuePicker(1); continue; }
        if (key === "enter") { await chooseValuePicker(); continue; }
        if (key === "esc") { cancelValuePicker(); continue; }
        // Filtro por prefixo/substring, como no /resume dos concorrentes.
        if (key === "backspace") {
          valuePicker.query = String(valuePicker.query || "").slice(0, -1);
        } else if (typeof key === "string" && key.length === 1) {
          valuePicker.query = String(valuePicker.query || "") + key;
        } else {
          continue;
        }
        const q = String(valuePicker.query || "").toLowerCase();
        valuePicker.items = q
          ? valuePicker.allItems.filter((it) =>
              `${it.label} ${it.hint || ""}`.toLowerCase().includes(q))
          : valuePicker.allItems;
        valuePicker.sel = 0;
        drawInput();
        continue;
      }
      if (running) {
        if (key === "ctrl-c") {
          if (pi) pi.abort().catch(() => {});
          write("^C\n");
          running = false;
          drawInput();
          continue;
        }
        // Enquanto o agente trabalha, o usuário pode continuar digitando.
        // Enter enfileira a mensagem (ctrl+enter envia imediato, quando o
        // terminal manda a sequência) em vez de descartar o que foi escrito.
        if (key === "enter" || key === "ctrl-enter") {
          const text = line.buf.trim();
          if (text) {
            queued.push(text);
            line = { buf: "", cur: 0, sel: 0, dismissed: false };
            write(paint(`  ${tr("queue.hint", { n: queued.length })}`, "muted") + "\n");
          }
          drawInput();
          continue;
        }
        const edited = reduceLine(line, key);
        if (edited && edited.state) {
          line = edited.state;
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
  await refreshThemeCache(); // se o tema ativo for custom, carrega a paleta
  prompt();

  return new Promise((resolve) => {
    const check = setInterval(() => {
      if (quitting) {
        clearInterval(check);
        resolve();
      }
    }, 20);
    check.unref?.(); // o stdin é o handle real; o polling não segura o processo
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
        // Ctrl+Enter em terminais que usam o protocolo "kitty keyboard".
        const ce1 = "\x1b[13;5u";
        const ce2 = "\x1b[1;5u";
        if (s.startsWith(ce1, i)) { yield "ctrl-enter"; i += ce1.length - 1; continue; }
        if (s.startsWith(ce2, i)) { yield "ctrl-enter"; i += ce2.length - 1; continue; }
        const next = s[i + 1];
        // Alt+T (alterna raciocínio) e Esc+, (fallback de Ctrl+,).
        if (next === "t" || next === "T") { yield "alt-t"; i += 1; continue; }
        if (next === ",") { yield "ctrl-comma"; i += 1; continue; }
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
      if (code === 0x0b) { // Ctrl+K — abre a lista de sessões
        yield "ctrl-k";
        continue;
      }
      if (code === 0x1c) { // Ctrl+, não tem código ASCII próprio; 0x1C é o que
        yield "ctrl-comma"; // a maioria dos terminais manda (Ctrl+ inclusive)
        continue;
      }
      if (code === 0x10) { // Ctrl+P — lista de atividade (shells + subagentes)
        yield "ctrl-p";
        continue;
      }
      if (code === 0x14) { // Ctrl+T — alterna a lista de tarefas da interface
        yield "ctrl-t";
        continue;
      }
      if (code === 0x02) { // Ctrl+B — move o comando em curso para o fundo
        yield "ctrl-b";
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
async function startEngine(cwd = workspaceRoot) {
  const { createPiClient } = await import("../core/agent/pi-rpc.mjs");
  const client = await createPiClient({ cwd }).catch(() => null);
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
    else if (screen === "help") frame = [renderBanner(), renderStatusLine(data), "", renderHelp()].join("\n");
    else if (screen === "banner") frame = [renderBanner(), renderStatusLine(data)].join("\n");
    else if (screen === "palette") frame = renderPaletteFrame("", 72);
    else if (screen === "menu") frame = renderPaletteFrame("", 72);
    else if (screen === "palette-filtered") frame = renderPaletteFrame("ev", 72);
    else if (screen === "status") frame = [
      renderBanner(),
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
        renderStatusLine({ ...data, mode: currentMode }),
        "",
        ...renderPanel(sample, data),
      ].join("\n");
    } else if (screen === "busy") {
      // Simula o rodapé com spinner + rótulos de estado (pensando / ferramenta).
      const f = spinnerFrame(SPINNER_MS * 3);
      frame = [
        renderBanner(),
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
  // engineRef carrega o client atual; /workspace pode trocá-lo (recria com novo
  // cwd), então main lê engineRef.current no fim em vez de um `pi` fixo.
  const engineRef = { current: null };
  if (engine.available) {
    engineRef.current = await startEngine(workspaceRoot);
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
  await repl({ pi: engineRef.current, engineRef, write: (s) => stdout.write(s), input: stdin, setRaw, data });
  setRaw(false);
  if (engineRef.current) await engineRef.current.close().catch(() => {});
  process.exitCode = 0;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`SelfEvoPI: ${err?.stack || err?.message || err}\n`);
    process.exitCode = 2;
  });
}