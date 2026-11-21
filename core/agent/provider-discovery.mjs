/**
 * core/agent/provider-discovery.mjs — descobre modelos de um gateway OpenAI-compatible.
 *
 * Recebe endpoint + chave e devolve modelos com capacidades inferidas:
 * efforts de raciocínio, modalidade de imagem, variantes free/fast e limites.
 * Nenhum segredo é logado ou devolvido. Funciona com OpenRouter, Kilo, Nous e
 * gateways genéricos porque a leitura é tolerante a formatos.
 */

export const EFFORT_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** Normaliza formatos {data:[...]}, {models:[...]} ou array puro. */
export function normalizeModelsResponse(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.models)) return payload.models;
  if (payload?.data && typeof payload.data === "object" && Array.isArray(payload.data.models)) return payload.data.models;
  return [];
}

function lowerList(value) {
  return (Array.isArray(value) ? value : []).map((v) => String(v).toLowerCase());
}

/** Variantes detectadas no id/nome ou em campos explícitos. */
export function detectVariants(entry) {
  const text = `${entry?.id || ""} ${entry?.name || ""}`.toLowerCase();
  const out = new Set();
  for (const token of ["free", "fast", "preview", "mini", "pro", "flash"]) {
    if (new RegExp(`(^|[^a-z])${token}([^a-z]|$)`).test(text)) out.add(token);
  }
  if (entry?.isFree === true || entry?.pricing?.prompt === "0") out.add("free");
  for (const key of Object.keys(entry?.variants || entry?.opencode?.variants || {})) {
    out.add(String(key).toLowerCase());
  }
  return [...out];
}

/** Efforts aceitos, reunindo os formatos conhecidos dos catálogos públicos. */
export function inferEfforts(entry) {
  const values = [];
  for (const v of entry?.reasoning?.supported_efforts || []) values.push(String(v).toLowerCase());
  for (const opt of entry?.opencode?.reasoning_options || []) {
    for (const v of opt?.values || []) values.push(String(v).toLowerCase());
  }
  for (const name of Object.keys(entry?.opencode?.variants || {})) values.push(String(name).toLowerCase());
  for (const p of lowerList(entry?.supported_parameters)) {
    if (p === "reasoning_effort") values.push("medium", "high");
  }
  const known = values.filter((v) => EFFORT_LEVELS.includes(v));
  if (known.length === 0) return [];
  const ordered = EFFORT_LEVELS.filter((l) => known.includes(l));
  // Raciocínio obrigatório não oferece "off".
  if (entry?.reasoning?.mandatory === true || entry?.reasoning?.default_enabled === true) {
    return ordered.filter((l) => l !== "off");
  }
  return ordered;
}

export function inferImage(entry) {
  const modalities = [
    ...lowerList(entry?.architecture?.input_modalities),
    ...lowerList(entry?.input_modalities),
    ...lowerList(entry?.input),
    ...lowerList(entry?.modalities?.input),
  ];
  if (modalities.some((m) => m === "image" || m === "vision" || m.includes("image"))) return true;
  const modality = String(entry?.architecture?.modality || entry?.modality || "").toLowerCase();
  return modality.includes("image") || modality.includes("vision");
}

/** Converte uma entrada do catálogo para o formato de modelo do models.json. */
export function inferCapabilities(entry) {
  if (!entry || typeof entry.id !== "string") return null;
  const efforts = inferEfforts(entry);
  const reasoning = entry.reasoning === true || Boolean(entry.reasoning) || efforts.length > 0 ||
    lowerList(entry.supported_parameters).some((p) => p === "reasoning" || p === "include_reasoning");
  const thinkingLevelMap = efforts.length > 0
    ? Object.fromEntries(EFFORT_LEVELS.map((l) => [l, efforts.includes(l) ? l : null]))
    : null;
  const contextWindow = Number(entry.context_length ?? entry.top_provider?.context_length ?? entry.contextWindow) || null;
  const maxTokens = Number(entry.top_provider?.max_completion_tokens ?? entry.maxTokens ?? entry.max_output_tokens) || null;

  const model = {
    id: entry.id,
    name: entry.name || entry.id,
    input: inferImage(entry) ? ["text", "image"] : ["text"],
  };
  if (reasoning) model.reasoning = true;
  if (thinkingLevelMap) model.thinkingLevelMap = thinkingLevelMap;
  if (reasoning && thinkingLevelMap) model.compat = { supportsReasoningEffort: true };
  if (contextWindow && contextWindow > 0) model.contextWindow = contextWindow;
  if (maxTokens && maxTokens > 0) model.maxTokens = maxTokens;

  return {
    ...model,
    efforts,
    reasoning: Boolean(reasoning),
    image: model.input.includes("image"),
    variants: detectVariants(entry),
  };
}

/** Candidatos de URL de models a tentar, na ordem. */
export function modelEndpoints(baseUrl) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) return [];
  if (/\/models$/.test(base)) return [base];
  const out = [`${base}/models`];
  if (!/\/v\d+$/.test(base)) {
    out.push(`${base}/v1/models`, `${base}/api/v1/models`);
  }
  return [...new Set(out)];
}

/**
 * Descobre modelos no gateway. `fetchImpl` é injetável (testes sem rede).
 * Nunca devolve a chave; erros incluem só endpoint e status.
 */
export async function discoverModels({ baseUrl, apiKey, fetchImpl, timeoutMs = 10_000 } = {}) {
  const fetcher = fetchImpl || globalThis.fetch;
  if (typeof fetcher !== "function") throw new Error("provider-discovery: sem fetch disponível");
  const urls = modelEndpoints(baseUrl);
  if (urls.length === 0) throw new Error("provider-discovery: baseUrl vazio");
  let lastError = null;
  for (const url of urls) {
    for (const headerMode of ["bearer", "x-api-key"]) {
      try {
        const headers = { Accept: "application/json" };
        if (apiKey) {
          if (headerMode === "bearer") headers.Authorization = `Bearer ${apiKey}`;
          else headers["X-API-Key"] = apiKey;
        }
        const res = await fetcher(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) { lastError = `${url} → HTTP ${res.status}`; continue; }
        const payload = await res.json();
        const rows = normalizeModelsResponse(payload);
        if (rows.length === 0) { lastError = `${url} → lista vazia`; continue; }
        const models = rows.map(inferCapabilities).filter(Boolean);
        return { endpoint: url, headerMode, models };
      } catch (err) {
        lastError = `${url} → ${String(err?.message || err).slice(0, 120)}`;
      }
    }
  }
  throw new Error(`provider-discovery: falhou em todos os endpoints (${lastError || "sem detalhe"})`);
}

export default {
  EFFORT_LEVELS, normalizeModelsResponse, detectVariants, inferEfforts,
  inferImage, inferCapabilities, modelEndpoints, discoverModels,
};
