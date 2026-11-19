/**
 * selfevopi-pi-harness — adaptador entre a nossa ponte e o pi-harness (Fase 4).
 *
 * Sem dependências. Node ESM puro. Windows nativo (sem `.sh`).
 *
 * POR QUE existe: a nossa ponte (`harness-state` + `index.json`) descreve um RUN
 * (DAG de nós). O pi-harness descreve uma SESSÃO (agente único, log de eventos).
 * São vocabulários diferentes. Este módulo faz a tradução nos dois sentidos:
 *
 *   - `toSessionResponse` / `toSessionList`  → nossos runs no formato do pi-harness
 *   - `parseSessionJsonl`                    → sessão real do pi em disco → resumo
 *   - `probePiHarness` / `createSession` / `listSessions` / `health`
 *                                            → cliente HTTP mínimo (fetch injetável)
 *
 * Nenhuma função daqui exige o servidor: os mapeadores são puros e testáveis.
 * As funções de rede só rodam quando chamadas (e o teste de integração pula
 * quando o servidor não responde).
 */

/* ------------------------------------------------------------------ */
/* Mapeamento de status                                                */
/* ------------------------------------------------------------------ */

/**
 * Converte o status do nosso run para o vocabulário do pi-harness.
 * pi-harness só conhece `"active" | "ended"`.
 */
export function toPiStatus(runStatus) {
  switch (runStatus) {
    case "running":
    case "pending":
    case "paused":
    case "blocked":
    case "waiting-human":
      return "active";
    case "completed":
    case "done":
    case "failed":
    case "skipped":
      return "ended";
    default:
      return "active";
  }
}

/* ------------------------------------------------------------------ */
/* Nosso run -> sessão do pi-harness                                   */
/* ------------------------------------------------------------------ */

/**
 * Mapeia um documento `harness-state` (um run) para o formato `SessionResponse`
 * do pi-harness: `{ sessionId, status, createdAt }`.
 *
 * @param {object} runDoc  documento da ponte (harness-state)
 * @returns {{ sessionId: string, status: "active"|"ended", createdAt: string|null }}
 */
export function toSessionResponse(runDoc) {
  const d = runDoc ?? {};
  return {
    sessionId: d.runId ?? null,
    status: toPiStatus(d.status),
    createdAt: d.startedAt ?? null,
  };
}

/**
 * Mapeia vários runs para o formato de `GET /sessions` do pi-harness:
 * `{ sessions: [SessionResponse, ...] }`.
 *
 * @param {object[]} runDocs
 * @returns {{ sessions: Array<{ sessionId: string, status: string, createdAt: string|null }> }}
 */
export function toSessionList(runDocs) {
  const sessions = (Array.isArray(runDocs) ? runDocs : []).map(toSessionResponse);
  return { sessions };
}

/* ------------------------------------------------------------------ */
/* Sessão do pi em disco (JSONL) -> resumo                             */
/* ------------------------------------------------------------------ */

/**
 * Interpreta o conteúdo de um arquivo de sessão do pi (`~/.pi/agent/sessions/
 * <cwd-codificado>/<iso>_<uuid>.jsonl`), que é um log de eventos append-only.
 *
 * Cada linha é um evento JSON. Tipos relevantes:
 *   - `session`               → cabeçalho: { version, id, timestamp, cwd }
 *   - `model_change`          → { provider, modelId }
 *   - `thinking_level_change` → { thinkingLevel }
 *   - `message`               → { id, parentId, message: { role, content[] } }
 *
 * @param {string} text  conteúdo bruto do .jsonl
 * @returns {{
 *   id: string|null, version: number|null, cwd: string|null,
 *   startedAt: string|null, endedAt: string|null,
 *   model: { provider: string|null, modelId: string|null }|null,
 *   thinkingLevel: string|null,
 *   messages: Array<{ id: string|null, parentId: string|null, role: string, at: string|null }>,
 *   eventCount: number, malformed: number
 * }}
 */
export function parseSessionJsonl(text) {
  const out = {
    id: null,
    version: null,
    cwd: null,
    startedAt: null,
    endedAt: null,
    model: null,
    thinkingLevel: null,
    messages: [],
    eventCount: 0,
    malformed: 0,
  };
  if (typeof text !== "string" || text.length === 0) return out;

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let ev;
    try {
      ev = JSON.parse(trimmed);
    } catch {
      out.malformed += 1;
      continue;
    }
    out.eventCount += 1;
    if (ev && ev.timestamp) out.endedAt = ev.timestamp;

    switch (ev?.type) {
      case "session":
        out.id = ev.id ?? out.id;
        out.version = typeof ev.version === "number" ? ev.version : out.version;
        out.cwd = ev.cwd ?? out.cwd;
        out.startedAt = ev.timestamp ?? out.startedAt;
        break;
      case "model_change":
        out.model = { provider: ev.provider ?? null, modelId: ev.modelId ?? null };
        break;
      case "thinking_level_change":
        out.thinkingLevel = ev.thinkingLevel ?? out.thinkingLevel;
        break;
      case "message": {
        const role = ev?.message?.role ?? "unknown";
        out.messages.push({
          id: ev.id ?? null,
          parentId: ev.parentId ?? null,
          role,
          at: ev.timestamp ?? null,
        });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Cliente HTTP mínimo (fetch injetável)                               */
/* ------------------------------------------------------------------ */

/** Extrai o prefixo base de uma URL, tolerando barra final. */
function base(baseUrl) {
  return String(baseUrl).replace(/\/+$/, "");
}

async function jsonOrThrow(res) {
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} em ${res.url ?? ""}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/**
 * Sonda `GET /health`. Devolve o corpo ou `null` se o servidor não responde
 * (qualquer motivo: ausente, porta fechada, erro de rede). Nunca lança por
 * indisponibilidade — quem chama decide pular/falhar.
 *
 * @param {object} [opts]
 * @param {string} [opts.baseUrl="http://127.0.0.1:8787"]
 * @param {number} [opts.timeoutMs=2000]
 * @param {Function} [opts.fetchImpl]  injetável para teste
 * @returns {Promise<object|null>}
 */
export async function probePiHarness({ baseUrl = "http://127.0.0.1:8787", timeoutMs = 2000, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") return null;
  try {
    const res = await fetchImpl(`${base(baseUrl)}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * `POST /sessions`. Devolve `{ sessionId, ... }` (o pi-harness 0.1.1 só ecoa o
 * sessionId; versões futuras podem trazer status/createdAt).
 *
 * @param {object} [opts]
 * @param {string} [opts.baseUrl]
 * @param {object} [opts.body]  ex.: { sessionId?, provider?, model?, workspaceDir? }
 * @param {number} [opts.timeoutMs]
 * @param {Function} [opts.fetchImpl]
 */
export async function createSession({ baseUrl = "http://127.0.0.1:8787", body = {}, timeoutMs = 5000, fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(`${base(baseUrl)}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return jsonOrThrow(res);
}

/** `GET /sessions` → `{ sessions: [...] }`. */
export async function listSessions({ baseUrl = "http://127.0.0.1:8787", timeoutMs = 5000, fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(`${base(baseUrl)}/sessions`, { signal: AbortSignal.timeout(timeoutMs) });
  return jsonOrThrow(res);
}

/** `GET /health` cru (lança em erro HTTP). */
export async function health({ baseUrl = "http://127.0.0.1:8787", timeoutMs = 5000, fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(`${base(baseUrl)}/health`, { signal: AbortSignal.timeout(timeoutMs) });
  return jsonOrThrow(res);
}