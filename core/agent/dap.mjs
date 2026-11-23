/**
 * core/agent/dap.mjs — cliente DAP mínimo, zero-dependência, sobre stdio.
 *
 * O Debug Adapter Protocol usa o mesmo framing do LSP:
 *   Content-Length: N\r\n\r\n< N bytes UTF-8 do JSON >
 * A correlação é diferente: DAP responde com `request_seq`, não `id`, e eventos
 * vêm como { type: "event", event, body }. Toda leitura é feita em Buffer; o
 * corpo só é decodificado quando N bytes chegam, então cortar no meio de um
 * emoji é seguro.
 *
 * Nada de I/O de arquivo além de readDapConfig; a CLI decide o que mostrar.
 * O processo filho recebe um allowlist de variáveis de ambiente mais o `env`
 * explícito — nenhuma chave do harness vaza para o adaptador.
 *
 * API:
 *   encodeDapMessage / createDapParser
 *   new DapClient({ command, args, cwd, env, timeoutMs })
 *     start(), launch(...), attach(...), setBreakpoints(...),
 *     continueRequest(threadId), next(threadId), stepIn(threadId),
 *     stepOut(threadId), pause(threadId), threads(), stackTrace(threadId),
 *     variables(frameId), waitForEvent(nome, timeoutMs?), close()
 *   readDapConfig(root), adapterForFile(config, caminho)
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const MAX_CABECALHO = 16 * 1024;
const MAX_CORPO = 32 * 1024 * 1024;
const SEPARADOR = Buffer.from("\r\n\r\n", "ascii");
const MAX_EVENTOS_FILA = 32;

const ENV_PERMITIDAS = [
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
  "APPDATA",
  "LOCALAPPDATA",
  "TERM",
  "COLORTERM",
];

/** Extensões conhecidas, usadas só se o adaptador existir na configuração. */
const EXTENSOES_ADAPTADOR = {
  node: [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"],
  python: [".py", ".pyw"],
  rust: [".rs"],
  go: [".go"],
  java: [".java"],
  ruby: [".rb"],
  php: [".php"],
  dotnet: [".cs"],
  cpp: [".c", ".cc", ".cpp", ".cxx", ".h", ".hpp"],
  bash: [".sh", ".bash"],
};

/* ------------------------------------------------------------------ */
/* Framing                                                             */
/* ------------------------------------------------------------------ */

/** Serializa uma mensagem DAP com Content-Length em bytes UTF-8. */
export function encodeDapMessage(obj) {
  const corpo = Buffer.from(JSON.stringify(obj), "utf8");
  const cabecalho = Buffer.from(`Content-Length: ${corpo.length}\r\n\r\n`, "ascii");
  return Buffer.concat([cabecalho, corpo]);
}

/** Parser incremental; aceita chunks em qualquer posição de byte. */
export function createDapParser(onMessage, { maxHeader = MAX_CABECALHO, maxBody = MAX_CORPO } = {}) {
  let buffer = Buffer.alloc(0);

  return {
    feed(chunk) {
      const pedaco = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? ""), "utf8");
      buffer = buffer.length === 0 ? pedaco : Buffer.concat([buffer, pedaco]);

      while (buffer.length > 0) {
        const fimCabecalho = buffer.indexOf(SEPARADOR);
        if (fimCabecalho < 0) {
          if (buffer.length > maxHeader) buffer = Buffer.alloc(0);
          return;
        }
        const textoCabecalho = buffer.subarray(0, fimCabecalho).toString("ascii");
        const encontrado = /content-length\s*:\s*(\d+)/i.exec(textoCabecalho);
        if (!encontrado) {
          buffer = buffer.subarray(fimCabecalho + SEPARADOR.length);
          continue;
        }
        const tamanho = Number(encontrado[1]);
        if (!Number.isSafeInteger(tamanho) || tamanho < 0 || tamanho > maxBody) {
          buffer = Buffer.alloc(0);
          return;
        }
        const inicioCorpo = fimCabecalho + SEPARADOR.length;
        if (buffer.length < inicioCorpo + tamanho) return;
        const corpo = buffer.subarray(inicioCorpo, inicioCorpo + tamanho);
        buffer = buffer.subarray(inicioCorpo + tamanho);
        try {
          const msg = JSON.parse(corpo.toString("utf8"));
          if (msg && typeof msg === "object") onMessage(msg);
        } catch {
          // payload corrompido é descartado sem derrubar a sessão
        }
      }
    },
    reset() {
      buffer = Buffer.alloc(0);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Auxiliares                                                          */
/* ------------------------------------------------------------------ */

function ambienteFiltrado(extra) {
  const env = {};
  for (const chave of ENV_PERMITIDAS) {
    if (process.env[chave] !== undefined) env[chave] = process.env[chave];
  }
  if (extra && typeof extra === "object") {
    for (const [chave, valor] of Object.entries(extra)) env[chave] = String(valor);
  }
  return env;
}

function textoSeguro(valor, limite = 2000) {
  const texto = String(valor ?? "");
  return texto.length > limite ? texto.slice(0, limite) : texto;
}

/* ------------------------------------------------------------------ */
/* Cliente                                                             */
/* ------------------------------------------------------------------ */

export class DapClient {
  #command;
  #args;
  #cwd;
  #env;
  #timeoutMs;
  #child = null;
  #seq = 1;
  #pendentes = new Map();
  #eventos = new Map();
  #esperando = new Map();
  #capabilities = null;
  #iniciado = false;
  #fechado = false;
  #stderr = "";
  #erroSpawn = null;
  #parser;

  constructor({ command, args = [], cwd = null, env = {}, timeoutMs = 8000 } = {}) {
    if (!command || typeof command !== "string") throw new TypeError("DAP: 'command' é obrigatório");
    this.#command = command;
    this.#args = Array.isArray(args) ? args.map(String) : [];
    this.#cwd = cwd ? String(cwd) : null;
    this.#env = env && typeof env === "object" ? env : {};
    this.#timeoutMs = Math.max(1, Number(timeoutMs) || 8000);
    this.#parser = createDapParser((msg) => this.#aoReceber(msg));
  }

  get capabilities() {
    return this.#capabilities;
  }

  get running() {
    return Boolean(this.#child && !this.#fechado);
  }

  /** Sobe o adaptador e faz o handshake initialize. */
  async start() {
    if (this.#iniciado) return this.#capabilities;
    if (this.#fechado) throw new Error("DAP: cliente já foi fechado");

    const raiz = resolve(this.#cwd || process.cwd());
    const precisaShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(this.#command);
    try {
      this.#child = spawn(this.#command, this.#args, {
        cwd: raiz,
        env: ambienteFiltrado(this.#env),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: precisaShell,
      });
    } catch (err) {
      throw new Error(`DAP: não consegui iniciar o processo: ${err?.message ?? err}`);
    }

    const child = this.#child;
    child.stdout.on("data", (chunk) => this.#parser.feed(chunk));
    child.stderr.on("data", (chunk) => {
      if (this.#stderr.length < 2000) this.#stderr += textoSeguro(chunk, 2000);
    });
    child.on("error", (err) => {
      this.#erroSpawn = err;
    });
    child.on("exit", () => this.#aoSair());

    try {
      const resultado = await this.#request("initialize", {
        adapterID: "selfevopi",
        pathFormat: "path",
        linesStartAt1: true,
        columnsStartAt1: true,
      });
      this.#capabilities = resultado ?? {};
      // Handshake padrão DAP: o adaptador pode esperar este evento antes de
      // aceitar a configuração da sessão.
      this.#enviar({ type: "event", event: "initialized", body: {} });
      this.#iniciado = true;
      return this.#capabilities;
    } catch (err) {
      this.#encerrarProcesso();
      this.#child = null;
      this.#iniciado = false;
      throw err;
    }
  }

  launch(config = {}) {
    return this.#request("launch", config);
  }

  attach(config = {}) {
    return this.#request("attach", config);
  }

  /**
   * Fecha a sequência de configuração. Adaptadores reais (lldb-dap, debugpy,
   * js-debug) podem bloquear breakpoints até receberem este request.
   */
  configurationDone() {
    return this.#request("configurationDone", {});
  }

  /** launch → breakpoints → configurationDone, na ordem que adaptadores esperam. */
  async launchAndConfigure(config = {}, { path = null, lines = [], breakpoints = true } = {}) {
    const resultado = await this.launch(config);
    if (breakpoints && path) await this.setBreakpoints({ path, lines });
    await this.configurationDone();
    return resultado;
  }

  async setBreakpoints({ path, lines = [] } = {}) {
    const resultado = await this.#request("setBreakpoints", {
      source: { path: String(path ?? "") },
      breakpoints: (Array.isArray(lines) ? lines : []).map((line) => ({ line: Number(line) })),
      lines: Array.isArray(lines) ? lines.map(Number) : [],
    });
    const lista = Array.isArray(resultado?.breakpoints) ? resultado.breakpoints : [];
    // Mantém os verificados e os que não informaram `verified` (adaptadores
    // simples): só descarta os explicitamente marcados como não verificados.
    return lista.filter((bp) => bp?.verified !== false);
  }

  continueRequest(threadId) {
    return this.#request("continue", { threadId: Number(threadId) });
  }

  next(threadId) {
    return this.#request("next", { threadId: Number(threadId) });
  }

  stepIn(threadId) {
    return this.#request("stepIn", { threadId: Number(threadId) });
  }

  stepOut(threadId) {
    return this.#request("stepOut", { threadId: Number(threadId) });
  }

  pause(threadId) {
    return this.#request("pause", { threadId: Number(threadId) });
  }

  async threads() {
    const resultado = await this.#request("threads", {});
    return Array.isArray(resultado?.threads) ? resultado.threads : [];
  }

  async stackTrace(threadId, { levels = 50 } = {}) {
    const resultado = await this.#request("stackTrace", {
      threadId: Number(threadId),
      startFrame: 0,
      levels: Number(levels) || 50,
    });
    return Array.isArray(resultado?.stackFrames) ? resultado.stackFrames : [];
  }

  /**
   * Variáveis de um frame: primeiro pede `scopes`, depois `variables` para
   * cada escopo. Aceita também { variablesReference } para pular os escopos.
   */
  async variables(frameId) {
    if (frameId && typeof frameId === "object" && Number.isFinite(frameId.variablesReference)) {
      const resultado = await this.#request("variables", {
        variablesReference: Number(frameId.variablesReference),
      });
      return Array.isArray(resultado?.variables) ? resultado.variables : [];
    }

    const referencias = [];
    try {
      const escopos = await this.#request("scopes", { frameId: Number(frameId) });
      for (const escopo of Array.isArray(escopos?.scopes) ? escopos.scopes : []) {
        if (Number(escopo?.variablesReference) > 0) referencias.push(Number(escopo.variablesReference));
      }
    } catch {
      // adaptador sem scopes: tenta o frameId como variablesReference
      if (Number(frameId) > 0) referencias.push(Number(frameId));
    }

    const variaveis = [];
    for (const variablesReference of referencias) {
      const resultado = await this.#request("variables", { variablesReference });
      if (Array.isArray(resultado?.variables)) variaveis.push(...resultado.variables);
    }
    return variaveis;
  }

  /** Consome um evento enfileirado ou espera por ele até o timeout. */
  waitForEvent(nome, timeoutMs = this.#timeoutMs) {
    const evento = String(nome ?? "");
    if (!evento) return Promise.resolve(null);
    const fila = this.#eventos.get(evento);
    if (fila && fila.length) return Promise.resolve(fila.shift());

    return new Promise((resolve) => {
      const espera = { resolve, timer: null };
      espera.timer = setTimeout(() => {
        this.#removerEspera(evento, espera);
        resolve(null);
      }, Math.max(1, Number(timeoutMs) || this.#timeoutMs));
      espera.timer.unref?.();
      if (!this.#esperando.has(evento)) this.#esperando.set(evento, []);
      this.#esperando.get(evento).push(espera);
    });
  }

  /** disconnect + kill seguro. */
  async close() {
    if (this.#fechado) return;
    this.#fechado = true;
    if (!this.#child) return;
    try {
      await this.#request("disconnect", { terminateDebuggee: false }, Math.min(1500, this.#timeoutMs));
    } catch {
      // adaptador já saiu ou não implementa disconnect
    }
    const child = this.#child;
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 300);
        timer.unref?.();
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    this.#encerrarProcesso();
    this.#rejeitarPendentes("DAP: cliente fechado");
  }

  /* -------------------- internos -------------------- */

  #enviar(obj) {
    const child = this.#child;
    if (!child?.stdin || child.stdin.destroyed) throw new Error("DAP: cliente não iniciado");
    child.stdin.write(encodeDapMessage(obj));
  }

  #request(command, args, ms = this.#timeoutMs) {
    if (!this.#child) return Promise.reject(new Error("DAP: cliente não iniciado"));
    const seq = this.#seq++;
    const limite = Math.max(1, Number(ms) || this.#timeoutMs);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pendentes.delete(seq);
        reject(new Error(`DAP: timeout em ${command} (${limite} ms)`));
      }, limite);
      timer.unref?.();
      this.#pendentes.set(seq, { resolve, reject, timer });
      try {
        this.#enviar({ type: "request", seq, command, arguments: args ?? {} });
      } catch (err) {
        clearTimeout(timer);
        this.#pendentes.delete(seq);
        reject(err);
      }
    });
  }

  #aoReceber(msg) {
    if (msg.type === "response") {
      const pedido = this.#pendentes.get(msg.request_seq);
      if (!pedido) return;
      this.#pendentes.delete(msg.request_seq);
      clearTimeout(pedido.timer);
      if (msg.success === false) {
        pedido.reject(new Error(`DAP: ${textoSeguro(msg.message || msg.command, 200)}`));
      } else {
        pedido.resolve(msg.body ?? {});
      }
      return;
    }

    if (msg.type === "event") {
      const nome = String(msg.event ?? "");
      if (!nome) return;
      const esperas = this.#esperando.get(nome);
      if (esperas && esperas.length) {
        this.#esperando.delete(nome);
        for (const espera of esperas) {
          clearTimeout(espera.timer);
          espera.resolve(msg.body ?? {});
        }
        return;
      }
      if (!this.#eventos.has(nome)) this.#eventos.set(nome, []);
      const fila = this.#eventos.get(nome);
      if (fila.length >= MAX_EVENTOS_FILA) fila.shift();
      fila.push(msg.body ?? {});
      return;
    }

    if (msg.type === "request") {
      // Reverse request do adaptador: responde "não implementado" para não travar.
      try {
        this.#enviar({
          type: "response",
          request_seq: msg.seq,
          success: false,
          command: String(msg.command ?? ""),
          message: "not implemented",
        });
      } catch {
        // cliente em fechamento
      }
    }
  }

  #removerEspera(nome, espera) {
    const lista = this.#esperando.get(nome);
    if (!lista) return;
    const indice = lista.indexOf(espera);
    if (indice >= 0) lista.splice(indice, 1);
    if (!lista.length) this.#esperando.delete(nome);
  }

  #aoSair() {
    this.#rejeitarPendentes("DAP: processo encerrado");
    for (const [, esperas] of this.#esperando) {
      for (const espera of esperas) {
        clearTimeout(espera.timer);
        espera.resolve(null);
      }
    }
    this.#esperando.clear();
    this.#parser.reset();
  }

  #rejeitarPendentes(motivo) {
    for (const [, pedido] of this.#pendentes) {
      clearTimeout(pedido.timer);
      pedido.reject(new Error(motivo));
    }
    this.#pendentes.clear();
  }

  #encerrarProcesso() {
    const child = this.#child;
    if (!child) return;
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    } catch {
      // já saiu
    }
    const matar = setTimeout(() => {
      try {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      } catch {
        // já saiu
      }
    }, 400);
    matar.unref?.();
  }
}

/* ------------------------------------------------------------------ */
/* Configuração                                                        */
/* ------------------------------------------------------------------ */

/** Lê <root>/.pi/dap.json. Nunca lança. */
export async function readDapConfig(root = null) {
  const arquivo = join(String(root || process.cwd()), ".pi", "dap.json");
  let bruto;
  try {
    bruto = await readFile(arquivo, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT" || err?.code === "ENOTDIR") return { adapters: {} };
    return { adapters: {}, error: `não consegui ler .pi/dap.json (${err?.code ?? "erro"})` };
  }
  try {
    const doc = JSON.parse(bruto);
    const adapters = doc?.adapters;
    if (
      !doc ||
      typeof doc !== "object" ||
      Array.isArray(doc) ||
      !adapters ||
      typeof adapters !== "object" ||
      Array.isArray(adapters)
    ) {
      return { adapters: {}, error: "formato inesperado em .pi/dap.json" };
    }
    return { adapters };
  } catch (err) {
    return { adapters: {}, error: `JSON inválido em .pi/dap.json: ${err?.message ?? err}` };
  }
}

/** Escolhe o adaptador pela extensão, preferindo `extensions` da config. */
export function adapterForFile(config, caminho) {
  if (typeof caminho !== "string" || !caminho) return null;
  const adapters = config?.adapters;
  if (!adapters || typeof adapters !== "object") return null;
  const alvo = caminho.toLowerCase();

  let melhor = null;
  let maior = -1;
  for (const [nome, cfg] of Object.entries(adapters)) {
    if (!cfg || typeof cfg !== "object") continue;
    const extensoes = Array.isArray(cfg.extensions)
      ? cfg.extensions
      : EXTENSOES_ADAPTADOR[nome.toLowerCase()] || [];
    for (const ext of extensoes) {
      if (typeof ext !== "string" || !ext) continue;
      if (alvo.endsWith(ext.toLowerCase()) && ext.length > maior) {
        melhor = { ...cfg, nome };
        maior = ext.length;
      }
    }
  }
  return melhor;
}

export default {
  DapClient,
  encodeDapMessage,
  createDapParser,
  readDapConfig,
  adapterForFile,
};
