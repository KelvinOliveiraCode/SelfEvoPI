/**
 * selfevopi-refine — `/refine` baseado em regras do SelfEvoPI (v1, sem modelo).
 *
 * Determinístico, sem rede, sem LLM. Analisa entradas do nível `project` e propõe
 * *deltas* estruturados; `applyDeltas` aplica apenas os deltas seguros (dedupe/drop),
 * removendo entradas do nível via reescrita do JSONL.
 *
 * Operações:
 *  - dedupe      : mesmo texto normalizado aparece mais de uma vez → manter 1, remover as demais
 *  - drop        : entrada vazia / curta demais / corrompida → remover
 *  - merge-tags  : tags que são variantes da mesma forma normalizada → unificar (advisory)
 *  - keep        : texto com cara de decisão ("sempre", "nunca", "deve") → preservar (advisory)
 *
 * Os deltas `merge-tags` e `keep` são informativos: esta versão não os aplica na store,
 * apenas os relata. A versão com modelo poderá usar essa informação para decidir.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FILE_BY_LEVEL = {
  session: "session.jsonl",
  project: "project.jsonl",
  skills: "skills.jsonl",
};

/** Conteúdo mínimo (já normalizado) para uma entrada ser considerada substantiva. */
const MIN_TEXT_LENGTH = 3;

/** Palavras que sinalizam uma decisão / regra durável. */
const DECISION_WORDS = ["sempre", "nunca", "deve", "deve ser", "obrigatorio", "proibido"];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Normaliza texto para comparação: minúsculas, espaços colapsados, sem pontuação redundante. */
export function normalizeText(text) {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Normaliza uma tag para comparação (minúsculas, espaços, hífens). */
export function normalizeTag(tag) {
  return String(tag ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function levelFile(root, level) {
  const name = FILE_BY_LEVEL[level];
  if (!name) throw new Error(`refine: nível inválido "${level}"`);
  return join(root, name);
}

/** Lê todas as entradas de um nível do disco (inclui inválidas). */
function readLevel(root, level) {
  const file = levelFile(root, level);
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
        return { id: null, at: null, text: `[linha ${i} inválida]`, tags: [], source: "refine", invalid: true };
      }
    });
}

function serialize(entries) {
  if (entries.length === 0) return "";
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

/** A entrada aparenta ser uma decisão / regra durável? */
function looksLikeDecision(text) {
  const t = normalizeText(text);
  return DECISION_WORDS.some((word) => t.includes(word));
}

/* ------------------------------------------------------------------ */
/* Proposta de deltas                                                  */
/* ------------------------------------------------------------------ */

/**
 * Analisa entradas (do nível `project`) e propõe deltas estruturados.
 *
 * @param {{ entries: object[], limit?: number }} opts
 * @returns {Array<object>} deltas ordenados de forma determinística
 */
export function proposeDeltas({ entries, limit = null } = {}) {
  if (!Array.isArray(entries)) throw new Error("refine: `entries` precisa ser um array");

  const deltas = [];
  const seen = new Map(); // normalizedText -> [ids]

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;

    // 1) Entradas corrompidas ou sem conteúdo → drop
    // Linha inválida não tem id; o applyDeltas poda todas as inválidas quando
    // encontra um drop sem id (ver refine.mjs).
    if (entry.invalid || entry.id === null || entry.id === undefined) {
      deltas.push({
        op: "drop",
        id: entry.id ?? null,
        reason: "entrada corrompida (JSONL inválido)",
      });
      continue;
    }

    const norm = normalizeText(entry.text);

    // 2) Entrada vazia / curta demais → drop
    if (norm.length < MIN_TEXT_LENGTH) {
      deltas.push({
        op: "drop",
        id: entry.id,
        reason: `conteúdo insuficiente (${JSON.stringify(String(entry.text ?? "").trim())})`,
      });
      continue;
    }

    // 3) Texto com cara de decisão → keep (advisory)
    if (looksLikeDecision(entry.text)) {
      deltas.push({
        op: "keep",
        id: entry.id,
        reason: "texto com marcador de decisão (sempre/nunca/deve/…)",
      });
    }

    // 4) Agrupar duplicatas por texto normalizado
    if (!seen.has(norm)) seen.set(norm, []);
    seen.get(norm).push(entry.id);
  }

  // Emite dedupe para grupos com mais de uma entrada.
  for (const [norm, ids] of seen) {
    if (ids.length < 2) continue;
    // Mantém a mais recente (mesmo critério do store.query): o texto foi reafirmado por último.
    const withTime = ids
      .map((id) => entries.find((e) => e.id === id))
      .filter(Boolean)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const kept = withTime[0].id;
    const duplicates = ids.filter((id) => id !== kept);
    deltas.push({
      op: "dedupe",
      ids: duplicates,
      kept,
      reason: `texto normalizado repetido (${JSON.stringify(norm.slice(0, 60))})`,
    });
  }

  // 5) Tags variantes da mesma forma normalizada → merge-tags (advisory)
  const tagGroups = new Map(); // normalizedTag -> { display: Map(rawTag -> count), ids: Set }
  for (const entry of entries) {
    if (!entry || entry.invalid || !Array.isArray(entry.tags)) continue;
    for (const raw of entry.tags) {
      const norm = normalizeTag(raw);
      if (!norm) continue;
      if (!tagGroups.has(norm)) tagGroups.set(norm, { counts: new Map(), ids: new Set() });
      const g = tagGroups.get(norm);
      g.counts.set(raw, (g.counts.get(raw) ?? 0) + 1);
      g.ids.add(entry.id);
    }
  }
  for (const [norm, g] of tagGroups) {
    if (g.counts.size < 2) continue;
    // Canônica = a forma normalizada da tag (minúsculas, sem espaços/hífens redundantes).
    const to = norm;
    for (const from of g.counts.keys()) {
      if (from === to) continue;
      deltas.push({ op: "merge-tags", from, to, ids: [...g.ids], reason: "tag variante normalizada" });
    }
  }

  // Ordenação determinística: drop → dedupe → keep → merge-tags; depois por id/texto.
  const order = { drop: 0, dedupe: 1, keep: 2, "merge-tags": 3 };
  deltas.sort((a, b) => {
    const oa = order[a.op] ?? 9;
    const ob = order[b.op] ?? 9;
    if (oa !== ob) return oa - ob;
    return String(a.id ?? a.ids ?? a.from ?? "").localeCompare(String(b.id ?? b.ids ?? b.from ?? ""));
  });

  return typeof limit === "number" && limit >= 0 ? deltas.slice(0, limit) : deltas;
}

/* ------------------------------------------------------------------ */
/* Aplicação de deltas                                                 */
/* ------------------------------------------------------------------ */

/**
 * Aplica deltas seguros (`dedupe` e `drop`) ao store, removendo entradas do nível
 * via reescrita do JSONL. `merge-tags` e `keep` são apenas relatados (advisory).
 *
 * Idempotente: rodar de novo não remove nada (as entradas já saíram).
 *
 * @param {{ root: string }} store instância de openStore
 * @param {Array<object>} deltas
 * @param {{ level?: "session"|"project"|"skills" }} opts
 * @returns {{ level, applied: object[], removed: number, advisory: object[] }}
 */
export function applyDeltas(store, deltas, { level = "project" } = {}) {
  if (!store || typeof store.root !== "string") {
    throw new Error("refine: informe um store válido (openStore)");
  }
  if (!Array.isArray(deltas)) throw new Error("refine: `deltas` precisa ser um array");

  const idsToRemove = new Set();
  let pruneInvalid = false;
  const applied = [];
  const advisory = [];

  for (const delta of deltas) {
    if (delta.op === "drop") {
      if (delta.id !== null && delta.id !== undefined) {
        idsToRemove.add(delta.id);
      } else {
        // Sem id: é linha corrompida de JSONL. Não dá para removê-la por id nem
        // por índice (o índice vem de uma lista ordenada, não do arquivo), então
        // podamos todas as entradas inválidas — são inparseáveis por definição.
        pruneInvalid = true;
      }
      applied.push(delta);
    } else if (delta.op === "dedupe") {
      const list = Array.isArray(delta.ids) ? delta.ids : [];
      for (const id of list) if (id !== delta.kept) idsToRemove.add(id);
      applied.push(delta);
    } else {
      // merge-tags / keep: não aplicados nesta versão
      advisory.push(delta);
    }
  }

  let removed = 0;
  if (idsToRemove.size > 0 || pruneInvalid) {
    const file = levelFile(store.root, level);
    if (existsSync(file)) {
      const entries = readLevel(store.root, level);
      const kept = entries.filter(
        (e) => !pruneInvalid || !e.invalid
      ).filter(
        (e) => !(e.id !== null && e.id !== undefined && idsToRemove.has(e.id))
      );
      removed = entries.length - kept.length;
      writeFileSync(file, serialize(kept), "utf8");
    }
  }

  return { level, applied, removed, advisory };
}

export default { proposeDeltas, applyDeltas, normalizeText, normalizeTag };