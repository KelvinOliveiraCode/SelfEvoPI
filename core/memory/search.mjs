#!/usr/bin/env node
/**
 * memory-search — recuperação de capacidades (lexical + semântica).
 *
 * O problema original: a promoção grava o artefato na memória (nível `skills`), mas
 * nada lia aquilo de volta — a capacidade existia e ninguém a encontrava, então o loop
 * gerava de novo a mesma coisa.
 *
 * A busca lexical por termo resolvia o caso literal ("somar" acha "somar dois
 * números"), mas falhava em sinônimos e paráfrases: "calcular IMC" não achava "índice
 * de massa corporal". Este módulo agora combina dois caminhos:
 *
 *   1. **léxico** (rápido, preciso quando o termo é literal) — casa no texto e nas
 *      tags, com peso 3 para tag (sinal curado por alguém);
 *   2. **semântico** (local, determinístico, offline) — embedding por hashing de
 *      n-gramas de caractere com expansão de sinônimos (`embed.mjs`), similaridade
 *      por cosseno.
 *
 * O escore final é o **máximo** entre o escore léxico normalizado e o escore
 * semântico, com um limiar mínimo (`minScore`). Assim, quando o termo é literal a
 * via léxica vence (mais rápida e precisa); quando é paráfrase, a semântica entra e
 * recupera a capacidade. Nada de rede, nada de modelo baixado.
 *
 * `node core/forge/cli.mjs skills [termo]` é a porta de entrada.
 */

import { embed, cosine, semanticSimilarity } from "./embed.mjs";

const STOPWORDS = new Set([
  "a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "ou", "que",
  "um", "uma", "para", "por", "com", "em", "no", "na", "se", "ao", "aos",
  "the", "of", "to", "and", "or", "a", "an", "in", "on", "for", "is", "are",
]);

/** Peso da tag no escore léxico (sinal forte: foi curado por alguém). */
const TAG_WEIGHT = 3;
/** Peso do casamento no texto. */
const TEXT_WEIGHT = 1;
/**
 * Escala que converte similaridade semântica (0..1) na faixa do escore léxico.
 * 2.0 faz um sinônimo "forte" (contenção ~1) pontuar ~2: acima de um casamento
 * literal no texto (1), abaixo de uma tag (3) — preservando a precisão léxica.
 */
const SEMANTIC_SCALE = 2;

/** Quebra texto em termos normalizados (sem acento, minúsculo). */
export function tokenize(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Pontua uma entrada contra os termos da consulta (caminho léxico). */
function scoreEntry(entry, terms) {
  const text = tokenize(entry.text ?? "");
  const tags = tokenize((Array.isArray(entry.tags) ? entry.tags : []).join(" "));
  const textSet = new Set(text);
  const tagSet = new Set(tags);

  let score = 0;
  const casou = [];
  for (const t of terms) {
    if (tagSet.has(t)) {
      score += TAG_WEIGHT;
      casou.push(t);
    } else if (textSet.has(t)) {
      score += TEXT_WEIGHT;
      casou.push(t);
    }
  }

  // cobertura: fração dos termos que casaram (uma entrada que fala de tudo
  // da consulta é melhor que uma que fala só de um pedaço)
  const cobertura = terms.length > 0 ? casou.length / terms.length : 0;
  return { score, cobertura, casou };
}

/**
 * Busca capacidades na memória, combinando caminhos léxico e semântico.
 *
 * @param {object} store  store aberto com openStore
 * @param {string} query  termo ou expressão livre
 * @param {object} [opts]
 * @param {string[]} [opts.levels=["skills","project"]]  onde procurar
 * @param {number} [opts.limit=10]
 * @param {number} [opts.minScore=1]        limiar do escore combinado
 * @param {boolean} [opts.semantic=true]    ligar/desligar o caminho semântico
 * @param {number} [opts.semanticFloor=0.05] piso de cosseno para considerar semântica
 * @returns {{ query, terms, count, results: Array }}
 */
export function searchCapabilities(
  store,
  query,
  { levels = ["skills", "project"], limit = 10, minScore = 1, semantic = true, semanticFloor = 0.05 } = {},
) {
  if (!store || typeof store.query !== "function") {
    throw new Error("memory-search: informe um store válido (openStore)");
  }

  const terms = tokenize(query);
  if (terms.length === 0) {
    return { query: String(query ?? ""), terms: [], count: 0, results: [] };
  }

  // Vetor da consulta (uma vez). `undefined` se a semântica estiver desligada.
  const queryVec = semantic ? embed(query) : null;

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

      const { score: lexScore, cobertura, casou } = scoreEntry(e, terms);

      // Caminho semântico: similaridade robusta (cosseno + contenção + sinônimos).
      let semCos = 0;
      if (queryVec) {
        const entryText = `${e.text ?? ""} ${(Array.isArray(e.tags) ? e.tags : []).join(" ")}`;
        semCos = semanticSimilarity(query, entryText);
      }

      // Escore combinado = max(léxico, semântica escalada). A semântica só conta
      // acima do piso, para não trazer ruído de vetores quase ortogonais.
      const semScore = semCos >= semanticFloor ? semCos * SEMANTIC_SCALE : 0;
      const combined = Math.max(lexScore, semScore);
      if (combined < minScore) continue;

      results.push({
        level,
        id: e.id,
        text: e.text,
        tags: Array.isArray(e.tags) ? e.tags : [],
        at: e.at ?? null,
        score: Number(combined.toFixed(4)),
        lexScore,
        semanticScore: Number(semCos.toFixed(4)),
        via: lexScore >= semScore ? "lexical" : "semantica",
        cobertura: Number(cobertura.toFixed(2)),
        casou: casou.sort(),
      });
    }
  }

  // Ordenação: maior escore combinado, depois cobertura léxica, depois mais recente.
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.cobertura !== a.cobertura) return b.cobertura - a.cobertura;
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