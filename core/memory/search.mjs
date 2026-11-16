#!/usr/bin/env node
/**
 * memory-search — recuperação de capacidades por termo.
 *
 * O problema: a promoção grava o artefato na memória (nível `skills`), mas nada
 * lia aquilo de volta. A capacidade existia e ninguém a encontrava — então o loop
 * gerava de novo a mesma coisa.
 *
 * O que este módulo faz é simples e honesto: busca por **termo** (não por
 * semântica — não há embeddings aqui). Casa no texto da entrada e nas tags, e
 * pontua por frequência e cobertura. É o suficiente para responder
 * "existe alguma coisa que soma dois números?" sem carregar nada no prompt.
 *
 * `node core/forge/cli.mjs skills [termo]` é a porta de entrada.
 */

const STOPWORDS = new Set([
  "a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "ou", "que",
  "um", "uma", "para", "por", "com", "em", "no", "na", "se", "ao", "aos",
  "the", "of", "to", "and", "or", "a", "an", "in", "on", "for", "is", "are",
]);

/** Quebra texto em termos normalizados (sem acento, minúsculo). */
export function tokenize(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Pontua uma entrada contra os termos da consulta. */
function scoreEntry(entry, terms) {
  const text = tokenize(entry.text ?? "");
  const tags = tokenize((Array.isArray(entry.tags) ? entry.tags : []).join(" "));
  const textSet = new Set(text);
  const tagSet = new Set(tags);

  let score = 0;
  const casou = [];
  for (const t of terms) {
    if (tagSet.has(t)) {
      score += 3; // tag é sinal forte: foi curado por alguém
      casou.push(t);
    } else if (textSet.has(t)) {
      score += 1;
      casou.push(t);
    }
  }

  // cobertura: fração dos termos que casaram (uma entrada que fala de tudo
  // da consulta é melhor que uma que fala só de um pedaço)
  const cobertura = terms.length > 0 ? casou.length / terms.length : 0;
  return { score, cobertura, casou };
}

/**
 * Busca capacidades na memória.
 *
 * @param {object} store  store aberto com openStore
 * @param {string} query  termo ou expressão livre
 * @param {object} [opts]
 * @param {string[]} [opts.levels=["skills","project"]]  onde procurar
 * @param {number} [opts.limit=10]
 * @param {number} [opts.minScore=1]
 * @returns {{ query, terms, count, results: Array }}
 */
export function searchCapabilities(store, query, { levels = ["skills", "project"], limit = 10, minScore = 1 } = {}) {
  if (!store || typeof store.query !== "function") {
    throw new Error("memory-search: informe um store válido (openStore)");
  }

  const terms = tokenize(query);
  if (terms.length === 0) {
    return { query: String(query ?? ""), terms: [], count: 0, results: [] };
  }

  const results = [];
  for (const level of levels) {
    let entries;
    try {
      entries = store.query({ level });
    } catch {
      continue; // nível inexistente neste store
    }
    for (const e of entries) {
      if (!e || e.invalid) continue;
      const { score, cobertura, casou } = scoreEntry(e, terms);
      if (score < minScore) continue;
      results.push({
        level,
        id: e.id,
        text: e.text,
        tags: Array.isArray(e.tags) ? e.tags : [],
        at: e.at ?? null,
        score,
        cobertura: Number(cobertura.toFixed(2)),
        casou: casou.sort(),
      });
    }
  }

  // mais termos casados, depois mais pontos, depois mais recente
  results.sort((a, b) => {
    if (b.cobertura !== a.cobertura) return b.cobertura - a.cobertura;
    if (b.score !== a.score) return b.score - a.score;
    return String(b.at ?? "").localeCompare(String(a.at ?? ""));
  });

  return {
    query: String(query ?? ""),
    terms,
    count: results.length,
    results: results.slice(0, Math.max(1, limit)),
  };
}

export default { searchCapabilities, tokenize };