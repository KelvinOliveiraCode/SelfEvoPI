#!/usr/bin/env node
/**
 * measure-selfevopi-overhead.mjs — mede o incremento de prompt que o SelfEvoPI
 * acrescenta ao PI, e compara com o orçamento do plano (< 1.500 tokens).
 *
 * Mede quatro configurações, do mais barato ao mais caro:
 *   1. pi-puro           — PI sem extensão nenhuma (linha de base)
 *   2. memoria-vazia     — PI + extensão de memória, zero entradas
 *   3. memoria-curta     — PI + memória com 5 entradas típicas
 *   4. memoria-cheia     — PI + memória no teto (20 entradas, teto de 400 tokens)
 *
 * Uso:
 *   node scripts/measure-selfevopi-overhead.mjs
 *   node scripts/measure-selfevopi-overhead.mjs --runs 3
 *   node scripts/measure-selfevopi-overhead.mjs --json
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const DEFAULT_MODEL = process.env.PI_MEASURE_MODEL || "kilo1/nvidia/nemotron-3-ultra-550b-a55b:free";
const MEMORY_EXT = path.join(ROOT, "core", "memory", "extension.mjs");
const BUDGET_TOKENS = 1_500;

/**
 * Valida que o provider do modelo default existe no models.json do PI.
 * Se faltar, cai para o primeiro provider+modelo disponível e avisa; se não há
 * provider nenhum com modelo, falha com mensagem explícita (não morre calado).
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
      doc = null;
    }
  }
  const providers = doc?.providers && typeof doc.providers === "object" ? doc.providers : {};
  const ids = Object.keys(providers);
  if (ids.length === 0) {
    return { model: DEFAULT_MODEL, note: null };
  }

  const provedorDefault = String(DEFAULT_MODEL).split("/")[0];
  if (providers[provedorDefault]) {
    return { model: DEFAULT_MODEL, note: null };
  }

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
  process.stderr.write(
    `measure-selfevopi-overhead: nenhum modelo utilizável em ${modelsFile} (provider "${provedorDefault}" ausente e nenhum provider com models)\n`,
  );
  process.exit(2);
}

const { model: MODEL, note: MODEL_NOTE } = resolveModel();

/**
 * Diretório "nu" para medir o PI sem configuração de projeto nenhuma.
 * O PI só lê `.pi/settings.json` no cwd — fora do repo ele sobe sem extensão.
 */
function makeBareCwd() {
  return mkdtempSync(path.join(os.tmpdir(), "selfevopi-bare-"));
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

/** Lê o `usage` do stream JSON do PI e devolve os tokens de entrada. */
function readUsage(stdout) {
  for (const line of String(stdout || "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const evt = JSON.parse(line);
      const u = evt.usage;
      if (u && (u.input || u.cacheRead || u.cacheWrite)) {
        return (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
      }
    } catch {
      /* linha não-JSON: segue */
    }
  }
  return null;
}

const { cmd, prefix } = resolvePi();
const runs = Math.max(1, Number(argValue("runs", "3")));

/**
 * Executa o PI uma vez na configuração dada e devolve os tokens de entrada.
 * `cwd` é sempre o repositório: a extensão só é carregada com -e explícito.
 */
function measureOnce({ extensions = [], memoryDir = null, cwd = ROOT } = {}) {
  const args = [...prefix, "--model", MODEL, "--mode", "json", "--approve"];
  for (const ext of extensions) args.push("-e", ext);
  args.push("--print", "responda apenas: ok");

  const env = { ...process.env };
  if (memoryDir) env.SELFEOPI_MEMORY_DIR = memoryDir;
  else delete env.SELFEOPI_MEMORY_DIR;

  const res = spawnSync(cmd, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
    timeout: 180_000,
  });
  return { tokens: readUsage(res.stdout), status: res.status, stderr: String(res.stderr || "").slice(0, 400) };
}

/** Mede uma configuração `runs` vezes e devolve a mediana (mais robusta que a média). */
function measureConfig(label, opts) {
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const r = measureOnce(opts);
    if (r.tokens != null) samples.push(r.tokens);
    else if (i === 0) process.stderr.write(`  [${label}] sem usage: ${r.stderr || `exit ${r.status}`}\n`);
  }
  samples.sort((a, b) => a - b);
  const median = samples.length ? samples[Math.floor(samples.length / 2)] : null;
  return { label, median, samples, runs: samples.length };
}

/* ------------------------------------------------------------------ */
/* Entradas de memória sintéticas                                      */
/* ------------------------------------------------------------------ */

const TYPICAL = [
  "Convenções de código: funções pequenas, sem comentários óbvios.",
  "A suíte de evals roda com extensões via -e; workdir em .pi/harness/tmp.",
  "O roteador mantém a família or desativada por decisão do usuário.",
  "Sandbox em três camadas: gate estático, permission model, job objects.",
  "Handoff é contrato curto, nunca transcrição da conversa do orquestrador.",
  "Nunca imprimir, commitar ou logar chaves de API.",
  "Testes são escritos antes ou junto do código.",
  "O PI só lê .pi/settings.json no cwd e não sobe a árvore.",
  "verify.mjs roda fora do sandbox; o artefato que ele invoca roda dentro.",
  "Linhas corrompidas de JSONL são podadas por condição, nunca por índice.",
  "Cold start medido: 405 ms; meta do plano: abaixo de 500 ms.",
  "Cada artefato gerado precisa passar pelo gate estático antes de executar.",
  "O loop evolutivo não edita evals/ nem core/governance/.",
  "Rollback automático usa git revert e confirma a suíte verde.",
  "Cada nó do grafo salva checkpoint antes de seguir.",
];

/** Cria um store de memória temporário com `n` entradas e devolve { dir, limpar }. */
function makeMemoryDir(n) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "selfevopi-mem-"));
  const lines = [];
  for (let i = 0; i < n; i++) {
    const text = TYPICAL[i % TYPICAL.length];
    lines.push(
      JSON.stringify({
        id: `e${String(i).padStart(3, "0")}`,
        at: new Date(Date.UTC(2026, 10, 16, 12, 0, i)).toISOString(),
        text,
        tags: ["project"],
        source: "medicao",
      }),
    );
  }
  writeFileSync(path.join(dir, "project.jsonl"), lines.join("\n") + "\n", "utf8");
  return { dir, limpar: () => rmSync(dir, { recursive: true, force: true }) };
}

/* ------------------------------------------------------------------ */
/* Execução                                                            */
/* ------------------------------------------------------------------ */

const asJson = process.argv.includes("--json");
const bareCwd = makeBareCwd();
const emptyMem = makeMemoryDir(0);
const shortMem = makeMemoryDir(5);
const fullMem = makeMemoryDir(20);

const results = [];
try {
  // 1) PI nu, fora do repositório: sem .pi/settings.json, sem extensão.
  results.push(measureConfig("pi-puro", { cwd: bareCwd }));
  // 2) PI com a extensão de memória (o incremento autoral do SelfEvoPI).
  results.push(measureConfig("memoria-vazia", { extensions: [MEMORY_EXT], memoryDir: emptyMem.dir }));
  results.push(measureConfig("memoria-curta", { extensions: [MEMORY_EXT], memoryDir: shortMem.dir }));
  results.push(measureConfig("memoria-cheia", { extensions: [MEMORY_EXT], memoryDir: fullMem.dir }));
  // 5) pi-subagents, carregado sob demanda — documenta o custo da camada 3.
  const subagents = path.join(ROOT, ".pi", "npm", "node_modules", "pi-subagents", "bundle", "index.js");
  if (existsSync(subagents)) {
    results.push(measureConfig("pi+subagents", { extensions: [subagents], memoryDir: emptyMem.dir }));
  }
} finally {
  rmSync(bareCwd, { recursive: true, force: true });
  emptyMem.limpar();
  shortMem.limpar();
  fullMem.limpar();
}

const base = results[0].median; // PI nu: zero SelfEvoPI
const increment = (r) => (base != null && r.median != null ? r.median - base : null);
const author = results.filter((r) => r.label.startsWith("memoria"));
// Só compara configurações com incremento mensurável (não-null). Sem isso,
// `null > null === false` fazia o reduce escolher o primeiro arbitrariamente.
const mensuraveis = author.filter((r) => increment(r) != null);
const worst = mensuraveis.length
  ? mensuraveis.reduce((a, b) => (increment(b) > increment(a) ? b : a), mensuraveis[0])
  : null;
const worstIncrement = worst ? increment(worst) : null;
const withinBudget = worstIncrement != null ? worstIncrement <= BUDGET_TOKENS : null;

const report = {
  model: MODEL,
  runs,
  budgetTokens: BUDGET_TOKENS,
  results: results.map((r) => ({
    config: r.label,
    medianTokens: r.median,
    incrementOverPi: increment(r),
    samples: r.samples,
  })),
  worstCase: { config: worst?.label ?? null, increment: worstIncrement },
  withinBudget,
  verdict:
    worstIncrement == null
      ? "indeterminado"
      : withinBudget
        ? `dentro do orcamento (${worstIncrement} de ${BUDGET_TOKENS} tokens)`
        : `FORA do orcamento (${worstIncrement} > ${BUDGET_TOKENS})`,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Incremento de prompt do SelfEvoPI (${MODEL})`);
  console.log(`  ${runs} execução(ões) por configuração · mediana\n`);
  for (const r of report.results) {
    const inc = r.incrementOverPi == null ? "—" : `+${r.incrementOverPi}`;
    const bar = r.medianTokens == null ? "sem medida" : `${r.medianTokens} tok  (${inc})`;
    console.log(`  ${r.config.padEnd(14)} ${bar}`);
  }
  console.log("");
  console.log(`  Orçamento do plano      ${BUDGET_TOKENS} tokens`);
  console.log(`  Pior caso               ${worstIncrement == null ? "—" : worstIncrement + " tokens"}`);
  console.log(`  Veredito                ${report.verdict}`);
}

process.exit(withinBudget === false ? 2 : 0);