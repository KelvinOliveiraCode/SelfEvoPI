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
  cloneFrom: arg("--clone-from"),
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
  replaceKey: has("--replace-key"),
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

function baseIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
    const host = /^\d+$/.test(hostname) ? "gateway" : hostname.split(".")[0];
    return host.replace(/[^a-z0-9_-]/gi, "-").toLowerCase() || "gateway";
  } catch {
    return "gateway";
  }
}

/** Nunca reutiliza o id de uma conta existente: sugere kilo1, kilo2, … */
function providerIdFor(url, doc) {
  if (opts.provider) return opts.provider;
  return cfg.nextProviderId(baseIdFromUrl(url), doc);
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

async function interactiveSetup(doc) {
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
  const sugerido = providerIdFor(baseUrl, doc);
  confirma: for (;;) {
    const id = await ask(`Id do provider [${sugerido}]: `) || sugerido;
    if (doc.providers[id] && !opts.replaceKey) {
      const fp = cfg.keyFingerprint(doc.providers[id].apiKey) || "sem-chave";
      console.log(`  "${id}" já existe (chave ${fp}). Escolha outro id ou rode com --replace-key.`);
      continue confirma;
    }
    await interactiveDiscoverAndSave({ doc, baseUrl, key, id, interactive: true });
    break;
  }
}

async function interactiveDiscoverAndSave({ doc, baseUrl, key, id }) {
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

function toModelEntry(m) {
  return {
    id: m.id,
    name: m.name || m.id,
    ...(m.reasoning ? { reasoning: true } : {}),
    ...(m.thinkingLevelMap ? { thinkingLevelMap: m.thinkingLevelMap, compat: { supportsReasoningEffort: true } } : {}),
    input: Array.isArray(m.input) ? m.input : ["text"],
    ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
    ...(m.maxTokens ? { maxTokens: m.maxTokens } : {}),
  };
}

async function main() {
  const doc = await cfg.readModels(modelsFile);

  if (opts.list) {
    const providers = Object.keys(doc.providers);
    const rows = providers.map((id) => {
      const p = doc.providers[id];
      return {
        id, endpoint: p.baseUrl || null,
        key: cfg.keyInfo(p.apiKey),
        modelCount: (p.models || []).length,
        models: (p.models || []).map((m) => m.id),
      };
    });
    if (opts.json) {
      console.log(JSON.stringify({ file: modelsFile, providers: rows }, null, 2));
    } else {
      console.log(`Config: ${modelsFile}`);
      const grupos = new Map();
      for (const r of rows) {
        const k = r.endpoint || "-";
        if (!grupos.has(k)) grupos.set(k, []);
        grupos.get(k).push(r);
      }
      for (const [endpoint, lista] of grupos) {
        console.log(`\n  ${endpoint}`);
        for (const r of lista) {
          console.log(`    ${r.id.padEnd(10)} ${String(r.modelCount).padStart(3)} modelo(s)  chave ${r.key.present ? r.key.fingerprint : "ausente"}`);
        }
      }
      if (rows.length === 0) console.log("  nenhum provider configurado");
    }
    return;
  }

  if (opts.removeProvider || opts.removeModel) {
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
    cfg.upsertProvider(doc, { id: opts.provider, name: opts.provider });
    cfg.upsertModels(doc, opts.provider, [model], { mode: "merge" });
    if (opts.apply) await cfg.writeModels(doc, { file: modelsFile });
    console.log(JSON.stringify({ provider: opts.provider, model, applied: Boolean(opts.apply) }, null, 2));
    return;
  }

  // Clonar catálogo de uma conta irmã: mesma URL, outra chave.
  if (opts.cloneFrom) {
    const src = doc.providers[opts.cloneFrom];
    if (!src) throw new Error(`--clone-from: provider "${opts.cloneFrom}" não existe`);
    const baseUrl = opts.baseUrl || src.baseUrl;
    if (!baseUrl) throw new Error("--clone-from exige --base-url quando a origem não tem baseUrl");
    const key = apiKey();
    const id = providerIdFor(baseUrl, doc);
    const models = (src.models || []).map((m) => ({
      ...m, efforts: Object.entries(m.thinkingLevelMap || {}).filter(([, v]) => v).map(([k]) => k),
      reasoning: Boolean(m.reasoning), image: (m.input || []).includes("image"), variants: [],
    }));
    if (opts.apply) {
      cfg.upsertProvider(doc, { id, name: id, baseUrl, apiKey: key, models: [] });
      cfg.upsertModels(doc, id, models.map(toModelEntry), { mode: "merge" });
      await cfg.writeModels(doc, { file: modelsFile });
    }
    console.log(JSON.stringify({
      provider: id, clonedFrom: opts.cloneFrom, endpoint: baseUrl,
      key: cfg.keyInfo(key), models: models.map(publicModel), applied: Boolean(opts.apply),
    }, null, 2));
    return;
  }

  if (!opts.baseUrl) {
    await interactiveSetup(doc);
    return;
  }

  const key = apiKey();
  const found = await discoverModels({ baseUrl: opts.baseUrl, apiKey: key });
  const chosen = selectModels(found.models);
  const id = providerIdFor(opts.baseUrl, doc);
  const irmãos = cfg.providersForEndpoint(doc, opts.baseUrl);
  const warnings = [];
  if (doc.providers[id] && !opts.replaceKey) {
    warnings.push(`o id "${id}" já existe; escolha --provider <outro> ou use --replace-key`);
  }
  if (cfg.isDuplicateKey(doc, opts.baseUrl, key)) {
    warnings.push("esta chave já está cadastrada para outro provider neste gateway");
  }
  const report = {
    provider: id,
    siblings: irmãos,
    endpoint: found.endpoint,
    headerMode: found.headerMode,
    discovered: found.models.length,
    selected: chosen.length,
    key: cfg.keyInfo(key),
    models: chosen.map(publicModel),
    warnings,
    applied: false,
    file: modelsFile,
  };

  if (opts.apply && chosen.length > 0 && warnings.length === 0) {
    cfg.upsertProvider(doc, { id, name: id, baseUrl: opts.baseUrl, apiKey: key, models: [] });
    cfg.upsertModels(doc, id, chosen.map(toModelEntry), { mode: "merge" });
    const saved = await cfg.writeModels(doc, { file: modelsFile });
    report.applied = true;
    report.backup = saved.backup;
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`${found.endpoint}: ${report.discovered} descoberto(s), ${report.selected} selecionado(s)`);
    if (irmãos.length) console.log(`  contas deste gateway: ${irmãos.join(", ")} → nova: ${id}`);
    for (const m of report.models) {
      console.log(`  ${m.id.padEnd(44)} efforts=${m.efforts.join(",") || "-"} img=${m.image ? "sim" : "não"} var=${m.variants.join(",") || "-"}`);
    }
    for (const w of warnings) console.log(`  ! ${w}`);
    console.log(opts.apply && report.applied ? `Gravado em ${modelsFile}` : "[dry-run] use --apply para gravar");
  }
}

main().catch((err) => {
  console.error(`✗ ${String(err?.message || err)}`);
  process.exitCode = 2;
});
