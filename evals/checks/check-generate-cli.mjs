#!/usr/bin/env node
/**
 * Grupo B (ferramenta) — gerador de CLI do Forge (core/forge/generate-cli.mjs).
 * Transforma um pedido de artefato (createArtifactRequest) num CLI de verdade e
 * prova que o artefato gerado funciona: valida entradas, imprime JSON e sai 2
 * quando falta argumento obrigatório. Também recusa sobrescrever.
 * Determinístico, sem chamadas de modelo.
 */
import { execFile } from "node:child_process";
import { mkdtemp, access, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { generateCli } = await import(pathToFileURL(path.join(ROOT, "core", "forge", "generate-cli.mjs")).href);
const { createArtifactRequest } = await import(pathToFileURL(path.join(ROOT, "core", "forge", "contract.mjs")).href);

const failures = [];

const workdir = process.env.EVAL_WORKDIR || (await mkdtemp(path.join(os.tmpdir(), "b6-cli-")));
const outDir = path.join(workdir, "cli-gerado");

try {
  const request = createArtifactRequest({
    goal: "somar dois numeros",
    kind: "cli",
    inputs: { a: "primeiro numero", b: "segundo numero" },
    outputs: { soma: "resultado da soma" },
    forbidden: ["acessar rede"],
    tests: [{ name: "soma 2+3", command: "node cli.mjs --a 2 --b 3", expect: "ok true" }],
  });

  // 1. gera os três arquivos
  await generateCli(request, outDir);
  for (const f of ["cli.mjs", "README.md", "verify.mjs"]) {
    try {
      await access(path.join(outDir, f));
    } catch {
      failures.push(`arquivo gerado ausente: ${f}`);
    }
  }

  const cliPath = path.join(outDir, "cli.mjs");

  // 2. com todas as entradas: exit 0 e JSON com ok:true e os inputs
  const r1 = await execFileAsync(process.execPath, [cliPath, "--a", "2", "--b", "3"], { timeout: 20000 });
  let j1;
  try {
    j1 = JSON.parse(String(r1.stdout).trim());
  } catch {
    failures.push("cli não imprimiu JSON válido com entradas corretas");
  }
  if (j1 && j1.ok !== true) failures.push(`cli ok=${j1?.ok}, esperado true`);
  if (j1 && (j1.inputs?.a !== "2" || j1.inputs?.b !== "3")) failures.push("cli não ecoou as entradas --a/--b");
  if (j1 && !("soma" in (j1.outputs ?? {}))) failures.push("cli não declarou a saída 'soma'");

  // 3. sem uma entrada obrigatória: exit 2
  let code2 = 0;
  try {
    await execFileAsync(process.execPath, [cliPath, "--a", "2"], { timeout: 20000 });
  } catch (err) {
    code2 = typeof err.code === "number" ? err.code : 1;
  }
  if (code2 !== 2) failures.push(`cli sem --b: exit ${code2}, esperado 2`);

  // 4. não sobrescreve: gerar de novo no mesmo dir recusa
  let refused = false;
  try {
    await generateCli(request, outDir);
  } catch {
    refused = true;
  }
  if (!refused) failures.push("generateCli não recusou sobrescrever cli.mjs existente");
} finally {
  if (!process.env.EVAL_WORKDIR) await rm(workdir, { recursive: true, force: true }).catch(() => {});
}

if (failures.length > 0) {
  console.error("falhou:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { arquivos: 3, casos: 4 } }));
console.error("ok: generate-cli produz CLI que valida entradas, imprime JSON e recusa sobrescrever");