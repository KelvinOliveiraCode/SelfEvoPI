/**
 * core/agent/pi-rpc.mjs — a camada compartilhada entre os front-ends do
 * SelfEvoPI (CLI e desktop) e o motor de conversa.
 *
 * É um cliente fino sobre o `RpcClient` do motor. Existe por três motivos:
 *
 *   1. os dois front-ends precisam exatamente do MESMO mapeamento
 *      evento → estado de tela (texto, ferramenta, fim);
 *   2. se o protocolo do motor mudar, corrigimos em UM lugar;
 *   3. o front-end nunca fala do motor: quem mapeia evento é aqui, e o
 *      front-end só consome `text` / `tool` / `settled`.
 *
 * Interface pública (é ela que o desktop vai consumir — mude com cuidado):
 *
 *   import { createPiClient } from "../core/agent/pi-rpc.mjs";
 *
 *   const pi = await createPiClient({ cwd, model });
 *   pi.on("text",    (delta) => {});   // streaming de texto (string)
 *   pi.on("tool",    (call)  => {});   // atividade de ferramenta ({ name, args, phase })
 *   pi.on("error",   (msg)   => {});   // erro bruto do modelo/provedor (texto cru)
 *   pi.on("settled", (info)  => {});   // fim da execução automática ({ aborted })
 *   await pi.prompt("pergunta");
 *   const texto = await pi.promptAndWait("pergunta"); // texto final, sem ler cedo demais
 *   await pi.abort();                  // cancela a execução em curso
 *   await pi.close();
 *
 *   listConfiguredModels()             // [{ provider, id }] só nomes (sem chaves)
 *
 * Resolução do motor: o SelfEvoPI é Node puro e não declara o motor como
 * dependência (zero dependência nova). O motor está instalado globalmente;
 * `findEngine` localiza o pacote e devolve os caminhos, ou diz que não achou.
 * A interface não cita o motor; quem escreve a mensagem para o usuário é o
 * front-end (voz do SelfEvoPI).
 */

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/* ------------------------------------------------------------------ */
/* Localização do motor                                               */
/* ------------------------------------------------------------------ */

/**
 * Devolve os caminhos de entrada do motor instalado, ou um motivo de ausência.
 *
 * @param {{ globalRoot?: string, modulePath?: string, forceAbsent?: boolean }} [opts]
 * @returns {{ available: true, modulePath: string, cliPath: string } | { available: false, reason: string }}
 */
export function findEngine(opts = {}) {
  const forced = opts.forceAbsent === true || process.env.SELFEOPI_FORCE_NO_ENGINE === "1";
  if (forced) return { available: false, reason: "motor desativado por configuração" };

  const appdata =
    process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming");
  const pkg = "@earendil-works/pi-coding-agent";

  // Candidatos em ordem: raiz global injetada, caminho de módulo explícito,
  // a raiz global do Windows e a resolução padrão do Node.
  const bases = [];
  if (opts.globalRoot) bases.push(opts.globalRoot);
  if (opts.modulePath) bases.push(path.dirname(path.dirname(path.dirname(opts.modulePath))));
  bases.push(path.join(appdata, "npm", "node_modules", pkg));

  for (const base of bases) {
    const modulePath = path.join(base, "dist", "index.js");
    if (!existsSync(modulePath)) continue;
    const bundle = path.join(base, "dist", "bundle", "cli.js");
    const cli = existsSync(bundle) ? bundle : path.join(base, "dist", "cli.js");
    return { available: true, modulePath, cliPath: cli };
  }
  return { available: false, reason: "motor não encontrado nesta máquina" };
}

/**
 * Lista os modelos CONFIGURADOS (provedor + id), lendo APENAS os campos de
 * nome/id do arquivo de modelos do motor. NUNCA lê nem devolve chaves de API —
 * só o que já é salvo como nome de modelo.
 *
 * @returns {Array<{provider: string, id: string}>}
 */
export function listConfiguredModels() {
  const file =
    process.env.PI_MODELS_FILE ||
    path.join(process.env.USERPROFILE || os.homedir(), ".pi", "agent", "models.json");
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const providers = doc && typeof doc === "object" ? doc.providers : null;
  if (!providers || typeof providers !== "object") return [];
  const out = [];
  for (const [provider, entry] of Object.entries(providers)) {
    const models = entry && typeof entry === "object" ? entry.models : null;
    const ids = Array.isArray(models)
      ? models
          .map((m) => (typeof m === "string" ? m : (m && (m.id || m.name)) || ""))
          .filter(Boolean)
      : models && typeof models === "object"
        ? Object.keys(models)
        : [];
    for (const id of ids) out.push({ provider, id: String(id) });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Mapeamento evento → estado de tela (puro, testável)                */
/* ------------------------------------------------------------------ */

/**
 * Traduz um evento cru do motor no evento normalizado que os front-ends
 * consomem. Devolve `null` para eventos que não interessam à tela.
 *
 *   { kind: "text", delta }                         → streaming de texto
 *   { kind: "tool", phase, id, name, args?, ... }   → atividade de ferramenta
 *   { kind: "settled", aborted }                    → fim da execução
 *
 * @param {any} ev
 * @returns {{kind:string, [k:string]:any}|null}
 */
export function normalizeEvent(ev) {
  if (!ev || typeof ev !== "object") return null;
  switch (ev.type) {
    case "message_update": {
      const inner = ev.assistantMessageEvent;
      if (inner && inner.type === "text_delta" && typeof inner.delta === "string") {
        return { kind: "text", delta: inner.delta };
      }
      return null;
    }
    case "tool_execution_start":
      return { kind: "tool", phase: "start", id: ev.toolCallId, name: ev.toolName, args: ev.args };
    case "tool_execution_end":
      return {
        kind: "tool",
        phase: "end",
        id: ev.toolCallId,
        name: ev.toolName,
        isError: ev.isError === true,
        durationMs: typeof ev.durationMs === "number" ? ev.durationMs : null,
      };
    case "message_end": {
      // erro do provedor/modelo: a mensagem assistente vem com stopReason "error"
      // e o texto cru em errorMessage (ex.: 401 Invalid bearer token). Emite como
      // "error" para o front-end traduzir em voz do produto — nunca mostra cru.
      const msg = ev.message;
      if (msg && msg.role === "assistant" && msg.stopReason === "error") {
        return { kind: "error", message: String(msg.errorMessage || "erro") };
      }
      return null;
    }
    case "agent_settled":
      return { kind: "settled", aborted: ev.aborted === true };
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Cliente fino                                                       */
/* ------------------------------------------------------------------ */

/**
 * Envolve um `RpcClient` (ou um dublê com a mesma superfície) e reemite
 * `text` / `tool` / `settled` normalizados. A inscrição acontece no construtor,
 * antes de qualquer prompt, para não perder eventos de uma conclusão rápida.
 */
class PiClient {
  constructor(rpc) {
    this._rpc = rpc;
    this._handlers = new Map();
    this._unsub =
      rpc && typeof rpc.onEvent === "function"
        ? rpc.onEvent((ev) => this._dispatch(ev))
        : () => {};
  }

  /** Inscreve um callback para "text" | "tool" | "settled". Devolve o cancelador. */
  on(kind, cb) {
    if (typeof cb !== "function") return () => {};
    if (!this._handlers.has(kind)) this._handlers.set(kind, new Set());
    this._handlers.get(kind).add(cb);
    return () => this._handlers.get(kind)?.delete(cb);
  }

  _emit(kind, arg) {
    const set = this._handlers.get(kind);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(arg);
      } catch {
        /* um callback do front-end não derruba a sessão */
      }
    }
  }

  _dispatch(ev) {
    const n = normalizeEvent(ev);
    if (!n) return;
    if (n.kind === "text") this._emit("text", n.delta);
    else if (n.kind === "tool") this._emit("tool", n);
    else if (n.kind === "error") this._emit("error", n.message);
    else if (n.kind === "settled") this._emit("settled", n);
  }

  /** Inicia o processo do motor. */
  start() {
    return this._rpc.start();
  }

  /** Envia um prompt. A resposta descreve o aceite; o texto vem por "text". */
  prompt(message) {
    return this._rpc.prompt(message);
  }

  /**
   * Envia um prompt e resolve com o texto final normalizado.
   *
   * Diferença para `prompt()`: `prompt()` resolve no ACEITE (a disposição
   * "started"/"handled") e o texto chega depois, por eventos — quem lê o texto
   * logo após `prompt()` resolver lê vazio. Este método assina o coletor de
   * texto ANTES de disparar o prompt e só resolve quando o motor emite
   * "settled", então o texto vem completo.
   *
   * Rejeita se o motor emitir "error" antes do settled, se o timeout estourar,
   * ou se o `prompt()` recusar. Se a disposição for "handled" (comando de
   * extensão / input interceptado: nenhum run começou, não haverá "settled"),
   * resolve de imediato com o texto acumulado (normalmente vazio) em vez de
   * pendurar até o timeout.
   *
   * @param {string} message
   * @param {number} [timeoutMs=120000]
   * @returns {Promise<string>} texto final normalizado
   */
  promptAndWait(message, timeoutMs = 120_000) {
    return new Promise((resolve, reject) => {
      let text = "";
      let done = false;
      let timer = null;
      const offs = [];

      const finish = (fn, arg) => {
        if (done) return;
        done = true;
        for (const off of offs) {
          try {
            off();
          } catch {
            /* cancelar nunca derruba */
          }
        }
        if (timer) clearTimeout(timer);
        fn(arg);
      };

      offs.push(this.on("text", (delta) => (text += delta)));
      offs.push(this.on("settled", () => finish(resolve, text)));
      offs.push(this.on("error", (m) => finish(reject, m instanceof Error ? m : new Error(String(m)))));

      timer = setTimeout(() => {
        finish(reject, new Error(`promptAndWait: tempo esgotado após ${timeoutMs} ms`));
      }, timeoutMs);
      timer?.unref?.();

      this.prompt(message)
        .then((disposition) => {
          // "handled": comando de extensão/input interceptado — nenhum run
          // começou, não haverá "settled"; resolve já para não pendurar.
          if (disposition === "handled") finish(resolve, text);
          // "started": run começou; espera o "settled" (via onSettled acima).
        })
        .catch((err) => finish(reject, err));
    });
  }

  /** Cancela a execução em curso (Ctrl+C), sem encerrar a sessão. */
  abort() {
    return this._rpc.abort();
  }

  /** Começa uma conversa nova (usado por /clear). */
  newSession() {
    return this._rpc.newSession();
  }

  getState() {
    return this._rpc.getState();
  }

  getAvailableModels() {
    return this._rpc.getAvailableModels();
  }

  /** Troca o modelo (provider, modelId). */
  setModel(provider, modelId) {
    return this._rpc.setModel(provider, modelId);
  }

  cycleModel() {
    return this._rpc.cycleModel();
  }

  /** Encerra o processo do motor e solta as inscrições. */
  async close() {
    try {
      if (this._rpc && typeof this._rpc.stop === "function") await this._rpc.stop();
    } catch {
      /* encerrar nunca lança */
    }
    try {
      this._unsub?.();
    } catch {
      /* idem */
    }
    this._handlers.clear();
  }
}

/**
 * Cria o cliente de conversa.
 *
 * `options.client` injeta um dublê (usado nos testes, sem motor instalado);
 * nesse caso o chamador controla o ciclo de vida. Sem `client`, o motor é
 * localizado, instanciado e iniciado, e a interface do SelfEvoPI funciona
 * como documentado no topo do arquivo.
 *
 * @param {{ cwd?: string, model?: string, env?: Record<string,string>,
 *           globalRoot?: string, modulePath?: string, client?: any }} [options]
 * @returns {Promise<PiClient>}
 */
export async function createPiClient(options = {}) {
  if (options.client) return new PiClient(options.client);

  const engine = findEngine(options);
  if (!engine.available) {
    const err = new Error("motor não encontrado");
    err.code = "ENGINE_NOT_FOUND";
    throw err;
  }

  const mod = await import(pathToFileURL(engine.modulePath).href);
  const RpcClient = mod.RpcClient;
  if (typeof RpcClient !== "function") {
    const err = new Error("motor sem RpcClient");
    err.code = "ENGINE_NO_RPC";
    throw err;
  }

  const rpc = new RpcClient({
    cliPath: engine.cliPath,
    cwd: options.cwd || process.cwd(),
    args: ["--no-session"],
    ...(options.model ? { model: options.model } : {}),
    ...(options.env ? { env: options.env } : {}),
  });

  const client = new PiClient(rpc);
  await client.start();
  return client;
}

export default { createPiClient, normalizeEvent, findEngine, listConfiguredModels };