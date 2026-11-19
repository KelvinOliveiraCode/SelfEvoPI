/**
 * budget.mjs — teto de consumo de tokens e custo por tarefa.
 *
 * Determinístico e testável sem relógio real.
 * Uso:
 *   const b = createBudget({ limitTokens: 100_000, limitCostUsd: 0.50 });
 *   b.spend({ tokens: 12_000, costUsd: 0.03 });
 *   b.ok // true
 *   b.spend({ tokens: 200_000, costUsd: 0.10 });
 *   b.ok // false, onExceeded chamado uma vez
 */

export function createBudget({ limitTokens = Infinity, limitCostUsd = Infinity, onExceeded = null } = {}) {
  let spentTokens = 0;
  let spentCostUsd = 0;
  let exceeded = false;
  let notified = false;

  function check() {
    if (!exceeded && (spentTokens >= limitTokens || spentCostUsd >= limitCostUsd)) {
      exceeded = true;
    }
    if (exceeded && !notified) {
      notified = true;
      if (typeof onExceeded === "function") {
        onExceeded({ spentTokens, spentCostUsd, limitTokens, limitCostUsd });
      }
    }
    return !exceeded;
  }

  return {
    /** Acumula gasto. Retorna { ok, remainingTokens, remainingCostUsd }. */
    spend({ tokens = 0, costUsd = 0 } = {}) {
      spentTokens += tokens;
      spentCostUsd += costUsd;
      check();
      return {
        ok: !exceeded,
        remainingTokens: Math.max(0, limitTokens - spentTokens),
        remainingCostUsd: Math.max(0, limitCostUsd - spentCostUsd),
      };
    },

    /** Zera a contagem e o estado de estouro. */
    reset() {
      spentTokens = 0;
      spentCostUsd = 0;
      exceeded = false;
      notified = false;
    },

    get ok() {
      return !exceeded;
    },

    get spentTokens() {
      return spentTokens;
    },

    get spentCostUsd() {
      return spentCostUsd;
    },

    get exceeded() {
      return exceeded;
    },
  };
}