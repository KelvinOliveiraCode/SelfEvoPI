/**
 * selfevopi-theme — paleta da TUI.
 *
 * Doze temas: `padrao` (padrão), `violeta`, `azul`, `ciano`, `verde`,
 * `esmeralda`, `laranja`, `rosa`, `vermelho`, `magenta`, `dourado`, `grafite`.
 * O tema muda a **paleta** (fg, muted, accent, ok, warn, fail), não a estrutura.
 *
 * Persistência dupla:
 *  - arquivo: ~/.pi/agent/theme.json  (a CLI lê daqui)
 * *
 * Exporta:
 *  - THEMES, getTheme(), setTheme(nome), listThemes()
 *  - themeToCss(nome) → string de CSS (variáveis --fg, --muted, --accent, …)
 *  - themeToAnsi(nome) → { fg, muted, accent, ok, warn, fail } (truecolor)
 *  - applyAnsiTheme(nome) → define variáveis ANSI256/truecolor no processo
 *
 * Zero dependência. Só `node:`. Sem禹 Unicode de bloco.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import process from "node:process";

const HOME = process.env.USERPROFILE || process.env.HOME || ".";
const THEME_KEY = "selfevopi.theme";
const DEFAULT_THEME = "padrao";

/** Nomes antigos ainda podem estar em theme.json/localStorage de quem atualizou. */
const LEGACY_NAMES = { escuro: "padrao", "alto-contraste": "padrao", claro: "violeta" };
function nomeAtual(value) {
  const raw = String(value || "");
  return LEGACY_NAMES[raw] || raw;
}

/** Caminho do arquivo de tema (resolvido a cada chamada, para respeitar overrides). */
function themeFile() {
  const home = process.env.USERPROFILE || process.env.HOME || ".";
  return join(home, ".pi", "agent", "theme.json");
}

/* ------------------------------------------------------------------ */
/* Paletas                                                             */
/* ------------------------------------------------------------------ */

/**
 * Cada tema define as mesmas chaves semânticas. Valores são hex (#rrggbb).
 * Todos os temas foram calibrados para WCAG AA (4.5:1 em cada papel de texto
 * sobre o respectivo fundo); o teste em `theme.test.mjs` verifica isso.
 */
export const THEMES = {
  padrao: {
    name: "padrao",
    bg: "#0b0908",
    fg: "#fff6e5",
    muted: "#d6b978",
    accent: "#ffc857",
    ok: "#7dd88c",
    warn: "#ffb454",
    fail: "#ff7b72",
    code: "#f0e2c0",
    tool: "#ffd97d",
    link: "#ffc857",
    rule: "#8a6e3c",
  },
  violeta: {
    name: "violeta",
    bg: "#0a0710",
    fg: "#f7f2ff",
    muted: "#cbb8f5",
    accent: "#c4a7ff",
    ok: "#86e0a0",
    warn: "#ffbd7a",
    fail: "#ff8e9c",
    code: "#ece3ff",
    tool: "#e3ccff",
    link: "#c4a7ff",
    rule: "#6b588e",
  },
  azul: { name: "azul", bg: "#0c0d0e", fg: "#f4f5f6", muted: "#b7c2cd", accent: "#6ea8e2", ok: "#7bd5a1", warn: "#f8b659", fail: "#f17a74", code: "#e0e3e6", tool: "#afcce9", link: "#6ea8e2", rule: "#404d59" },
  ciano: { name: "ciano", bg: "#0c0d0e", fg: "#f4f5f6", muted: "#b6cacd", accent: "#6cd1e5", ok: "#7bd5a1", warn: "#f8b659", fail: "#f17a74", code: "#e0e5e6", tool: "#ade0eb", link: "#6cd1e5", rule: "#3f565a" },
  verde: { name: "verde", bg: "#0c0e0d", fg: "#f4f6f5", muted: "#b7cdc0", accent: "#70e19f", ok: "#7bd5a1", warn: "#f8b659", fail: "#f17a74", code: "#e0e6e2", tool: "#b0e8c7", link: "#70e19f", rule: "#41584b" },
  esmeralda: { name: "esmeralda", bg: "#0c0e0d", fg: "#f4f6f5", muted: "#b7cdc7", accent: "#70e1c4", ok: "#7bd5a1", warn: "#f8b659", fail: "#f17a74", code: "#e0e6e4", tool: "#b0e8da", link: "#70e1c4", rule: "#415852" },
  laranja: { name: "laranja", bg: "#0e0d0c", fg: "#f6f5f4", muted: "#cfc1b5", accent: "#e8a469", ok: "#7bd5a1", warn: "#f8b659", fail: "#f17a74", code: "#e6e3e0", tool: "#eccaac", link: "#e8a469", rule: "#5b4c3e" },
  rosa: { name: "rosa", bg: "#0e0c0d", fg: "#f6f4f5", muted: "#cdb6c2", accent: "#e56ca8", ok: "#7bd5a1", warn: "#f8b659", fail: "#f17a74", code: "#e6e0e3", tool: "#ebadcc", link: "#e56ca8", rule: "#5a3f4d" },
  vermelho: { name: "vermelho", bg: "#0e0c0c", fg: "#f6f4f4", muted: "#cfb6b5", accent: "#e86d69", ok: "#7bd5a1", warn: "#f8b659", fail: "#f17a74", code: "#e6e0e0", tool: "#ecaeac", link: "#e86d69", rule: "#5b3f3e" },
  magenta: { name: "magenta", bg: "#0e0c0e", fg: "#f6f4f6", muted: "#cdb6cd", accent: "#e46ce4", ok: "#7bd5a1", warn: "#f8b659", fail: "#f17a74", code: "#e6e0e6", tool: "#eaaeea", link: "#e46ce4", rule: "#5a3f5a" },
  dourado: { name: "dourado", bg: "#0e0d0c", fg: "#f6f6f4", muted: "#d1ccb3", accent: "#eed763", ok: "#7bd5a1", warn: "#f8b659", fail: "#f17a74", code: "#e7e6df", tool: "#f0e4a8", link: "#eed763", rule: "#5e583b" },
  grafite: { name: "grafite", bg: "#0c0d0e", fg: "#f4f5f6", muted: "#b7c0cd", accent: "#83a2ce", ok: "#7bd5a1", warn: "#f8b659", fail: "#f17a74", code: "#e0e2e6", tool: "#bbc9dd", link: "#83a2ce", rule: "#454b54" },
};

/* ------------------------------------------------------------------ */
/* Persistência                                                        */
/* ------------------------------------------------------------------ */

function readThemeFile() {
  try {
    const raw = readFileSync(themeFile(), "utf8");
    const doc = JSON.parse(raw);
    return typeof doc?.theme === "string" ? doc.theme : null;
  } catch {
    return null;
  }
}

function writeThemeFile(name) {
  try {
    const file = themeFile();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ theme: name }, null, 2) + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

function readLocalStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function writeLocalStorage(name) {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.setItem(THEME_KEY, name);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Estado                                                              */
/* ------------------------------------------------------------------ */

let current = null;

function resolveInitial() {
  // prioridade: arquivo (fonte da verdade) > padrão
  const saved = nomeAtual(readThemeFile() || readLocalStorage());
  if (!saved) return DEFAULT_THEME;
  // tema salvo que não existe mais (removido/renomeado) cai no padrão
  const isBuiltin = Object.prototype.hasOwnProperty.call(THEMES, saved);
  const isCustom = /^custom:[1-3]$/.test(String(saved));
  if (!isBuiltin && !isCustom) return DEFAULT_THEME;
  return saved;
}

/* ------------------------------------------------------------------ */
/* API pública                                                         */
/* ------------------------------------------------------------------ */

/** Lista os nomes de tema disponíveis. */
export function listThemes() {
  return Object.keys(THEMES);
}

/** Tema ativo (nome). */
export function getTheme() {
  if (current === null) current = resolveInitial();
  return current;
}

/** A paleta do tema ativo. */
export function getThemeColors(nome) {
  const name = nomeAtual(nome) || getTheme();
  return THEMES[name] || THEMES[DEFAULT_THEME];
}

/**
 * Define o tema ativo. Persiste em arquivo e localStorage.
 * @param {string} nome
 * @returns {boolean} true se aplicou
 */
export function setTheme(nome) {
  const nomeFinal = nomeAtual(nome);
  // aceita temas embutidos E slots customizados ("custom:1".."custom:3")
  const isCustom = typeof nomeFinal === "string" && /^custom:[1-3]$/.test(nomeFinal);
  if (!THEMES[nomeFinal] && !isCustom) return false;
  current = nomeFinal;
  writeThemeFile(nomeFinal);
  writeLocalStorage(nomeFinal);
  return true;
}

/* ------------------------------------------------------------------ */
/* Conversão: CSS                                                      */
/* ------------------------------------------------------------------ */

/**
 * Gera CSS com as variáveis do tema, pronto para injetar num <style>.
 * @param {string} [nome]
 * @returns {string}
 */
export function themeToCss(nome) {
  const t = getThemeColors(nome);
  return `:root {
  --bg: ${t.bg};
  --fg: ${t.fg};
  --muted: ${t.muted};
  --accent: ${t.accent};
  --ok: ${t.ok};
  --warn: ${t.warn};
  --fail: ${t.fail};
}`;
}

/* ------------------------------------------------------------------ */
/* Conversão: ANSI                                                     */
/* ------------------------------------------------------------------ */

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return { r: 255, g: 255, b: 255 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * Paleta do tema em valores ANSI truecolor (38;2;r;g;b).
 * @param {string} [nome]
 * @returns {{fg:string, muted:string, accent:string, ok:string, warn:string, fail:string}}
 */
export function themeToAnsi(nome) {
  const t = getThemeColors(nome);
  const seq = (hex) => {
    const { r, g, b } = hexToRgb(hex);
    return `\x1b[38;2;${r};${g};${b}m`;
  };
  return {
    fg: seq(t.fg),
    muted: seq(t.muted),
    accent: seq(t.accent),
    ok: seq(t.ok),
    warn: seq(t.warn),
    fail: seq(t.fail),
    code: seq(t.code),
    tool: seq(t.tool),
    link: seq(t.link),
    rule: seq(t.rule),
  };
}

/** Converte um hex (#rrggbb) no índice da paleta ANSI-256 (16..255). */
export function hexToAnsi256(hex) {
  const { r, g, b } = hexToRgb(hex);
  // tons de cinza: rampa 232..255 (cinza 8..238)
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 238) return 231;
    return 232 + Math.max(0, Math.min(23, Math.round((r - 8) / 10)));
  }
  // cubo 6x6x6: níveis [0, 95, 135, 175, 215, 255]
  const levels = [0, 95, 135, 175, 215, 255];
  const near = (v) => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < 6; i++) {
      const d = Math.abs(levels[i] - v);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };
  return 16 + 36 * near(r) + 6 * near(g) + near(b);
}

/**
 * Paleta do tema em ANSI-256 (`\x1b[38;5;Nm`) — funciona em terminais que não
 * têm truecolor (ex.: `xterm-256color`, console clássico do Windows).
 * @param {string} [nome]
 */
export function themeToAnsi256(nome) {
  const t = getThemeColors(nome);
  const seq = (hex) => `\x1b[38;5;${hexToAnsi256(hex)}m`;
  return {
    fg: seq(t.fg),
    muted: seq(t.muted),
    accent: seq(t.accent),
    ok: seq(t.ok),
    warn: seq(t.warn),
    fail: seq(t.fail),
    code: seq(t.code),
    tool: seq(t.tool),
    link: seq(t.link),
    rule: seq(t.rule),
  };
}

/**
 * Paleta (objeto de hex) → ANSI truecolor. Usada por temas customizados,
 * que não estão em THEMES mas têm as mesmas chaves.
 * @param {{fg:string,muted:string,accent:string,ok:string,warn:string,fail:string,code?:string,tool?:string,link?:string,rule?:string}} colors
 */
export function themeToAnsiFromColors(colors = {}) {
  const seq = (hex) => {
    const { r, g, b } = hexToRgb(hex);
    return `\x1b[38;2;${r};${g};${b}m`;
  };
  return {
    fg: seq(colors.fg), muted: seq(colors.muted), accent: seq(colors.accent),
    ok: seq(colors.ok), warn: seq(colors.warn), fail: seq(colors.fail),
    code: seq(colors.code || colors.fg), tool: seq(colors.tool || colors.accent),
    link: seq(colors.link || colors.accent), rule: seq(colors.rule || colors.muted),
  };
}

/** Paleta (objeto de hex) → ANSI-256. */
export function themeToAnsi256FromColors(colors = {}) {
  const seq = (hex) => `\x1b[38;5;${hexToAnsi256(hex)}m`;
  return {
    fg: seq(colors.fg), muted: seq(colors.muted), accent: seq(colors.accent),
    ok: seq(colors.ok), warn: seq(colors.warn), fail: seq(colors.fail),
    code: seq(colors.code || colors.fg), tool: seq(colors.tool || colors.accent),
    link: seq(colors.link || colors.accent), rule: seq(colors.rule || colors.muted),
  };
}

/**
 * Aplica o tema ao processo: define as variáveis de cor ANSI que a TUI usa.
 * Não imprime nada; só prepara o ambiente.
 * @param {string} [nome]
 */
export function applyAnsiTheme(nome) {
  const ansi = themeToAnsi(nome);
  for (const [k, v] of Object.entries(ansi)) {
    process.env[`SELFEVOPI_ANSI_${k.toUpperCase()}`] = v;
  }
  return ansi;
}

export default {
  THEMES,
  getTheme,
  setTheme,
  listThemes,
  getThemeColors,
  themeToCss,
  themeToAnsi,
  themeToAnsi256,
  hexToAnsi256,
  applyAnsiTheme,
};