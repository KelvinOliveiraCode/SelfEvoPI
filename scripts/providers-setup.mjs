#!/usr/bin/env node
/**
 * providers-setup.mjs — configurar providers e modelos no SelfEvoPI.
 *
 * Dois modos:
 *  - humano: rode sem argumentos num TTY e responda às perguntas;
 *  - agente: use --base-url/--api-key-env/--json e --apply para gravar.
 *
 * A chave nunca é impressa. O padrão é dry-run: sem --apply nada é escrito.
 * A config real fica em ~/.pi/agent/models.json (fora do repositório).
 */

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const { discoverModels } = await imp("core/agent/provider-discovery.mjs");
const cfg = await imp("core/agent/models-config.mjs");

/* ------------------------------------------------------------------ */
/* Argumentos                                                          */
/* ------------------------------------------------------------------ */

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const has = (flag) => process.argv.includes(flag);

const opts = {
  baseUrl: arg("--base-url"),
  apiKeyEnv: arg("--api-key-env"),
  apiKeyRaw: arg("--api-key"),
  provider: arg("--provider"),
  file: arg("--file"),
  only: arg("--only"),
  addModel: arg("--add-model"),
  removeProvider: arg("--remove-provider"),
  removeModel: arg("--remove-model"),
  name: arg("--name"),
  efforts: arg("--efforts"),
  json: has("--json"),
  all: has("--all"),
  freeOnly: has("--free-only"),
  image: has("--image"),
  apply: has("--apply"),
  list: has("--list"),
};

if (opts.file) process.env.PI_MODELS_FILE = path.resolve(opts.file);
const modelsFile = cfg.modelsPath();

function apiKey() {
  if (opts.apiKeyRaw) return opts.apiKeyRaw;
  if (opts.apiKeyEnv) {
    const value = process.env[opts.apiKeyEnv];
    if (!value) throw new Error(`variável de ambiente ${opts.apiKeyEnv} não está definida`);
    return value;
  }
  return null;
}

function providerIdFromUrl(url) {
  if (opts.provider) return opts.provider;
  try {
    const host = new URL(url).host.split(".")[0];
    return host.replace(/[^a-z0-9_-]/gi, "-").toLowerCase() || "gateway";
  } catch {
    return "gateway";
  }
}

/* ------------------------------------------------------------------ */
/* Operações                                                          */
/* ------------------------------------------------------------------ */

function publicModel(m) {
  return {
    id: m.id,
    name: m.name,
    reasoning: m.reasoning,
    efforts: m.efforts,
    variants: m.variants,
    image: m.image,
    contextWindow: m.contextWindow || null,
  };
}

function selectModels(models) {
  if (opts.all) return models;
  if (opts.freeOnly) return models.filter((m) => m.variants.includes("free") || m.variants.includes("fast"));
  if (opts.only) {
    const ids = opts.only.split(",").map((s) => s.trim()).filter(Boolean);
    return models.filter((m) => ids.includes(m.id));
  }
  return models;
}

async function ask(question) {
  const rl = readline.createInterface({ input, output });
  try { return (await rl.question(question)).trim(); } finally { rl.close(); }
}

async function interactiveSetup() {
  if (!process.stdout.isTTY) {
    console.error("Sem TTY. Use --base-url/--api-key-env/--json para modo agente.");
    console.error("Exemplo: node scripts/providers-setup.mjs --base-url https://api.exemplo/v1 --api-key-env MINHA_CHAVE --json");
    process.exitCode = 2;
    return;
  }
  console.log("\nSelfEvoPI — configurar provider\n");
  const baseUrl = await ask("Endpoint base (ex.: https://openrouter.ai/api/v1): ");
  if (!baseUrl) return;
  const envName = await ask("Nome da variável com a chave (recomendado,Enter para sem chave): ");
  const key = envName ? process.env[envName] : null;
  if (envName && !key) {
    console.error(`Variável ${envName} não definida. Exporte-a e rode de novo.`);
    process.exitCode = 2;
    return;
  }
  const id = await ask(`Id do provider [${providerIdFromUrl(baseUrl)}]: `) || providerIdFromUrl(baseUrl);

  process.stdout.write("Descobrindo modelos… ");
  const found = await discoverModels({ baseUrl, apiKey: key });
  console.log(`${found.models.length} modelo(s) em ${found.endpoint}`);

  console.log("\n  #   id                                      efforts            img  variantes");
  found.models.forEach((m, i) => {
    console.log(
      `  ${String(i + 1).padStart(2)}  ${m.id.slice(0, 40).padEnd(40)} ${m.efforts.join(",").padEnd(18)} ${m.image ? "sim" : "não"}   ${m.variants.join(",")}`,
    );
  });
  const answer = await ask("\nQuais adicionar? (enter=todos, f=free/fast, ou números separados por vírgula): ");
  const chosen = answer.toLowerCase() === "f"
    ? found.models.filter((m) => m.variants.includes("free") || m.variants.includes("fast"))
    : answer === ""
      ? found.models
      : answer.split(",").map((n) => found.models[Number(n.trim()) - 1]).filter(Boolean);

  const confirm = await ask(`Gravar ${chosen.length} modelo(s) no provider "${id}"? (s/N): `);
  if (!/^s/i.test(confirm)) { console.log("Nada gravado."); return; }

  const doc = await cfg.readModels(modelsFile);
  cfg.upsertProvider(doc, { id, name: id, baseUrl, apiKey: key, models: [] });
  cfg.upsertModels(doc, id, chosen.map((m) => ({
    id: m.id, name: m.name,
    ...(m.reasoning ? { reasoning: true } : {}),
    ...(m.thinkingLevelMap ? { thinkingLevelMap: m.thinkingLevelMap, compat: { supportsReasoningEffort: true } } : {}),
    input: m.input,
    ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
    ...(m.maxTokens ? { maxTokens: m.maxTokens } : {}),
  })), { mode: "merge" });
  const saved = await cfg.writeModels(doc, { file: modelsFile });
  console.log(`\nGravado em ${saved.file}${saved.backup ? ` (backup: ${saved.backup})` : ""}`);
}

async function main() {
  if (opts.list) {
    const doc = await cfg.readModels(modelsFile);
    const providers = Object.keys(doc.providers);
    if (opts.json) {
      console.log(JSON.stringify({ file: modelsFile, providers: providers.map((id) => ({
        id, baseUrl: doc.providers[id].baseUrl || null,
        key: cfg.keyInfo(doc.providers[id].apiKey),
        models: (doc.providers[id].models || []).map((m) => m.id),
      })) }, null, 2));
    } else {
      console.log(`Config: ${modelsFile}`);
      for (const id of providers) {
        const p = doc.providers[id];
        console.log(`  ${id}: ${(p.models || []).length} modelo(s), chave ${p.apiKey ? "presente" : "ausente"}`);
      }
      if (providers.length === 0) console.log("  nenhum provider configurado");
    }
    return;
  }

  if (opts.removeProvider || opts.removeModel) {
    const doc = await cfg.readModels(modelsFile);
    const changed = opts.removeProvider
      ? cfg.removeProvider(doc, opts.removeProvider)
      : cfg.removeModel(doc, opts.provider, opts.removeModel);
    if (opts.apply && changed) await cfg.writeModels(doc, { file: modelsFile });
    console.log(JSON.stringify({ changed, applied: Boolean(opts.apply && changed) }));
    return;
  }

  if (opts.addModel) {
    if (!opts.provider) throw new Error("--add-model exige --provider");
    const efforts = (opts.efforts || "").split(",").map((s) => s.trim()).filter(Boolean);
    const model = {
      id: opts.addModel,
      name: opts.name || opts.addModel,
      input: opts.image ? ["text", "image"] : ["text"],
      ...(efforts.length ? {
        reasoning: true,
        thinkingLevelMap: Object.fromEntries(["off", "minimal", "low", "medium", "high", "xhigh", "max"]
          .map((l) => [l, efforts.includes(l) ? l : null])),
        compat: { supportsReasoningEffort: true },
      } : {}),
    };
    const doc = await cfg.readModels(modelsFile);
    cfg.upsertProvider(doc, { id: opts.provider, name: opts.provider });
    cfg.upsertModels(doc, opts.provider, [model], { mode: "merge" });
    if (opts.apply) await cfg.writeModels(doc, { file: modelsFile });
    console.log(JSON.stringify({ provider: opts.provider, model, applied: Boolean(opts.apply) }, null, 2));
    return;
  }

  if (!opts.baseUrl) {
    await interactiveSetup();
    return;
  }

  const key = apiKey();
  const found = await discoverModels({ baseUrl: opts.baseUrl, apiKey: key });
  const chosen = selectModels(found.models);
  const id = providerIdFromUrl(opts.baseUrl);
  const report = {
    provider: id,
    endpoint: found.endpoint,
    headerMode: found.headerMode,
    discovered: found.models.length,
    selected: chosen.length,
    key: cfg.keyInfo(key),
    models: chosen.map(publicModel),
    applied: false,
    file: modelsFile,
  };

  if (opts.apply && chosen.length > 0) {
    const doc = await cfg.readModels(modelsFile);
    cfg.upsertProvider(doc, { id, name: id, baseUrl: opts.baseUrl, apiKey: key, models: [] });
    cfg.upsertModels(doc, id, chosen.map((m) => ({
      id: m.id, name: m.name,
      ...(m.reasoning ? { reasoning: true } : {}),
      ...(m.thinkingLevelMap ? { thinkingLevelMap: m.thinkingLevelMap, compat: { supportsReasoningEffort: true } } : {}),
      input: m.input,
      ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
      ...(m.maxTokens ? { maxTokens: m.maxTokens } : {}),
    })), { mode: "merge" });
    const saved = await cfg.writeModels(doc, { file: modelsFile });
    report.applied = true;
    report.backup = saved.backup;
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`${found.endpoint}: ${report.discovered} descoberto(s), ${report.selected} selecionado(s)`);
    for (const m of report.models) {
      console.log(`  ${m.id.padEnd(44)} efforts=${m.efforts.join(",") || "-"} img=${m.image ? "sim" : "não"} var=${m.variants.join(",") || "-"}`);
    }
    console.log(opts.apply ? `Gravado em ${modelsFile}` : "[dry-run] use --apply para gravar");
  }
}

main().catch((err) => {
  console.error(`✗ ${String(err?.message || err)}`);
  process.exitCode = 2;
});
