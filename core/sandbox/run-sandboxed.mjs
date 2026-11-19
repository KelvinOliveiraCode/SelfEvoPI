/**
 * selfevopi-run-sandboxed — camada 2 do sandbox: rodar código gerado com contenção.
 *
 * Não é sandbox de segurança. É contenção: o que passa do gate ainda esbarra em três
 * coisas — Node Permission Model (fs), preload de rede (a lacuna da versão) e a
 * árvore de processos morta no timeout (taskkill /T /F).
 *
 * Flags montadas pelo runner (nunca aceita override):
 *   --permission
 *   --allow-fs-read=<workdir[,extra...]>
 *   --allow-fs-write=<workdir>          (só com allowWrite)
 *   --import data:text/javascript;base64,<preload>
 *   SEM --allow-net        (rede é fechada pelo preload)
 *   SEM --allow-child-process  (processo filho é bloqueado pelo runtime)
 *
 * Contrato:
 *   runSandboxed({ script, args, workdir, timeoutMs, allowRead, allowWrite })
 *     -> { ok, exitCode, stdout, stderr, durationMs, timedOut, pid, signal, truncated,
 *          blocked, gate }
 *
 * O runner nunca imprime segredos: a saída é limitada (64 KB por fluxo) e o filho
 * recebe um ambiente mínimo (allowlist), não o process.env do harness.
 */

import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { evaluate, formatDecision } from "./static-gate.mjs";

export const MAX_OUTPUT_BYTES = 64 * 1024;
export const DEFAULT_TIMEOUT_MS = 15_000;

/** Variáveis que o filho herda. Nada de token, chave ou config do harness. */
const ENV_ALLOW = [
  "PATH",
  "Path",
  "PATHEXT",
  "ComSpec",
  "SystemRoot",
  "windir",
  "TEMP",
  "TMP",
  "USERNAME",
  "USERDOMAIN",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "TZ",
];

/* ------------------------------------------------------------------ */
/* Preload: fecha a lacuna de rede do Permission Model                  */
/* ------------------------------------------------------------------ */

/**
 * Node 24.13.0: --permission NÃO barra rede (ver docs/fase2/sandbox.md §3.1).
 * Este preload é injetado com --import e transforma toda saída de rede em
 * ERR_ACCESS_DENIED, com o mesmo código que o Permission Model usa para fs.
 */
export const NET_BLOCK_PRELOAD = `
const blocked = (name) => {
  const err = new Error("SelfEvoPI sandbox: " + name + " bloqueado");
  err.code = "ERR_ACCESS_DENIED";
  err.permission = "Net";
  return err;
};
const patch = (obj, key, name) => {
  if (!obj || typeof obj[key] !== "function") return;
  Object.defineProperty(obj, key, {
    value: () => { throw blocked(name); },
    configurable: true,
    writable: true,
  });
};
const http = (await import("node:http")).default;
const https = (await import("node:https")).default;
const net = (await import("node:net")).default;
const tls = (await import("node:tls")).default;
const dgram = (await import("node:dgram")).default;
patch(http, "request", "http.request");
patch(http, "get", "http.get");
patch(https, "request", "https.request");
patch(https, "get", "https.get");
patch(net, "connect", "net.connect");
patch(net, "createConnection", "net.createConnection");
patch(tls, "connect", "tls.connect");
patch(dgram, "createSocket", "dgram.createSocket");
if (net.Socket) {
  const original = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    if (args.length === 0) return original.apply(this, args);
    throw blocked("net.Socket.connect");
  };
}
globalThis.fetch = () => { throw blocked("fetch"); };
if (typeof globalThis.WebSocket === "function") {
  globalThis.WebSocket = class extends WebSocket {
    constructor(...args) { super(...args); throw blocked("WebSocket"); }
  };
}
`;

function preloadUrl() {
  const b64 = Buffer.from(NET_BLOCK_PRELOAD, "utf8").toString("base64");
  return `data:text/javascript;base64,${b64}`;
}

/* ------------------------------------------------------------------ */
/* Processos                                                           */
/* ------------------------------------------------------------------ */

/** Roda um comando curto e devolve só o exit code (usado pelo taskkill). */
function runCode(command, args) {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(command, args, { windowsHide: true, stdio: "ignore" });
    const done = (code) => {
      if (settled) return;
      settled = true;
      resolve(code);
    };
    child.on("error", () => done(null));
    child.on("close", (code) => done(code));
  });
}

/**
 * Mata a árvore inteira. No Windows o `taskkill /T` alcança netos e processos
 * destacados — `child.kill()` não. Fora do Windows, SIGKILL no grupo.
 */
export async function killTree(pid) {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return "no-pid";
  if (process.platform === "win32") {
    const code = await runCode("taskkill", ["/PID", String(pid), "/T", "/F"]);
    if (code === 0) return "taskkill";
    // 128 = processo já não existia; qualquer outro código é falha real
    return code === 128 ? "gone" : `taskkill-failed(${code})`;
  }
  try {
    process.kill(-pid, "SIGKILL");
    return "process-group";
  } catch {
    try {
      process.kill(pid, "SIGKILL");
      return "signal";
    } catch {
      return "gone";
    }
  }
}

/** Acumula no máximo `cap` bytes por fluxo; o resto é descartado. */
function collector(cap) {
  const state = { text: "", bytes: 0, truncated: false };
  return {
    state,
    push(chunk) {
      if (state.truncated) return;
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      const room = cap - state.bytes;
      if (buf.length <= room) {
        state.text += buf.toString("utf8");
        state.bytes += buf.length;
        return;
      }
      if (room > 0) {
        state.text += buf.subarray(0, room).toString("utf8");
        state.bytes += room;
      }
      state.truncated = true;
    },
  };
}

function minimalEnv(extra = {}, inherit = false) {
  const base = inherit ? { ...process.env } : {};
  for (const key of ENV_ALLOW) {
    if (process.env[key] !== undefined && base[key] === undefined) base[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null) base[key] = String(value);
  }
  return base;
}

function listFlag(name, values) {
  const list = values.map((p) => path.resolve(p));
  return `${name}=${list.join(",")}`;
}

function resolveList(value, fallback) {
  if (value === null || value === undefined) return fallback;
  const arr = Array.isArray(value) ? value : [value];
  const clean = arr.filter((p) => typeof p === "string" && p.trim() !== "");
  return clean.length > 0 ? clean : fallback;
}

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

/**
 * Roda `script` sob contenção e devolve o laudo da execução.
 *
 * @param {object} opts
 * @param {string} opts.script      caminho do script (relativo ao workdir ou absoluto)
 * @param {string[]} [opts.args]    argumentos passados ao script
 * @param {string} [opts.workdir]   diretório de trabalho (default: diretório do script)
 * @param {number} [opts.timeoutMs] teto de tempo; ao fim, a árvore é morta
 * @param {string|string[]|null} [opts.allowRead]  caminhos extra de leitura (default: só o workdir)
 * @param {boolean} [opts.allowWrite]  libera escrita dentro do workdir
 * @param {boolean} [opts.precheck]  roda o gate estático antes (default: true)
 * @param {object}  [opts.gateAllow] overrides de regra para o gate
 * @param {boolean} [opts.inheritEnv]  herda o process.env inteiro (default: false)
 * @param {object}  [opts.env]     variáveis extras para o filho
 * @param {number}  [opts.maxOutputBytes] teto por fluxo (default: 65536)
 */
export async function runSandboxed(opts = {}) {
  const {
    script,
    args = [],
    workdir: workdirOpt,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    allowRead = null,
    allowWrite = false,
    precheck = true,
    gateAllow = {},
    inheritEnv = false,
    env: extraEnv = {},
    maxOutputBytes = MAX_OUTPUT_BYTES,
  } = opts;

  const started = Date.now();
  const base = {
    ok: false,
    exitCode: null,
    stdout: "",
    stderr: "",
    durationMs: 0,
    timedOut: false,
    pid: null,
    signal: null,
    truncated: false,
    blocked: false,
    killReason: null,
    decision: null,
    gate: null,
  };

  if (typeof script !== "string" || script.trim() === "") {
    return { ...base, stderr: "run-sandboxed: informe o caminho do script" };
  }

  const scriptPath = path.resolve(workdirOpt ? path.resolve(workdirOpt) : ".", script);
  const workdir = workdirOpt ? path.resolve(workdirOpt) : path.dirname(scriptPath);

  let st;
  try {
    st = await stat(scriptPath);
  } catch {
    return { ...base, stderr: `run-sandboxed: script não encontrado: ${scriptPath}` };
  }
  if (!st.isFile()) {
    return { ...base, stderr: `run-sandboxed: não é arquivo: ${scriptPath}` };
  }
  try {
    const wd = await stat(workdir);
    if (!wd.isDirectory()) return { ...base, stderr: `run-sandboxed: workdir não é diretório: ${workdir}` };
  } catch {
    return { ...base, stderr: `run-sandboxed: workdir não existe: ${workdir}` };
  }

  // ---- pré-checagem: o gate reprova antes de qualquer processo existir
  if (precheck) {
    let source;
    try {
      source = await readFile(scriptPath, "utf8");
    } catch (err) {
      return { ...base, stderr: `run-sandboxed: não li o script para o gate (${err?.code ?? "erro"})` };
    }
    const gate = evaluate(source, { file: scriptPath, workspace: workdir, allow: gateAllow });
    if (gate.decision === "block") {
      const reason = gate.violations
        .filter((v) => v.severity === "block")
        .map((v) => `${v.rule}@${v.line}`)
        .join(", ");
      return {
        ...base,
        stderr: `gate: bloqueado antes de executar (${reason}) — ${formatDecision(gate)}`,
        blocked: true,
        decision: gate.decision,
        gate,
      };
    }
    base.gate = gate;
    base.decision = gate.decision;
  }

  // ---- flags: montadas aqui, sem override de quem chama
  const readPaths = resolveList(allowRead, [workdir]);
  const flags = ["--permission", listFlag("--allow-fs-read", readPaths)];
  if (allowWrite) flags.push(listFlag("--allow-fs-write", [workdir]));
  flags.push("--import", preloadUrl());

  const child = spawn(process.execPath, [...flags, scriptPath, ...args.map(String)], {
    cwd: workdir,
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: minimalEnv(extraEnv, inheritEnv),
  });

  const out = collector(maxOutputBytes);
  const errOut = collector(maxOutputBytes);
  child.stdout.on("data", (c) => out.push(c));
  child.stderr.on("data", (c) => errOut.push(c));

  let timer = null;
  let finished = false;
  let resolveClose = null;
  let resolveKill = null;

  const close = new Promise((resolve) => {
    resolveClose = resolve;
  });
  const kill = new Promise((resolve) => {
    resolveKill = resolve;
  });

  const settle = () => {
    if (finished) return;
    finished = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    resolveKill?.();
    resolveClose?.();
  };

  child.on("error", (e) => {
    base.signal = null;
    base.stderr = errOut.state.text || String(e?.message ?? "erro ao spawnar");
    settle();
  });
  child.on("close", (code, signal) => {
    base.exitCode = code;
    base.signal = signal;
    settle();
  });

  // ao estourar o teto: mata a árvore e, se o close não vier, não trava o laudo
  timer = setTimeout(async () => {
    base.timedOut = true;
    base.killReason = await killTree(child.pid);
    const t = setTimeout(settle, 2_000);
    if (t.unref) t.unref();
  }, Math.max(1, Number(timeoutMs) || 0));
  if (timer.unref) timer.unref();

  await Promise.all([close, kill]);
  if (timer) clearTimeout(timer);

  base.stdout = out.state.text;
  base.stderr = errOut.state.text;
  base.truncated = out.state.truncated || errOut.state.truncated;
  base.pid = typeof child.pid === "number" ? child.pid : null;
  base.durationMs = Date.now() - started;
  base.ok = !base.timedOut && base.exitCode === 0;

  return base;
}

