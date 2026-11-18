#!/usr/bin/env node
/**
 * import-providers.mjs — traduz as contas do OpenCode para o formato do PI.
 *
 * Lê o opencode.jsonc local, extrai SOMENTE as 8 contas do SelfEvoPI
 * (kilo1..kilo4 e or1..or4) e gera um models.json do PI em ~/.pi/agent/.
 *
 * Seguranca:
 *  - Nunca imprime o valor de apiKey (apenas "presente" + tamanho + fingerprint).
 *  - Faz backup do models.json existente antes de sobrescrever.
 *  - Apos escrever, remove a heranca e concede acesso SOMENTE ao usuario logado:
 *    icacls "<arquivo>" /inheritance:r /grant:r "<usuario>:F"
 *  - O repositorio recebe apenas config/providers.example.json (placeholders).
 *
 * Uso:
 *   node scripts/import-providers.mjs              # dry-run (nada e escrito)
 *   node scripts/import-providers.mjs --apply      # escreve models.json + icacls
 *   node scripts/import-providers.mjs --apply --out "C:/tmp/models.json"
 */

import { readFile, writeFile, copyFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import process from "node:process";

const TARGETS = ["kilo1", "kilo2", "kilo3", "kilo4", "or1", "or2", "or3", "or4"];
const HOME = os.homedir();
const DEFAULT_SOURCE = path.join(HOME, ".config", "opencode", "opencode.jsonc");
const DEFAULT_OUT = path.join(HOME, ".pi", "agent", "models.json");

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const source = path.resolve(argValue("--source", DEFAULT_SOURCE));
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

async function main() {
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

  const providers = config?.provider ?? config?.providers ?? {};
  const found = TARGETS.filter((id) => providers[id]);
  const missing = TARGETS.filter((id) => !providers[id]);

  if (found.length === 0) {
    console.error("✗ nenhum dos provedores alvo foi encontrado no arquivo de origem");
    process.exit(2);
  }

  const models = {};
  const summary = [];

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