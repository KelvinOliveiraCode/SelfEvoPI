/**
 * selfevopi-router — roteador multi-provider do SelfEvoPI.
 *
 * Sem dependencias. Determinístico quando a estratégia é "roundRobin".
 *
 * Responsabilidades:
 *  - perfis (orchestrator / worker / reviewer) sobre o pool de 8 contas
 *  - circuit breaker por provider (closed -> open -> halfOpen -> closed)
 *  - retry com backoff exponencial e jitter
 *  - teto de tokens por tarefa
 *  - reviewer obrigatoriamente em provider diferente do autor
 */

/* ------------------------------------------------------------------ */
/* Circuit breaker                                                     */
/* ------------------------------------------------------------------ */

export class Circuit {
  constructor({ failureThreshold = 3, cooldownMs = 30_000 } = {}) {
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.failures = 0;
    this.openedAt = null;
    this.state = "closed";
  }

  get isOpen() {
    if (this.state === "open") {
      if (this.openedAt !== null && Date.now() - this.openedAt >= this.cooldownMs) {
        this.state = "halfOpen";
      }
    }
    return this.state === "open";
  }

  allow() {
    if (this.state === "open" && !this.isOpen) return true; // acabou de virar halfOpen
    return this.state !== "open";
  }

  success() {
    this.failures = 0;
    this.openedAt = null;
    this.state = "closed";
  }

  failure() {
    this.failures += 1;
    if (this.state === "halfOpen" || this.failures >= this.failureThreshold) {
      this.state = "open";
      this.openedAt = Date.now();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Backoff                                                             */
/* ------------------------------------------------------------------ */

/** Backoff exponencial com jitter total. */
export function backoffMs(attempt, { base = 250, factor = 2, cap = 8_000, rng = Math.random } = {}) {
  const raw = Math.min(cap, base * factor ** Math.max(0, attempt - 1));
  return Math.round(raw * (0.5 + rng() / 2));
}

export async function withRetry(fn, { attempts = 3, retryOn = () => true, onRetry = null, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      const retryable = attempt < attempts && retryOn(err, attempt);
      if (!retryable) break;
      if (onRetry) onRetry({ attempt, error: err, delayMs: backoffMs(attempt) });
      await sleep(backoffMs(attempt));
    }
  }
  throw lastError;
}

/* ------------------------------------------------------------------ */
/* Perfis                                                              */
/* ------------------------------------------------------------------ */

const PREFIX = /^(kilo|or)\d+$/;

/**
 * Perfis padrão.
 *  - orchestrator: contexto grande, prefere o gateway Kilo
 *  - worker: execução, prefere OpenRouter
 *  - reviewer: usa qualquer um, mas nunca o provider do autor
 */
export const PROFILES = {
  orchestrator: { prefer: ["kilo"], requireDifferentFrom: null, minContext: 200_000 },
  worker: { prefer: ["or"], requireDifferentFrom: "orchestrator", minContext: 32_000 },
  reviewer: { prefer: ["kilo", "or"], requireDifferentFrom: "worker", minContext: 32_000 },
};

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

export class Router {
  constructor({
    providers,
    strategy = "roundRobin",
    profiles = PROFILES,
    circuit = {},
    rng = Math.random,
    now = () => Date.now(),
  } = {}) {
    if (!Array.isArray(providers) || providers.length === 0) {
      throw new Error("router: informe ao menos um provider");
    }
    this.providers = providers.map((p, i) => ({
      id: p.id,
      family: (PREFIX.exec(p.id) || [])[1] ?? p.family ?? "outro",
      models: (p.models ?? []).map((m) => ({ ...m })),
      baseUrl: p.baseUrl ?? null,
      index: i,
      ewma: p.ewma ?? 500,
      calls: 0,
    }));
    this.byId = new Map(this.providers.map((p) => [p.id, p]));
    this.strategy = strategy;
    this.profiles = profiles;
    this.breakers = new Map(this.providers.map((p) => [p.id, new Circuit(circuit)]));
    this.rng = rng;
    this.now = now;
    this.cursor = 0;
  }

  /** Seleciona o próximo provider saudável segundo a estratégia. */
  #select(candidates) {
    const healthy = candidates.filter((p) => this.breakers.get(p.id).allow());
    const pool = healthy.length > 0 ? healthy : candidates;
    if (pool.length === 0) return null;
    if (this.strategy === "random") return pool[Math.floor(this.rng() * pool.length) % pool.length];
    if (this.strategy === "latency") {
      return pool.reduce((best, p) => (p.ewma < best.ewma ? p : best), pool[0]);
    }
    // roundRobin
    const ordered = [...pool].sort((a, b) => a.index - b.index);
    const start = this.cursor++ % ordered.length;
    return ordered[start];
  }

  /**
   * Escolhe um modelo para um perfil.
   * @returns {{provider, model, ref, baseUrl}}
   */
  pick(profileName = "worker", { exclude = [], minContext = null, model = null, budget = null } = {}) {
    if (budget && !budget.ok) {
      throw new Error(
        `router: orcamento da tarefa esgotado (tokens=${budget.spentTokens}, custo=$${budget.spentCostUsd.toFixed(4)})`
      );
    }
    const profile = this.profiles[profileName];
    if (!profile) throw new Error(`router: perfil desconhecido "${profileName}"`);
    if (!(profile instanceof Object)) throw new Error("router: perfil invalido");

    let candidates = this.providers.filter((p) => !exclude.includes(p.id));
    if (profile.requireDifferentFrom && exclude.length === 0) {
      // caller precisa passar exclude explicitamente para garantir a regra
    }
    if (profile.prefer?.length) {
      const preferred = candidates.filter((p) => profile.prefer.includes(p.family));
      if (preferred.length > 0) candidates = preferred;
    }

    const need = minContext ?? profile.minContext ?? 0;
    const withModels = candidates.filter((p) => p.models.length > 0);
    if (withModels.length === 0) throw new Error("router: nenhum provider com modelos");

    // tenta o modelo pedido primeiro, caindo para o maior contexto disponivel
    const fallback = [...withModels].sort((a, b) => maxContext(b) - maxContext(a))[0];
    const chosen = this.#select(withModels) ?? fallback;

    // Modelo explicito tem prioridade sobre o minimo do perfil: quem pede sabe o que quer.
    const explicitList = model
      ? chosen.models.filter((m) => m.id === model || m.id.endsWith(model))
      : [];
    if (explicitList.length > 0) {
      chosen.calls += 1;
      const picked = explicitList[0];
      return {
        provider: chosen.id,
        model: picked.id,
        ref: `${chosen.id}/${picked.id}`,
        baseUrl: chosen.baseUrl,
      };
    }

    const pool = chosen.models.filter((m) => (m.contextWindow ?? 0) >= need);
    const modelList = pool.length > 0 ? pool : chosen.models;
    const picked = modelList[0];

    if (!picked) throw new Error(`router: provider "${chosen.id}" sem modelo utilizavel`);
    chosen.calls += 1;

    return {
      provider: chosen.id,
      model: picked.id,
      ref: `${chosen.id}/${picked.id}`,
      baseUrl: chosen.baseUrl,
    };
  }

  /** Registra o resultado de uma chamada. */
  report(providerId, ok, { latencyMs = null, tokens = null, retryable = null } = {}) {
    const provider = this.byId.get(providerId);
    if (!provider) return false;
    const breaker = this.breakers.get(providerId);
    if (ok) {
      breaker.success();
      if (typeof latencyMs === "number") {
        provider.ewma = provider.ewma * 0.7 + latencyMs * 0.3;
      }
    } else {
      if (retryable === false) return false;
      breaker.failure();
    }
    if (typeof tokens === "number") provider.tokens = (provider.tokens ?? 0) + tokens;
    return true;
  }

  /** Estado observável, sem segredos. */
  snapshot() {
    return this.providers.map((p) => ({
      id: p.id,
      family: p.family,
      models: p.models.length,
      calls: p.calls,
      ewmaMs: Math.round(p.ewma),
      circuit: this.breakers.get(p.id).state,
    }));
  }

  /**
   * Escolhe provider + executa fn, trocando de provider em erros retryable.
   * @param {string} profile - perfil do roteador
   * @param {object} fn - callback async (pick) => result
   * @param {object} [opts]
   * @param {number} [opts.attempts=3]
   * @param {string[]} [opts.exclude=[]] - providers já excluídos (ex.: autor)
   * @param {object} [opts.budget] - instância de budget (createBudget)
   * @param {function} [opts.onAttempt] - callback (info) => void a cada tentativa
   * @param {function} [opts.isRetryable] - override do critério de retry
   * @returns {{ result, attempts, providersTried }}
   */
  async pickWithRetry(profile, fn, opts = {}) {
    const {
      attempts = 3,
      exclude = [],
      budget = null,
      onAttempt = null,
      isRetryable: retryCheck = isRetryable,
    } = opts;

    if (typeof fn !== "function") throw new Error("router: pickWithRetry exige fn(pick) async");

    const tried = new Set();
    let lastErr;

    for (let i = 1; i <= attempts; i++) {
      // budget estourou antes de tentar?
      if (budget && !budget.ok) {
        throw new Error(
          `router: orcamento esgotado antes da tentativa ${i} (tokens=${budget.spentTokens}, custo=$${budget.spentCostUsd.toFixed(4)})`
        );
      }

      let pick;
      try {
        pick = this.pick(profile, { budget, exclude: [...exclude, ...tried] });
      } catch (err) {
        // sem provider disponível — propaga
        throw err;
      }

      const providerId = pick.provider;
      tried.add(providerId);

      if (onAttempt) {
        onAttempt({ attempt: i, provider: providerId, model: pick.model, ref: pick.ref });
      }

      try {
        const result = await fn(pick);
        this.report(providerId, true);
        return { result, attempts: i, providersTried: [...tried] };
      } catch (err) {
        lastErr = err;
        this.report(providerId, false);

        if (!retryCheck(err)) {
          throw err;
        }

        // budget estourou durante a execução?
        if (budget && !budget.ok) {
          throw new Error(
            `router: orcamento esgotado apos tentativa ${i} (tokens=${budget.spentTokens}, custo=$${budget.spentCostUsd.toFixed(4)})`
          );
        }
      }
    }

    throw new Error(
      `router: esgotou ${attempts} tentativas em ${tried.size} provider(s): ${lastErr?.message ?? "sem detalhe"}`
    );
  }

  /** Reinicia o cursor do round-robin. */
  reset() {
    this.cursor = 0;
    for (const b of this.breakers.values()) b.success();
  }
}

/** Erro retryable por padrão: rede, 429, 5xx, timeout. */
function isRetryable(err) {
  if (!err) return false;
  const msg = (err.message || String(err)).toLowerCase();
  if (msg.includes("429") || msg.includes("rate limit")) return true;
  if (/\b5\d{2}\b/.test(msg)) return true;
  if (msg.includes("timeout") || msg.includes("etimedout") || msg.includes("econnreset") || msg.includes("enotfound") || msg.includes("econnrefused")) return true;
  if (err.code && ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN"].includes(err.code)) return true;
  return false;
}

function maxContext(p) {
  return p.models.reduce((n, m) => Math.max(n, m.contextWindow ?? 0), 0);
}

/** Carrega o models.json do PI e devolve um Router. */
export async function fromPiConfig(file, opts = {}) {
  const { readFile } = await import("node:fs/promises");
  const doc = JSON.parse(await readFile(file, "utf8"));
  const providers = Object.entries(doc.providers ?? {}).map(([id, p]) => ({
    id,
    family: (PREFIX.exec(id) || [])[1] ?? "outro",
    baseUrl: p.baseUrl ?? null,
    models: p.models ?? [],
  }));
  return new Router({ providers, ...opts });
}