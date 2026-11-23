/**
 * core/router/cooldown-store.mjs — persistência local do cooldown de modelos.
 *
 * Guarda só pares `ref -> timestamp` num JSON pequeno. Nenhuma chave, token,
 * comando ou caminho de usuário entra no arquivo. Toda função é best-effort:
 * disco cheio, JSON corrompido ou arquivo ausente nunca derrubam o turno.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const COOLDOWN_FILE = "model-cooldown.json";

function seguro(ref) {
  return (
    typeof ref === "string" &&
    ref.length > 0 &&
    ref.length <= 200 &&
    !/[\r\n]/.test(ref) &&
    !/(api[_-]?key|token|secret|password|authorization)/i.test(ref)
  );
}

/** Normaliza entradas lidas do disco: só refs válidos e timestamps no futuro próximo. */
export function normalizarEntradas(obj, { now = Date.now(), maxIdadeMs = 86_400_000 } = {}) {
  const out = new Map();
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
  const bruto = obj.refs && typeof obj.refs === "object" && !Array.isArray(obj.refs) ? obj.refs : obj;
  for (const [ref, valor] of Object.entries(bruto)) {
    if (!seguro(ref)) continue;
    const t = Number(valor);
    if (!Number.isFinite(t) || t <= 0) continue;
    if (now - t > maxIdadeMs) continue; // entrada velha demais: descarta
    out.set(ref, t);
  }
  return out;
}

/** Lê o arquivo. Nunca lança; devolve Map vazio no erro. */
export async function readCooldown(file, opts = {}) {
  try {
    const texto = await readFile(file, "utf8");
    return normalizarEntradas(JSON.parse(texto), opts);
  } catch {
    return new Map();
  }
}

/** Grava o Map. Cria o diretório. Nunca lança. */
export async function writeCooldown(file, mapa, { now = Date.now(), maxIdadeMs = 86_400_000 } = {}) {
  try {
    const refs = {};
    for (const [ref, t] of mapa instanceof Map ? mapa : Object.entries(mapa || {})) {
      if (!seguro(ref) || !Number.isFinite(Number(t))) continue;
      if (now - Number(t) > maxIdadeMs) continue;
      refs[ref] = Number(t);
    }
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ version: 1, refs }, null, 2) + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

export default { COOLDOWN_FILE, normalizarEntradas, readCooldown, writeCooldown };
