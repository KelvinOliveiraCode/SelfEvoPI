/**
 * core/sandbox/keepalive.mjs — política de manutenção de processos de fundo.
 *
 * Matar a árvore ao sair já custou pontos em evals reais de outras harnesses
 * (PROJECT.md §10). Por isso a política padrão é `keep-alive`: enquanto o
 * processo deu sinal de vida dentro da janela, `shutdown` decide `keep`.
 * Só o que expirou entra em `killRequested`, e nada é morto sem um executor
 * `kill` injetado — a decisão é explícita e rastreável, nunca um efeito
 * colateral de importar o módulo.
 *
 * Relógio e executor são injetáveis para teste com tempo falso. Nenhum sinal
 * é enviado por este módulo por conta própria.
 */

/** Janela padrão de manutenção: cinco minutos (premissa, configurável). */
export const DEFAULT_TTL_MS = 5 * 60 * 1000;
export const KEEP_POLICIES = Object.freeze(["keep-alive", "kill-all"]);

export class KeepAlive {
  /**
   * @param {object} [opts]
   * @param {Function} [opts.now]      relógio falso/injetado (ms)
   * @param {number} [opts.ttlMs]      janela de manutenção
   * @param {string} [opts.policy]     keep-alive (padrão) | kill-all
   * @param {Function} [opts.kill]     (pid, decision) => void; ausente = não executa
   */
  constructor(opts = {}) {
    const clock = opts?.now;
    this._now = typeof clock === "function" ? clock : () => Date.now();
    const ttl = Number(opts?.ttlMs);
    this._ttl = Number.isFinite(ttl) && ttl >= 0 ? ttl : DEFAULT_TTL_MS;
    this._policy = KEEP_POLICIES.includes(opts?.policy) ? opts.policy : "keep-alive";
    this._kill = typeof opts?.kill === "function" ? opts.kill : null;
    this._entries = new Map();
  }

  get ttlMs() { return this._ttl; }
  get policy() { return this._policy; }
  get size() { return this._entries.size; }

  _time(at) {
    return typeof at === "number" && Number.isFinite(at) ? at : this._now();
  }

  _alive(entry, now) {
    return now - entry.lastAlive <= this._ttl;
  }

  /** Registra (ou substitui) um processo. Devolve o registro ou null se inválido. */
  register(id, pid, meta = {}) {
    if (typeof id !== "string" || !id.trim()) return null;
    if (!Number.isInteger(pid) || pid <= 0) return null;
    const now = this._now();
    const entry = {
      id: id.trim(),
      pid,
      meta: meta && typeof meta === "object" ? { ...meta } : {},
      lastAlive: now,
      registeredAt: now,
    };
    this._entries.set(entry.id, entry);
    return { ...entry, meta: { ...entry.meta } };
  }

  /** Renova o sinal de vida. Devolve false se o id não existe. */
  markAlive(id, at) {
    const entry = this._entries.get(id);
    if (!entry) return false;
    entry.lastAlive = this._time(at);
    return true;
  }

  /** Remove quem ficou sem sinal além da janela. Não mata ninguém. */
  sweep(now) {
    const t = this._time(now);
    const removed = [];
    const kept = [];
    for (const [id, entry] of this._entries) {
      if (this._alive(entry, t)) kept.push(id);
      else {
        this._entries.delete(id);
        removed.push(id);
      }
    }
    return { now: t, ttlMs: this._ttl, removed, kept };
  }

  /**
   * Decide, entry por entry, entre `keep` e `kill`. Com `kill` injetado, só os
   * decididos como `kill` são removidos do registro. Sem executor, nada é
   * matado nem removido; `killRequested` diz o que aconteceria.
   */
  shutdown(reason, now) {
    const t = this._time(now);
    const label = String(reason ?? "shutdown");
    const decisions = [];
    for (const [id, entry] of this._entries) {
      const alive = this._alive(entry, t);
      const action = this._policy === "keep-alive" && alive ? "keep" : "kill";
      decisions.push({ id, pid: entry.pid, action, alive, reason: label });
    }

    const kept = decisions.filter((d) => d.action === "keep").map((d) => d.id);
    const killRequested = decisions.filter((d) => d.action === "kill").map((d) => d.id);
    const killed = [];
    const failed = [];
    if (this._kill) {
      for (const d of decisions) {
        if (d.action !== "kill") continue;
        try {
          this._kill(d.pid, d);
          killed.push(d.id);
          this._entries.delete(d.id);
        } catch {
          failed.push(d.id);
        }
      }
    }

    return {
      reason: label,
      policy: this._policy,
      now: t,
      decisions,
      kept,
      killRequested,
      killed,
      failed,
      executed: Boolean(this._kill),
    };
  }

  /** Retrato determinístico para a TUI (ordenado por id). */
  report(now) {
    const t = this._time(now);
    const entries = [...this._entries.values()]
      .map((entry) => ({
        id: entry.id,
        pid: entry.pid,
        meta: { ...entry.meta },
        alive: this._alive(entry, t),
        ageMs: Math.max(0, t - entry.lastAlive),
        lastAlive: entry.lastAlive,
      }))
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { sensitivity: "base" }));
    return { now: t, ttlMs: this._ttl, policy: this._policy, entries };
  }
}

export default { KeepAlive, DEFAULT_TTL_MS, KEEP_POLICIES };
