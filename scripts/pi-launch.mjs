#!/usr/bin/env node
/**
 * pi-launch.mjs — lançador do PI com extensões **sob demanda**.
 *
 * Motivo: o orçamento do projeto é de 1.500 tokens de prompt, e uma única
 * extensão de orquestração (pi-subagents) custa ~1.870 tokens por turno. O plano
 * manda carregar extensões sob demanda — este launcher é o que torna isso real:
 *
 *   node scripts/pi-launch.mjs --memory -- responda apenas: ok
 *   node scripts/pi-launch.mjs --subagents -- ask "explore o repo"
 *   node scripts/pi-launch.mjs --list
 *
 * Flags:
 *   --memory      carrega a extensão de memória (core/memory/extension.mjs)
 *   --subagents   carrega o pi-subagents (instalado em .pi/npm)
 *   --list        só mostra o que está disponível e o custo medido de cada um
 *   -- <args>     tudo depois de `--` vai para o PI sem alteração
 *
 * O que não é pedido não carrega. É o "lazy-loading" do plano, na prática.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");

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

/** Extensões disponíveis, com o custo medido (tokens por turno). */
export const AVAILABLE = Object.freeze({
  memory: {
    path: path.join(ROOT, "core", "memory", "extension.mjs"),
    tokens: 511,
    note: "memória em 3 níveis; teto de 400 tokens por turno",
  },
  subagents: {
    path: path.join(ROOT, ".pi", "npm", "node_modules", "pi-subagents", "bundle", "index.js"),
    tokens: 1_870,
    note: "orquestração de subagentes; sozinho estoura o orçamento de 1.500",
  },
});

function parse(argv) {
  const flags = new Set();
  let rest = [];
  let afterDash = false;
  for (const a of argv) {
    if (afterDash) {
      rest.push(a);
      continue;
    }
    if (a === "--") {
      afterDash = true;
      continue;
    }
    if (a === "--memory") flags.add("memory");
    else if (a === "--subagents") flags.add("subagents");
    else rest.push(a);
  }
  return { flags, rest };
}

const { flags, rest } = parse(process.argv.slice(2));

if (process.argv.includes("--list")) {
  console.log("Extensões disponíveis (custo medido em tokens por turno):");
  for (const [name, info] of Object.entries(AVAILABLE)) {
    const present = existsSync(info.path);
    console.log(`  --${name.padEnd(11)} ${String(info.tokens).padStart(5)} tok  ${present ? "" : "[ausente] "}${info.note}`);
  }
  console.log("");
  console.log("Sem flags, o PI sobe com o system prompt puro (custo medido por scripts/measure-overhead.mjs).");
  process.exit(0);
}

const { cmd, prefix } = resolvePi();
const args = [...prefix];
for (const name of flags) {
  const ext = AVAILABLE[name];
  if (!ext) {
    process.stderr.write(`pi-launch: extensão desconhecida "${name}"\n`);
    process.exit(2);
  }
  if (!existsSync(ext.path)) {
    process.stderr.write(`pi-launch: "${name}" não encontrado em ${ext.path}\n`);
    process.exit(2);
  }
  args.push("-e", ext.path);
}
args.push(...rest);

const child = spawn(cmd, args, { stdio: "inherit", windowsHide: true });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
child.on("error", (err) => {
  process.stderr.write(`pi-launch: falha ao iniciar o PI: ${err.message}\n`);
  process.exit(1);
});