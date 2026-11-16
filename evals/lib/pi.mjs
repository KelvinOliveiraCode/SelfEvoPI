/**
 * pi.mjs — executor do PI Coding Agent para as evals.
 *
 * Roda `pi --model <ref> --mode json --print <prompt>` num workspace e devolve
 * o texto final, o uso de tokens e a duração. O modo json emite uma linha por
 * evento; o objeto `usage` do último turno traz a medição real do provider.
 *
 * Nota de Windows: a stdout do PI e redirecionada para um arquivo temporario em
 * vez de um pipe. Com pipe, o processo filho fica preso quando o pai tem um
 * event loop ativo (async), e o chamador so recebe o resultado no timeout.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { open, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

/**
 * No Windows o `pi` instalado por npm e um shim .cmd, que o execFile nao
 * executa. Resolve o entrypoint JS real e roda com o proprio Node.
 */
function resolvePi() {
  if (process.env.PI_BIN) {
    if (process.env.PI_BIN.endsWith(".js")) return { cmd: process.execPath, prefix: [process.env.PI_BIN] };
    return { cmd: process.env.PI_BIN, prefix: [] };
  }
  if (process.platform === "win32") {
    const bundle = path.join(
      process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming"),
      "npm", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js",
    );
    if (existsSync(bundle)) return { cmd: process.execPath, prefix: [bundle] };
  }
  return { cmd: "pi", prefix: [] };
}

/**
 * Lista as extensões **habilitadas** no projeto.
 *
 * Lê `.pi/settings.json` (`{ "packages": ["npm:<nome>", ...] }`) e devolve o
 * bundle de cada pacote habilitado. Só o que está no settings carrega — é isso
 * que torna o carregamento preguiçoso de verdade: uma extensão instalada em
 * `.pi/npm/` mas fora do settings não entra no prompt.
 *
 * Fallback: se o settings não existir ou não tiver `packages`, devolve vazio.
 */
export async function projectExtensions(root) {
  const base = path.join(root, ".pi", "npm", "node_modules");
  let declared = null;
  try {
    const raw = await (await import("node:fs/promises")).readFile(
      path.join(root, ".pi", "settings.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.packages)) declared = parsed.packages;
  } catch {
    declared = null; // sem settings: nada habilitado
  }
  if (!declared) return [];

  const out = [];
  for (const spec of declared) {
    const name = typeof spec === "string" && spec.startsWith("npm:") ? spec.slice(4) : null;
    if (!name) continue;
    const bundle = path.join(base, name, "bundle", "index.js");
    if (existsSync(bundle)) out.push(bundle);
  }
  return out;
}

/** Executa o PI e resume o stream JSON. */
export async function runPi({
  model,
  prompt,
  cwd,
  timeoutMs = 180_000,
  extraArgs = [],
  approveProjectPackages = true,
  extensions = null,
}) {
  const { cmd, prefix } = resolvePi();
  // `--approve` confia nos pacotes locais do projeto (.pi/settings.json). Sem ele as
  // extensões instaladas no projeto não carregam e o overhead medido fica irreal.
  const args = [...prefix, "--model", model, "--mode", "json"];
  if (approveProjectPackages) args.push("--approve");
  // O PI só procura .pi/settings.json no cwd. Como as tarefas rodam em workdirs
  // temporários, as extensões do projeto vão explícitas com -e.
  const loaded = extensions ?? (await projectExtensions(path.resolve(import.meta.dirname, "..", "..")));
  for (const ext of loaded) args.push("-e", ext);
  args.push("--print", ...extraArgs, prompt);
  const started = performance.now();

  const outPath = path.join(
    os.tmpdir(),
    `pi-out-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.jsonl`,
  );
  const tmp = await open(outPath, "w");
  let stderr = "";
  let code = 0;

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        cwd,
        stdio: ["ignore", tmp.fd, "pipe"],
        windowsHide: true,
        env: { ...process.env, PI_TELEMETRY: "0", NO_COLOR: "1" },
      });

      child.stderr?.on("data", (d) => {
        if (stderr.length < 64_000) stderr += d.toString();
      });

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`timeout de ${timeoutMs} ms ao executar o PI`));
      }, timeoutMs);

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (exitCode) => {
        clearTimeout(timer);
        code = exitCode ?? 1;
        resolve();
      });
    });
  } finally {
    await tmp.close().catch(() => {});
  }

  const stdout = await readFile(outPath, "utf8").catch(() => "");
  await rm(outPath, { force: true }).catch(() => {});

  const durationMs = performance.now() - started;
  if (code !== 0) {
    const detail = stderr.trim().split("\n")[0] || stdout.trim().split("\n")[0] || `exit ${code}`;
    throw new Error(`pi saiu com código ${code}: ${detail.slice(0, 300)}`);
  }

  const { text, usage, events, toolCalls } = parse(stdout);

  // O provider pode recusar sem erro de processo: exit 0, zero token e nenhuma
  // resposta. Cota diaria esgotada (ex.: free tier do OpenRouter) chega assim.
  // Tratar como falha evita que o checker receba texto vazio e a tarefa "passe".
  if (usage.total === 0 && text === "") {
    const err = new Error(
      "pi não retornou conteúdo (0 tokens, resposta vazia) — provider possivelmente sem cota",
    );
    err.code = "EMPTY_RESPONSE";
    throw err;
  }

  return { text, usage, events, toolCalls, durationMs };
}

/** Converte o stream JSON do PI em texto + ultimo usage. */
export function parse(stdout) {
  let text = "";
  let usage = null;
  let events = 0;
  let toolCalls = 0;

  for (const line of String(stdout).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let evt;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      continue;
    }
    events++;
    if (evt.usage) usage = evt.usage;
    if (evt.type === "tool_call" || evt.type === "tool_result") toolCalls++;
    // apenas message_end: turn_end repete o mesmo texto e duplicaria a saida
    const msg = evt.type === "message_end" ? evt.message : null;
    if (msg?.role === "assistant") {
      const parts = Array.isArray(msg.content) ? msg.content : [];
      const chunk = parts
        .filter((p) => p?.type === "text" && typeof p.text === "string")
        .map((p) => p.text)
        .join("");
      if (chunk) text += chunk;
    }
  }

  return { text: text.trim(), usage: normalizeUsage(usage), events, toolCalls };
}

function normalizeUsage(u) {
  if (!u) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0, costUsd: 0 };
  return {
    input: Number(u.input) || 0,
    output: Number(u.output) || 0,
    cacheRead: Number(u.cacheRead) || 0,
    cacheWrite: Number(u.cacheWrite) || 0,
    reasoning: Number(u.reasoning) || 0,
    total: Number(u.totalTokens) || 0,
    costUsd: Number(u.cost?.total) || 0,
  };
}