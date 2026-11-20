#!/usr/bin/env node
/**
 * core/agent/providers.mjs — registro manual de provedores de modelo.
 *
 * O comando `/providers` deixa o usuário cadastrar/remover provedores na mão,
 * sem depender de import de outro produto. Este módulo é a lógica pura por
 * trás dele: listar, adicionar, remover e sondar modelos.
 *
 * Formato do `models.json` (compatível com o existente):
 *   {
 *     "$schema": "...",
 *     "providers": {
 *       "<id>": {
 *         "name": "...",            // opcional
 *         "baseUrl": "https://…/v1",
 *         "api": "openai-completions",
 *         "apiKey": "…",            // NUNCA devolvido/logado
 *         "models": [ { "id": "…" }, … ]
 *       }
 *     }
 *   }
 *
 * A chave de API é gravada em `models.json` (formato nativo) e espelhada em
 * `auth.json`; ambos recebem ACL restrita no Windows (`icacls`). A chave nunca
 * aparece em retorno, log ou mensagem de erro — qualquer saída que a contenha
 * é redigida.
 *
 * Contrato:
 *   listProviders()                          -> [{ id, baseUrl, models:[string] }]
 *   addProvider({ id, baseUrl, apiKey, models }) -> { id, baseUrl, models, apiKeyRedacted }
 *   removeProvider({ id })                   -> { removed, id }
 *   fetchModels({ baseUrl, apiKey })         -> [{ id }]   (OpenAI-compatible)
 *
 * Windows nativo, Node ESM puro, zero dependência nova.
 */

import { readFile, writeFile, mkdir, rename, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

/** Nome do arquivo de configuração de modelos (relativo ao home). */
const MODELS_SUBDIR = path.join(".pi", "agent", "models.json");

/** Nome do arquivo de credenciais (relativo ao home). */
const AUTH_SUBDIR = path.join(".pi", "agent", "auth.json");

/** Timeout curto para fetchModels (ms). */
const FETCH_TIMEOUT_MS = 8_000;

/** Protocolo default ao registrar um provedor. */
const DEFAULT_API = "openai-completions";

/* ------------------------------------------------------------------ */
/* Erros tipados                                                       */
/* ------------------------------------------------------------------ */

/** Erro de domínio de providers (código estável para automação). */
export class ProviderError extends Error {
  constructor(message, { code = "invalid", cause = null } = {}) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    if (cause) this.cause = cause;
  }
}

/* ------------------------------------------------------------------ */
/* Caminhos                                                            */
/* ------------------------------------------------------------------ */

/** Home do usuário (respeita override de teste via `home`). */
function resolveHome(home) {
  if (typeof home === "string" && home.trim() !== "") return path.resolve(home);
  return path.resolve(process.env.HOME ?? process.env.USERPROFILE ?? ".");
}

/** Caminho do models.json (respeita `SELFEOPI_MODELS_JSON` e override de teste). */
function modelsPath(home) {
  if (process.env.SELFEOPI_MODELS_JSON) return path.resolve(process.env.SELFEOPI_MODELS_JSON);
  return path.join(resolveHome(home), MODELS_SUBDIR);
}

/** Caminho do auth.json (respeita override de teste). */
function authPath(home) {
  return path.join(resolveHome(home), AUTH_SUBDIR);
}

/* ------------------------------------------------------------------ */
/* Redação de segredos                                                 */
/* ------------------------------------------------------------------ */

/** Redige uma string que possa conter a chave (por segurança, nunca devolve). */
function redact(text, secret) {
  const s = String(text ?? "");
  if (!secret) return s;
  return s.split(String(secret)).join("***");
}

/** Devolve o usuário atual para o icacls (Windows). */
function currentUserName() {
  return process.env.USERNAME || process.env.USERDOMAIN
    ? `${process.env.USERDOMAIN ? process.env.USERDOMAIN + "\\" : ""}${process.env.USERNAME || ""}`
    : os.userInfo().username;
}

/* ------------------------------------------------------------------ */
/* ACL (Windows)                                                       */
/* ------------------------------------------------------------------ */

/**
 * Blinda um arquivo no Windows: remove herança e concede acesso só ao usuário
 * atual. No-op em outros sistemas. Nunca lança — se o icacls falhar, o
 * arquivo continua com a ACL que já tinha (a gravação atômica não é revertida).
 */
function blindarArquivo(file) {
  if (process.platform !== "win32") return { applied: false, reason: "não-windows" };
  const user = currentUserName();
  if (!user) return { applied: false, reason: "sem usuário" };
  try {
    const r = spawnSync(
      "icacls",
      [file, "/inheritance:r", `/grant:r`, `${user}:F`],
      { windowsHide: true, encoding: "utf8" },
    );
    if (r.status === 0) return { applied: true };
    return { applied: false, reason: redact((r.stderr || r.stdout || "").trim(), null) };
  } catch (err) {
    return { applied: false, reason: redact(String(err?.message ?? err), null) };
  }
}

/* ------------------------------------------------------------------ */
/* Leitura                                                             */
/* ------------------------------------------------------------------ */

/** Lê e parseia um JSON sem lançar; devolve `{ ok, value, error }`. */
async function lerJson(file) {
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return { ok: true, value: null };
    return { ok: false, error: `não consegui ler ${file}: ${err?.message ?? err}` };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: `JSON inválido em ${file}: ${err?.message ?? err}` };
  }
}

/** Normaliza a lista de modelos de um provider para `[string]` (ids). */
function modelIds(entry) {
  const list = Array.isArray(entry?.models) ? entry.models : [];
  const out = [];
  for (const m of list) {
    const id = typeof m === "string" ? m : m && typeof m === "object" ? m.id : null;
    if (typeof id === "string" && id.trim() !== "") out.push(id.trim());
  }
  return out;
}

/**
 * Lista os provedores configurados (SEM chaves de API).
 *
 * @param {{ home?: string }} [opts]
 * @returns {Promise<Array<{ id: string, baseUrl: string|null, models: string[] }>>}
 */
export async function listProviders({ home } = {}) {
  const file = modelsPath(home);
  const r = await lerJson(file);
  if (!r.ok) {
    throw new ProviderError(r.error, { code: "read-error" });
  }
  const doc = r.value ?? {};
  const providers = doc && typeof doc === "object" && doc.providers && typeof doc.providers === "object"
    ? doc.providers
    : {};
  const out = [];
  for (const [id, entry] of Object.entries(providers)) {
    if (!entry || typeof entry !== "object") continue;
    out.push({
      id,
      baseUrl: typeof entry.baseUrl === "string" ? entry.baseUrl : null,
      models: modelIds(entry),
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/* ------------------------------------------------------------------ */
/* Escrita                                                             */
/* ------------------------------------------------------------------ */

/** Escreve JSON atômico (tmp + rename) e, se pedido, blinda com icacls. */
async function escreverJson(file, doc, { blindar = false } = {}) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(doc, null, 2) + "\n", "utf8");
  await rename(tmp, file);
  if (blindar) blindarArquivo(file);
}

/** Normaliza a entrada de modelos para o formato do models.json. */
function normalizarModels(models) {
  const list = Array.isArray(models) ? models : [];
  const out = [];
  for (const m of list) {
    if (typeof m === "string" && m.trim() !== "") {
      out.push({ id: m.trim() });
    } else if (m && typeof m === "object" && typeof m.id === "string" && m.id.trim() !== "") {
      const { id, ...rest } = m;
      out.push({ id: id.trim(), ...rest });
    }
  }
  return out;
}

/**
 * Registra (ou atualiza) um provedor no models.json. A chave de API é gravada
 * no models.json (formato nativo) e espelhada no auth.json; ambos blindados
 * com ACL restrita no Windows. A chave NUNCA é devolvida nem logada.
 *
 * @param {object} p
 * @param {string} p.id        identificador do provedor (ex.: "kilo4")
 * @param {string} p.baseUrl   URL base OpenAI-compatible
 * @param {string} p.apiKey    chave de API (nunca devolvida)
 * @param {string[]} p.models  ids de modelo
 * @param {string} [p.name]    nome legível (opcional)
 * @param {string} [p.api]     protocolo (default "openai-completions")
 * @param {{ home?: string }} [p.home]  override de home (teste)
 * @returns {Promise<{ id, baseUrl, models, apiKeyRedacted: "***", acl: object }>}
 */
export async function addProvider({ id, baseUrl, apiKey, models, name, api, home } = {}) {
  const pid = String(id ?? "").trim();
  if (!pid) throw new ProviderError("addProvider: `id` é obrigatório", { code: "missing-id" });
  const url = String(baseUrl ?? "").trim();
  if (!url) throw new ProviderError("addProvider: `baseUrl` é obrigatório", { code: "missing-baseUrl" });

  const file = modelsPath(home);
  const r = await lerJson(file);
  if (!r.ok) throw new ProviderError(r.error, { code: "read-error" });
  const doc = r.value && typeof r.value === "object" ? r.value : {};
  const providers = doc.providers && typeof doc.providers === "object" ? doc.providers : {};

  // Preserva campos extras de uma entrada existente (name, api, etc.) e
  // sobrescreve apenas o que foi pedido.
  const anterior = providers[pid] && typeof providers[pid] === "object" ? providers[pid] : {};
  const entry = {
    ...anterior,
    name: name ?? anterior.name ?? pid,
    baseUrl: url,
    api: api ?? anterior.api ?? DEFAULT_API,
    models: normalizarModels(models ?? anterior.models),
  };
  // A chave só entra no models.json se foi fornecida; se não, mantém a anterior.
  const chaveFinal = apiKey != null && String(apiKey).trim() !== "" ? String(apiKey).trim() : anterior.apiKey;
  if (chaveFinal) entry.apiKey = chaveFinal;

  providers[pid] = entry;
  const novoDoc = { ...doc, providers };
  await escreverJson(file, novoDoc, { blindar: true });

  // Espelha a chave no auth.json (credenciais), também blindado.
  let authAcl = { applied: false, reason: "sem-chave" };
  if (chaveFinal) {
    const authFile = authPath(home);
    const ar = await lerJson(authFile);
    const authDoc = ar.ok && ar.value && typeof ar.value === "object" ? ar.value : {};
    authDoc[pid] = chaveFinal;
    await escreverJson(authFile, authDoc, { blindar: true });
    authAcl = blindarArquivo(authFile);
  }

  return {
    id: pid,
    baseUrl: url,
    models: modelIds(entry),
    apiKeyRedacted: "***",
    acl: { models: blindarArquivo(file), auth: authAcl },
  };
}

/**
 * Remove um provedor do models.json (e do auth.json). Não lança se não existir.
 *
 * @param {object} p
 * @param {string} p.id
 * @param {{ home?: string }} [p.home]
 * @returns {Promise<{ removed: boolean, id: string }>}
 */
export async function removeProvider({ id, home } = {}) {
  const pid = String(id ?? "").trim();
  if (!pid) throw new ProviderError("removeProvider: `id` é obrigatório", { code: "missing-id" });

  const file = modelsPath(home);
  const r = await lerJson(file);
  if (!r.ok) throw new ProviderError(r.error, { code: "read-error" });
  const doc = r.value && typeof r.value === "object" ? r.value : {};
  const providers = doc.providers && typeof doc.providers === "object" ? doc.providers : {};

  let removed = false;
  if (providers[pid]) {
    delete providers[pid];
    await escreverJson(file, { ...doc, providers }, { blindar: false });
    removed = true;
  }

  // Remove a chave do auth.json, se existir.
  const authFile = authPath(home);
  const ar = await lerJson(authFile);
  if (ar.ok && ar.value && typeof ar.value === "object" && ar.value[pid]) {
    delete ar.value[pid];
    await escreverJson(authFile, ar.value, { blindar: false });
  }

  return { removed, id: pid };
}

/* ------------------------------------------------------------------ */
/* Sondagem de modelos (OpenAI-compatible)                             */
/* ------------------------------------------------------------------ */

/**
 * Lista os modelos de um provedor OpenAI-compatible via GET {baseUrl}/v1/models.
 * Timeout curto; erro tipado se falhar. A chave NUNCA aparece no erro.
 *
 * @param {object} p
 * @param {string} p.baseUrl
 * @param {string} p.apiKey
 * @param {number} [p.timeoutMs=8000]
 * @param {Function} [p.fetchImpl]  injetável para teste (default: fetch global)
 * @returns {Promise<Array<{ id: string }>>}
 */
export async function fetchModels({ baseUrl, apiKey, timeoutMs = FETCH_TIMEOUT_MS, fetchImpl } = {}) {
  const url = String(baseUrl ?? "").trim();
  if (!url) throw new ProviderError("fetchModels: `baseUrl` é obrigatório", { code: "missing-baseUrl" });
  const key = String(apiKey ?? "").trim();
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new ProviderError("fetchModels: fetch indisponível neste runtime", { code: "no-fetch" });
  }

  const base = url.replace(/\/+$/, "");
  // A base pode vir com ou sem o segmento de versão. Se já termina em "/v1"
  // (ex.: "https://gateway/v1"), acrescenta só "/models"; senão "/v1/models".
  const endpoint = /\/v1$/.test(base) ? `${base}/models` : `${base}/v1/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, Number(timeoutMs) || FETCH_TIMEOUT_MS));
  timer?.unref?.();

  let res;
  try {
    res = await doFetch(endpoint, {
      method: "GET",
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = err?.name === "AbortError";
    throw new ProviderError(
      aborted ? `fetchModels: tempo esgotado após ${timeoutMs} ms` : `fetchModels: falha de rede: ${redact(String(err?.message ?? err), key)}`,
      { code: aborted ? "timeout" : "network", cause: err },
    );
  }
  clearTimeout(timer);

  if (!res || typeof res.ok !== "boolean") {
    throw new ProviderError("fetchModels: resposta inválida do servidor", { code: "bad-response" });
  }
  if (!res.ok) {
    // Não ecoa a chave; o status é seguro.
    throw new ProviderError(`fetchModels: HTTP ${res.status} ${res.statusText || ""}`.trim(), {
      code: "http",
    });
  }

  let body;
  try {
    body = await res.json();
  } catch (err) {
    throw new ProviderError(`fetchModels: resposta não-JSON: ${redact(String(err?.message ?? err), key)}`, {
      code: "bad-json",
    });
  }

  // Formato OpenAI: { data: [{ id, ... }, ...] }
  const data = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
  const out = [];
  for (const m of data) {
    const id = typeof m === "string" ? m : m && typeof m === "object" ? m.id : null;
    if (typeof id === "string" && id.trim() !== "") out.push({ id: id.trim() });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

export default {
  listProviders,
  addProvider,
  removeProvider,
  fetchModels,
  ProviderError,
};