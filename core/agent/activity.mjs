#!/usr/bin/env node
/**
 * core/agent/activity.mjs — registro de ATIVIDADE ("o que está rodando")
 * (shells + subagentes) da TUI.
 *
 * Estado em memória no processo (um Map por id). Determinístico: `listActivity`
 * ordena por `startedAt` desc; `registerActivity` faz upsert por id (nunca
 * duplica); `listActivity`/`getActive`/`getActivity` devolvem cópias, então
 * mexer no resultado não afeta o registro.
 *
 * Modelo:
 *   Atividade = { id, kind: "shell"|"subagent", name,
 *                 status: "running"|"stopped"|"crashed"|"done",
 *                 startedAt, endedAt?, meta? }
 *   meta (subagente): { persistent, provider?, model?, effort?, task?, sessionId? }
 *   meta (shell):     { command?, cwd?, pid? }
 *
 * API:
 *   registerActivity(entry)        -> Atividade      (upsert por id)
 *   updateActivity(id, patch)      -> Atividade|null (mescla campos; null se não existir)
 *   unregisterActivity(id)         -> boolean        (remove)
 *   listActivity({ kind?, status? }) -> Atividade[]  (mais recentes primeiro)
 *   getActive()                    -> Atividade[]    (só status "running")
 *   getActivity(id)                -> Atividade|null
 *   clearActivity()                -> void           (limpa tudo; útil no boot)
 *
 * Windows nativo, Node ESM puro, só `node:`.
 */

/** Kinds válidos de atividade. */
export const ACTIVITY_KINDS = Object.freeze(["shell", "subagent"]);

/** Status válidos de atividade. */
export const ACTIVITY_STATUSES = Object.freeze(["running", "stopped", "crashed", "done"]);

const KIND_SET = new Set(ACTIVITY_KINDS);
const STATUS_SET = new Set(ACTIVITY_STATUSES);

/** id -> registro (Map preserva a ordem de inserção; a ordenação é por startedAt). */
const store = new Map();

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Devolve uma cópia rasa (meta também), para o chamador não mutar o registro. */
function clone(rec) {
  const out = { ...rec };
  if (rec.meta && typeof rec.meta === "object") out.meta = { ...rec.meta };
  return out;
}

/** Normaliza startedAt para string ISO (aceita Date, número epoch ou string). */
function normalizeStarted(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string" && value.trim() !== "") return value;
  return new Date().toISOString();
}

/** Instante de um registro para ordenação (ms); 0 quando não parseia. */
function timeOf(rec) {
  const t = Date.parse(rec?.startedAt);
  return Number.isFinite(t) ? t : 0;
}

/** Mescla `entry` sobre `base` (entry vence), normalizando e validando. */
function normalizeEntry(entry, base = null) {
  if (!entry || typeof entry !== "object") throw new Error("activity: entrada inválida");
  const id = String(entry.id ?? "").trim();
  if (id === "") throw new Error("activity: id é obrigatório");

  const kind = entry.kind ?? base?.kind;
  if (!KIND_SET.has(kind)) throw new Error(`activity: kind inválido "${kind}" (use: ${ACTIVITY_KINDS.join(", ")})`);

  const status = entry.status ?? base?.status ?? "running";
  if (!STATUS_SET.has(status)) throw new Error(`activity: status inválido "${status}" (use: ${ACTIVITY_STATUSES.join(", ")})`);

  const startedAt = entry.startedAt !== undefined
    ? normalizeStarted(entry.startedAt)
    : (base?.startedAt ?? normalizeStarted(undefined));

  const name = entry.name ?? base?.name ?? id;

  const meta = entry.meta && typeof entry.meta === "object"
    ? { ...(base?.meta ?? {}), ...entry.meta }
    : (base?.meta ?? {});

  const rec = { id, kind, name, status, startedAt, meta };
  const endedAt = entry.endedAt !== undefined ? entry.endedAt : base?.endedAt;
  if (endedAt !== undefined) rec.endedAt = endedAt;
  return rec;
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Adiciona (ou atualiza, quando o id já existe) uma atividade.
 *
 * @param {object} entry  { id, kind, name?, status?, startedAt?, endedAt?, meta? }
 * @returns {object} o registro gravado (cópia)
 */
export function registerActivity(entry) {
  const key = entry && typeof entry.id === "string" ? entry.id.trim() : "";
  const base = key ? store.get(key) ?? null : null;
  const rec = normalizeEntry(entry, base);
  store.set(rec.id, rec);
  return clone(rec);
}

/**
 * Mescla campos de uma atividade existente. `patch` pode trazer status/meta/etc.
 *
 * @param {string} id
 * @param {object} patch
 * @returns {object|null} o registro atualizado (cópia), ou null se o id não existe
 */
export function updateActivity(id, patch = {}) {
  const key = String(id ?? "").trim();
  const base = store.get(key);
  if (!base) return null;
  const rec = normalizeEntry({ ...patch, id: key }, base);
  store.set(rec.id, rec);
  return clone(rec);
}

/**
 * Remove uma atividade.
 *
 * @param {string} id
 * @returns {boolean} true se removeu, false se não existia
 */
export function unregisterActivity(id) {
  return store.delete(String(id ?? "").trim());
}

/**
 * Lista atividades filtradas, mais recentes primeiro (startedAt desc).
 *
 * @param {object} [opts]
 * @param {string} [opts.kind]    filtra por kind
 * @param {string} [opts.status]  filtra por status
 * @returns {object[]} cópias dos registros (não muta o estado)
 */
export function listActivity({ kind, status } = {}) {
  let rows = [...store.values()];
  if (kind) rows = rows.filter((r) => r.kind === kind);
  if (status) rows = rows.filter((r) => r.status === status);
  rows.sort((a, b) => timeOf(b) - timeOf(a));
  return rows.map(clone);
}

/**
 * Só as atividades em andamento (status "running").
 *
 * @returns {object[]}
 */
export function getActive() {
  return listActivity({ status: "running" });
}

/**
 * Uma atividade por id.
 *
 * @param {string} id
 * @returns {object|null} cópia do registro, ou null
 */
export function getActivity(id) {
  const rec = store.get(String(id ?? "").trim());
  return rec ? clone(rec) : null;
}

/** Limpa todas as atividades (útil no boot). */
export function clearActivity() {
  store.clear();
}

export default {
  registerActivity,
  updateActivity,
  unregisterActivity,
  listActivity,
  getActive,
  getActivity,
  clearActivity,
  ACTIVITY_KINDS,
  ACTIVITY_STATUSES,
};