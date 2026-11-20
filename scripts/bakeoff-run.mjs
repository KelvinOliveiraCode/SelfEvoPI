#!/usr/bin/env node
// Bake-off de SOBRECARGA REAL — mede o que cada pacote custa dentro de uma
// sessão Pi de verdade: TTFT, tokens de prompt/tool schemas, tools expostas e
// tempo de uma tarefa trivial.
//
// Uso:
//   node scripts/bakeoff-run.mjs
//   node scripts/bakeoff-run.mjs --model=kilo1/reflection/beam-free
//   node scripts/bakeoff-run.mjs pi-subagents @arhen/pi-core-subagent
//
// Como funciona, por pacote:
//   1. projeto temporário + `npm install --ignore-scripts --no-audit --no-fund`
//      (nada é instalado no sistema; o prefixo é o diretório temporário)
//   2. sessão de controle: pi sem extensão, mesmo config/modelo/prompt
//   3. sessão de tratamento: pi -e <caminho do pacote>
//   4. lê o system message persistido em cada sessão e mede tokens com o
//      PRÓPRIO estimador do Pi (@earendil-works/pi-ai/utils/estimate) — o mesmo
//      que alimenta a compactação e o rodapé de contexto. Não é chute meu.
//   5. TTFT e tempo total vêm do stream JSONL carimbado no relógio.
//
// O diretório temporário é removido ao final, inclusive em caso de erro.
// Nada é instalado globalmente e ~/.pi/agent/models.json nunca é tocado:
// a config é uma CÓPIA num PI_CODING_AGENT_DIR temporário.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const IS_WIN = process.platform === "win32";
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_PACKAGES = [
  "pi-subagents",
  "pi-agent-orchestrator",
  "@arhen/pi-core-subagent",
];

// Modelo pequeno e rápido: o objetivo é comparar pacotes, não medir modelo.
// Precisa ser o MESMO nas duas sessões, senão a comparação não vale nada.
const DEFAULT_MODEL = process.env.PI_BAKEOFF_MODEL || "kilo1/reflection/beam-free";
const PROMPT = "Reply with exactly: ok";

const PKG_NAME_RE = /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

// --------------------------------------------------------------- utilidades

function parseArgs(argv) {
  const opts = { timeout: DEFAULT_TIMEOUT_MS, model: DEFAULT_MODEL, packages: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--model=")) opts.model = arg.slice("--model=".length);
    else if (arg === "--model") { opts.model = argv[i + 1]; i += 1; }
    else if (arg.startsWith("--timeout=")) {
      const n = Number(arg.slice("--timeout=".length));
      if (Number.isFinite(n) && n > 0) opts.timeout = n;
    } else if (arg.startsWith("-")) {
      // flags desconhecidas não travam a rodada
    } else opts.packages.push(arg);
  }
  return opts;
}

/** Roda um comando capturando stdout/stderr; nunca lança por falha de processo. */
function runCapture(cmd, args, { timeout = DEFAULT_TIMEOUT_MS, cwd, env } = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = spawn(cmd, args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, npm_config_yes: "true", npm_config_progress: "false", ...env },
      // stdin fechado: processo filho com pipe aberto espera EOF e congela
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killTree(child);
      resolve({ ok: false, stdout, stderr, code: null, timedOut: true });
    }, timeout);

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: `${stderr}\n${err.message}`, code: null, timedOut: false });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr, code, timedOut: false });
    });
  });
}

/** Remove uma árvore com retentativas: no Windows o Pi escreve auth.json e
 *  models-store.json ao sair e segura o diretório por alguns milissegundos
 *  (EBUSY/EPERM). Sem esta janela sobra lixo em %TEMP%. */
async function rmrf(dir) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
}

/**
 * Mata a árvore do processo no timeout. No Windows `child.kill()` derruba só o
 * processo direto e deixa netos órfãos (o Pi spawna subprocessos); `taskkill /T`
 * alcança a árvore inteira. Fora do Windows, SIGKILL no grupo.
 */
function killTree(child) {
  if (!child || child.pid == null) return;
  if (IS_WIN) {
    try {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } catch {
      /* best-effort */
    }
    return;
  }
  try {
    child.kill("SIGKILL");
  } catch {
    /* já morreu */
  }
}

// ------------------------------------------------------- localizar o Pi CLI

/**
 * Resolve o cli.js do Pi e a raiz do pacote. O `pi` do sistema é um .cmd, que
 * o Node 24 não spawna (EINVAL, CVE-2024-27980) — então rodamos o cli.js
 * direto com o Node, como docs/fase0/evals.md já faz.
 */
async function resolvePi() {
  const readVersion = async (root) => {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
      return { version: pkg.version ?? null };
    } catch {
      return { version: null };
    }
  };

  if (process.env.PI_CLI) {
    const p = path.resolve(process.env.PI_CLI);
    if (existsSync(p)) {
      const root = path.resolve(path.dirname(p), "..", "..");
      return { cli: p, root, ...(await readVersion(root)) };
    }
  }

  const locator = IS_WIN ? "where" : "which";
  const found = await runCapture(locator, ["pi"], { timeout: 15_000 });
  const bins = found.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (const bin of bins) {
    const guesses = [
      path.join(path.dirname(bin), "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js"),
      path.join(path.dirname(bin), "..", "lib", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js"),
    ];
    for (const g of guesses) {
      const abs = path.resolve(g);
      if (existsSync(abs)) {
        const root = path.resolve(path.dirname(abs), "..", "..");
        return { cli: abs, root, ...(await readVersion(root)) };
      }
    }
  }

  const home = path.join(
    os.homedir(), "AppData", "Roaming", "npm", "node_modules",
    "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js",
  );
  if (existsSync(home)) {
    const root = path.resolve(path.dirname(home), "..", "..");
    return { cli: home, root, ...(await readVersion(root)) };
  }

  throw new Error("não encontrei o cli.js do Pi (defina PI_CLI=/caminho/cli.js)");
}

/**
 * Importa o estimador de tokens do próprio Pi. Medir "tokens" com uma conta
 * minha seria estimativa; este é o mesmo cálculo que o Pi usa para decidir
 * compactação — a unidade em que o custo aparece de verdade.
 */
async function loadPiEstimator(piRoot) {
  const estimatePath = path.join(
    piRoot, "node_modules", "@earendil-works", "pi-ai", "dist", "utils", "estimate.js",
  );
  const textPath = path.join(
    piRoot, "node_modules", "@earendil-works", "pi-ai", "dist", "utils", "text.js",
  );

  if (!existsSync(estimatePath) || !existsSync(textPath)) return null;

  try {
    const [estimate, text] = await Promise.all([
      import(pathToFileURL(estimatePath).href),
      import(pathToFileURL(textPath).href),
    ]);
    if (typeof estimate.estimateMessageTokens !== "function") return null;
    return {
      estimateMessageTokens: estimate.estimateMessageTokens,
      getSystemMessageText: typeof text.getSystemMessageText === "function" ? text.getSystemMessageText : null,
    };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- sessão Pi

/**
 * Roda uma sessão Pi e devolve eventos, TTFT e tempo total.
 * O stdout é drenado continuamente — um leitor que para trava o Pi quando o
 * buffer da pipe enche (docs/json.md).
 */
function runPiSession({ cli, args, cwd, env, timeout }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const events = [];
    let buf = "";
    let ttftMs = null;
    let stderr = "";
    let settled = false;

    const child = spawn(process.execPath, [cli, ...args], {
      cwd,
      windowsHide: true,
      env,
      // stdin fechado: um pipe aberto faz o Pi esperar EOF e congelar até o
      // timeout. Armadilha documentada em docs/fase0/evals.md.
      stdio: ["ignore", "pipe", "pipe"],
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ events, ttftMs, totalMs: Date.now() - started, stderr, ...result });
    };

    const timer = setTimeout(() => {
      killTree(child);
      finish({ ok: false, timedOut: true, code: null });
    }, timeout);

    child.stderr.on("data", (d) => { stderr += d.toString(); });

    child.stdout.on("data", (chunk) => {
      buf += chunk.toString("utf8");

      // split só em LF: readline quebraria em separadores Unicode (docs/json.md)
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;

        let e;
        try { e = JSON.parse(line); } catch { continue; }
        events.push(e);

        // TTFT = primeiro token do assistente (texto ou raciocínio)
        if (ttftMs === null && e.type === "message_update") {
          const t = e.assistantMessageEvent?.type;
          if (t === "text_delta" || t === "thinking_delta") ttftMs = Date.now() - started;
        }
      }
    });

    child.on("error", (err) => {
      stderr += `\n${err.message}`;
      finish({ ok: false, timedOut: false, code: null });
    });

    child.on("close", (code) => finish({ ok: code === 0, timedOut: false, code }));
  });
}

/** Lê a mensagem de sistema persistida na sessão mais recente do diretório. */
async function readSystemMessage(sessionDir) {
  let names;
  try {
    names = await fs.readdir(sessionDir);
  } catch {
    return { error: "diretório de sessão não criado" };
  }
  const files = names.filter((n) => n.endsWith(".jsonl")).sort();
  if (files.length === 0) return { error: "nenhum arquivo de sessão" };

  const file = files[files.length - 1];
  const raw = await fs.readFile(path.join(sessionDir, file), "utf8");

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== "message") continue;
    const m = e.message;
    if (m?.role !== "system") continue;
    return { file, message: m };
  }
  return { error: "sessão sem system message" };
}

const CHARS_PER_TOKEN = 3.5; // constante do próprio estimador do Pi

/** System prompt, schemas de tool e tokens — tudo medido, nada estimado por mim. */
function describeSystemMessage(systemMessage, estimator) {
  const sections = systemMessage.sections ?? {};
  const tools = systemMessage.toolsAdded ?? [];

  let promptText;
  if (estimator?.getSystemMessageText) {
    promptText = String(estimator.getSystemMessageText(systemMessage) ?? "");
  } else {
    // fallback: soma das seções, que é o que getSystemMessageText monta
    promptText = Object.values(sections).map((v) => String(v ?? "")).join("\n");
  }

  const toolsJson = JSON.stringify(tools);
  const promptChars = promptText.length;
  const total = estimator
    ? estimator.estimateMessageTokens(systemMessage)
    : Math.ceil((promptChars + toolsJson.length) / CHARS_PER_TOKEN);

  return {
    sections: Object.keys(sections),
    sectionBytes: Object.fromEntries(
      Object.entries(sections).map(([k, v]) => [k, Buffer.byteLength(String(v ?? ""))]),
    ),
    promptChars,
    promptTokens: Math.ceil(promptChars / CHARS_PER_TOKEN),
    toolCount: tools.length,
    toolNames: tools.map((t) => t.name),
    toolsJsonBytes: Buffer.byteLength(toolsJson),
    toolsTokens: Math.ceil(toolsJson.length / CHARS_PER_TOKEN),
    totalTokens: total,
  };
}

// ---------------------------------------------------------------- por pacote

/** Instala o pacote num diretório temporário. Nada vai para o sistema. */
async function npmInstall(pkg, prefixDir, timeout) {
  const args = [
    "install", pkg,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--prefix", prefixDir,
  ];

  // npm_execpath existe quando rodamos sob npm; fora dele, resolve o cli.js.
  if (process.env.npm_execpath) {
    return runCapture(process.execPath, [process.env.npm_execpath, ...args], { timeout, cwd: prefixDir });
  }

  const locator = IS_WIN ? "where" : "which";
  const found = await runCapture(locator, [IS_WIN ? "npm.cmd" : "npm"], { timeout: 15_000 });
  const bins = found.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const bin of bins) {
    const cand = path.resolve(path.dirname(bin), "node_modules", "npm", "bin", "npm-cli.js");
    if (existsSync(cand)) return runCapture(process.execPath, [cand, ...args], { timeout, cwd: prefixDir });
  }
  return runCapture(IS_WIN ? "npm.cmd" : "npm", args, { timeout, cwd: prefixDir });
}

function tail(text, n = 3) {
  return (text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-n).join(" | ");
}

async function measurePackage(pkg, ctx) {
  const { cli, estimator, modelsSource, timeout, model } = ctx;
  const slug = pkg.replace(/[^a-z0-9._-]/gi, "_");
  const dir = path.join(ctx.tmpRoot, slug);
  await fs.mkdir(dir, { recursive: true });

  const out = {
    name: pkg,
    ok: false,
    installed: false,
    extensionPath: null,
    loaded: false,
    installError: null,
    loadError: null,
    treated: null,
    overhead: null,
  };

  if (!PKG_NAME_RE.test(pkg)) {
    out.installError = "nome de pacote inválido";
    await rmrf(dir);
    return out;
  }

  // 1) instalar no diretório temporário
  const proj = path.join(dir, "proj");
  await fs.mkdir(proj, { recursive: true });
  const install = await npmInstall(pkg, proj, timeout);

  if (!install.ok) {
    out.installError = install.timedOut
      ? `timeout após ${timeout}ms`
      : tail(install.stderr || install.stdout, 2) || "npm install falhou";
    await rmrf(dir);
    return out;
  }
  out.installed = true;

  const extPath = path.join(proj, "node_modules", ...pkg.split("/"));
  if (!existsSync(extPath)) {
    out.installError = `instalou, mas ${extPath} não existe`;
    await rmrf(dir);
    return out;
  }
  out.extensionPath = extPath;

  // 2) sessão de tratamento — config é cópia num PI_CODING_AGENT_DIR temporário
  const agentDir = path.join(dir, "agent");
  await fs.mkdir(agentDir, { recursive: true });
  await fs.copyFile(modelsSource, path.join(agentDir, "models.json")).catch(() => {});

  const sessDir = path.join(dir, "sess");
  await fs.mkdir(sessDir, { recursive: true });

  const treat = await runPiSession({
    cli,
    args: [
      "--mode", "json",
      "-ne",                    // isola extensões descobertas; -e explícito ainda carrega
      "-nc",                    // sem AGENTS.md/CLAUDE.md (o cwd é temporário anyway)
      // -ns e -np NÃO entram aqui: desligar skills/prompt templates apagaria
      // justamente o que o pi-subagents injeta no contexto. O isolamento do
      // config do usuário vem do PI_CODING_AGENT_DIR temporário, não dos flags.
      "--session-dir", sessDir,
      "--model", model,
      PROMPT,
      "-e", extPath,
    ],
    cwd: dir,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
    timeout,
  });

  out.treated = {
    exitCode: treat.code,
    timedOut: treat.timedOut,
    ttftMs: treat.ttftMs,
    totalMs: treat.totalMs,
    events: treat.events.length,
    stderrTail: tail(treat.stderr, 3),
  };

  const sys = await readSystemMessage(sessDir);
  if (sys.error) {
    out.loadError = treat.timedOut ? `timeout após ${timeout}ms` : sys.error;
    out.treated.stderr = (treat.stderr || "").slice(-1500);
    await rmrf(dir);
    return out;
  }

  out.treated.system = describeSystemMessage(sys.message, estimator);

  // 3) falha de carga: o Pi segue rodando e só avisa no stderr
  const loadNoise = (treat.stderr || "").match(/(?:failed to load extension|could not load extension|error loading extension|cannot find module|jiti transform failed)[^\n]*/i);
  out.loaded = treat.ok !== false && !loadNoise;
  if (loadNoise) out.loadError = loadNoise[0].slice(0, 300);
  if (!treat.ok && !out.loadError) out.loadError = `sessão terminou com exit ${treat.code}`;

  await rmrf(dir);
  out.ok = true;
  return out;
}

/** Sessão de controle: mesmo modelo, mesmo prompt, nenhuma extensão. */
async function measureControl(ctx) {
  const { cli, estimator, timeout, model, modelsSource } = ctx;
  const dir = path.join(ctx.tmpRoot, "_controle");
  await fs.mkdir(dir, { recursive: true });

  const agentDir = path.join(dir, "agent");
  await fs.mkdir(agentDir, { recursive: true });
  await fs.copyFile(modelsSource, path.join(agentDir, "models.json")).catch(() => {});

  const sessDir = path.join(dir, "sess");
  await fs.mkdir(sessDir, { recursive: true });

  const ctl = await runPiSession({
    cli,
    args: [
      "--mode", "json",
      "-ne", "-nc",
      "--session-dir", sessDir,
      "--model", model,
      PROMPT,
    ],
    cwd: dir,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
    timeout,
  });

  const sys = await readSystemMessage(sessDir);
  const result = {
    exitCode: ctl.code,
    ttftMs: ctl.ttftMs,
    totalMs: ctl.totalMs,
    events: ctl.events.length,
    system: sys.error ? null : describeSystemMessage(sys.message, estimator),
    error: sys.error ?? null,
    stderrTail: tail(ctl.stderr, 2),
  };

  await rmrf(dir);
  return result;
}

// ------------------------------------------------------------------- main

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const packages = opts.packages.length > 0 ? opts.packages : DEFAULT_PACKAGES;

  const pi = await resolvePi();
  const estimator = await loadPiEstimator(pi.root);

  // models.json: origem é o config real, aberto SOMENTE PARA LEITURA; cada
  // sessão recebe uma CÓPIA num PI_CODING_AGENT_DIR temporário.
  const modelsSource = process.env.PI_BAKEOFF_MODELS
    || path.join(os.homedir(), ".pi", "agent", "models.json");
  if (!existsSync(modelsSource)) {
    throw new Error(`models.json não encontrado em ${modelsSource}`);
  }

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "selfevopi-bakeoff-run-"));
  const ctx = {
    cli: pi.cli,
    piRoot: pi.root,
    estimator,
    modelsSource,
    tmpRoot,
    timeout: opts.timeout,
    model: opts.model,
  };

  const started = Date.now();
  const control = await measureControl(ctx);
  const results = [];

  for (const pkg of packages) {
    try {
      const r = await measurePackage(pkg, ctx);
      // sobrecarga = tratamento − controle (mesmo modelo, mesmo prompt)
      if (r.treated?.system && control.system) {
        const t = r.treated.system;
        const c = control.system;
        r.overhead = {
          totalTokens: t.totalTokens - c.totalTokens,
          promptTokens: t.promptTokens - c.promptTokens,
          toolTokens: t.toolsTokens - c.toolsTokens,
          newToolCount: t.toolCount - c.toolCount,
          newToolNames: t.toolNames.filter((n) => !c.toolNames.includes(n)),
        };
      }
      results.push(r);
    } catch (err) {
      results.push({ name: pkg, ok: false, error: err?.message ?? String(err) });
    }
  }

  await rmrf(tmpRoot);

  console.log(JSON.stringify({
    measuredAt: new Date().toISOString(),
    model: opts.model,
    prompt: PROMPT,
    piVersion: pi.version ?? null,
    tokensMeasuredWith: estimator
      ? "pi-ai/utils/estimate (estimador do próprio Pi, chars/3.5)"
      : "fallback chars/3.5",
    control: {
      exitCode: control.exitCode,
      ttftMs: control.ttftMs,
      totalMs: control.totalMs,
      toolCount: control.system?.toolCount ?? null,
      toolNames: control.system?.toolNames ?? [],
      promptTokens: control.system?.promptTokens ?? null,
      toolsTokens: control.system?.toolsTokens ?? null,
      totalTokens: control.system?.totalTokens ?? null,
      sectionBytes: control.system?.sectionBytes ?? null,
      error: control.error,
    },
    results,
    wallMs: Date.now() - started,
  }, null, 2));

  console.error(`# ${results.length} pacote(s) + controle em ${Date.now() - started} ms`);

  // exit 0: a rodada terminou. Pacote que não carrega é RESULTADO, não falha.
  // Só falha se nada instalou (aí a medição não aconteceu).
  if (results.every((r) => !r.installed)) process.exit(1);
}

main().catch((err) => {
  console.error(`bakeoff-run: falha fatal: ${err?.stack ?? err}`);
  process.exit(1);
});