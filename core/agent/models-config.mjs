/**
 * core/agent/models-config.mjs — leitura e escrita segura do models.json do PI.
 *
 * Nunca devolve chave em log. Todo write faz backup e, no Windows, reaplica ACL.
 * É a camada usada pelo importador, pelo assistente de setup e por agentes.
 */

import { copyFile, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
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
  return { present: true, length: String(key).length };
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
  modelsPath, readModels, writeModels, keyInfo,
  upsertProvider, removeProvider, upsertModels, removeModel,
};
