/**
 * selfevopi-theme — paleta da TUI e do desktop.
 *
 * Três temas: `escuro` (padrão), `claro`, `alto-contraste`.
 * O tema muda a **paleta** (fg, muted, accent, ok, warn, fail), não a estrutura.
 *
 * Persistência dupla:
 *  - arquivo: ~/.pi/agent/theme.json  (a CLI lê daqui; TUI e desktop concordam)
 *  - localStorage: selfevopi.theme     (o desktop lê daqui quando há DOM)
 *
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
const DEFAULT_THEME = "escuro";

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
 * `alto-contraste` foi calibrado para WCAG AA em fundo preto (4.5:1 texto normal).
 */
export const THEMES = {
  escuro: {
    name: "escuro",
    bg: "#000000",
    fg: "#ffffff",
    muted: "#787878",
    accent: "#4a9eff",
    ok: "#3fb950",
    warn: "#d29922",
    fail: "#f85149",
  },
  claro: {
    name: "claro",
    bg: "#ffffff",
    fg: "#0d0d0d",
    muted: "#5a5a5a",
    accent: "#1565c0",
    ok: "#1a7f37",
    warn: "#9a6700",
    fail: "#cf222e",
  },
  "alto-contraste": {
    name: "alto-contraste",
    bg: "#000000",
    fg: "#ffffff",
    muted: "#b0b0b0",
    accent: "#6cb6ff",
    ok: "#5dff5d",
    warn: "#ffd700",
    fail: "#ff6b6b",
  },
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
  // prioridade: arquivo (fonte da verdade entre TUI e desktop) > localStorage > padrão
  return readThemeFile() || readLocalStorage() || DEFAULT_THEME;
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
  const name = nome || getTheme();
  return THEMES[name] || THEMES[DEFAULT_THEME];
}

/**
 * Define o tema ativo. Persiste em arquivo e localStorage.
 * @param {string} nome
 * @returns {boolean} true se aplicou
 */
export function setTheme(nome) {
  if (!THEMES[nome]) return false;
  current = nome;
  writeThemeFile(nome);
  writeLocalStorage(nome);
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
  applyAnsiTheme,
};