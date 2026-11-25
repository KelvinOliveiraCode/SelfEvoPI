/**
 * core/agent/cells.mjs — células de código com contexto persistente e
 * reentrada de ferramentas.
 *
 * Diferente de `code-mode.mjs` (que roda um programa stateless e devolve valor),
 * a célula mantém um contexto VIVO entre chamadas: o que uma execução deixou em
 * `state` (ou em `globalThis`) continua valendo na próxima. Isso permite que a
 * célula chame uma ferramenta, guarde o resultado e o use na chamada seguinte.
 *
 * Segurança (mesma postura do code-mode, com isolamento de reigno reforçado):
 *   - contexto `vm` com `codeGeneration` desligado (sem eval, sem Function);
 *   - sem `process`, `require`, `fetch`, `setTimeout` ou qualquer global de host;
 *   - sem rede, sem sistema de arquivos, sem imports, sem temporizadores;
 *   - `state`, `tools` e `console` nascem DENTRO do contexto: poluir o
 *     `__proto__` de um deles afeta só o reigno da célula, nunca o processo
 *     hospedeiro. O despachante de ferramentas do host fica escondido num
 *     fecho (closure), inalcançável pela célula;
 *   - a ÚNICA forma de efeito é `tools.call(nome, args)`, limitada por allowlist,
 *     contador de chamadas e prazo. O resultado volta re-materializado no reigno
 *     da célula (não vaza objeto do host).
 *
 * Persistência:
 *   - `state` sobrevive entre `run`. Guarde valores em `state.algo = ...` (ou
 *     `globalThis.algo = ...`) para a próxima chamada;
 *   - declarações `let`/`const` no topo de uma célula são locais àquela execução;
 *     use `state` para atravessar chamadas.
 *
 * Contrato:
 *   createCellRuntime({ tools, allow?, timeoutMs?, maxCalls?, maxCodeChars?,
 *                       maxOutputChars? })
 *     -> { run(code) -> Promise<resultado>, reset() -> void }
 *
 * `tools` pode ser:
 *   (a) um mapa nome -> função assíncrona; `allow` restringe (default: todas);
 *   (b) um objeto { call(nome,args), allow?, list? } com despachante próprio.
 *
 * Limite honesto: isto é uma contenção de linguagem, não um sandbox de sistema
 * operacional (ver PROJECT.md §9/§16). Não há isolamento de processo.
 */

import vm from "node:vm";

const ERRO_TEMPO = "tempo esgotado";

/**
 * Script de bootstrap rodado DENTRO do contexto. Cria `state`, `tools` e
 * `console` como objetos do próprio reigno da célula e esconde o despachante do
 * host (`hostCall`) num fecho. Assim `state.__proto__` / `tools.__proto__`/
 * `tools.call.constructor` apontam para o reigno isolado, e o resultado de uma
 * ferramenta é re-materializado com o `JSON` do contexto (objeto do reigno).
 */
const BOOTSTRAP = `(function (nomes, hostCall) {
  const nomesLocal = Array.from(nomes);
  const permitidos = new Set(nomesLocal);
  Object.defineProperty(globalThis, 'state', {
    value: {}, writable: false, enumerable: true, configurable: false,
  });
  Object.defineProperty(globalThis, 'console', {
    value: { log: function () {}, error: function () {}, warn: function () {}, info: function () {} },
    writable: false, enumerable: true, configurable: false,
  });
  const tools = {
    list: function () { return Array.from(permitidos); },
    has: function (n) { return permitidos.has(n); },
    call: function (nome, args) {
      return Promise.resolve(hostCall(nome, args === undefined ? {} : args)).then(function (r) {
        return JSON.parse(JSON.stringify(r === undefined ? null : r));
      });
    },
  };
  Object.defineProperty(globalThis, 'tools', {
    value: tools, writable: false, enumerable: true, configurable: false,
  });
})`;

/** Serializa um valor limitando o tamanho (igual ao code-mode). */
function serializar(valor, limite) {
  let texto;
  try {
    texto = JSON.stringify(valor === undefined ? null : valor);
  } catch {
    texto = JSON.stringify(String(valor));
  }
  if (texto == null) texto = "null";
  if (texto.length > limite) return { truncated: true, preview: texto.slice(0, limite) };
  try {
    return JSON.parse(texto);
  } catch {
    return { truncated: true, preview: texto.slice(0, limite) };
  }
}

/**
 * Cria um runtime de células com contexto persistente.
 *
 * @param {object} opts
 * @param {Record<string, Function>|{ call: Function, allow?: string[] }} opts.tools
 * @param {string[]} [opts.allow]        allowlist de nomes de ferramenta
 * @param {number}   [opts.timeoutMs=10000]    prazo por execução
 * @param {number}   [opts.maxCalls=50]        teto de chamadas de ferramenta por execução
 * @param {number}   [opts.maxCodeChars=20000] teto de tamanho do código de uma célula
 * @param {number}   [opts.maxOutputChars=20000] teto de tamanho de cada resultado serializado
 * @returns {{ run: (code: string) => Promise<object>, reset: () => void }}
 */
export function createCellRuntime(opts = {}) {
  const {
    tools = {},
    timeoutMs = 10_000,
    maxCalls = 50,
    maxCodeChars = 20_000,
    maxOutputChars = 20_000,
  } = opts;

  // Resolve o despachante e a allowlist conforme a forma de `tools`.
  let dispatch; // (nome, args) => Promise<any>
  let nomesBase; // nomes disponíveis
  // Allowlist explícita tem prioridade; sem ela, vale o default de cada forma.
  let allowOverride = Array.isArray(opts.allow) ? opts.allow : null;

  if (tools && typeof tools.call === "function" && typeof tools !== "function") {
    dispatch = (nome, args) => tools.call(nome, args);
    if (allowOverride === null) {
      allowOverride = Array.isArray(tools.allow) ? tools.allow : [];
    }
    nomesBase = typeof tools.list === "function" ? tools.list() : [];
  } else if (tools && typeof tools === "object") {
    nomesBase = Object.keys(tools).filter((n) => typeof tools[n] === "function");
    const mapa = Object.create(null);
    for (const n of nomesBase) mapa[n] = tools[n];
    dispatch = (nome, args) => mapa[nome](args);
  } else {
    dispatch = () => {
      throw new Error("nenhuma ferramenta disponível");
    };
    nomesBase = [];
  }

  // Allowlist efetiva (o que a célula pode de fato chamar).
  const permitidos = new Set(
    (allowOverride ?? nomesBase).filter((n) => {
      if (typeof n !== "string") return false;
      if (allowOverride) return true;
      return typeof tools[n] === "function";
    }),
  );
  const nomesPermitidos = [...permitidos].sort();

  const limiteChamadas = Math.max(1, Math.min(500, Number(maxCalls) || 50));
  const limiteResultado = Math.max(100, Math.min(1_000_000, Number(maxOutputChars) || 20_000));
  const limiteCodigo = Number.isFinite(maxCodeChars) && maxCodeChars > 0 ? Math.floor(maxCodeChars) : 20_000;
  const prazoBase = Math.max(100, Math.min(120_000, Number(timeoutMs) || 10_000));

  // Contador mutável por execução (vive no host, no fecho do runtime).
  let chamadas = 0;

  /**
   * Despachante do host, escondido num fecho dentro do contexto. É a única ponte
   * para fora: aplica allowlist, contador, prazo e serialização com limite.
   */
  async function hostCall(nome, args) {
    chamadas += 1;
    if (chamadas > limiteChamadas) throw new Error("limite de chamadas excedido");
    if (typeof nome !== "string" || !permitidos.has(nome)) {
      throw new Error(`ferramenta não permitida: ${String(nome).slice(0, 80)}`);
    }
    let a = args;
    if (a === undefined) a = {};
    if (a === null || typeof a !== "object" || Array.isArray(a)) {
      throw new Error("args deve ser um objeto");
    }
    const resultado = await dispatch(nome, a);
    return serializar(resultado, limiteResultado);
  }

  // Cria o contexto e injeta os argumentos do bootstrap de forma isolada.
  function novoContexto() {
    const ponte = { __nomes__: nomesPermitidos, __hostCall__: hostCall };
    const ctx = vm.createContext(ponte, { codeGeneration: { strings: false, wasm: false } });
    const script = new vm.Script(`(${BOOTSTRAP})(__nomes__, __hostCall__);`, { filename: "cells-bootstrap.js" });
    script.runInContext(ctx, { timeout: 1000 });
    // Apaga os argumentos-ponte do sandbox para que a célula não os veja.
    delete ponte.__nomes__;
    delete ponte.__hostCall__;
    return ctx;
  }

  let contexto = novoContexto();

  /**
   * Executa o código de uma célula no contexto persistente.
   * @param {string} code
   * @returns {Promise<{ ok: boolean, value?: any, error?: string, calls: number, durationMs: number, truncated?: boolean }>}
   */
  async function run(code) {
    const iniciado = Date.now();
    chamadas = 0; // contador por execução
    const falha = (message) => ({
      ok: false,
      error: String(message).slice(0, 500),
      calls: chamadas,
      durationMs: Date.now() - iniciado,
    });

    if (typeof code !== "string" || !code.trim()) return falha("código vazio");
    if (code.length > limiteCodigo) return falha("código acima do limite de tamanho");

    const prazo = Math.max(100, prazoBase);
    let promessa;
    try {
      const script = new vm.Script(`(async () => {\n${code}\n})()`, { filename: "cell.js" });
      promessa = script.runInContext(contexto, { timeout: prazo });
      if (!promessa || typeof promessa.then !== "function") {
        return falha("a célula não retornou uma promessa");
      }
    } catch (err) {
      const mensagem = String(err?.message || err);
      // O VM do Node lança "Script execution timed out after Nms" quando o
      // relógio está atrasado sob carga. Normalizamos para o mesmo motivo da
      // célula, para que a interface não mostre dois textos para a mesma falha.
      return falha(/timed out|timeout/i.test(mensagem) ? ERRO_TEMPO : mensagem);
    }

    let timer;
    const expira = new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(ERRO_TEMPO)), prazo + 20);
      if (timer.unref) timer.unref();
    });

    try {
      const valor = await Promise.race([promessa, expira]);
      if (Date.now() - iniciado > prazo) return falha(ERRO_TEMPO);
      const dado = serializar(valor, limiteResultado);
      return {
        ok: true,
        value: dado,
        calls: chamadas,
        durationMs: Date.now() - iniciado,
        ...(dado && dado.truncated ? { truncated: true } : {}),
      };
    } catch (err) {
      return falha(String(err?.message || err));
    } finally {
      clearTimeout(timer);
    }
  }

  /** Descarta o contexto atual e começa um novo (estado limpo). */
  function reset() {
    chamadas = 0;
    contexto = novoContexto();
  }

  return { run, reset };
}

export default { createCellRuntime };