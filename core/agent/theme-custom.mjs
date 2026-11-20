/**
 * core/agent/theme-custom.mjs — temas customizáveis (3 slots) para a TUI.
 *
 * O SelfEvoPI tem um tema fixo em `core/agent/theme.mjs`; este módulo cuida
 * dos TEMAS DO USUÁRIO: três slots independentes, cada um com um nome e uma
 * paleta por role de cor, persistidos em `~/.pi/agent/custom-themes.json`.
 *
 * Roles de cor (a paleta completa):
 *   fg, muted, accent, ok, warn, fail, code, tool, link, rule, bg
 *
 * Persistência:
 *   - arquivo em `~/.pi/agent/custom-themes.json` (ou `SELFEOPI_THEMES_JSON`).
 *   - formato: { "slots": [null | { name, colors: {<role>: "#rrggbb"} }, x3 ] }
 *   - escrita atômica (tmp + rename), tolerante a JSON corrompido (devolve 3 nulos).
 *
 * ESM puro, só `node:`, Windows nativo.
 */

import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import process from "node:process";

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

/** Todos os roles de cor reconhecidos. */
export const CUSTOM_ROLES = [
  "fg",
  "muted",
  "accent",
  "ok",
  "warn",
  "fail",
  "code",
  "tool",
  "link",
  "rule",
  "bg",
];

/** Roles do config "geral" (um subconjunto para a UI de ajuste rápido). */
export const GENERAL_ROLES = ["fg", "accent", "ok", "warn", "fail"];

const ROLE_SET = new Set(CUSTOM_ROLES);
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const NUM_SLOTS = 3;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function resolveHome(home) {
  if (typeof home === "string" && home.trim() !== "") return path.resolve(home);
  return path.resolve(process.env.HOME ?? process.env.USERPROFILE ?? os.homedir());
}

function themesFile(home) {
  const override = process.env.SELFEOPI_THEMES_JSON;
  if (typeof override === "string" && override.trim() !== "") {
    return path.resolve(override.trim());
  }
  return path.join(resolveHome(home), ".pi", "agent", "custom-themes.json");
}

/** true quando a string é um hex `#rrggbb` válido. */
function isHex(value) {
  return typeof value === "string" && HEX_RE.test(value);
}

/** Normaliza o slot para inteiro 1..3, ou null. */
function normSlot(slot) {
  const n = Number(slot);
  if (!Number.isInteger(n) || n < 1 || n > NUM_SLOTS) return null;
  return n;
}

/** Três slots vazios (o estado "sem nada salvo"). */
function emptySlots() {
  return [null, null, null];
}

/**
 * Valida um objeto de cores: devolve só as entradas com role conhecido e hex
 * válido. Rejeita (lança) role desconhecida ou hex inválido.
 */
function validateColors(colors) {
  if (colors === null || typeof colors !== "object" || Array.isArray(colors)) {
    throw new TypeError("colors deve ser um objeto { <role>: '#rrggbb' }");
  }
  const out = {};
  for (const [role, value] of Object.entries(colors)) {
    if (!ROLE_SET.has(role)) {
      throw new RangeError(`role de cor desconhecida: ${JSON.stringify(role)}`);
    }
    if (!isHex(value)) {
      throw new RangeError(`cor inválida para "${role}": ${JSON.stringify(value)} (use #rrggbb)`);
    }
    out[role] = value.toLowerCase();
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Leitura                                                             */
/* ------------------------------------------------------------------ */

/**
 * Lê o arquivo bruto e devolve os 3 slots normalizados. Tolerante: qualquer
 * erro (arquivo ausente, JSON corrompido, formato inesperado) vira 3 nulos.
 */
async function readSlots(home) {
  let raw;
  try {
    raw = await readFile(themesFile(home), "utf8");
  } catch {
    return emptySlots();
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    return emptySlots();
  }
  const slots = Array.isArray(doc?.slots) ? doc.slots : [];
  return emptySlots().map((_, i) => {
    const entry = slots[i];
    if (!entry || typeof entry !== "object") return null;
    if (typeof entry.name !== "string" || entry.name.trim() === "") return null;
    const colors =
      entry.colors && typeof entry.colors === "object" && !Array.isArray(entry.colors)
        ? { ...entry.colors }
        : {};
    return { name: entry.name, colors };
  });
}

/**
 * Lista os 3 slots. Sempre devolve 3 itens, em ordem.
 *
 * @param {{ home?: string }} [opts]
 * @returns {Promise<Array<{ slot: number, name: string|null, colors?: object }>>}
 */
export async function listCustomThemes({ home } = {}) {
  const slots = await readSlots(home);
  return slots.map((entry, i) =>
    entry
      ? { slot: i + 1, name: entry.name, colors: entry.colors }
      : { slot: i + 1, name: null },
  );
}

/**
 * Devolve o tema de um slot, ou `null` quando vazio.
 *
 * @param {number} slot 1..3
 * @param {{ home?: string }} [opts]
 * @returns {Promise<{ name: string, colors: object } | null>}
 */
export async function getCustomTheme(slot, { home } = {}) {
  const n = normSlot(slot);
  if (n === null) return null;
  const slots = await readSlots(home);
  return slots[n - 1];
}

/* ------------------------------------------------------------------ */
/* Escrita                                                             */
/* ------------------------------------------------------------------ */

/**
 * Salva (ou atualiza) um slot. `colors` parciais mesclam com o que já existe;
 * valida hex e role. Escrita atômica.
 *
 * @param {number} slot 1..3
 * @param {{ name: string, colors: object }} theme
 * @param {{ home?: string }} [opts]
 * @returns {Promise<{ slot: number, name: string, colors: object }>}
 */
export async function saveCustomTheme(slot, theme, { home } = {}) {
  const n = normSlot(slot);
  if (n === null) {
    throw new RangeError(`slot inválido: ${JSON.stringify(slot)} (use 1, 2 ou 3)`);
  }
  if (!theme || typeof theme !== "object") {
    throw new TypeError("theme deve ser { name, colors }");
  }
  if (typeof theme.name !== "string" || theme.name.trim() === "") {
    throw new RangeError("theme.name vazio");
  }
  const incoming = validateColors(theme.colors ?? {});

  const slots = await readSlots(home);
  const existing = slots[n - 1];
  const merged = existing
    ? { ...existing.colors, ...incoming }
    : { ...incoming };
  const entry = { name: theme.name.trim(), colors: merged };
  slots[n - 1] = entry;

  const file = themesFile(home);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify({ slots }, null, 2)}\n`, "utf8");
  await rename(tmp, file);

  return { slot: n, name: entry.name, colors: entry.colors };
}

/**
 * Zera um slot (remove o tema salvo).
 *
 * @param {number} slot 1..3
 * @param {{ home?: string }} [opts]
 * @returns {Promise<{ slot: number, cleared: true }>}
 */
export async function clearCustomTheme(slot, { home } = {}) {
  const n = normSlot(slot);
  if (n === null) {
    throw new RangeError(`slot inválido: ${JSON.stringify(slot)} (use 1, 2 ou 3)`);
  }
  const slots = await readSlots(home);
  slots[n - 1] = null;

  const file = themesFile(home);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify({ slots }, null, 2)}\n`, "utf8");
  await rename(tmp, file);

  return { slot: n, cleared: true };
}

/* ------------------------------------------------------------------ */
/* mergeColors                                                         */
/* ------------------------------------------------------------------ */

/**
 * Mescla dois objetos de cores (override vence), validando hex e role dos dois.
 * Devolve um novo objeto; não muta as entradas.
 *
 * @param {object} base
 * @param {object} override
 * @returns {object}
 */
export function mergeColors(base, override) {
  const a = validateColors(base ?? {});
  const b = validateColors(override ?? {});
  return { ...a, ...b };
}

export default {
  listCustomThemes,
  getCustomTheme,
  saveCustomTheme,
  clearCustomTheme,
  mergeColors,
  CUSTOM_ROLES,
  GENERAL_ROLES,
};