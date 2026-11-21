#!/usr/bin/env node
/**
 * import-providers.mjs — importa contas de provedor para o models.json do PI,
 * de forma A G N Ó S T I C A (sem dependência do OpenCode).
 *
 * Lê uma fonte e gera/atualiza um models.json do PI em ~/.pi/agent/. A fonte
 * pode ser:
 *   - opencode.jsonc  (formato OpenCode: `provider` no singular, `options.baseURL`)
 *   - models.json     (formato NATIVO do PI: `providers` no plural, reaproveitado
 *                      sem conversão)
 *
 * O formato é detectado pelo schema, ou forçado com --source-format pi|opencode.
 *
 * Seguranca:
 *  - Nunca imprime o valor de apiKey (apenas "presente" + tamanho + fingerprint).
 *  - Faz backup do models.json existente antes de sobrescrever.
 *  - Apos escrever, remove a heranca e concede acesso SOMENTE ao usuario logado:
 *    icacls "<arquivo>" /inheritance:r /grant:r "<usuario>:F"
 *  - O repositorio recebe apenas config/providers.example.json (placeholders).
 *
 * Uso:
 *   node scripts/import-providers.mjs                            # dry-run (nada e escrito)
 *   node scripts/import-providers.mjs --apply                    # escreve models.json + icacls
 *   node scripts/import-providers.mjs --apply --out "C:/tmp/models.json"
 *   node scripts/import-providers.mjs --source ~/.pi/agent/models.json   # fonte PI nativa
 *   node scripts/import-providers.mjs --source-format pi|opencode        # forca o formato
 */

import { readFile, writeFile, copyFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import process from "node:process";

const BASE_TARGETS = ["kilo1", "kilo2", "kilo3", "kilo4", "or1", "or2", "or3", "or4"];
let TARGETS = [...BASE_TARGETS];
const HOME = os.homedir();
const OPENCODE_SOURCE = path.join(HOME, ".config", "opencode", "opencode.jsonc");
const PI_SOURCE = path.join(HOME, ".pi", "agent", "models.json");
const DEFAULT_OUT = path.join(HOME, ".pi", "agent", "models.json");

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

/** Primeira fonte existente entre os candidatos, ou o 1º candidato (para o erro). */
async function firstExisting(candidates) {
  for (const c of candidates) {
    const st = await stat(c).catch(() => null);
    if (st?.isFile()) return c;
  }
  return candidates[0];
}

const sourceFormatArg = (() => {
  const v = argValue("--source-format", null);
  if (v === null) return null;
  const s = String(v).toLowerCase();
  if (s === "pi" || s === "opencode") return s;
  console.error(`✗ --source-format inválido: ${JSON.stringify(v)} (use: pi | opencode)`);
  process.exit(2);
})();

const source = path.resolve(argValue("--source", null) ?? (await firstExisting([OPENCODE_SOURCE, PI_SOURCE])));
const out = path.resolve(argValue("--out", DEFAULT_OUT));
const apply = process.argv.includes("--apply");

/** Remove comentarios de JSONC preservando strings e escapes. */
function stripJsonc(text) {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      result += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; result += ch; continue; }
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      result += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
      continue;
    }
    result += ch;
  }
  return result;
}

/** Primeiro valor de uma chave dentro de um recorte de texto. */
function pick(sourceText, key) {
  const m = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`).exec(sourceText);
  return m ? m[1] : null;
}

function blockFor(raw, id) {
  const start = raw.indexOf(`"${id}"`);
  if (start === -1) return null;
  // recorta ate a proxima chave de provedor de primeiro nivel
  const rest = raw.slice(start + id.length + 3);
  const nextIdx = rest.search(/\n\s{4}"[A-Za-z0-9_.\-]+"\s*:\s*\{/);
  return nextIdx === -1 ? rest : rest.slice(0, nextIdx);
}

/* ------------------------------------------------------------------ */
/* Enriquecimento de metadados de modelo (reasoning effort e imagem)    */
/* ------------------------------------------------------------------ */

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const PUBLIC_CATALOGS = [
  "https://openrouter.ai/api/v1/models",
  "https://ai-gateway.kilo.ai/api/v1/models",
];
const PRIVATE_OVERRIDES_FILE =
  process.env.SELFEOPI_PROVIDER_OVERRIDES ||
  path.join(ROOT_DIR(), "config", "providers.private.json");

function ROOT_DIR() {
  return path.resolve(import.meta.dirname, "..");
}

/** Overrides privados são opcionais: target/catálogos/efforts específicos de uma máquina. */
async function loadPrivateOverrides() {
  try {
    const doc = JSON.parse(await readFile(PRIVATE_OVERRIDES_FILE, "utf8"));
    return {
      targets: Array.isArray(doc.targets) ? doc.targets.filter((x) => typeof x === "string") : [],
      catalogs: Array.isArray(doc.catalogs) ? doc.catalogs.filter((x) => typeof x === "string") : [],
      efforts: doc.efforts && typeof doc.efforts === "object" ? doc.efforts : {},
    };
  } catch {
    return { targets: [], catalogs: [], efforts: {} };
  }
}

/** Busca os catálogos públicos; falha de rede nunca impede a importação. */
async function fetchCatalogs(catalogs = PUBLIC_CATALOGS) {
  const rows = [];
  for (const url of catalogs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data?.data)) rows.push(...data.data);
    } catch {
      /* sem rede: mantém o que a fonte local trouxe */
    }
  }
  return rows;
}

/** Extrai os efforts aceitos de uma entrada dos catálogos públicos. */
function effortsOf(entry) {
  if (!entry) return null;
  const values = [];
  for (const v of entry.reasoning?.supported_efforts || []) values.push(String(v).toLowerCase());
  for (const opt of entry.opencode?.reasoning_options || []) {
    for (const v of opt?.values || []) values.push(String(v).toLowerCase());
  }
  for (const name of Object.keys(entry.opencode?.variants || {})) values.push(String(name).toLowerCase());
  const known = values.filter((v) => THINKING_LEVELS.includes(v));
  return known.length > 0 ? [...new Set(known)] : null;
}

/** Aplica reasoning/image aos modelos já convertidos, sem tocar em chaves. */
async function enrichModelMetadata(models, { network = true, overrides = null } = {}) {
  const extra = overrides || await loadPrivateOverrides();
  const catalog = network ? await fetchCatalogs([...PUBLIC_CATALOGS, ...extra.catalogs]) : [];
  const byId = new Map();
  for (const entry of catalog) {
    if (typeof entry?.id !== "string") continue;
    if (!byId.has(entry.id)) byId.set(entry.id, []);
    byId.get(entry.id).push(entry);
  }
  let changed = 0;
  for (const [providerId, provider] of Object.entries(models)) {
    for (const model of provider?.models || []) {
      if (!model || typeof model.id !== "string") continue;
      const explicit = extra.efforts[model.id] || extra.efforts[`${providerId}/${model.id}`] || null;
      const entries = byId.get(model.id) || [];
      const efforts = entries.map(effortsOf).find(Boolean) || null;
      const modalities = entries.find((e) => Array.isArray(e?.architecture?.input_modalities))
        ?.architecture.input_modalities;
      if (explicit) {
        model.reasoning = true;
        model.thinkingLevelMap = { ...explicit };
        model.compat = { ...(model.compat || {}), supportsReasoningEffort: true };
        changed++;
      } else if (efforts) {
        const map = {};
        for (const level of THINKING_LEVELS) {
          map[level] = efforts.includes(level) ? level : null;
        }
        // `off` nunca é "effort" em modelos de raciocínio obrigatório.
        if (efforts.length > 0 && !efforts.includes("off")) map.off = null;
        model.reasoning = true;
        model.thinkingLevelMap = map;
        model.compat = { ...(model.compat || {}), supportsReasoningEffort: true };
        changed++;
      }
      if (Array.isArray(modalities)) {
        const input = modalities.filter((m) => m === "text" || m === "image");
        if (input.length > 0) model.input = input;
      }
    }
  }
  return changed;
}

function buildModel(raw, id, meta) {
  const model = { id };
  if (meta?.name) model.name = meta.name;
  if (meta?.reasoning === true) model.reasoning = true;
  const input = meta?.modalities?.input;
  if (Array.isArray(input) && input.length > 0) model.input = input.filter((x) => x === "text" || x === "image");
  if (input && (!model.input || model.input.length === 0)) model.input = ["text"];
  const ctx = meta?.limit?.context;
  const max = meta?.limit?.output;
  if (typeof ctx === "number" && ctx > 0) model.contextWindow = ctx;
  if (typeof max === "number" && max > 0) model.maxTokens = max;
  return model;
}

/* ------------------------------------------------------------------ */
/* Deteccao de formato (agnostico: PI nativo vs OpenCode)               */
/* ------------------------------------------------------------------ */

/**
 * Decide o formato do arquivo de origem:
 *  - "pi"       — models.json nativo do PI (`providers` no plural, `baseUrl`/`api`
 *                 diretos, ou `$schema` apontando para pi.dev/schemas/models).
 *  - "opencode" — opencode.jsonc (`provider` no singular, `options.baseURL`).
 *  - null       — nenhum reconhecido.
 */
function detectFormat(config) {
  if (!config || typeof config !== "object") return null;
  const schema = typeof config.$schema === "string" ? config.$schema : "";
  if (/pi\.dev\/schemas\/models/i.test(schema)) return "pi";

  const providerMap = config.provider && typeof config.provider === "object" ? config.provider : null;
  const opencodeShape =
    providerMap &&
    Object.values(providerMap).some(
      (p) => p && typeof p === "object" && (p.options?.baseURL || p.options?.base_url),
    );
  if (opencodeShape) return "opencode";

  if (config.providers && typeof config.providers === "object") return "pi";
  if (providerMap) return "opencode";
  return null;
}

/**
 * Extrai provedores de um models.json NATIVO do PI — sem conversão. Cada
 * provedor já está no formato do PI; apenas filtramos os alvos e montamos o
 * resumo (mesma forma que o caminho OpenCode devolve).
 */
function fromPiNative(providers) {
  const models = {};
  const summary = [];
  for (const id of Object.keys(providers)) {
    const p = providers[id];
    const baseUrl = p?.baseUrl ?? null;
    const apiKey = p?.apiKey ?? null;
    const modelList = Array.isArray(p?.models) ? p.models : [];
    models[id] = {
      name: p.name ?? id,
      baseUrl,
      api: p.api ?? "openai-completions",
      ...(apiKey ? { apiKey } : {}),
      models: modelList,
    };
    summary.push({
      id,
      baseUrl,
      models: modelList.length,
      apiKey: apiKey ? `presente (${String(apiKey).length} chars)` : "ausente (usar env/auth.json)",
      fp: apiKey ? createHash("sha256").update(String(apiKey)).digest("hex").slice(0, 10) : null,
    });
  }
  return { models, summary };
}

async function main() {
  const overrides = await loadPrivateOverrides();
  TARGETS = [...new Set([...BASE_TARGETS, ...overrides.targets])];
  let raw;
  try {
    raw = await readFile(source, "utf8");
  } catch (err) {
    console.error(`✗ nao foi possivel ler ${source}: ${err.message}`);
    process.exit(2);
  }

  let config;
  try {
    config = JSON.parse(stripJsonc(raw));
  } catch (err) {
    console.error(`✗ JSONC invalido em ${source}: ${err.message}`);
    process.exit(2);
  }

  // ---- deteccao de formato (agnostico) --------------------------------
  const format = sourceFormatArg ?? detectFormat(config);
  if (!format) {
    console.error(
      `✗ formato nao reconhecido em ${source}.\n` +
        "  Esperado: models.json do PI (`providers`) ou opencode.jsonc (`provider` com `options.baseURL`).\n" +
        "  Force com --source-format pi|opencode.",
    );
    process.exit(2);
  }

  let models;
  let summary;

  if (format === "pi") {
    // models.json NATIVO do PI: reaproveita o schema sem conversao.
    const providers = config.providers && typeof config.providers === "object" ? config.providers : {};
    const extracted = fromPiNative(providers);
    // filtra apenas os alvos, preservando a ordem de TARGETS
    models = {};
    for (const id of TARGETS) if (extracted.models[id]) models[id] = extracted.models[id];
    summary = TARGETS.filter((id) => extracted.models[id])
      .map((id) => extracted.summary.find((s) => s.id === id))
      .filter(Boolean);
    console.log(`Formato: pi (nativo, sem conversao)`);
  } else {
    // OpenCode: mantem a conversao atual (provider singular, options.baseURL).
    const providers = config.provider && typeof config.provider === "object" ? config.provider : {};
    const found = TARGETS.filter((id) => providers[id]);

    models = {};
    summary = [];
    for (const id of found) {
      const p = providers[id];
      const baseUrl = p?.options?.baseURL ?? p?.baseURL ?? p?.options?.base_url ?? null;
      const apiKey = p?.options?.apiKey ?? p?.apiKey ?? null;
      if (!baseUrl) {
        summary.push({ id, status: "ignorado", reason: "sem baseURL" });
        continue;
      }
      const modelList = Object.entries(p.models ?? {}).map(([mid, meta]) => buildModel(raw, mid, meta));
      if (modelList.length === 0) {
        summary.push({ id, status: "ignorado", reason: "sem modelos" });
        continue;
      }
      models[id] = {
        name: p.name ?? id,
        baseUrl,
        api: "openai-completions",
        ...(apiKey ? { apiKey } : {}),
        models: modelList,
      };
      summary.push({
        id,
        baseUrl,
        models: modelList.length,
        apiKey: apiKey ? `presente (${String(apiKey).length} chars)` : "ausente (usar env/auth.json)",
        fp: apiKey ? createHash("sha256").update(String(apiKey)).digest("hex").slice(0, 10) : null,
      });
    }
    console.log(`Formato: opencode (convertido para o schema do PI)`);
  }

  const enriquecidos = await enrichModelMetadata(models, { overrides });
  if (enriquecidos > 0) {
    console.log(`Metadados: ${enriquecidos} modelo(s) com reasoning/effort atualizados dos catálogos públicos`);
  }

  const found = TARGETS.filter((id) => models[id]);
  const missing = TARGETS.filter((id) => !models[id]);

  if (found.length === 0) {
    console.error("✗ nenhum dos provedores alvo foi encontrado no arquivo de origem");
    process.exit(2);
  }

  const document = {
    $schema: "https://pi.dev/schemas/models.schema.json",
    providers: models,
  };

  console.log(`Origem : ${source}`);
  console.log(`Destino: ${out}`);
  console.log("");
  for (const s of summary) {
    if (s.status === "ignorado") {
      console.log(`  · ${s.id.padEnd(6)} ignorado — ${s.reason}`);
    } else {
      console.log(`  ✓ ${s.id.padEnd(6)} ${String(s.models).padStart(2)} modelos  ${s.baseUrl}`);
      console.log(`          chave: ${s.apiKey}  fp:${s.fp ?? "-"}`);
    }
  }
  if (missing.length) console.log(`\n  ausentes na origem: ${missing.join(", ")}`);

  const fps = summary.filter((s) => s.fp).map((s) => s.fp);
  const unique = new Set(fps).size;
  console.log(`  chaves distintas: ${unique} de ${fps.length}`);

  console.log(`\n  total: ${Object.keys(models).length} provedores, ${Object.values(models).reduce((n, p) => n + p.models.length, 0)} modelos`);

  if (!apply) {
    console.log("\n[dry-run] nada foi escrito. Use --apply para gravar e blindar com icacls.");
    return;
  }

  try {
    const existing = await stat(out).catch(() => null);
    if (existing) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backup = `${out}.bak-${stamp}`;
      await copyFile(out, backup);
      console.log(`\n  backup: ${backup}`);
    }
  } catch (err) {
    console.error(`✗ falha ao fazer backup: ${err.message}`);
    process.exit(1);
  }

  await writeFile(out, JSON.stringify(document, null, 2) + "\n", "utf8");
  console.log(`  escrito: ${out}`);

  if (process.platform === "win32") {
    // Nao usar process.env.USERNAME: em servicos/agentes ele pode valer "SYSTEM"
    // enquanto o token real e do usuario logado. whoami e a fonte confiavel.
    let account = os.userInfo().username;
    try {
      account = execFileSync("whoami", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\\").pop();
    } catch {
      /* mantem os.userInfo() */
    }
    try {
      execFileSync("icacls", [out, "/grant:r", `${account}:F`], { stdio: "ignore" });
      console.log(`  icacls: acesso concedido a ${account}`);
    } catch (err) {
      console.error(`  ! icacls falhou: ${err.message}`);
    }
  }

  console.log("\n✓ pronto. Verifique com: pi auth check --provider kilo1 --json");
}

main();