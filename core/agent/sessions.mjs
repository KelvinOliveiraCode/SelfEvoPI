/**
 * selfevopi-forge-sessions — listar, carregar, bifurcar e referenciar sessões.
 *
 * Item 1 do gap analysis: sessão é o ativo mais valioso do usuário. Sem isso,
 * fechar o terminal = perder contexto.
 *
 * O motor (PI) guarda sessões em:
 *   ~/.pi/agent/sessions/<cwd-codificado>/<iso>_<uuid>.jsonl
 * Onde a primeira linha é um header { type:"session", id, timestamp, cwd } e as
 * demais são mensagens (uma por linha).
 *
 * Reutiliza `createHarnessStore` de `core/graph/harness-store.mjs` para a
 * linhagem de forks (trilha JSON atômica em <dir>/.forge/lineage).
 *
 * Contrato:
 *   listSessions(dir, { refresh? })            -> [{ id, title, startedAt, updatedAt, turns, tokens, forkedFrom }]
 *   loadSession(dir, id)                       -> { messages, meta }
 *   forkSession(dir, id, name?)                -> novo id
 *   referenceSession({ from, to, note, dir })  -> { ref, tokens }
 *   listReferences({ session, dir })           -> [{ ref, from, note, at, tokens }]
 *   readReference({ session, ref, dir })       -> { messages, meta }
 *   removeReference({ session, ref, dir })     -> { removed }
 */

import { readdir, readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";

import { createHarnessStore } from "../graph/harness-store.mjs";

const HEADER_TYPE = "session";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Faz parse de um JSONL de sessão: { header, messages }. */
export function parseSession(text) {
  const lines = String(text ?? "").split(/\r?\n/).filter((l) => l.trim() !== "");
  let header = null;
  const messages = [];
  for (let i = 0; i < lines.length; i++) {
    let obj;
    try {
      obj = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (i === 0 && obj && obj.type === HEADER_TYPE) {
      header = obj;
      continue;
    }
    messages.push(obj);
  }
  return { header, messages };
}

/** Estimativa de tokens (~4 chars/token). */
export function estimateTokens(messages) {
  let chars = 0;
  for (const m of messages) chars += JSON.stringify(m).length;
  return Math.ceil(chars / 4);
}

function countTurns(messages) {
  return messages.filter((m) => m && m.role === "user").length;
}

function isoForFile(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

/** Acha o arquivo de uma sessão pelo id (header.id ou prefixo do nome). */
async function findSessionFile(dir, id) {
  const files = await readdir(dir).catch(() => []);
  for (const f of files) {
    if (!f.endsWith(".jsonl")) continue;
    const full = join(dir, f);
    const text = await readFile(full, "utf8").catch(() => "");
    const { header } = parseSession(text);
    if (header && header.id === id) return full;
    if (f.replace(/\.jsonl$/, "").includes(id)) return full;
  }
  return null;
}

function lineageStore(dir) {
  return createHarnessStore({ dir: join(dir, ".forge", "lineage") });
}

async function readJson(file, fallback = null) {
  const raw = await readFile(file, "utf8").catch(() => null);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(file, doc) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(doc, null, 2) + "\n", "utf8");
}

/** Assinatura leve da pasta: nomes + mtime dos JSONL (não lê conteúdo). */
async function dirSignature(dir) {
  const files = await readdir(dir).catch(() => []);
  const parts = [];
  for (const f of files) {
    if (!f.endsWith(".jsonl")) continue;
    const st = await stat(join(dir, f)).catch(() => null);
    parts.push(`${f}:${st ? st.mtimeMs || 0 : 0}`);
  }
  parts.sort();
  return parts.join("|");
}

/** Varre a pasta e calcula metadados (caminho lento, usado ao reconstruir). */
async function scanSessions(dir) {
  const files = await readdir(dir).catch(() => []);
  const sessions = [];
  for (const f of files) {
    if (!f.endsWith(".jsonl")) continue;
    const full = join(dir, f);
    const st = await stat(full).catch(() => null);
    const text = await readFile(full, "utf8").catch(() => "");
    const { header, messages } = parseSession(text);
    const id = (header && header.id) || f.replace(/\.jsonl$/, "");
    const startedAt = (header && header.timestamp) || null;
    sessions.push({
      id,
      title: (header && header.title) || null,
      startedAt,
      updatedAt: st && st.mtime ? st.mtime.toISOString() : startedAt,
      turns: countTurns(messages),
      tokens: estimateTokens(messages),
      forkedFrom: (header && header.forkedFrom) || null,
      client: (header && header.client) || null,
    });
  }
  return sessions;
}

function sortSessions(sessions) {
  return sessions.sort((a, b) => {
    const byUpdated = Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0);
    if (byUpdated !== 0) return byUpdated;
    // desempate determinístico: startedAt desc, depois id
    const byStarted = Date.parse(b.startedAt || 0) - Date.parse(a.startedAt || 0);
    if (byStarted !== 0) return byStarted;
    return String(a.id).localeCompare(String(b.id));
  });
}

/* ------------------------------------------------------------------ */
/* API — listar / carregar / bifurcar                                  */
/* ------------------------------------------------------------------ */

/**
 * Lista as sessões (metadados apenas). Usa índice leve quando válido.
 *
 * @param {string} dir  pasta de sessões
 * @param {object} [opts]
 * @param {boolean} [opts.refresh=false]  força varredura (ignora o índice)
 * @returns {Promise<Array<{id,title,startedAt,updatedAt,turns,tokens,forkedFrom}>>}
 */
export async function listSessions(dir, { refresh = false } = {}) {
  const signature = await dirSignature(dir);
  const indexPath = join(dir, ".forge", "sessions-index.json");
  const index = await readJson(indexPath, null);

  if (!refresh && index && index.signature === signature && Array.isArray(index.sessions)) {
    return sortSessions(index.sessions);
  }

  const sessions = await scanSessions(dir);
  await writeJson(indexPath, {
    version: 1,
    signature,
    updatedAt: new Date().toISOString(),
    sessions,
  });
  return sortSessions(sessions);
}

/**
 * Carrega uma sessão pelo id.
 *
 * @param {string} dir
 * @param {string} id
 * @returns {Promise<{ messages: Array, meta: object }>}
 */
export async function loadSession(dir, id) {
  const file = await findSessionFile(dir, id);
  if (!file) {
    return { messages: [], meta: { id, title: null, startedAt: null, turns: 0, tokens: 0, forkedFrom: null, client: null } };
  }
  const text = await readFile(file, "utf8");
  const { header, messages } = parseSession(text);
  return {
    messages,
    meta: {
      id: (header && header.id) || id,
      title: (header && header.title) || null,
      startedAt: (header && header.timestamp) || null,
      turns: countTurns(messages),
      tokens: estimateTokens(messages),
      forkedFrom: (header && header.forkedFrom) || null,
      client: (header && header.client) || null,
    },
  };
}

/**
 * Bifurca uma sessão: nova sessão que aponta para a origem (forkedFrom), com o
 * mesmo histórico. A original não é tocada.
 *
 * @param {string} dir
 * @param {string} id    id da sessão de origem
 * @param {string} [name]
 * @returns {Promise<string>} novo id
 */
export async function forkSession(dir, id, name = null, client = null) {
  const src = await findSessionFile(dir, id);
  if (!src) throw new Error(`sessions: sessão não encontrada: ${id}`);

  const text = await readFile(src, "utf8");
  const { header, messages } = parseSession(text);

  const now = new Date();
  const newId = randomUUID();
  const newHeader = {
    type: HEADER_TYPE,
    version: (header && header.version) || 3,
    id: newId,
    timestamp: now.toISOString(),
    cwd: (header && header.cwd) || process.cwd(),
    forkedFrom: id,
  };
  if (name) newHeader.title = name;
  // `client` identifica a superfície que criou a sessão
  if (client) newHeader.client = client;
  else if (header && header.client) newHeader.client = header.client;

  const lines = [JSON.stringify(newHeader)];
  for (const m of messages) lines.push(JSON.stringify(m));
  const dest = join(dir, `${isoForFile(now)}_${newId}.jsonl`);
  await writeFile(dest, lines.join("\n") + "\n", "utf8");

  const store = lineageStore(dir);
  await store.save(newId, { parentId: id, name: name || null, forkedAt: now.toISOString(), turns: messages.length });

  return newId;
}

/* ------------------------------------------------------------------ */
/* API — referências cruzadas                                          */
/* ------------------------------------------------------------------ */

function refsFile(dir, session) {
  return join(dir, ".forge", "refs", `${session}.json`);
}

async function readRefs(dir, session) {
  const doc = await readJson(refsFile(dir, session), null);
  if (doc && Array.isArray(doc.refs)) return doc.refs;
  return [];
}

async function writeRefs(dir, session, refs) {
  await writeJson(refsFile(dir, session), {
    version: 1,
    session,
    updatedAt: new Date().toISOString(),
    refs,
  });
}

/** Recorte da cauda: até maxMessages mensagens ou maxTokens tokens. */
function sliceTail(messages, { maxMessages = 20, maxTokens = 2000 } = {}) {
  const result = [];
  let tokens = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (result.length >= maxMessages) break;
    const t = estimateTokens([messages[i]]);
    if (tokens + t > maxTokens && result.length > 0) break;
    result.unshift(messages[i]);
    tokens += t;
  }
  return result;
}

/**
 * Cria uma referência da sessão `from` para a sessão `to`: guarda o id de origem
 * + um recorte (não a sessão inteira, para não estourar a janela).
 *
 * @param {object} opts
 * @param {string} opts.from   id da sessão de origem
 * @param {string} opts.to     id da sessão que vai ler a referência
 * @param {string} [opts.dir]  pasta de sessões (default: process.cwd())
 * @param {string} [opts.note] nota/rótulo da citação
 * @param {number} [opts.maxMessages=20]  teto de mensagens do recorte
 * @param {number} [opts.maxTokens=2000]  teto de tokens do recorte
 * @returns {Promise<{ ref: string, tokens: number }>}
 */
export async function referenceSession({ from, to, note = null, dir = null, maxMessages = 20, maxTokens = 2000 } = {}) {
  if (!from || !to) throw new Error("sessions: referenceSession exige { from, to }");
  const d = dir || process.cwd();

  const src = await findSessionFile(d, from);
  if (!src) throw new Error(`sessions: sessão de origem não encontrada: ${from}`);

  const { messages } = parseSession(await readFile(src, "utf8"));
  const slice = sliceTail(messages, { maxMessages, maxTokens });
  const tokens = estimateTokens(slice);
  const ref = randomUUID();
  const at = new Date().toISOString();

  const refs = await readRefs(d, to);
  refs.push({ ref, from, note, at, tokens, messages: slice });
  await writeRefs(d, to, refs);

  return { ref, tokens };
}

/**
 * Lista as referências de uma sessão (metadados apenas).
 * @returns {Promise<Array<{ ref, from, note, at, tokens }>>}
 */
export async function listReferences({ session, dir = null } = {}) {
  if (!session) throw new Error("sessions: listReferences exige { session }");
  const refs = await readRefs(dir || process.cwd(), session);
  return refs.map(({ ref, from, note, at, tokens }) => ({ ref, from, note, at, tokens }));
}

/**
 * Lê o conteúdo de uma referência (o recorte guardado).
 * @returns {Promise<{ messages, meta }>}
 */
export async function readReference({ session, ref, dir = null } = {}) {
  if (!session || !ref) throw new Error("sessions: readReference exige { session, ref }");
  const refs = await readRefs(dir || process.cwd(), session);
  const found = refs.find((r) => r.ref === ref);
  if (!found) return { messages: [], meta: { ref, from: null, note: null, at: null, tokens: 0 } };
  return {
    messages: Array.isArray(found.messages) ? found.messages : [],
    meta: { ref: found.ref, from: found.from, note: found.note, at: found.at, tokens: found.tokens },
  };
}

/**
 * Remove uma referência.
 * @returns {Promise<{ removed: boolean }>}
 */
export async function removeReference({ session, ref, dir = null } = {}) {
  if (!session || !ref) throw new Error("sessions: removeReference exige { session, ref }");
  const d = dir || process.cwd();
  const refs = await readRefs(d, session);
  const before = refs.length;
  const kept = refs.filter((r) => r.ref !== ref);
  if (kept.length === before) return { removed: false };
  await writeRefs(d, session, kept);
  return { removed: true };
}

export default {
  listSessions,
  loadSession,
  forkSession,
  parseSession,
  estimateTokens,
  referenceSession,
  listReferences,
  readReference,
  removeReference,
};