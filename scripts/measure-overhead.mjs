#!/usr/bin/env node
/**
 * measure-overhead.mjs — mede o custo fixo do harness.
 *
 * Duas métricas que o plano trata como requisito:
 *   1. cold-start: tempo de `pi --version` (proxy do custo de subida)
 *   2. system prompt: tokens de entrada de uma chamada trivial
 *
 * Uso:
 *   node scripts/measure-overhead.mjs            # 10 execuções
 *   node scripts/measure-overhead.mjs --runs 20
 *   node scripts/measure-overhead.mjs --json
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const DEFAULT_MODEL = process.env.PI_MEASURE_MODEL || "kilo1/nvidia/nemotron-3-ultra-550b-a55b:free";

/**
 * Valida que o provider do modelo default existe no models.json do PI.
 * Se faltar (ex.: kilo1 foi removido), cai para o primeiro provider+modelo
 * disponível e avisa. Se não há provider nenhum, falha com mensagem explícita
 * em vez de morrer em silêncio quando o PI não resolve o modelo.
 */
function resolveModel() {
  const modelsFile = process.env.SELFEOPI_MODELS_JSON
    ? path.resolve(process.env.SELFEOPI_MODELS_JSON)
    : path.join(os.homedir(), ".pi", "agent", "models.json");

  let doc = null;
  if (existsSync(modelsFile)) {
    try {
      doc = JSON.parse(readFileSync(modelsFile, "utf8"));
    } catch {
      doc = null; // models.json corrompido: cai no default sem validar
    }
  }
  const providers = doc?.providers && typeof doc.providers === "object" ? doc.providers : {};
  const ids = Object.keys(providers);
  if (ids.length === 0) {
    // Sem models.json utilizável: não dá para validar, mas o default pode ainda
    // funcionar via auth.json. Usa o default e deixa o PI decidir.
    return { model: DEFAULT_MODEL, note: null };
  }

  const provedorDefault = String(DEFAULT_MODEL).split("/")[0];
  if (providers[provedorDefault]) {
    return { model: DEFAULT_MODEL, note: null };
  }

  // Provedor do default ausente: escolhe o primeiro que tiver modelo.
  for (const id of ids) {
    const firstModel = providers[id]?.models?.[0]?.id;
    if (firstModel) {
      const model = `${id}/${firstModel}`;
      return {
        model,
        note: `modelo default indisponível (provider "${provedorDefault}" ausente); usando ${model}`,
      };
    }
  }
  // Há providers, mas nenhum expõe modelo: falha explícita.
  process.stderr.write(
    `measure-overhead: nenhum modelo utilizável em ${modelsFile} (provider "${provedorDefault}" ausente e nenhum provider com models)\n`,
  );
  process.exit(2);
}

function argValue(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

function resolvePi() {
  if (process.platform === "win32") {
    const bundle = path.join(
      process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming"),
      "npm", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js",
    );
    return { cmd: process.execPath, prefix: [bundle] };
  }
  return { cmd: "pi", prefix: [] };
}

const runs = Number(argValue("runs", "10"));
const asJson = process.argv.includes("--json");
const { cmd, prefix } = resolvePi();
const { model: RESOLVED_MODEL, note: MODEL_NOTE } = resolveModel();
if (MODEL_NOTE && !asJson) process.stderr.write(`  ! ${MODEL_NOTE}\n`);

/* --- 1. cold start ------------------------------------------------- */

const times = [];
for (let i = 0; i < runs; i++) {
  const t0 = performance.now();
  try {
    execFileSync(cmd, [...prefix, "--version"], { cwd: ROOT, stdio: "ignore", windowsHide: true });
  } catch {
    /* ignora: interessa o tempo, não a saída */
  }
  times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b, 0) / times.length;
const median = times[Math.floor(times.length / 2)];

/* --- 2. system prompt ---------------------------------------------- */

const tmp = path.join(os.tmpdir(), `pi-measure-${Date.now()}.jsonl`);
let promptTokens = null;
let totalTokens = null;
let error = null;

try {
  const res = spawnSync(cmd, [...prefix, "--model", RESOLVED_MODEL, "--mode", "json", "--approve", "--print", "responda apenas: ok"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
    timeout: 120_000,
  });
  const lines = String(res.stdout || "").split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const evt = JSON.parse(line);
      if (evt.usage && evt.usage.totalTokens) {
        totalTokens = evt.usage.totalTokens;
        promptTokens = (evt.usage.input || 0) + (evt.usage.cacheRead || 0) + (evt.usage.cacheWrite || 0);
      }
    } catch {
      /* linha não-JSON */
    }
  }
  if (!totalTokens) error = `sem usage no stream (exit ${res.status})`;
} catch (err) {
  error = err.message;
}

/* --- 3. relatório --------------------------------------------------- */

const result = {
  coldStart: {
    runs,
    avgMs: Math.round(avg),
    medianMs: Math.round(median),
    minMs: Math.round(times[0]),
    maxMs: Math.round(times[times.length - 1]),
  },
  systemPrompt: {
    model: RESOLVED_MODEL,
    inputTokensInclCache: promptTokens,
    totalTokens,
    note: "input + cacheRead + cacheWrite da 1ª chamada; inclui o system prompt do PI e a mensagem de teste",
  },
  error,
};

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Cold start (${runs} execuções de \`pi --version\`)`);
  console.log(`  média   ${result.coldStart.avgMs} ms`);
  console.log(`  mediana ${result.coldStart.medianMs} ms`);
  console.log(`  mín     ${result.coldStart.minMs} ms`);
  console.log(`  máx     ${result.coldStart.maxMs} ms`);
  console.log("");
  console.log(`System prompt (${RESOLVED_MODEL})`);
  if (error) {
    console.log(`  erro: ${error}`);
  } else {
    console.log(`  entrada total (inclui cache)  ${promptTokens} tokens`);
    console.log(`  total do turno                ${totalTokens} tokens`);
    console.log(`  meta do projeto               < 1.500 tokens (prompt do SelfEvoPI)`);
  }
}

process.exit(error ? 1 : 0);