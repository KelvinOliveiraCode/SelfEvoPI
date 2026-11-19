/**
 * core/agent/inspect.mjs — inspeção de estado, custo e contexto.
 *
 * Funções puras: recebem estado, devolvem objeto. Sem efeitos colaterais.
 * Zero dependência nova. Determinístico.
 *
 * Interface:
 *   sessionStatus(state)  -> { version, model, provider, sessionId, turns, mode }
 *   sessionCost(state)    -> { tokensIn, tokensOut, tokensCacheRead, costUsd, byTurn:[] }
 *   contextUsage(state)   -> { usedTokens, budgetTokens, percent, breakdown:{} }
 *   formatTokens(n)       -> string
 *   formatCost(usd)       -> string
 */

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/**
 * Formata um número de tokens para exibição.
 * 999 → "999", 1500 → "1.500", 1500000 → "1.500.000"
 */
export function formatTokens(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("pt-BR");
}

/**
 * Formata um custo em USD para exibição.
 * 0.05 → "$0.05", 1.5 → "$1.50", null → "—"
 */
export function formatCost(usd) {
  if (usd == null || !Number.isFinite(usd)) return "—";
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Extrai array de entradas do ledger de um estado. */
function ledgerEntries(state) {
  if (!state || !Array.isArray(state.ledger)) return [];
  return state.ledger;
}

/** Soma tokens de entradas do ledger, separando entrada/saída/cache. */
function sumTokens(entries) {
  let tokensIn = 0;
  let tokensOut = 0;
  let tokensCacheRead = 0;

  for (const e of entries) {
    const u = e?.usage;
    if (u && typeof u === "object") {
      tokensIn += Number(u.input) || 0;
      tokensOut += Number(u.output) || 0;
      tokensCacheRead += Number(u.cacheRead) || 0;
    } else {
      // ledger pode ter formato simples: { tokens: N }
      tokensIn += Number(e?.tokens) || 0;
    }
  }

  return { tokensIn, tokensOut, tokensCacheRead };
}

/** Soma custo de entradas do ledger. Retorna null se alguma entrada não tem costUsd. */
function sumCost(entries) {
  if (entries.length === 0) return null;
  let total = 0;
  for (const e of entries) {
    if (e?.costUsd == null || !Number.isFinite(Number(e.costUsd))) {
      return null; // entrada sem custo → soma incompleta
    }
    total += Number(e.costUsd);
  }
  return total;
}

/* ------------------------------------------------------------------ */
/* sessionStatus                                                       */
/* ------------------------------------------------------------------ */

/**
 * Resumo do estado da sessão.
 *
 * @param {object} state
 * @param {string} [state.version]
 * @param {string} [state.model]
 * @param {string} [state.provider]
 * @param {string} [state.sessionId]
 * @param {number} [state.turns]
 * @param {string} [state.mode]
 * @returns {{ version: string|null, model: string|null, provider: string|null, sessionId: string|null, turns: number, mode: string|null }}
 */
export function sessionStatus(state = {}) {
  return {
    version: state.version ?? null,
    model: state.model ?? null,
    provider: state.provider ?? null,
    sessionId: state.sessionId ?? null,
    turns: Number(state.turns) || 0,
    mode: state.mode ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* sessionCost                                                         */
/* ------------------------------------------------------------------ */

/**
 * Custo e tokens da sessão, lidos do ledger.
 *
 * @param {object} state
 * @param {Array} [state.ledger] — entradas do ledger (formato evals.jsonl ou usage)
 * @returns {{ tokensIn: number, tokensOut: number, tokensCacheRead: number, costUsd: number|null, byTurn: Array }}
 */
export function sessionCost(state = {}) {
  const entries = ledgerEntries(state);
  const { tokensIn, tokensOut, tokensCacheRead } = sumTokens(entries);
  const costUsd = sumCost(entries);

  const byTurn = entries.map((e, i) => ({
    turn: i + 1,
    tokensIn: Number(e?.usage?.input) || Number(e?.tokens) || 0,
    tokensOut: Number(e?.usage?.output) || 0,
    costUsd: e?.costUsd != null && Number.isFinite(Number(e.costUsd)) ? Number(e.costUsd) : null,
  }));

  return { tokensIn, tokensOut, tokensCacheRead, costUsd, byTurn };
}

/* ------------------------------------------------------------------ */
/* contextUsage                                                        */
/* ------------------------------------------------------------------ */

/**
 * Uso de contexto da sessão.
 *
 * @param {object} state
 * @param {number} [state.usedTokens] — tokens já no contexto
 * @param {number} [state.budgetTokens] — teto de contexto (default: 200_000)
 * @param {object} [state.breakdown] — decomposição por categoria (system, messages, tools, etc.)
 * @returns {{ usedTokens: number, budgetTokens: number, percent: number, breakdown: object }}
 */
export function contextUsage(state = {}) {
  const budgetTokens = Number(state.budgetTokens) || 200_000;
  const usedTokens = Number(state.usedTokens) || 0;
  const percent = budgetTokens > 0 ? Math.round((usedTokens / budgetTokens) * 100) : 0;
  const breakdown = state.breakdown && typeof state.breakdown === "object" ? state.breakdown : {};

  return { usedTokens, budgetTokens, percent, breakdown };
}

/* ------------------------------------------------------------------ */
/* Default export                                                      */
/* ------------------------------------------------------------------ */

export default { sessionStatus, sessionCost, contextUsage, formatTokens, formatCost };