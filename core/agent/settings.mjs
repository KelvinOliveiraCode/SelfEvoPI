/**
 * core/agent/settings.mjs — comando /settings: mostra e altera configuração.
 *
 * Funções puras: recebem estado, devolvem objeto. Sem efeitos colaterais.
 * Zero dependência nova. Determinístico.
 *
 * Interface:
 *   collectSettings({ root })          -> { groups: [{ name, entries: [...] }] }
 *   applySetting({ root, key, value }) -> { ok, value, applied, error? }
 *
 * Segurança:
 *   - Nunca expõe apiKey, token, secret. Mostra "configured" / "não configurado".
 *   - applySetting valida antes de aplicar.
 *   - Configs de áreas protegidas (evals/, core/governance/) são readOnly.
 */

import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import path from "node:path";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Lê JSON de um arquivo, ou null se não existir/inválido. */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Escreve JSON num arquivo (atômico: tmp + rename). */
function writeJson(file, data) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  renameSync(tmp, file);
}

/** Verifica se um caminho está dentro de uma área protegida. */
function isReadOnly(key) {
  const protectedPrefixes = ["evals/", "core/governance/", "core/sandbox/"];
  return protectedPrefixes.some((p) => key.startsWith(p));
}

/** Campos sensíveis que nunca devem ser expostos. */
const SENSITIVE_KEYS = ["apiKey", "api_key", "token", "secret", "password", "credential"];

/** Verifica se uma chave é sensível. */
function isSensitive(key) {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.some((s) => lower.includes(s));
}

/* ------------------------------------------------------------------ */
/* Schemas de configuração                                             */
/* ------------------------------------------------------------------ */

/**
 * Define quais configurações são conhecidas, onde vivem, e como são exibidas.
 * Cada entrada: { key, label, type, options?, hint?, sensitive?, readOnly?, source }
 */
const SETTINGS_SCHEMA = [
  // ── Conversa ──
  {
    key: "conversation.model",
    label: "Modelo",
    type: "string",
    hint: "ID do modelo (ex.: kilo1/nemotron-3-ultra:free)",
    source: "conversation",
  },
  {
    key: "conversation.effort",
    label: "Esforço / raciocínio",
    type: "enum",
    options: ["low", "medium", "high", "max", "auto"],
    hint: "Nível de esforço do modelo",
    source: "conversation",
  },
  {
    key: "conversation.mode",
    label: "Modo",
    type: "enum",
    options: ["plan", "build", "ask"],
    hint: "Modo de operação da conversa",
    source: "conversation",
  },
  {
    key: "conversation.permissionMode",
    label: "Permissão",
    type: "enum",
    options: ["full-access", "auto", "ask"],
    hint: "Como o agente pede confirmação",
    source: "conversation",
  },
  {
    key: "conversation.capabilities",
    label: "Capacidades do modelo",
    type: "readonly-list",
    hint: "Ex.: text, vision",
    source: "conversation",
    readOnly: true,
  },

  // ── Sessão ──
  {
    key: "session.id",
    label: "ID da sessão",
    type: "string",
    source: "session",
    readOnly: true,
  },
  {
    key: "session.turns",
    label: "Turnos",
    type: "number",
    source: "session",
    readOnly: true,
  },
  {
    key: "session.tokens",
    label: "Tokens",
    type: "number",
    source: "session",
    readOnly: true,
  },
  {
    key: "session.costUsd",
    label: "Custo (USD)",
    type: "number",
    source: "session",
    readOnly: true,
  },

  // ── Motor ──
  {
    key: "engine.version",
    label: "Versão do motor",
    type: "string",
    source: "engine",
    readOnly: true,
  },
  {
    key: "engine.tools",
    label: "Ferramentas disponíveis",
    type: "readonly-list",
    source: "engine",
    readOnly: true,
  },

  // ── Harness ──
  {
    key: "harness.baseline",
    label: "Baseline de evals",
    type: "string",
    hint: "Data/versão da baseline",
    source: "harness",
    readOnly: true,
  },
  {
    key: "harness.coldStartMs",
    label: "Cold start (ms)",
    type: "number",
    source: "harness",
    readOnly: true,
  },
  {
    key: "harness.scheduled",
    label: "Agendamento diário",
    type: "enum",
    options: ["active", "inactive"],
    source: "harness",
    readOnly: true,
  },
];

/* ------------------------------------------------------------------ */
/* collectSettings                                                     */
/* ------------------------------------------------------------------ */

/**
 * Coleta o estado atual de todas as configurações.
 *
 * @param {object} opts
 * @param {string} opts.root — raiz do repositório
 * @param {object} [opts.state] — estado da sessão (para campos de sessão)
 * @returns {{ groups: Array<{ name: string, entries: Array<object> }> }}
 */
export function collectSettings(opts = {}) {
  const root = opts.root || process.cwd();
  const state = opts.state || {};

  // Lê configurações de arquivos
  const settingsFile = path.join(root, ".pi", "settings.json");
  const piSettings = readJson(settingsFile) || {};

  const lkgFile = path.join(root, ".pi", "harness", "last-known-good.json");
  const lkg = readJson(lkgFile);

  const baselineFile = path.join(root, "evals", "baseline.json");
  const baseline = readJson(baselineFile);

  // Mapeia valores atuais
  const values = {
    "conversation.model": state.model || piSettings.model || "—",
    "conversation.effort": state.effort || piSettings.effort || "—",
    "conversation.mode": state.mode || piSettings.mode || "—",
    "conversation.permissionMode": state.permissionMode || piSettings.permissionMode || "—",
    "conversation.capabilities": state.capabilities || ["text"],
    "session.id": state.sessionId || "—",
    "session.turns": state.turns ?? 0,
    "session.tokens": state.tokens ?? 0,
    "session.costUsd": state.costUsd ?? "—",
    "engine.version": state.engineVersion || "—",
    "engine.tools": state.tools || [],
    "harness.baseline": baseline?.generatedAt || "—",
    "harness.coldStartMs": lkg?.checks?.find((c) => c.name === "cold-start")?.detail || "—",
    "harness.scheduled": state.scheduled === true ? "active" : "inactive",
  };

  // Agrupa por origem
  const groupNames = {
    conversation: "Conversa",
    session: "Sessão",
    engine: "Motor",
    harness: "Harness",
  };

  const groupsMap = new Map();
  for (const schema of SETTINGS_SCHEMA) {
    const groupKey = schema.source;
    if (!groupsMap.has(groupKey)) {
      groupsMap.set(groupKey, { name: groupNames[groupKey] || groupKey, entries: [] });
    }

    const rawValue = values[schema.key];
    const isSensitiveField = isSensitive(schema.key);
    const readOnly = schema.readOnly || isReadOnly(schema.key);

    let displayValue = rawValue;
    if (isSensitiveField) {
      displayValue = rawValue != null && rawValue !== "—" ? "configurado" : "não configurado";
    }

    const entry = {
      key: schema.key,
      label: schema.label,
      value: displayValue,
      type: schema.type,
    };

    if (schema.options) entry.options = schema.options;
    if (schema.hint) entry.hint = schema.hint;
    if (readOnly) entry.readOnly = true;

    groupsMap.get(groupKey).entries.push(entry);
  }

  return { groups: [...groupsMap.values()] };
}

/* ------------------------------------------------------------------ */
/* applySetting                                                        */
/* ------------------------------------------------------------------ */

/**
 * Aplica uma configuração.
 *
 * @param {object} opts
 * @param {string} opts.root — raiz do repositório
 * @param {string} opts.key — chave da configuração (ex.: "conversation.model")
 * @param {*} opts.value — novo valor
 * @returns {{ ok: boolean, value: *, applied: boolean, error?: string }}
 */
export function applySetting(opts = {}) {
  const { root, key, value } = opts;

  if (!root || !key) {
    return { ok: false, value: null, applied: false, error: "root e key são obrigatórios" };
  }

  // Encontra o schema
  const schema = SETTINGS_SCHEMA.find((s) => s.key === key);
  if (!schema) {
    return { ok: false, value: null, applied: false, error: `configuração desconhecida: "${key}"` };
  }

  // Campo sensível: recusa
  if (isSensitive(key)) {
    return { ok: false, value: null, applied: false, error: `campo sensível: "${key}" não pode ser alterado via /settings` };
  }

  // Campo readOnly: recusa
  if (schema.readOnly || isReadOnly(key)) {
    return { ok: false, value: null, applied: false, error: `"${schema.label}" é somente leitura${isReadOnly(key) ? " (área protegida)" : ""}` };
  }

  // Valida o valor
  if (schema.type === "enum" && schema.options) {
    if (!schema.options.includes(value)) {
      return { ok: false, value: null, applied: false, error: `valor inválido para "${schema.label}": use um de ${schema.options.join(", ")}` };
    }
  }

  if (schema.type === "number") {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return { ok: false, value: null, applied: false, error: `"${schema.label}" espera um número, veio "${value}"` };
    }
  }

  // Persiste em .pi/settings.json
  const settingsFile = path.join(root, ".pi", "settings.json");
  const settings = readJson(settingsFile) || {};
  settings[key] = value;
  writeJson(settingsFile, settings);

  return { ok: true, value, applied: true };
}

/* ------------------------------------------------------------------ */
/* Default export                                                      */
/* ------------------------------------------------------------------ */

export default { collectSettings, applySetting };