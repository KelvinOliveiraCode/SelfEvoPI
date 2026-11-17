/**
 * selfevopi-forge-sessions — listar, carregar e bifurcar sessões (Fase 2).
 *
 * Item 1 do gap analysis: sessão é o ativo mais valioso do usuário. Sem isso,
 * fechar o terminal = perder contexto.
 *
 * O motor (PI) guarda sessões em:
 *   ~/.pi/agent/sessions/<cwd-codificado>/<iso>_<uuid>.jsonl
 * Onde a primeira linha é um header { type:"session", id, timestamp, cwd } e as
 * demais são mensagens (uma por linha).
 *
 * Este módulo lê daí quando `dir` aponta para a pasta de sessões. A listagem
 * devolve APENAS metadados (não copia sessão gigante).
 *
 * Reutiliza `createHarnessStore` de `core/graph/harness-store.mjs` para a
 * linhagem de forks (uma trilha JSON atômica em `<dir>/.forge/lineage`), sem
 * reinventar persistência.
 *
 * Contrato:
 *   listSessions(dir)           -> [{ id, title, startedAt, updatedAt, turns, tokens }]
 *   loadSession(dir, id)        -> { messages, meta }
 *   forkSession(dir, id, name)  -> novo id
 */

import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
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

/** Estimativa de tokens do histórico (~4 chars/token). */
function estimateTokens(messages) {
  let chars = 0;
  for (const m of messages) chars += JSON.stringify(m).length;
  return Math.ceil(chars / 4);
}

function countTurns(messages) {
  return messages.filter((m) => m && m.role === "user").length;
}

/** Nome de arquivo seguro a partir do timestamp ISO. */
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

/** Store de linhagem (força subpasta dedicada, não polui a pasta de sessões). */
function lineageStore(dir) {
  return createHarnessStore({ dir: join(dir, ".forge", "lineage") });
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Lista as sessões de uma pasta (metadados apenas).
 *
 * @param {string} dir  pasta de sessões
 * @returns {Promise<Array<{id,title,startedAt,updatedAt,turns,tokens}>>}
 */
export async function listSessions(dir) {
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
    });
  }

  // Mais recentes primeiro (metadados, nunca o conteúdo).
  sessions.sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
  return sessions;
}

/**
 * Carrega uma sessão pelo id.
 *
 * @param {string} dir  pasta de sessões
 * @param {string} id   id da sessão (header.id ou prefixo do arquivo)
 * @returns {Promise<{ messages: Array, meta: object }>}
 */
export async function loadSession(dir, id) {
  const file = await findSessionFile(dir, id);
  if (!file) {
    return { messages: [], meta: { id, title: null, startedAt: null, turns: 0, tokens: 0 } };
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
    },
  };
}

/**
 * Bifurca uma sessão: copia o histórico para um novo id e registra a linhagem.
 *
 * @param {string} dir   pasta de sessões
 * @param {string} id    id da sessão de origem
 * @param {string} [name] nome/rótulo da bifurcação
 * @returns {Promise<string>} novo id
 */
export async function forkSession(dir, id, name = null) {
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

  const lines = [JSON.stringify(newHeader)];
  for (const m of messages) lines.push(JSON.stringify(m));
  const dest = join(dir, `${isoForFile(now)}_${newId}.jsonl`);
  await writeFile(dest, lines.join("\n") + "\n", "utf8");

  // Linhagem: quem nasceu de quem (reutiliza harness-store, escrita atômica).
  const store = lineageStore(dir);
  await store.save(newId, { parentId: id, name: name || null, forkedAt: now.toISOString(), turns: messages.length });

  return newId;
}

export default { listSessions, loadSession, forkSession, parseSession };