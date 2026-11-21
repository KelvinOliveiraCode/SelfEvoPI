/**
 * core/agent/models-config.mjs — leitura e escrita segura do models.json do PI.
 *
 * Nunca devolve chave em log. Todo write faz backup e, no Windows, reaplica ACL.
 * É a camada usada pelo importador, pelo assistente de setup e por agentes.
 */

import { copyFile, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

export function modelsPath() {
  return (
    process.env.PI_MODELS_FILE ||
    path.join(process.env.USERPROFILE || os.homedir(), ".pi", "agent", "models.json")
  );
}

export async function readModels(file = modelsPath()) {
  try {
    const doc = JSON.parse(await readFile(file, "utf8"));
    if (!doc || typeof doc !== "object" || !doc.providers || typeof doc.providers !== "object") {
      return { $schema: "https://pi.dev/schemas/models.schema.json", providers: {} };
    }
    return doc;
  } catch {
    return { $schema: "https://pi.dev/schemas/models.schema.json", providers: {} };
  }
}

export async function writeModels(doc, { file = modelsPath(), backup = true, acl = true } = {}) {
  const payload = JSON.stringify(doc, null, 2) + "\n";
  let backupFile = null;
  if (backup) {
    try {
      await readFile(file);
      backupFile = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      await copyFile(file, backupFile);
    } catch {
      backupFile = null; // arquivo ainda não existe
    }
  }
  await writeFile(file, payload, "utf8");
  if (acl && process.platform === "win32") {
    let account = os.userInfo().username;
    try {
      account = execFileSync("whoami", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
        .trim()
        .split("\\")
        .pop();
    } catch { /* mantém os.userInfo() */ }
    try {
      execFileSync("icacls", [file, "/grant:r", `${account}:F`], { stdio: "ignore" });
    } catch { /* ACL é best-effort em ambiente não-admin */ }
  }
  return { file, backup: backupFile };
}

/** Só metadados seguros de uma chave — nunca o valor. */
export function keyInfo(key) {
  if (!key) return { present: false };
  return { present: true, length: String(key).length, fingerprint: keyFingerprint(key) };
}

/** Fingerprint curto: permite comparar chaves sem imprimi-las. */
export function keyFingerprint(key) {
  if (!key) return null;
  return createHash("sha256").update(String(key)).digest("hex").slice(0, 8);
}

function normalizeEndpoint(url) {
  return String(url || "").trim().toLowerCase().replace(/\/+$/, "").replace(/\/v\d+(?:\/models)?$/, "");
}

/** Ids cadastrados para o mesmo gateway (endpoints equivalentes). */
export function providersForEndpoint(doc, baseUrl) {
  const alvo = normalizeEndpoint(baseUrl);
  if (!alvo) return [];
  return Object.entries(doc.providers || {})
    .filter(([, p]) => normalizeEndpoint(p?.baseUrl) === alvo)
    .map(([id]) => id);
}

/**
 * Sugere o próximo id livre para o mesmo gateway.
 * "kilo" → kilo1, kilo2…; "kilo3" → kilo4, kilo5…
 */
export function nextProviderId(base, doc) {
  const ids = new Set(Object.keys(doc.providers || {}));
  const nome = String(base || "gateway").replace(/[^a-z0-9_-]/gi, "-").toLowerCase() || "gateway";
  const match = /^(.*?)(\d+)$/.exec(nome);
  const prefixo = match ? match[1] : nome;
  const inicio = match ? Number(match[2]) + 1 : 1;
  for (let i = inicio; i < inicio + 1000; i++) {
    const candidato = `${prefixo}${i}`;
    if (!ids.has(candidato)) return candidato;
  }
  return `${prefixo}-${Date.now()}`;
}

/** Verdadeiro se outra conta do mesmo gateway já usa exatamente esta chave. */
export function isDuplicateKey(doc, baseUrl, key) {
  if (!key) return false;
  const fp = keyFingerprint(key);
  return providersForEndpoint(doc, baseUrl).some((id) => keyFingerprint(doc.providers[id]?.apiKey) === fp);
}

export function upsertProvider(doc, { id, name, baseUrl, apiKey, api = "openai-completions", models = [], mode = "merge" }) {
  if (!id || typeof id !== "string") throw new Error("models-config: id obrigatório");
  const atual = doc.providers[id] || {};
  const merged = {
    name: name || atual.name || id,
    baseUrl: baseUrl || atual.baseUrl || null,
    api: api || atual.api || "openai-completions",
    ...(apiKey ? { apiKey } : atual.apiKey ? { apiKey: atual.apiKey } : {}),
    models: mode === "replace"
      ? models
      : [...(Array.isArray(atual.models) ? atual.models : []), ...models],
  };
  doc.providers[id] = merged;
  return merged;
}

export function removeProvider(doc, id) {
  if (!doc.providers[id]) return false;
  delete doc.providers[id];
  return true;
}

export function upsertModels(doc, providerId, models, { onlyIds = null, mode = "merge" } = {}) {
  const provider = doc.providers[providerId];
  if (!provider) throw new Error(`models-config: provider "${providerId}" não existe`);
  const selecionados = Array.isArray(onlyIds) && onlyIds.length
    ? models.filter((m) => onlyIds.includes(m.id))
    : models;
  if (mode === "replace") {
    provider.models = selecionados;
  } else {
    const byId = new Map((provider.models || []).map((m) => [m.id, m]));
    for (const m of selecionados) byId.set(m.id, { ...(byId.get(m.id) || {}), ...m });
    provider.models = [...byId.values()];
  }
  return provider.models;
}

export function removeModel(doc, providerId, modelId) {
  const provider = doc.providers[providerId];
  if (!provider || !Array.isArray(provider.models)) return false;
  const before = provider.models.length;
  provider.models = provider.models.filter((m) => m.id !== modelId);
  return provider.models.length !== before;
}

export default {
  modelsPath, readModels, writeModels, keyInfo, keyFingerprint,
  providersForEndpoint, nextProviderId, isDuplicateKey,
  upsertProvider, removeProvider, upsertModels, removeModel,
};
