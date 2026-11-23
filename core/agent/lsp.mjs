/**
 * core/agent/lsp.mjs — cliente LSP mínimo, zero-dependência, sobre stdio.
 *
 * O protocolo LSP é JSON-RPC 2.0 com framing por
 *   Content-Length: N\r\n\r\n< N bytes UTF-8 do JSON >
 * `N` é contado em BYTES, não em caracteres: "Atenção ☕" tem mais bytes que
 * caracteres. Toda a leitura é feita em Buffer e o body só é decodificado
 * quando os N bytes chegam — dividir no meio de um codepoint é seguro.
 *
 * Este módulo não conhece a CLI, não escreve na tela e não lê segredos. O
 * processo filho recebe apenas um allowlist de variáveis de ambiente mais as
 * explícitas em `env`.
 *
 * API:
 *   new LspClient({ command, args, cwd, env, timeoutMs })
 *   await client.start()                     -> capabilities do servidor
 *   client.openDocument(uri, languageId, text)
 *   client.changeDocument(uri, text, version)
 *   await client.diagnostics(uri)            -> [{ range, severity, message, source }]
 *   await client.rename(uri, line, char, newName) -> { changes } | null
 *   await client.hover(uri, line, char)      -> string | null
 *   await client.documentSymbols(uri)        -> [{ name, kind, range, selectionRange }]
 *   await client.close()
 *
 *   readLspConfig(root)  -> { servers, error? }   (nunca lança)
 *   serverForFile(config, caminho) -> { nome, ...cfg } | null
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * LSP 3.17 permite utf-8/utf-16/utf-32; o padrão é utf-16. Índices de string
 * do JS já são UTF-16 code units, então quando o servidor pede utf-8 precisamos
 * contar BYTES do prefixo, e para utf-32 contamos CODE POINTS.
 */
export function positionToLsp(lineText, coluna, encoding = "utf-16") {
  const linha = String(lineText ?? "");
  const n = Math.max(0, Math.min(linha.length, Number(coluna) || 0));
  if (encoding === "utf-8") return Buffer.byteLength(linha.slice(0, n), "utf8");
  if (encoding === "utf-32") return [...linha.slice(0, n)].length;
  return n; // utf-16 (padrão)
}

/** Inverso de positionToLsp: coluna do servidor → índice de string JS. */
export function positionFromLsp(lineText, coluna, encoding = "utf-16") {
  const linha = String(lineText ?? "");
  const alvo = Math.max(0, Number(coluna) || 0);
  if (encoding === "utf-16") return Math.min(linha.length, alvo);
  if (encoding === "utf-32") {
    let indice = 0, contador = 0;
    for (const cp of linha) { if (contador >= alvo) break; indice += cp.length; contador += 1; }
    return indice;
  }
  // utf-8: caminha pelos code points somando bytes até atingir a coluna
  let indice = 0, bytes = 0;
  for (const cp of linha) {
    const b = Buffer.byteLength(cp, "utf8");
    if (bytes + b > alvo) break;
    bytes += b;
    indice += cp.length;
  }
  return indice;
}

const JSONRPC = "2.0";
const PROTOCOL_VERSION = "3.17.0";
const SEPARADOR = Buffer.from("\r\n\r\n", "ascii");
const MAX_CABECALHO = 16 * 1024;
const MAX_CORPO = 32 * 1024 * 1024;

/** Variáveis repassadas ao servidor. Nada de chaves de API vazam por aqui. */
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

/* ------------------------------------------------------------------ */
/* Framing — funções puras, exportadas para teste                      */
/* ------------------------------------------------------------------ */

/** Serializa uma mensagem JSON-RPC com Content-Length em bytes UTF-8. */
export function encodeLspMessage(obj) {
  const corpo = Buffer.from(JSON.stringify(obj), "utf8");
  const cabecalho = Buffer.from(`Content-Length: ${corpo.length}\r\n\r\n`, "ascii");
  return Buffer.concat([cabecalho, corpo]);
}

/**
 * Parser incremental de stdout. Aceita chunks em qualquer posição (inclusive
 * no meio de um caractere multibyte) e multiple mensagens no mesmo chunk.
 */
export function createLspParser(onMessage, { maxHeader = MAX_CABECALHO, maxBody = MAX_CORPO } = {}) {
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
        const total = inicioCorpo + tamanho;
        if (buffer.length < total) return; // ainda chegando

        const corpo = buffer.subarray(inicioCorpo, total);
        buffer = buffer.subarray(total);
        try {
          const msg = JSON.parse(corpo.toString("utf8"));
          if (msg && typeof msg === "object") onMessage(msg);
        } catch {
          // payload corrompido é descartado; não derruba a sessão
        }
      }
    },
    reset() {
      buffer = Buffer.alloc(0);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Normalização de resultados                                          */
/* ------------------------------------------------------------------ */

function normalizarDiagnostico(item) {
  return {
    range: item?.range ?? null,
    severity: item?.severity ?? null,
    message: String(item?.message ?? ""),
    source: item?.source ?? null,
  };
}

function textoHover(conteudo) {
  if (typeof conteudo === "string") return conteudo;
  if (Array.isArray(conteudo)) {
    return conteudo
      .map((parte) => (typeof parte === "string" ? parte : typeof parte?.value === "string" ? parte.value : ""))
      .filter(Boolean)
      .join("\n\n");
  }
  return typeof conteudo?.value === "string" ? conteudo.value : "";
}

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

/* ------------------------------------------------------------------ */
/* Cliente                                                             */
/* ------------------------------------------------------------------ */

export class LspClient {
  #command;
  #args;
  #cwd;
  #env;
  #timeoutMs;
  #child = null;
  #proximoId = 1;
  #pendentes = new Map();
  #diagnosticos = new Map();
  #documentos = new Map(); // uri -> texto, para conversão de posições
  #esperandoDiagnostico = new Map();
  #capabilities = null;
  #iniciado = false;
  #fechado = false;
  #erroSpawn = null;
  #stderr = "";
  #parser;

  constructor({ command, args = [], cwd = null, env = {}, timeoutMs = 8000 } = {}) {
    if (!command || typeof command !== "string") throw new TypeError("LSP: 'command' é obrigatório");
    this.#command = command;
    this.#args = Array.isArray(args) ? args.map(String) : [];
    this.#cwd = cwd ? String(cwd) : null;
    this.#env = env && typeof env === "object" ? env : {};
    this.#timeoutMs = Math.max(1, Number(timeoutMs) || 8000);
    this.#parser = createLspParser((msg) => this.#aoReceber(msg));
  }

  get capabilities() {
    return this.#capabilities;
  }

  /** Encoding de posição negociado no initialize (padrão utf-16). */
  get positionEncoding() {
    const valor = this.#capabilities?.positionEncoding || this.#capabilities?.general?.positionEncoding;
    return ["utf-8", "utf-16", "utf-32"].includes(valor) ? valor : "utf-16";
  }

  get running() {
    return Boolean(this.#child && !this.#fechado);
  }

  /** Sobe o processo, faz initialize + initialized e devolve capabilities. */
  async start() {
    if (this.#iniciado) return this.#capabilities;
    if (this.#fechado) throw new Error("LSP: cliente já foi fechado");

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
      throw new Error(`LSP: não consegui iniciar o processo: ${err?.message ?? err}`);
    }

    const child = this.#child;
    child.stdout.on("data", (chunk) => this.#parser.feed(chunk));
    child.stderr.on("data", (chunk) => {
      if (this.#stderr.length < 2000) this.#stderr += String(chunk).slice(0, 2000);
    });
    child.on("error", (err) => {
      this.#erroSpawn = err;
    });
    child.on("exit", () => this.#aoSair());

    try {
      const resultado = await this.#request("initialize", {
        processId: null,
        rootUri: pathToFileURL(raiz).href,
        capabilities: {},
        protocolVersion: PROTOCOL_VERSION,
      });
      this.#capabilities = resultado?.capabilities ?? {};
      this.#notificar("initialized", {});
      this.#iniciado = true;
      return this.#capabilities;
    } catch (err) {
      this.#encerrarProcesso();
      this.#child = null;
      this.#iniciado = false;
      throw err;
    }
  }

  openDocument(uri, languageId, text) {
    this.#diagnosticos.delete(uri);
    const conteudo = String(text ?? "");
    this.#documentos.set(uri, conteudo);
    this.#notificar("textDocument/didOpen", {
      textDocument: { uri, languageId, version: 1, text: conteudo },
    });
  }

  changeDocument(uri, text, version) {
    this.#diagnosticos.delete(uri);
    const conteudo = String(text ?? "");
    this.#documentos.set(uri, conteudo);
    this.#notificar("textDocument/didChange", {
      textDocument: { uri, version: Number.isFinite(version) ? version : 2 },
      contentChanges: [{ text: conteudo }],
    });
  }

  /** Converte a coluna JS (UTF-16) para o encoding negociado com o servidor. */
  #colunaServidor(uri, line, character) {
    const linhas = String(this.#documentos.get(uri) ?? "").split(/\r?\n/);
    const textoLinha = linhas[Number(line) || 0] ?? "";
    return positionToLsp(textoLinha, character, this.positionEncoding);
  }

  /** Espera publishDiagnostics; usa pull diagnostics como fallback. */
  async diagnostics(uri) {
    const alvo = String(uri ?? "");
    if (!alvo) return [];
    if (this.#diagnosticos.has(alvo)) return this.#diagnosticos.get(alvo);

    const itens = await new Promise((resolve) => {
      const espera = { resolve, timer: null };
      espera.timer = setTimeout(() => {
        this.#removerEspera(alvo, espera);
        resolve(null);
      }, this.#timeoutMs);
      espera.timer.unref?.();
      if (!this.#esperandoDiagnostico.has(alvo)) this.#esperandoDiagnostico.set(alvo, []);
      this.#esperandoDiagnostico.get(alvo).push(espera);
    });
    if (itens) return itens;

    if (this.#capabilities?.diagnosticProvider) {
      try {
        const res = await this.#request("textDocument/diagnostic", { textDocument: { uri: alvo } });
        const lista = Array.isArray(res?.items) ? res.items.map(normalizarDiagnostico) : [];
        this.#diagnosticos.set(alvo, lista);
        return lista;
      } catch {
        // sem pull: devolve lista vazia
      }
    }
    return [];
  }

  async rename(uri, line, character, newName) {
    try {
      const res = await this.#request("textDocument/rename", {
        textDocument: { uri },
        position: { line, character: this.#colunaServidor(uri, line, character) },
        newName: String(newName ?? ""),
      });
      if (!res) return null;
      const changes = {};
      if (res.changes && typeof res.changes === "object") {
        for (const [u, edits] of Object.entries(res.changes)) {
          if (Array.isArray(edits)) changes[u] = edits;
        }
      }
      if (Array.isArray(res.documentChanges)) {
        for (const item of res.documentChanges) {
          const u = item?.textDocument?.uri;
          if (u && Array.isArray(item.edits)) changes[u] = [...(changes[u] || []), ...item.edits];
        }
      }
      return Object.keys(changes).length ? { changes } : null;
    } catch {
      return null;
    }
  }

  async hover(uri, line, character) {
    try {
      const res = await this.#request("textDocument/hover", {
        textDocument: { uri },
        position: { line, character: this.#colunaServidor(uri, line, character) },
      });
      if (!res) return null;
      const texto = textoHover(res.contents);
      return texto.trim() ? texto : null;
    } catch {
      return null;
    }
  }

  async documentSymbols(uri) {
    try {
      const res = await this.#request("textDocument/documentSymbol", { textDocument: { uri } });
      const simbolos = [];
      const visitar = (lista) => {
        if (!Array.isArray(lista)) return;
        for (const simbolo of lista) {
          if (!simbolo || typeof simbolo !== "object") continue;
          const range = simbolo.range ?? simbolo.location?.range ?? null;
          simbolos.push({
            name: String(simbolo.name ?? ""),
            kind: simbolo.kind ?? null,
            range,
            selectionRange: simbolo.selectionRange ?? range,
          });
          if (Array.isArray(simbolo.children)) visitar(simbolo.children);
        }
      };
      visitar(res);
      return simbolos;
    } catch {
      return [];
    }
  }

  /** shutdown + exit, com kill de segurança se o processo não sair. */
  async close() {
    if (this.#fechado) return;
    this.#fechado = true;
    if (!this.#child) return;

    try {
      await this.#request("shutdown", null, Math.min(1500, this.#timeoutMs));
    } catch {
      // servidor já morreu ou não implementa shutdown: segue para exit
    }
    try {
      this.#notificar("exit");
    } catch {
      // stdin já fechado
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
    this.#rejeitarPendentes("LSP: cliente fechado");
  }

  /* -------------------- internos -------------------- */

  #enviar(obj) {
    const child = this.#child;
    if (!child?.stdin || child.stdin.destroyed) throw new Error("LSP: cliente não iniciado");
    child.stdin.write(encodeLspMessage(obj));
  }

  #notificar(method, params) {
    this.#enviar({ jsonrpc: JSONRPC, method, params: params ?? {} });
  }

  #request(method, params, ms = this.#timeoutMs) {
    if (!this.#child) return Promise.reject(new Error("LSP: cliente não iniciado"));
    const id = this.#proximoId++;
    const limite = Math.max(1, Number(ms) || this.#timeoutMs);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pendentes.delete(id);
        reject(new Error(`LSP: timeout em ${method} (${limite} ms)`));
      }, limite);
      timer.unref?.();
      this.#pendentes.set(id, { resolve, reject, timer });
      try {
        this.#enviar({ jsonrpc: JSONRPC, id, method, params: params ?? null });
      } catch (err) {
        clearTimeout(timer);
        this.#pendentes.delete(id);
        reject(err);
      }
    });
  }

  #aoReceber(msg) {
    const ehResposta =
      msg.id != null && (Object.hasOwn(msg, "result") || Object.hasOwn(msg, "error"));
    if (ehResposta) {
      const pedido = this.#pendentes.get(msg.id);
      if (!pedido) return;
      this.#pendentes.delete(msg.id);
      clearTimeout(pedido.timer);
      if (msg.error) {
        pedido.reject(new Error(`LSP: ${msg.error.message || "erro na requisição"}`));
      } else {
        pedido.resolve(msg.result);
      }
      return;
    }

    const method = msg.method;
    if (!method) return;

    if (msg.id != null) {
      // Pedido iniciado pelo servidor: não implementamos nenhum.
      try {
        this.#enviar({
          jsonrpc: JSONRPC,
          id: msg.id,
          error: { code: -32601, message: "method not found" },
        });
      } catch {
        // cliente em fechamento
      }
      return;
    }

    if (method === "textDocument/publishDiagnostics") {
      const uri = msg.params?.uri;
      if (!uri) return;
      const itens = Array.isArray(msg.params.diagnostics)
        ? msg.params.diagnostics.map(normalizarDiagnostico)
        : [];
      this.#diagnosticos.set(uri, itens);
      const esperas = this.#esperandoDiagnostico.get(uri);
      if (esperas) {
        this.#esperandoDiagnostico.delete(uri);
        for (const espera of esperas) {
          clearTimeout(espera.timer);
          espera.resolve(itens);
        }
      }
    }
    // Outras notificações (logMessage, showMessage, telemetry) são ignoradas
    // de propósito: não podem travar o roteamento.
  }

  #removerEspera(uri, espera) {
    const lista = this.#esperandoDiagnostico.get(uri);
    if (!lista) return;
    const indice = lista.indexOf(espera);
    if (indice >= 0) lista.splice(indice, 1);
    if (!lista.length) this.#esperandoDiagnostico.delete(uri);
  }

  #aoSair() {
    this.#rejeitarPendentes("LSP: processo encerrado");
    for (const [, esperas] of this.#esperandoDiagnostico) {
      for (const espera of esperas) {
        clearTimeout(espera.timer);
        espera.resolve([]);
      }
    }
    this.#esperandoDiagnostico.clear();
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

/** Lê <root>/.pi/lsp.json. Nunca lança: ausente é { servers: {} }. */
export async function readLspConfig(root = null) {
  const arquivo = join(String(root || process.cwd()), ".pi", "lsp.json");
  let bruto;
  try {
    bruto = await readFile(arquivo, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT" || err?.code === "ENOTDIR") return { servers: {} };
    return { servers: {}, error: `não consegui ler .pi/lsp.json (${err?.code ?? "erro"})` };
  }
  try {
    const doc = JSON.parse(bruto);
    const servidores = doc?.servers;
    if (
      !doc ||
      typeof doc !== "object" ||
      Array.isArray(doc) ||
      !servidores ||
      typeof servidores !== "object" ||
      Array.isArray(servidores)
    ) {
      return { servers: {}, error: "formato inesperado em .pi/lsp.json" };
    }
    return { servers: servidores };
  } catch (err) {
    return { servers: {}, error: `JSON inválido em .pi/lsp.json: ${err?.message ?? err}` };
  }
}

/** Encontra o servidor cuja extensão casa com o sufixo do caminho. */
export function serverForFile(config, caminho) {
  if (typeof caminho !== "string" || !caminho) return null;
  const servidores = config?.servers;
  if (!servidores || typeof servidores !== "object") return null;

  const alvo = caminho.toLowerCase();
  let melhor = null;
  let maiorExtensao = -1;
  for (const [nome, cfg] of Object.entries(servidores)) {
    if (!cfg || typeof cfg !== "object") continue;
    const extensoes = Array.isArray(cfg.extensions) ? cfg.extensions : [];
    for (const ext of extensoes) {
      if (typeof ext !== "string" || !ext) continue;
      if (alvo.endsWith(ext.toLowerCase()) && ext.length > maiorExtensao) {
        melhor = { ...cfg, nome };
        maiorExtensao = ext.length;
      }
    }
  }
  return melhor;
}

export default {
  LspClient, encodeLspMessage, createLspParser, readLspConfig, serverForFile,
  positionToLsp, positionFromLsp,
};
