#!/usr/bin/env node
/**
 * memory-search — recuperação de capacidades em 3 camadas (lexical + PPMI + glossário).
 *
 * O problema original: a promoção grava o artefato na memória (nível `skills`), mas
 * nada lia aquilo de volta — a capacidade existia e ninguém a encontrava, então o loop
 * gerava de novo a mesma coisa.
 *
 * HONESTIDADE SOBRE A TÉCNICA (importante):
 *   Não existe "semântica" mágica aqui. Existem três camadas, e cada uma compra uma
 *   coisa diferente. Os resultados trazem o escore de cada camada separado, para
 *   qualquer um ver quanto cada uma contribui.
 *
 *   CAMADA 1 — LÉXICA: casa termos no texto e nas tags (tag pesa 3×). Rápida e
 *     precisa quando o termo é literal. É o fallback e a coincidência exata.
 *   CAMADA 2 — PPMI (corpus): co-ocorrência termo↔termo aprendida dos textos do
 *     próprio store (`ppmi.mjs`). Sinônimos que aparecem nos mesmos registros ficam
 *     próximos. Local, determinística, melhora com o corpus. Sinal fraco se o corpus
 *     for pequeno.
 *   CAMADA 3 — GLOSSÁRIO (bootstrap): expansão por glossário curado à mão
 *     (`embed.mjs` → `glossarySimilarity`). É tabela de substituição, não
 *     aprendizado; só cobre o que foi escrito.
 *
 * O escore final é uma combinação explícita e documentada:
 *     score = max(lexScore, PPMI_SCALE * ppmi, GLOSSARY_SCALE * glossary)
 * As escalas são calibradas para que o literal vença quando existe, e as camadas
 * semânticas só decidam quando o léxico não casa. `minScore` é o limiar.
 *
 * Nada de rede, nada de modelo baixado. Se este módulo precisar de rede, está errado.
 *
 * `node core/forge/cli.mjs skills [termo]` é a porta de entrada.
 */

import { rawSimilarity, glossarySimilarity, normalize } from "./embed.mjs";
import { buildPpmiModel, ppmiSimilarity } from "./ppmi.mjs";

const STOPWORDS = new Set([
  "a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "ou", "que",
  "um", "uma", "para", "por", "com", "em", "no", "na", "se", "ao", "aos",
  "the", "of", "to", "and", "or", "a", "an", "in", "on", "for", "is", "are",
]);

/** Peso da tag no escore léxico (sinal forte: foi curado por alguém). */
const TAG_WEIGHT = 3;
/** Peso do casamento no texto. */
const TEXT_WEIGHT = 1;
/** Escala da camada PPMI (0..1 → faixa do escore). */
const PPMI_SCALE = 2.5;
/** Escala da camada glossário (0..1 → faixa do escore). */
const GLOSSARY_SCALE = 2.5;

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

  const cobertura = terms.length > 0 ? casou.length / terms.length : 0;
  return { score, cobertura, casou };
}

/**
 * Busca capacidades na memória, combinando as três camadas.
 *
 * @param {object} store  store aberto com openStore
 * @param {string} query  termo ou expressão livre
 * @param {object} [opts]
 * @param {string[]} [opts.levels=["skills","project"]]  onde procurar
 * @param {number} [opts.limit=10]
 * @param {number} [opts.minScore=1]        limiar do escore combinado
 * @param {boolean} [opts.ppmi=true]        ligar/desligar a camada PPMI
 * @param {boolean} [opts.glossary=true]    ligar/desligar a camada glossário
 * @param {object} [opts.ppmiModel]         modelo PPMI pronto; sem ele, é construído
 *                                          a partir dos textos do próprio store
 * @returns {{ query, terms, count, results: Array }}
 */
export function searchCapabilities(
  store,
  query,
  { levels = ["skills", "project"], limit = 10, minScore = 1, ppmi = true, glossary = true, ppmiModel = null } = {},
) {
  if (!store || typeof store.query !== "function") {
    throw new Error("memory-search: informe um store válido (openStore)");
  }

  const terms = tokenize(query);
  if (terms.length === 0) {
    return { query: String(query ?? ""), terms: [], count: 0, results: [] };
  }

  // Coleta as entradas dos níveis uma vez (para pontuar e para o corpus PPMI).
  const collected = [];
  for (const level of levels) {
    let entries;
    try {
      entries = store.query({ level });
    } catch {
      continue; // nível inexistente neste store
    }
    for (const e of entries) {
      if (!e || e.invalid) continue;
      collected.push({ level, entry: e });
    }
  }

  // Modelo PPMI: usa o recebido, ou constrói a partir dos textos do próprio store.
  let model = ppmiModel;
  if (ppmi && !model) {
    const corpus = collected.map(({ entry }) => `${entry.text ?? ""} ${(Array.isArray(entry.tags) ? entry.tags : []).join(" ")}`);
    model = buildPpmiModel(corpus);
  }

  const results = [];
  for (const { level, entry: e } of collected) {
    const { score: lexScore, cobertura, casou } = scoreEntry(e, terms);
    const entryText = `${e.text ?? ""} ${(Array.isArray(e.tags) ? e.tags : []).join(" ")}`;

    const rawSim = rawSimilarity(query, entryText); // camada 1 (forma), informativa
    const ppmiSim = ppmi ? ppmiSimilarity(model, query, entryText) : 0;
    const glossSim = glossary ? glossarySimilarity(query, entryText) : 0;

    const ppmiScore = ppmiSim * PPMI_SCALE;
    const glossScore = glossSim * GLOSSARY_SCALE;
    const combined = Math.max(lexScore, ppmiScore, glossScore);
    if (combined < minScore) continue;

    // Qual camada decidiu o escore (para diagnóstico transparente).
    const via = lexScore >= ppmiScore && lexScore >= glossScore
      ? "lexical"
      : glossScore >= ppmiScore
        ? "glossario"
        : "ppmi";

    results.push({
      level,
      id: e.id,
      text: e.text,
      tags: Array.isArray(e.tags) ? e.tags : [],
      at: e.at ?? null,
      score: Number(combined.toFixed(4)),
      lexScore,
      rawScore: Number(rawSim.toFixed(4)),
      ppmiScore: Number(ppmiSim.toFixed(4)),
      glossaryScore: Number(glossSim.toFixed(4)),
      via,
      cobertura: Number(cobertura.toFixed(2)),
      casou: casou.sort(),
    });
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