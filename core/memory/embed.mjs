#!/usr/bin/env node
/**
 * embed.mjs — embedding local, determinístico, sem dependência e sem rede.
 *
 * O problema: a busca lexical não liga "calcular IMC" a "índice de massa corporal",
 * porque as palavras não coincidem. Este módulo dá ao harness uma noção local de
 * "são parecidos" sem baixar modelo, sem chamar API, sem tocar na rede.
 *
 * Como funciona (100% offline):
 *   1. normaliza o texto (minúsculo, sem acento) e **expande sinônimos** de um
 *      glossário local — assim "imc" e "índice de massa corporal" caem no mesmo
 *      token canônico antes de virar vetor;
 *   2. extrai n-gramas de caractere (3–5) do texto normalizado;
 *   3. aplica *feature hashing* (FNV-1a) em `dims` dimensões (padrão 256);
 *   4. normaliza o vetor em L2 (norma 1).
 *
 * A similaridade entre dois textos é o cosseno dos seus vetores (produto interno,
 * já que ambos têm norma 1). Determinístico: o mesmo texto sempre gera o mesmo vetor.
 *
 * Nada de `fetch`, nada de modelo baixado, nada de API. Se este arquivo precisar de
 * rede, ele está errado.
 */

/** Dimensão padrão do vetor (potência de dois facilita o hashing). */
export const DEFAULT_DIMS = 256;

/** Tamanhos de n-grama de caractere usados. */
export const NGRAM_SIZES = Object.freeze([3, 4, 5]);

/**
 * Glossário de sinônimos: cada grupo tem um **canônico** e suas variantes.
 * A expansão é determinística e local — é o que permite ligar "imc" a
 * "índice de massa corporal" sem modelo. Mantenha os canônicos curtos e estáveis.
 */
export const SYNONYM_GROUPS = Object.freeze([
  { canonical: "imc", variants: ["imc", "indice de massa corporal", "indice de massa", "massa corporal"] },
  { canonical: "configuracao", variants: ["configuracao", "arquivo de configuracao", "config", "settings", "setting", "preferencias", "preferences"] },
  { canonical: "servidor", variants: ["servidor", "server", "servidor web", "http server", "daemon"] },
  { canonical: "iniciar", variants: ["iniciar", "subir", "start", "startar", "rodar", "executar", "launch", "subir servidor"] },
  { canonical: "arquivo", variants: ["arquivo", "file", "fichero", "arquivo de configuracao"] },
  { canonical: "validar", variants: ["validar", "validacao", "validate", "verificar", "checar", "check", "validar entrada"] },
  { canonical: "schema", variants: ["schema", "esquema", "contrato"] },
  { canonical: "numero", variants: ["numero", "number", "valor", "numeros"] },
  { canonical: "parser", variants: ["parser", "parse", "analisador", "interpretador"] },
  { canonical: "documento", variants: ["documento", "document", "doc", "documentacao"] },
  { canonical: "criptografia", variants: ["criptografia", "cifrar", "cifra", "criptografar", "encriptar", "criptografar mensagem", "cifrar mensagem", "aes", "simetrica"] },
  { canonical: "pdf", variants: ["pdf", "documento pdf", "relatorio pdf", "formato pdf"] },
  { canonical: "somar", variants: ["somar", "soma", "somar dois numeros", "adicao", "adicionar"] },
  { canonical: "subtrair", variants: ["subtrair", "subtracao", "diferenca"] },
]);

/** Normaliza texto base: minúsculo, sem acento, espaços colapsados. */
export function normalize(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Substitui uma frase inteira (delimitada por espaços) por um sinônimo canônico. */
function replacePhrase(haystack, phrase, canonical) {
  const re = new RegExp(`(^| )${escapeRegExp(phrase)}(?= |$)`, "g");
  return haystack.replace(re, (_m, lead) => `${lead}${canonical}`);
}

/**
 * Expande sinônimos do texto normalizado. Frases mais longas primeiro, para que
 * "indice de massa corporal" vire "imc" antes de "massa corporal" tentar casar.
 *
 * @param {string} normalizedText texto já passado por normalize()
 * @returns {string} texto com sinônimos colapsados nos canônicos
 */
export function expandSynonyms(normalizedText) {
  let text = ` ${normalizedText} `;
  // Ordena as variantes por tamanho decrescente (frases longas têm prioridade).
  const phrases = [];
  for (const group of SYNONYM_GROUPS) {
    for (const v of group.variants) {
      phrases.push({ phrase: v, canonical: group.canonical });
    }
  }
  phrases.sort((a, b) => b.phrase.length - a.phrase.length);
  for (const { phrase, canonical } of phrases) {
    const p = normalize(phrase);
    if (!p || p === canonical) continue;
    text = replacePhrase(text, p, canonical);
  }
  return text.trim().replace(/\s+/g, " ");
}

/** FNV-1a de 32 bits — estável entre plataformas e versões do Node. */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Extrai os n-gramas de caractere (3–5) de um texto. Texto curto (menor que o
 * menor n) vira um único grama inteiro.
 */
export function charNgrams(text, sizes = NGRAM_SIZES) {
  const s = String(text ?? "");
  const grams = [];
  if (s.length === 0) return grams;
  for (const n of sizes) {
    if (s.length < n) {
      grams.push(s);
    } else {
      for (let i = 0; i + n <= s.length; i++) grams.push(s.slice(i, i + n));
    }
  }
  return grams;
}

/**
 * Gera o vetor de embedding de um texto.
 *
 * @param {string} text
 * @param {{ dims?: number, sizes?: number[] }} [opts]
 * @returns {number[]} vetor L2-normalizado (norma 1), comprimento `dims`
 */
export function embed(text, { dims = DEFAULT_DIMS, sizes = NGRAM_SIZES } = {}) {
  const dim = Number.isFinite(dims) && dims > 0 ? Math.floor(dims) : DEFAULT_DIMS;
  const vec = new Array(dim).fill(0);

  const normalized = normalize(text);
  const expanded = expandSynonyms(normalized);
  const grams = charNgrams(expanded, sizes);

  for (const gram of grams) {
    // hash com sinal: bit alto decide +1/-1, reduzindo colisões enviesadas.
    const h = fnv1a(gram);
    const idx = h % dim;
    const sign = (h & 0x80000000) === 0 ? 1 : -1;
    vec[idx] += sign;
  }

  // Normalização L2.
  let sum = 0;
  for (let i = 0; i < dim; i++) sum += vec[i] * vec[i];
  const norm = Math.sqrt(sum);
  if (norm === 0) return vec; // vetor nulo (texto vazio): norma 0
  for (let i = 0; i < dim; i++) vec[i] /= norm;
  return vec;
}

/** Produto interno de dois vetores de mesmo comprimento. */
export function dot(a, b) {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/**
 * Similaridade de cosseno entre dois textos. Como `embed` já normaliza em L2,
 * o cosseno é o produto interno — mas recalculamos a norma para robustez.
 *
 * @param {string} a
 * @param {string} b
 * @param {{ dims?: number }} [opts]
 * @returns {number} cosseno em [-1, 1] (0 para vetor nulo)
 */
export function cosine(a, b, { dims = DEFAULT_DIMS } = {}) {
  const va = embed(a, { dims });
  const vb = embed(b, { dims });
  let dotab = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < dims; i++) {
    dotab += va[i] * vb[i];
    na += va[i] * va[i];
    nb += vb[i] * vb[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dotab / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Contenção de n-gramas: fração dos n-gramas da **consulta** presentes na entrada.
 *
 * O cosseno é simétrico e cai muito quando a consulta é curta e a entrada é longa
 * (o vetor da entrada dilui). A contenção é robusta a essa assimetria: pergunta
 * "quanto da consulta está dentro da entrada?", que é exatamente o caso de busca
 * (termo curto → documento longo).
 *
 * @param {string} query
 * @param {string} entry
 * @param {{ sizes?: number[] }} [opts]
 * @returns {number} contenção em [0, 1]
 */
export function gramContainment(query, entry, { sizes = NGRAM_SIZES } = {}) {
  const q = charNgrams(expandSynonyms(normalize(query)), sizes);
  if (q.length === 0) return 0;
  const eSet = new Set(charNgrams(expandSynonyms(normalize(entry)), sizes));
  let hit = 0;
  for (const g of q) if (eSet.has(g)) hit++;
  return hit / q.length;
}

/**
 * Contenção de tokens após expansão de sinônimos.
 *
 * É o sinal semântico mais forte para o caso "sinônimo/paráfrase": depois de
 * expandir o glossário, "imc" e "índice de massa corporal" caem no mesmo token
 * canônico, então a consulta curta casa exatamente com a entrada longa.
 *
 * @param {string} query
 * @param {string} entry
 * @returns {number} fração dos tokens da consulta presentes na entrada, em [0, 1]
 */
export function tokenContainment(query, entry) {
  const q = new Set(tokenizeForMatch(query));
  if (q.size === 0) return 0;
  const e = new Set(tokenizeForMatch(entry));
  let hit = 0;
  for (const t of q) if (e.has(t)) hit++;
  return hit / q.size;
}

/** Tokeniza após expansão de sinônimos (remove stopwords curtas). */
function tokenizeForMatch(text) {
  return expandSynonyms(normalize(text))
    .split(" ")
    .filter((t) => t.length > 1);
}

/**
 * Similaridade semântica robusta entre consulta e entrada, em [0, 1].
 *
 * Combina três sinais complementares e devolve o maior:
 *   - `cosine`       — fuzzy quando os comprimentos são comparáveis;
 *   - `gramContainment` — fuzzy robusto a assimetria de comprimento;
 *   - `tokenContainment` — exato após expansão de sinônimos (o caso "imc").
 *
 * Todos locais e determinísticos; nada de rede, nada de modelo baixado.
 *
 * @param {string} query
 * @param {string} entry
 * @param {{ dims?: number }} [opts]
 * @returns {number} similaridade em [0, 1]
 */
export function semanticSimilarity(query, entry, { dims = DEFAULT_DIMS } = {}) {
  const cos = cosine(query, entry, { dims });
  const cosPos = cos > 0 ? cos : 0;
  const gram = gramContainment(query, entry);
  const tok = tokenContainment(query, entry);
  return Math.max(cosPos, gram, tok);
}

export default {
  embed,
  cosine,
  normalize,
  expandSynonyms,
  charNgrams,
  gramContainment,
  tokenContainment,
  semanticSimilarity,
  DEFAULT_DIMS,
};