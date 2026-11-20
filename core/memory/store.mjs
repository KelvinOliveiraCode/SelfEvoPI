/**
 * selfevopi-memory — camada de memória em 3 níveis do SelfEvoPI.
 *
 * Sem dependências externas. Node puro (ESM).
 *
 * Níveis (do mais efêmero ao mais durável):
 *  - session: memória do agente em curso. Efêmera, vive no diretório da sessão.
 *  - project: fatos, decisões e convenções que sobrevivem a sessões (`.pi/harness/`).
 *  - skills:  capacidades promovidas, executáveis e indexadas.
 *
 * Formato de entrada (JSONL, append-only):
 *  { id, at, text, tags, source }
 *
 * Layout em disco (raiz = diretório de memória):
 *  <root>/session.jsonl
 *  <root>/project.jsonl
 *  <root>/skills.jsonl
 *
 * Cada linha é um objeto JSON válido. O id é estável e único dentro do store.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const LEVELS = Object.freeze(["session", "project", "skills"]);

const FILE_BY_LEVEL = {
  session: "session.jsonl",
  project: "project.jsonl",
  skills: "skills.jsonl",
};

function levelPath(root, level) {
  return join(root, FILE_BY_LEVEL[level]);
}

/** Lê as entradas de um nível do disco. Arquivo ausente = sem entradas. */
function readLevel(root, level) {
  const file = levelPath(root, level);
  if (!existsSync(file)) return [];
  const raw = readFileSync(file, "utf8");
  if (raw.trim() === "") return [];
  return raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch {
        // Linha corrompida não derruba o store: marca como inválida para auditoria.
        return { id: null, at: null, text: `[linha ${i} inválida]`, tags: [], source: "memory", invalid: true };
      }
    });
}

/**
 * Abre (ou cria) um store de memória no diretório `root`.
 *
 * @param {{ root: string }} opts
 */
export function openStore({ root } = {}) {
  if (!root || typeof root !== "string") {
    throw new Error("memory: informe o diretório raiz (root)");
  }
  mkdirSync(root, { recursive: true });

  /** Carrega um nível do disco (fonte de verdade para leitura). */
  const load = (level) => readLevel(root, level);

  return {
    /** Diretório raiz do store. */
    root,

    /**
     * Anexa uma entrada ao nível. Append-only.
     * @param {"session"|"project"|"skills"} level
     * @param {{ id?: string, at?: string, text: string, tags?: string[], source?: string }} entry
     * @returns {object} a entrada gravada (com id e at preenchidos)
     */
    append(level, entry) {
      assertLevel(level);
      if (!entry || typeof entry.text !== "string" || entry.text.trim() === "") {
        throw new Error("memory: entrada precisa de texto não vazio");
      }
      const record = {
        id: entry.id ?? randomUUID(),
        at: entry.at ?? new Date().toISOString(),
        text: entry.text,
        tags: Array.isArray(entry.tags) ? entry.tags.map(String) : [],
        source: entry.source ?? "agent",
      };
      const line = JSON.stringify(record) + "\n";
      // Append-only: acrescenta ao final do arquivo do nível.
      writeFileSync(levelPath(root, level), line, { encoding: "utf8", flag: "a" });
      return record;
    },

    /**
     * Busca entradas de um nível, das mais recentes para as mais antigas.
     * Filtros combinam com AND: `tag` (a entrada tem a tag) e `text` (case-insensitive,
     * substring). Sem filtros, devolve tudo.
     *
     * `includeInvalid: true` devolve também as linhas corrompidas do JSONL — é o que
     * a manutenção (refine) precisa para propor a remoção delas. Por padrão ficam fora.
     *
     * @param {{ level: "session"|"project"|"skills", tag?: string, text?: string, limit?: number, includeInvalid?: boolean }} query
     */
    query({ level, tag = null, text = null, limit = null, includeInvalid = false } = {}) {
      assertLevel(level);
      const needle = typeof text === "string" ? text.toLowerCase() : null;
      let rows = load(level).filter((e) => {
        if (e.invalid && !includeInvalid) return false;
        if (tag && !(Array.isArray(e.tags) && e.tags.includes(tag))) return false;
        if (needle && !String(e.text).toLowerCase().includes(needle)) return false;
        return true;
      });
      // Mais recentes primeiro (o `at` é ISO-8601, ordenável lexicograficamente).
      rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
      // `limit > 0` é teto; 0 ou ausente = sem teto. Antes, `limit: 0` caía em
    // `slice(0, 0)` e devolvia vazio — surpreendia quem usava 0 como "sem limite".
    if (typeof limit === "number" && limit > 0) rows = rows.slice(0, limit);
      return rows;
    },

    /**
     * Move uma entrada de um nível para outro. Append-only na prática: a entrada é
     * removida do nível de origem e regravada no destino preservando id e at.
     * @param {string} entryId
     * @param {"session"|"project"|"skills"} fromLevel
     * @param {"session"|"project"|"skills"} toLevel
     * @returns {object|null} a entrada promovida, ou null se não existir na origem
     */
    promote(entryId, fromLevel, toLevel) {
      assertLevel(fromLevel);
      assertLevel(toLevel);
      const source = load(fromLevel);
      const dest = load(toLevel);
      const index = source.findIndex((e) => !e.invalid && e.id === entryId);
      if (index === -1) return null;
      if (dest.some((e) => !e.invalid && e.id === entryId)) {
        throw new Error(`memory: id ${entryId} já existe em ${toLevel}`);
      }
      const [entry] = source.splice(index, 1);
      dest.push(entry);
      // Regrava origem (sem a entrada) e destino (com ela).
      writeFileSync(levelPath(root, fromLevel), serialize(source), "utf8");
      writeFileSync(levelPath(root, toLevel), serialize(dest), "utf8");
      return entry;
    },

    /** Contagem de entradas por nível. */
    stats() {
      const out = {};
      for (const level of LEVELS) out[level] = load(level).filter((e) => !e.invalid).length;
      return out;
    },
  };
}

/** Serializa um array de entradas como JSONL (uma por linha). */
function serialize(entries) {
  if (entries.length === 0) return "";
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

function assertLevel(level) {
  if (!LEVELS.includes(level)) {
    throw new Error(`memory: nível inválido "${level}" (use: ${LEVELS.join(", ")})`);
  }
}

export default { openStore, LEVELS };