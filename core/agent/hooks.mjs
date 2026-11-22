/**
 * core/agent/hooks.mjs — ganchos de ciclo de vida da CLI.
 *
 * Configuração: `.pi/hooks.json` na RAIZ DO WORKSPACE (não é a config pessoal
 * em ~/.pi). Se o arquivo não existe, nada acontece — custo zero por turno.
 *
 * Formato:
 *   {
 *     "version": 1,
 *     "hooks": {
 *       "tool_start": [
 *         { "name": "auditar", "command": "node", "args": ["scripts/hook.mjs"], "timeoutMs": 2000 }
 *       ]
 *     }
 *   }
 *
 * O payload chega como JSON no stdin do processo. Nunca há shell, interpolação
 * ou variáveis de ambiente sensíveis: o filho recebe só o ambiente mínimo.
 * Um hook que falha OU expira NUNCA derruba o turno — ele é registrado e
 * devolvido ao chamador para a interface mostrar, se quiser.
 */

import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

export const EVENTS = Object.freeze([
  "turn_start",
  "turn_end",
  "tool_start",
  "tool_result",
  "error",
  "compact",
]);

const MAX_OUTPUT = 4096;
const DEFAULT_TIMEOUT = 3000;

/** Ambiente mínimo e sem credenciais. Nunca herda `apiKey`, tokens ou `PATH` do usuário. */
function ambienteSeguro() {
  const env = {};
  for (const chave of ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "TMP", "TEMP", "HOME", "USERPROFILE"]) {
    if (process.env[chave]) env[chave] = process.env[chave];
  }
  env.LANG = "C";
  return env;
}

function redigir(texto) {
  return String(texto ?? "")
    .replace(/(api[_-]?key|token|secret|authorization)\s*[:=]\s*["']?[^\s,"'}]+/gi, "$1=[redacted]")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-[redacted]")
    .replace(/eyJ[A-Za-z0-9_-]{12,}/g, "eyJ[redacted]");
}

function ehObjeto(v) {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

/**
 * Lê e valida `.pi/hooks.json`. Nunca lança: devolve `{ ok:false, error }`
 * para que a CLI siga o turno e mostre o diagnóstico.
 */
export async function readHooks({ root = process.cwd(), file = ".pi/hooks.json" } = {}) {
  const alvo = path.isAbsolute(file) ? file : path.join(root, file);
  let texto;
  try {
    texto = await readFile(alvo, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return { ok: true, path: alvo, hooks: {}, counts: {} };
    return { ok: false, path: alvo, hooks: {}, counts: {}, error: String(err?.message || err) };
  }
  let doc;
  try {
    doc = JSON.parse(texto);
  } catch (err) {
    return { ok: false, path: alvo, hooks: {}, counts: {}, error: `JSON inválido: ${String(err?.message || err)}` };
  }
  if (!ehObjeto(doc) || !ehObjeto(doc.hooks)) {
    return { ok: false, path: alvo, hooks: {}, counts: {}, error: "esperado { version, hooks:{...} }" };
  }
  const hooks = {};
  const counts = {};
  for (const evento of EVENTS) {
    const lista = doc.hooks[evento];
    if (lista == null) continue;
    if (!Array.isArray(lista)) {
      return { ok: false, path: alvo, hooks, counts, error: `hooks.${evento} deve ser lista` };
    }
    const validos = [];
    for (const item of lista) {
      if (!ehObjeto(item) || typeof item.command !== "string" || !item.command.trim()) {
        return { ok: false, path: alvo, hooks, counts, error: `hooks.${evento}: item sem command` };
      }
      const args = Array.isArray(item.args) ? item.args.filter((a) => typeof a === "string") : [];
      if (args.some((a) => /[;&|`$]/.test(a))) {
        return { ok: false, path: alvo, hooks, counts, error: `hooks.${evento}: args com metacaracteres de shell` };
      }
      validos.push({
        name: String(item.name || item.command).slice(0, 80),
        command: item.command,
        args,
        timeoutMs: Math.min(30_000, Math.max(100, Number(item.timeoutMs) || DEFAULT_TIMEOUT)),
      });
    }
    hooks[evento] = validos;
    counts[evento] = validos.length;
  }
  return { ok: true, path: alvo, hooks, counts };
}

function executar(hook, evento, payload) {
  return new Promise((resolve) => {
    const iniciado = Date.now();
    let stdout = "";
    let stderr = "";
    let terminou = false;
    let child;
    try {
      child = spawn(hook.command, [...hook.args, `--event=${evento}`], {
        cwd: undefined,
        env: ambienteSeguro(),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      resolve({ name: hook.name, ok: false, error: redigir(String(err?.message || err)), durationMs: 0 });
      return;
    }
    const timer = setTimeout(() => {
      if (terminou) return;
      terminou = true;
      try { child.kill("force"); } catch { /* já saiu */ }
      resolve({ name: hook.name, ok: false, error: "timeout", durationMs: Date.now() - iniciado });
    }, hook.timeoutMs);
    if (timer.unref) timer.unref();

    child.stdout?.on("data", (d) => { if (stdout.length < MAX_OUTPUT) stdout += d.toString("utf8"); });
    child.stderr?.on("data", (d) => { if (stderr.length < MAX_OUTPUT) stderr += d.toString("utf8"); });
    child.on("error", (err) => {
      if (terminou) return;
      terminou = true;
      clearTimeout(timer);
      resolve({ name: hook.name, ok: false, error: redigir(String(err?.message || err)), durationMs: Date.now() - iniciado });
    });
    child.on("close", (code) => {
      if (terminou) return;
      terminou = true;
      clearTimeout(timer);
      const saida = redigir((stdout + stderr).trim()).slice(0, MAX_OUTPUT);
      resolve({
        name: hook.name,
        ok: code === 0,
        exitCode: code,
        output: saida || undefined,
        durationMs: Date.now() - iniciado,
      });
    });
    child.stdin.on("error", () => {});
    try {
      child.stdin.end(JSON.stringify({ event: evento, at: new Date().toISOString(), payload }));
    } catch {
      /* stdin fechado: o hook ainda pode terminar sozinho */
    }
  });
}

/**
 * Dispara os hooks de um evento. `config` vem de `readHooks()`.
 * Nunca lança e nunca modifica o payload.
 */
export async function runHooks(evento, payload = {}, config = {}) {
  if (!EVENTS.includes(evento) || !ehObjeto(config) || !Array.isArray(config.hooks?.[evento])) return [];
  const resultados = [];
  for (const hook of config.hooks[evento]) {
    resultados.push(await executar(hook, evento, payload));
  }
  return resultados;
}

export default { EVENTS, readHooks, runHooks };
