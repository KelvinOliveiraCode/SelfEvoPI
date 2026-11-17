#!/usr/bin/env node
/**
 * ppmi.mjs — camada 2 da recuperação: PPMI sobre o corpus da própria memória.
 *
 * Diferente do glossário (camada 3, tabela escrita à mão) e do n-grama cru (camada 1,
 * forma), esta camada **aprende** com os textos que já estão na memória. A ideia é
 * clássica e honesta: se dois termos aparecem nos mesmos registros, eles ficam próximos.
 *
 * Como funciona (100% local, determinístico, zero dependência, zero rede):
 *   1. tokeniza cada entrada do corpus (normaliza, tira stopwords);
 *   2. conta co-ocorrência termo↔termo dentro de cada entrada (janela = a entrada);
 *   3. calcula PPMI = max(0, log2( P(a,b) / (P(a)·P(b)) ));
 *   4. para uma consulta, monta um vetor sobre os termos relacionados (via PPMI) e
 *      compara com cada entrada por cosseno.
 *
 * Ponto fraco honesto: corpus pequeno no início = sinal fraco. É o preço de não baixar
 * modelo. A camada melhora conforme a memória cresce.
 *
 * Nada de `fetch`, nada de modelo baixado, nada de API. Se precisar de rede, está errado.
 */

import { normalize } from "./embed.mjs";

const STOPWORDS = new Set([
  "a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "ou", "que",
  "um", "uma", "para", "por", "com", "em", "no", "na", "se", "ao", "aos",
  "the", "of", "to", "and", "or", "an", "in", "on", "for", "is", "are",
  "artefato", "gerado", "lacuna", "skills", "harness",
]);

/** Tokeniza texto para co-ocorrência (normaliza, tira stopwords). */
export function tokenizeCorpus(text) {
  return normalize(text)
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Constrói o modelo PPMI a partir de um corpus de documentos (strings).
 *
 * @param {string[]} documents  textos do corpus (ex.: entradas do store)
 * @param {{ minCount?: number, window?: number }} [opts]
 * @returns {{ terms: string[], cooc: Map<string, Map<string, number>>, docCount: number, df: Map<string, number> }}
 */
export function buildPpmiModel(documents, { minCount = 1, window = 0 } = {}) {
  const docs = (Array.isArray(documents) ? documents : []).map(tokenizeCorpus).filter((d) => d.length > 0);
  const df = new Map();
  const cooc = new Map(); // termo -> (termo -> contagem)

  const bump = (a, b) => {
    if (!cooc.has(a)) cooc.set(a, new Map());
    const inner = cooc.get(a);
    inner.set(b, (inner.get(b) ?? 0) + 1);
  };

  for (const tokens of docs) {
    const uniq = [...new Set(tokens)];
    for (const t of uniq) df.set(t, (df.get(t) ?? 0) + 1);
    // janela = a própria entrada (window<=0) ou janela deslizante fixa.
    if (window && window > 0) {
      for (let i = 0; i < tokens.length; i++) {
        for (let j = i + 1; j < Math.min(tokens.length, i + window + 1); j++) {
          bump(tokens[i], tokens[j]);
          bump(tokens[j], tokens[i]);
        }
      }
    } else {
      for (let i = 0; i < uniq.length; i++) {
        for (let j = i + 1; j < uniq.length; j++) {
          bump(uniq[i], uniq[j]);
          bump(uniq[j], uniq[i]);
        }
      }
    }
  }

  // PPMI
  const docCount = docs.length;
  const total = docCount || 1;
  const ppmi = new Map();
  for (const [a, inner] of cooc) {
    const pa = (df.get(a) ?? 0) / total;
    const row = new Map();
    for (const [b, c] of inner) {
      if (c < minCount) continue;
      const pb = (df.get(b) ?? 0) / total;
      const pab = c / total;
      if (pa <= 0 || pb <= 0) continue;
      const val = Math.log2(pab / (pa * pb));
      if (val > 0) row.set(b, val);
    }
    if (row.size > 0) ppmi.set(a, row);
  }

  return { terms: [...df.keys()], cooc: ppmi, df, docCount, ppmi: true };
}

/**
 * Expande um termo nos seus vizinhos PPMI (1-hop), com peso = PPMI.
 * @returns {Map<string, number>} termo -> peso
 */
function expandTerm(model, term) {
  const out = new Map();
  const row = model.cooc.get(term);
  if (!row) return out;
  for (const [n, w] of row) out.set(n, w);
  return out;
}

/** Vetor esparso da consulta: soma dos vizinhos PPMI dos seus termos. */
function queryVector(model, query) {
  const terms = tokenizeCorpus(query);
  const vec = new Map();
  for (const t of terms) {
    vec.set(t, (vec.get(t) ?? 0) + 1); // o próprio termo conta
    for (const [n, w] of expandTerm(model, t)) {
      vec.set(n, (vec.get(n) ?? 0) + w);
    }
  }
  return vec;
}

/** Vetor esparso de um documento: seus termos com peso 1. */
function docVector(tokens) {
  const vec = new Map();
  for (const t of tokens) vec.set(t, (vec.get(t) ?? 0) + 1);
  return vec;
}

function cosineSparse(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [, v] of a) na += v * v;
  for (const [, v] of b) nb += v * v;
  if (na === 0 || nb === 0) return 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const [k, v] of small) {
    const w = big.get(k);
    if (w) dot += v * w;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Similaridade PPMI entre uma consulta e um documento, em [0, 1] (cosseno pode dar
 * negativo; normalizamos para 0..1). Só faz sentido se o modelo foi treinado com um
 * corpus que contenha termos relacionados à consulta.
 *
 * @param {ReturnType<typeof buildPpmiModel>} model
 * @param {string} query
 * @param {string} document
 * @returns {number} similaridade em [0, 1]
 */
export function ppmiSimilarity(model, query, document) {
  if (!model || !model.ppmi || model.docCount === 0) return 0;
  const qv = queryVector(model, query);
  const dv = docVector(tokenizeCorpus(document));
  if (qv.size === 0 || dv.size === 0) return 0;
  const cos = cosineSparse(qv, dv);
  return cos > 0 ? cos : 0;
}

/**
 * Similaridade PPMI entre uma consulta e uma **lista de documentos** (busca).
 * Devolve, por índice, a similaridade normalizada.
 *
 * @param {ReturnType<typeof buildPpmiModel>} model
 * @param {string} query
 * @param {string[]} documents
 * @returns {number[]} similaridade por documento, em [0, 1]
 */
export function ppmiRank(model, query, documents) {
  return (Array.isArray(documents) ? documents : []).map((d) => ppmiSimilarity(model, query, d));
}

export default { buildPpmiModel, ppmiSimilarity, ppmiRank, tokenizeCorpus };