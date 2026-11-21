/**
 * core/agent/model-metadata.mjs — metadados locais de modelos/provedores.
 *
 * Lê ~/.pi/agent/models.json sem nunca expor chaves. É a fonte rápida para
 * perguntas que o motor não responde bem: quais níveis de esforço um modelo
 * aceita e se ele aceita imagem. O catálogo do motor continua sendo consultado
 * quando existe sessão; aqui é o fallback honesto e o complemento.
 */

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

function catalogPath() {
  return (
    process.env.PI_MODELS_FILE ||
    path.join(process.env.USERPROFILE || os.homedir(), ".pi", "agent", "models.json")
  );
}

function readCatalog() {
  try {
    const data = JSON.parse(readFileSync(catalogPath(), "utf8"));
    return data && typeof data.providers === "object" && data.providers ? data.providers : {};
  } catch {
    return {};
  }
}

export function findModel(provider, id) {
  const providers = readCatalog();
  const entry = providers[provider];
  if (!entry || !Array.isArray(entry.models)) return null;
  return entry.models.find((m) => m && m.id === id) || null;
}

/**
 * Níveis de esforço que o modelo aceita, derivados de `thinkingLevelMap`.
 * `null` no mapa significa "este nível não existe"; `xhigh`/`max` precisam de
 * mapeamento explícito (regra do próprio motor).
 */
export function effortLevelsFor(provider, id) {
  const model = findModel(provider, id);
  if (!model) return null;
  if (model.reasoning !== true) return ["off"];
  const map = model.thinkingLevelMap || {};
  if (Object.keys(map).length > 0) {
    // Mapa presente = a lista é exatamente o que foi declarado. Níveis sem
    // entrada explícita não são presumidos (o catálogo público preenche todos).
    const declarados = LEVELS.filter((level) => typeof map[level] === "string");
    return declarados.length > 0 ? declarados : ["high"];
  }
  return [...LEVELS];
}

export function supportsImage(provider, id) {
  const model = findModel(provider, id);
  return !!(model && Array.isArray(model.input) && model.input.includes("image"));
}

/** Lista plana, sem chaves, para o seletor de modelos e para diagnóstico. */
export function listModelMetadata() {
  const providers = readCatalog();
  const out = [];
  for (const [provider, entry] of Object.entries(providers)) {
    for (const m of Array.isArray(entry?.models) ? entry.models : []) {
      if (!m || typeof m.id !== "string") continue;
      out.push({
        provider,
        id: m.id,
        name: m.name || m.id,
        reasoning: m.reasoning === true,
        efforts: effortLevelsFor(provider, m.id) || [],
        image: Array.isArray(m.input) && m.input.includes("image"),
      });
    }
  }
  return out;
}

export default { findModel, effortLevelsFor, supportsImage, listModelMetadata };
