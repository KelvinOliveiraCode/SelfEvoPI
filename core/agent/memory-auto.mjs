/**
 * core/agent/memory-auto.mjs — memória automática do SelfEvoPI.
 *
 * Camada fina de memória "automática": o harness guarda fatos que o usuário ou
 * o agente afirmam, recupera por sobreposição de termos (sem embeddings, sem
 * rede), promove lições duráveis e resume uma sessão em poucos fatos.
 *
 * É deliberadamente DIFERENTE de `core/memory/store.mjs` (que tem 3 níveis e
 * LANÇA em erro). Aqui a regra é: NUNCA LANÇA. Toda função devolve um objeto
 * com `ok`; um banco corrompido produz lista vazia + `error` explícito, nunca
 * uma exceção. Assim um fato ruim ou um arquivo quebrado não derruba o turno.
 *
 * Layout em disco (raiz = diretório do banco, ex.: `.pi/harness/memory`):
 *   <banco>/auto.jsonl     fatos retidos (retain)
 *   <banco>/lessons.jsonl   lições promovidas (learn)
 *
 * Cada linha é um objeto JSON: { id, at, kind, text, scope, source, hash, rule? }
 *
 * Privacidade: nenhum dado pessoal entra nos fatos. `redact` remove chaves,
 * tokens, senhas e e-mails ANTES de gravar; o hash é calculado sobre o texto
 * já redigido. Nada de provedor ou modelo em teste.
 *
 * Contrato:
 *   retain(banco, { text, scope, source })      -> { ok, entry, deduped, error? }
 *   recall(banco, query, { limit })             -> { ok, results, error? }
 *   learn(banco, { lesson, rule })              -> { ok, entry, deduped, error? }
 *   digestSession(banco, mensagens, opts?)       -> { ok, facts, count, error? }
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";

const ARQUIVO_FACTS = "auto.jsonl";
const ARQUIVO_LESSONS = "lessons.jsonl";

/** Teto de caracteres de um fato (evita gravação gigante). */
const MAX_TEXTO = 2_000;

const STOPWORDS = new Set([
  "a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "ou", "que",
  "um", "uma", "para", "por", "com", "em", "no", "na", "se", "ao", "aos",
  "the", "of", "to", "and", "or", "an", "in", "on", "for", "is", "are",
]);

const DECISION_WORDS = ["sempre", "nunca", "deve", "deve ser", "obrigatorio", "proibido", "regra", "decisao", "decidi", "padrao", "convencao"];

/* ------------------------------------------------------------------ */
/* Helpers de caminho e serialização                                   */
/* ------------------------------------------------------------------ */

/** Aceita string (diretório) ou objeto { root | dir | banco }. */
function raizDoBanco(banco) {
  if (typeof banco === "string" && banco.trim() !== "") return banco;
  if (banco && typeof banco === "object") {
    const r = banco.root ?? banco.dir ?? banco.banco;
    if (typeof r === "string" && r.trim() !== "") return r;
  }
  return null;
}

function arquivoNo(banco, nome) {
  const raiz = raizDoBanco(banco);
  return raiz ? join(raiz, nome) : null;
}

/**
 * Lê um JSONL do banco. Linhas vazias são ignoradas; uma linha que não é JSON
 * marca o arquivo como corrompido (sem lançar).
 *
 * @returns {{ entries: object[], corrupted: boolean, exists: boolean }}
 */
function lerJsonl(banco, nome) {
  const file = arquivoNo(banco, nome);
  if (!file || !existsSync(file)) return { entries: [], corrupted: false, exists: false };
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return { entries: [], corrupted: true, exists: true };
  }
  if (raw.trim() === "") return { entries: [], corrupted: false, exists: true };
  const entries = [];
  let corrupted = false;
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      corrupted = true;
    }
  }
  return { entries, corrupted, exists: true };
}

/** Acrescenta uma linha JSON ao arquivo do banco (append-only). */
function anexar(banco, nome, registro) {
  const file = arquivoNo(banco, nome);
  if (!file) throw new Error("banco inválido");
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(registro) + "\n", "utf8");
}

/* ------------------------------------------------------------------ */
/* Redação de segredos e dados pessoais                                */
/* ------------------------------------------------------------------ */

/**
 * Remove padrões de chave/segredo e dados pessoais de um texto.
 * Ordem importa: segredos compostos primeiro, e-mails depois.
 *
 * @param {string} texto
 * @returns {string}
 */
export function redact(texto) {
  let t = String(texto ?? "");
  // Tokens "Bearer ..." e "Basic ...".
  t = t.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redigido]");
  // Chaves de API com prefixo conhecido (sk-, pk-, rk-, ghp_, xoxb-…).
  t = t.replace(/\b(?:sk|pk|rk|ghp|gho|xox[baprs])-[A-Za-z0-9._-]{6,}/g, "[chave redigida]");
  // Atribuições nome=valor de credencial.
  t = t.replace(
    /\b(api[_-]?key|access[_-]?token|token|secret|password|passwd|pwd|credential)\b(\s*[:=]\s*)(["']?)[^\s"']+\3/gi,
    "$1$2[redigido]",
  );
  // E-mails.
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email redigido]");
  // Sequências hex longas (32+), típicas de token/assinatura.
  t = t.replace(/\b[0-9a-f]{32,}\b/gi, "[hash redigido]");
  return t;
}

/** Normaliza texto para comparação/dedup (minúsculas, espaços colapsados). */
function normalizar(texto) {
  return String(texto ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Hash curto e estável do texto (para dedup e rastreio). */
export function hashDoTexto(texto) {
  return createHash("sha256").update(normalizar(texto), "utf8").digest("hex").slice(0, 16);
}

/** Tokeniza para sobreposição de termos (sem acento, sem stopword). */
export function tokenize(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function novoId() {
  // UUID v4 sem depender de crypto.randomUUID (disponível, mas mantemos simples).
  return globalThis.crypto?.randomUUID?.() ?? createHash("sha256").update(String(Date.now()) + Math.random()).digest("hex").slice(0, 32);
}

/* ------------------------------------------------------------------ */
/* API — retain / recall / learn / digestSession                       */
/* ------------------------------------------------------------------ */

/**
 * Retém um fato (append-only, com hash e timestamp). Redige segredos antes de
 * gravar. Se um fato com o mesmo hash já existe, não duplica (deduped=true).
 *
 * @param {string|object} banco diretório do banco
 * @param {{ text?: string, scope?: string, source?: string }} entrada
 * @returns {{ ok: boolean, entry?: object, deduped?: boolean, error?: string }}
 */
export function retain(banco, { text, scope, source } = {}) {
  try {
    if (typeof text !== "string" || text.trim() === "") {
      return { ok: false, error: "retain: `text` precisa ser string não vazia" };
    }
    const limpo = redact(text.trim()).slice(0, MAX_TEXTO);
    if (limpo.trim() === "") return { ok: false, error: "retain: texto vazio após redação" };
    const hash = hashDoTexto(limpo);

    // Dedup contra fatos válidos já gravados.
    const { entries, corrupted } = lerJsonl(banco, ARQUIVO_FACTS);
    if (!corrupted && entries.some((e) => e && e.hash === hash)) {
      const existente = entries.find((e) => e && e.hash === hash);
      return { ok: true, deduped: true, entry: existente };
    }

    const entry = {
      id: novoId(),
      at: new Date().toISOString(),
      kind: "fact",
      text: limpo,
      scope: typeof scope === "string" && scope ? scope : "project",
      source: typeof source === "string" && source ? source : "auto",
      hash,
    };
    anexar(banco, ARQUIVO_FACTS, entry);
    return { ok: true, deduped: false, entry };
  } catch (err) {
    return { ok: false, error: `retain falhou: ${String(err?.message || err)}` };
  }
}

/**
 * Recupera fatos por sobreposição de termos. Sem embeddings, sem rede.
 * Banco corrompido -> lista vazia + error explícito (nunca lança).
 *
 * @param {string|object} banco
 * @param {string} query
 * @param {{ limit?: number, scope?: string }} [opts]
 * @returns {{ ok: boolean, results: object[], error?: string }}
 */
export function recall(banco, query, { limit = 10, scope = null } = {}) {
  try {
    const { entries, corrupted, exists } = lerJsonl(banco, ARQUIVO_FACTS);
    if (corrupted) {
      return { ok: false, results: [], error: "recall: banco de memória corrompido (JSONL inválido)" };
    }
    if (!exists || entries.length === 0) return { ok: true, results: [] };

    const termos = tokenize(query);
    if (termos.length === 0) return { ok: true, results: [] };
    const termoSet = new Set(termos);

    const teto = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;
    const ranqueados = [];
    for (const e of entries) {
      if (!e || typeof e !== "object") continue;
      if (scope && e.scope !== scope) continue;
      const doFato = new Set(tokenize(e.text ?? ""));
      let score = 0;
      for (const t of termoSet) if (doFato.has(t)) score += 1;
      if (score <= 0) continue;
      ranqueados.push({
        id: e.id ?? null,
        text: e.text ?? "",
        scope: e.scope ?? null,
        source: e.source ?? null,
        at: e.at ?? null,
        score,
      });
    }

    // Maior sobreposição; empate desempata pelo mais recente.
    ranqueados.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(b.at ?? "").localeCompare(String(a.at ?? ""));
    });
    return { ok: true, results: ranqueados.slice(0, teto) };
  } catch (err) {
    return { ok: false, results: [], error: `recall falhou: ${String(err?.message || err)}` };
  }
}

/**
 * Promove uma lição durável (nível "skills"). Redige segredos, grava com hash.
 * `rule` é opcional e guardado como campo próprio.
 *
 * @param {string|object} banco
 * @param {{ lesson?: string, rule?: string }} entrada
 * @returns {{ ok: boolean, entry?: object, deduped?: boolean, error?: string }}
 */
export function learn(banco, { lesson, rule } = {}) {
  try {
    const base = typeof lesson === "string" && lesson.trim() !== "" ? lesson : rule;
    if (typeof base !== "string" || base.trim() === "") {
      return { ok: false, error: "learn: informe `lesson` ou `rule` não vazio" };
    }
    const texto = redact(base.trim()).slice(0, MAX_TEXTO);
    if (texto.trim() === "") return { ok: false, error: "learn: texto vazio após redação" };
    const ruleLimpa = typeof rule === "string" && rule.trim() !== "" ? redact(rule.trim()).slice(0, MAX_TEXTO) : null;
    const hash = hashDoTexto(texto + "\u0000" + (ruleLimpa ?? ""));

    const { entries, corrupted } = lerJsonl(banco, ARQUIVO_LESSONS);
    if (!corrupted && entries.some((e) => e && e.hash === hash)) {
      return { ok: true, deduped: true, entry: entries.find((e) => e && e.hash === hash) };
    }

    const entry = {
      id: novoId(),
      at: new Date().toISOString(),
      kind: "lesson",
      text: texto,
      rule: ruleLimpa,
      scope: "skills",
      source: "learn",
      hash,
    };
    anexar(banco, ARQUIVO_LESSONS, entry);
    return { ok: true, deduped: false, entry };
  } catch (err) {
    return { ok: false, error: `learn falhou: ${String(err?.message || err)}` };
  }
}

/** Texto de uma mensagem (string ou { role, content }). */
function textoDaMensagem(m) {
  if (typeof m === "string") return { role: null, text: m };
  if (m && typeof m === "object") {
    const text = typeof m.content === "string" ? m.content : typeof m.text === "string" ? m.text : "";
    return { role: typeof m.role === "string" ? m.role : null, text };
  }
  return { role: null, text: "" };
}

/** Quebra um texto em frases candidatas (pontuação final ou quebra de linha). */
function frases(texto) {
  return String(texto ?? "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function pareceDecisao(texto) {
  const t = normalizar(texto);
  return DECISION_WORDS.some((w) => t.includes(w));
}

/**
 * Resume uma sessão em poucos fatos e retém cada um (scope "session").
 * Determinístico: escolhe as frases mais substantivas por marcador de decisão,
 * origem (usuário pesa mais) e recência. Nunca lança.
 *
 * @param {string|object} banco
 * @param {Array} mensagens  strings ou { role, content }
 * @param {{ maxFacts?: number }} [opts]
 * @returns {{ ok: boolean, facts: object[], count: number, error?: string }}
 */
export function digestSession(banco, mensagens, { maxFacts = 3 } = {}) {
  try {
    if (!Array.isArray(mensagens)) {
      return { ok: false, facts: [], count: 0, error: "digestSession: `mensagens` precisa ser array" };
    }
    const teto = Number.isFinite(maxFacts) && maxFacts > 0 ? Math.floor(maxFacts) : 3;

    const candidatos = [];
    let ordem = 0;
    for (const m of mensagens) {
      const { role, text } = textoDaMensagem(m);
      for (const s of frases(text)) {
        if (s.length < 12) continue; // frases curtas não viram fato
        if (s.length > MAX_TEXTO) continue;
        const decisao = pareceDecisao(s);
        // Pontuação: decisão vale mais; usuário um pouco acima do assistente;
        // recência quebra empate.
        let peso = 0;
        if (decisao) peso += 3;
        if (role === "user") peso += 1;
        candidatos.push({ text: s, peso, ordem });
        ordem += 1;
      }
    }

    // Dedup por texto normalizado, mantendo a maior pontuação. Só viram fato as
    // frases com peso > 0 (marcador de decisão ou vindas do usuário) — ruído de
    // confirmação do assistente não é memória durável.
    const porTexto = new Map();
    for (const c of candidatos) {
      if (c.peso <= 0) continue;
      const chave = normalizar(c.text);
      const atual = porTexto.get(chave);
      if (!atual || c.peso > atual.peso) porTexto.set(chave, c);
    }

    const ordenados = [...porTexto.values()].sort((a, b) => {
      if (b.peso !== a.peso) return b.peso - a.peso;
      return b.ordem - a.ordem; // mais recente primeiro
    });

    const escolhidos = ordenados.slice(0, teto);
    const facts = [];
    for (const c of escolhidos) {
      const r = retain(banco, { text: c.text, scope: "session", source: "digest" });
      if (r.ok && r.entry) facts.push(r.entry);
    }
    return { ok: true, facts, count: facts.length };
  } catch (err) {
    return { ok: false, facts: [], count: 0, error: `digestSession falhou: ${String(err?.message || err)}` };
  }
}

export default { retain, recall, learn, digestSession, redact, hashDoTexto, tokenize };