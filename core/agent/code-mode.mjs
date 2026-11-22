/**
 * core/agent/code-mode.mjs — execução de um programa curto que encadeia tools.
 *
 * O modelo escreve JavaScript; ele NÃO recebe `process`, `require`, `fs`, `fetch`
 * nem `eval`/`Function` (codeGeneration desligado). A única forma de efeito é
 * `tools.call(nome, args)`, limitada por allowlist, contador e prazo.
 *
 * Este módulo é puro: não conecta em MCP, não lê config, não sobe processo.
 * Quem fornece o mapa `tools` é o chamador (o gateway em
 * `scripts/code-mode-mcp.mjs`, ou um teste com ferramentas falsas).
 */

import vm from "node:vm";

const ERRO_TEMPO = "tempo esgotado";

function serializar(valor, limite) {
  let texto;
  try {
    texto = JSON.stringify(valor === undefined ? null : valor);
  } catch {
    texto = JSON.stringify(String(valor));
  }
  if (texto == null) texto = "null";
  if (texto.length > limite) return { truncated: true, preview: texto.slice(0, limite) };
  try { return JSON.parse(texto); } catch { return { truncated: true, preview: texto.slice(0, limite) }; }
}

/**
 * @param {string} code programa JavaScript (corpo de uma função assíncrona)
 * @param {object} [opts]
 * @param {Record<string, Function>} [opts.tools] mapa nome -> (args) => Promise<any>
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.maxCalls]
 * @param {number} [opts.maxCodeChars]
 * @param {number} [opts.maxResultChars]
 * @param {Function} [opts.log]
 * @returns {Promise<{ok:boolean, value?:any, error?:string, calls:number, durationMs:number, truncated?:boolean}>}
 */
export async function runCode(code, opts = {}) {
  const iniciado = Date.now();
  const {
    tools = {},
    timeoutMs = 10_000,
    maxCalls = 50,
    maxCodeChars = 20_000,
    maxResultChars = 20_000,
    log = null,
  } = opts;

  const falha = (message, calls = 0) => ({
    ok: false,
    error: String(message).slice(0, 500),
    calls,
    durationMs: Date.now() - iniciado,
  });

  if (typeof code !== "string" || !code.trim()) return falha("código vazio");
  if (code.length > maxCodeChars) return falha("código acima do limite de tamanho");
  if (!tools || typeof tools !== "object" || Array.isArray(tools)) return falha("mapa de ferramentas inválido");

  const nomes = Object.keys(tools).filter((n) => typeof tools[n] === "function");
  const prazo = iniciado + Math.max(100, Math.min(120_000, Number(timeoutMs) || 10_000));
  const limiteChamadas = Math.max(1, Math.min(500, Number(maxCalls) || 50));
  let chamadas = 0;

  const api = Object.freeze({
    list: () => nomes.slice(),
    has: (nome) => Object.prototype.hasOwnProperty.call(tools, nome),
    call: async (nome, args = {}) => {
      chamadas += 1;
      if (chamadas > limiteChamadas) throw new Error("limite de chamadas excedido");
      if (Date.now() > prazo) throw new Error(ERRO_TEMPO);
      if (typeof nome !== "string" || !Object.prototype.hasOwnProperty.call(tools, nome)) {
        throw new Error(`ferramenta desconhecida: ${String(nome).slice(0, 80)}`);
      }
      if (args == null || typeof args !== "object" || Array.isArray(args)) {
        throw new Error("args deve ser um objeto");
      }
      const resultado = await tools[nome](args);
      if (Date.now() > prazo) throw new Error(ERRO_TEMPO);
      return serializar(resultado, maxResultChars);
    },
    log: (...partes) => {
      if (typeof log === "function") {
        log(partes.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ").slice(0, 1000));
      }
    },
  });

  const consoleApi = Object.freeze({ log: api.log, error: api.log });
  const contexto = vm.createContext(
    Object.freeze({
      tools: api,
      console: consoleApi,
      JSON, Math, Date,
      String, Number, Boolean, Array, Object, Map, Set,
      Promise, RegExp, Error, TypeError, RangeError,
      parseInt, parseFloat, isNaN, isFinite,
    }),
    { codeGeneration: { strings: false, wasm: false } },
  );

  let promessa;
  try {
    const script = new vm.Script(`(async () => {\n${code}\n})()`, { filename: "code-mode.js" });
    promessa = script.runInContext(contexto, { timeout: Math.max(100, prazo - Date.now()) });
    if (!promessa || typeof promessa.then !== "function") return falha("o programa não retornou uma promessa", chamadas);
  } catch (err) {
    return falha(String(err?.message || err), chamadas);
  }

  let timer;
  const expira = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(ERRO_TEMPO)), Math.max(50, prazo - Date.now()));
    if (timer.unref) timer.unref();
  });

  try {
    const valor = await Promise.race([promessa, expira]);
    const dado = serializar(valor, maxResultChars);
    return {
      ok: true,
      value: dado,
      calls: chamadas,
      durationMs: Date.now() - iniciado,
      ...(dado && dado.truncated ? { truncated: true } : {}),
    };
  } catch (err) {
    return falha(String(err?.message || err), chamadas);
  } finally {
    clearTimeout(timer);
  }
}

export default { runCode };
