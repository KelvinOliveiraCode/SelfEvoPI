#!/usr/bin/env node
/**
 * smoke-llm.mjs — teste manual do gerador com modelo real.
 *
 * Uso: node scripts/smoke-llm.mjs [--model <id>]
 * Gera um artefato num diretório temporário, roda o verify e imprime o resultado.
 * Não toca no repositório: o artefato vive em os.tmpdir() e é removido no fim.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { createArtifactRequest } from "../core/forge/contract.mjs";
import { generateWithModel, ForgeGenerationError } from "../core/forge/generate-llm.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const MODEL = process.argv.includes("--model")
  ? process.argv[process.argv.indexOf("--model") + 1]
  : process.env.SELFEOPI_MODEL || "kilo1/nvidia/nemotron-3-ultra-550b-a55b:free";

function bundlePath() {
  return path.join(
    process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming"),
    "npm", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js",
  );
}

async function runModel({ prompt, timeoutMs = 180_000 }) {
  const cmd = process.platform === "win32" ? process.execPath : "pi";
  const prefix = process.platform === "win32" ? [bundlePath()] : [];
  const res = spawnSync(cmd, [...prefix, "--model", MODEL, "--approve", "--mode", "text", "--print", prompt], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
    timeout: timeoutMs,
  });
  if (res.status !== 0) {
    throw new Error(`pi saiu com código ${res.status}: ${String(res.stderr || res.stdout || "").slice(0, 300)}`);
  }
  return { text: String(res.stdout ?? "") };
}

const request = createArtifactRequest({
  goal: "calcular o IMC (peso em kg / altura em m ao quadrado)",
  kind: "cli",
  inputs: { peso: "peso em quilogramas", altura: "altura em metros" },
  outputs: { imc: "valor do IMC com duas casas", classificacao: "Abaixo do peso, Normal, Sobrepeso ou Obesidade" },
  forbidden: ["acessar rede", "escrever arquivos"],
  tests: [
    { name: "imc 70/1.75", command: "node cli.mjs --peso 70 --altura 1.75", expect: "imc 22.86" },
    { name: "sem argumentos", command: "node cli.mjs", expect: "exit 2" },
  ],
});

const dir = mkdtempSync(path.join(tmpdir(), "selfevopi-smoke-llm-"));
try {
  process.stdout.write(`modelo: ${MODEL}\n`);
  const res = await generateWithModel({ request, outDir: dir, runModel, model: MODEL });
  process.stdout.write(`arquivos: ${res.files.join(", ")}\n\n`);
  process.stdout.write("--- cli.mjs ---\n");
  process.stdout.write(readFileSync(path.join(dir, "cli.mjs"), "utf8"));
  process.stdout.write("\n--- execucao: --peso 70 --altura 1.75 ---\n");
  const run = spawnSync(process.execPath, [path.join(dir, "cli.mjs"), "--peso", "70", "--altura", "1.75"], {
    encoding: "utf8",
    windowsHide: true,
  });
  process.stdout.write(`exit ${run.status}\n${run.stdout}${run.stderr}`);
} catch (err) {
  if (err instanceof ForgeGenerationError) {
    process.stderr.write(`falha de geração [${err.code}]: ${err.message}\n`);
    process.exitCode = 1;
  } else {
    throw err;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}