/**
 * selfevopi-forge-compact — compactação determinística de histórico (Fase 2).
 *
 * `/compact` é convenção universal (7/7 ferramentas): sessão longa estoura a
 * janela; compactar preserva o essencial e libera espaço.
 *
 * Heurística, sem modelo e determinística:
 *   - preserva as últimas `keepLast` mensagens intactas;
 *   - resume as anteriores mantendo início e fim de cada uma e cortando o meio
 *     com o marcador `[…]`;
 *   - se ainda passar do teto, descarta as resumidas mais antigas até caber.
 *
 * Reutiliza `normalizeText` de `core/memory/refine.mjs` (mesma filosofia
 * determinística do `/refine`): não reinventa a normalização de texto.
 *
 * Contrato:
 *   compactHistory(messages, { maxTokens, keepLast })
 *     -> { messages, removed, tokensBefore, tokensAfter }
 */

import { normalizeText } from "../memory/refine.mjs";

/** Marcador que substitui o meio cortado. */
export const MARKER = " […]";

/** Fração do início e do fim preservados ao resumir (o meio é cortado). */
const HEAD_RATIO = 0.35;
const TAIL_RATIO = 0.35;

/** Mensagens abaixo deste tamanho não são resumidas (não há meio que cortar). */
const MIN_SUMMARIZE_CHARS = 120;

/** Estimativa de tokens: ~4 caracteres por token (documentada, determinística). */
export function estimateTokens(text) {
  return Math.ceil(String(text ?? "").length / 4);
}

/** Texto de uma mensagem (aceita string ou { role, content }). */
function messageText(message) {
  if (typeof message === "string") return message;
  if (message && typeof message.content === "string") return message.content;
  return JSON.stringify(message);
}

/** Resume uma mensagem: início + marcador + fim (normalizado por refine). */
function summarizeMessage(message) {
  const raw = String(messageText(message ?? ""));
  if (raw.length < MIN_SUMMARIZE_CHARS) return message;

  const norm = normalizeText(raw);
  const len = norm.length;
  const head = Math.ceil(len * HEAD_RATIO);
  const tail = Math.floor(len * TAIL_RATIO);
  if (head + tail >= len) return message;

  return norm.slice(0, head) + MARKER + norm.slice(len - tail);
}

function tokensOf(messages) {
  let total = 0;
  for (const m of messages) total += estimateTokens(messageText(m));
  return total;
}

/**
 * Compacta um histórico de mensagens.
 *
 * @param {Array} messages  histórico (strings ou { role, content })
 * @param {object} [opts]
 * @param {number} opts.maxTokens  teto de tokens (obrigatório)
 * @param {number} [opts.keepLast=6]  mensagens finais preservadas intactas
 * @returns {{ messages: Array, removed: number, tokensBefore: number, tokensAfter: number }}
 */
export function compactHistory(messages, { maxTokens, keepLast = 6 } = {}) {
  if (!Array.isArray(messages)) {
    throw new Error("compact: `messages` precisa ser um array");
  }
  const limit = Number(maxTokens);
  if (!Number.isFinite(limit) || limit < 0) {
    throw new Error("compact: `maxTokens` deve ser um número >= 0");
  }
  const keep = Number.isInteger(keepLast) && keepLast >= 0 ? keepLast : 6;

  const tokensBefore = tokensOf(messages);

  // Abaixo do teto: não faz nada.
  if (tokensBefore <= limit) {
    return { messages, removed: 0, tokensBefore, tokensAfter: tokensBefore };
  }

  const cut = Math.max(0, messages.length - keep);
  const summarized = messages.slice(0, cut).map(summarizeMessage);
  const kept = messages.slice(cut);

  let result = [...summarized, ...kept];
  let tokensAfter = tokensOf(result);
  let dropped = 0;

  // Se ainda passar do teto, descarta as resumidas mais antigas.
  while (tokensAfter > limit && summarized.length > 0) {
    summarized.shift();
    dropped += 1;
    result = [...summarized, ...kept];
    tokensAfter = tokensOf(result);
  }

  // `removed` = mensagens que deixaram de estar verbatim (resumidas + descartadas).
  const removed = cut + dropped;

  return { messages: result, removed, tokensBefore, tokensAfter };
}

export default { compactHistory, estimateTokens, MARKER };