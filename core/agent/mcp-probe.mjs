/**
 * core/agent/mcp-probe.mjs — probe JSON-RPC de servidores MCP + helpers de
 * config.
 *
 * Este módulo nasceu da separação do antigo `mcp-opencode.mjs`, que tinha dois
 * papéis: ler a config global (`~/.pi/settings.json`) e fazer o probe JSON-RPC.
 * A leitura global agora é responsabilidade de `mcp.mjs:listMcpServers({ root:
 * os.homedir() })`. O probe (abrir processo, handshake, tools/list) e os
 * helpers de JSONC/normalização ficam aqui.
 *
 * Decisões que definem o módulo:
 *
 *  1. **JSONC de verdade.** O arquivo é `.jsonc`: comentários e vírgula
 *     sobrando são válidos, e `JSON.parse` cru falha. A limpeza respeita
 *     string e escape (`\"` não fecha string). Se não der conta, o erro diz
 *     **a linha** — "JSON inválido" sem linha é erro que ninguém corrige.
 *
 *  2. **O probe não finge.** Ele abre o processo, escreve um `initialize`
 *     JSON-RPC em stdin e espera. Se o servidor não responder, `ok` é `false`
 *     e `error` diz o que aconteceu. Um `ok: true` sem handshake seria pior
 *     que não ter probe: a CLI diria "conectado" e o usuário perderia tempo.
 *
 * `environment` é devolvido como está no arquivo, e **pode conter segredo**.
 * Quem chamar não loga esse campo — a regra do projeto é "nunca logar chave".
 */

import { spawn } from "node:child_process";
import { lstatSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

/**
 * Onde procuramos a config global de MCPs. Só a config do próprio SelfEvoPI
 * (`~/.pi/settings.json`); o harness é agnóstico e não lê a config de outro
 * produto em runtime. Quem já tem MCPs em outro lugar usa o `/import` para
 * trazê-los para `~/.pi/settings.json` (importação explícita, uma vez).
 *
 * O formato aceito é `mcpServers` (nativo do SelfEvoPI); `listConfiguredMcp`
 * mantém compatibilidade com o formato aninhado `mcp.servers` para não quebrar
 * configs legadas que já estejam em `~/.pi/settings.json`.
 */
export const MCP_CONFIG_FILES = [
  path.join(".pi", "settings.json"),
];

/** Status possíveis. */
export const STATUS = Object.freeze({
  CONFIGURED: "configured",
  DISABLED: "disabled",
  BROKEN: "broken",
});

/** Tipos de servidor que sabemos montar. */
const TIPOS_CONHECIDOS = new Set(["local", "remote"]);

/**
 * Variáveis que um processo filho recebe, no probe (nada de segredo do harness).
 *
 * `APPDATA`/`LOCALAPPDATA` não são luxo: o `uv` (Python) guarda as
 * instalações em `%LOCALAPPDATA%` e, sem ela, o `searxng` morria com
 * `[WARNING] Failed to read unmanaged installs` antes de falar MCP. Medido
 * 2026-11-19: com a allowlist antiga, sem resposta; com `LOCALAPPDATA`,
 * `initialize` em 4475 ms.
 */
const ENV_BASE = [
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
  "PYTHONUTF8",
  "APPDATA",
  "LOCALAPPDATA",
];

/** Protocolo MCP que o probe anuncia. */
const PROTOCOL_VERSION = "2024-11-05";

/* ------------------------------------------------------------------ */
/* JSONC                                                               */
/* ------------------------------------------------------------------ */

/**
 * Remove comentários de um JSONC, respeitando string e escape.
 *
 * Devolve `{ text }` ou lança `Error` com a linha do problema:
 *  - string que nunca fecha;
 *  - comentário de bloco que nunca fecha.
 *
 * Comentário vira espaço (não some), então comprimento e numeração de linha
 * continuam coerentes com o arquivo original.
 */
export function stripJsonc(source) {
  const s = String(source ?? "");
  const n = s.length;
  const out = [];
  let i = 0;
  let line = 1;
  let blockStartLine = null;
  let stringStartLine = null;
  let state = "code"; // code | line | block | dq

  while (i < n) {
    const c = s[i];
    const d = i + 1 < n ? s[i + 1] : "";

    if (state === "code") {
      if (c === "/" && d === "/") {
        out.push(" ", " ");
        i += 2;
        state = "line";
        continue;
      }
      if (c === "/" && d === "*") {
        if (blockStartLine === null) blockStartLine = line;
        out.push(" ", " ");
        i += 2;
        state = "block";
        continue;
      }
      if (c === '"') {
        out.push(c);
        i += 1;
        state = "dq";
        if (stringStartLine === null) stringStartLine = line;
        continue;
      }
      if (c === "\n") {
        out.push(c);
        line += 1;
        i += 1;
        continue;
      }
      out.push(c);
      i += 1;
      continue;
    }

    if (state === "line") {
      if (c === "\n") {
        out.push(c);
        line += 1;
        i += 1;
        state = "code";
        continue;
      }
      out.push(" ");
      i += 1;
      continue;
    }

    if (state === "block") {
      if (c === "*" && d === "/") {
        out.push(" ", " ");
        i += 2;
        state = "code";
        blockStartLine = null;
        continue;
      }
      if (c === "\n") {
        out.push(c);
        line += 1;
      } else {
        out.push(" ");
      }
      i += 1;
      continue;
    }

    // dentro de string: copia tudo, só marca o fim
    if (c === "\\") {
      if (i + 1 < n && s[i + 1] !== "\n") {
        out.push(c, s[i + 1]);
        i += 2;
      } else {
        out.push(c);
        i += 1;
      }
      continue;
    }
    if (c === '"') {
      out.push(c);
      i += 1;
      state = "code";
      continue;
    }
    if (c === "\n") {
      out.push(c);
      line += 1;
      i += 1;
      continue;
    }
    out.push(c);
    i += 1;
  }

  if (state === "dq") {
    throw new Error(`string não fechada (linha ${stringStartLine ?? line})`);
  }
  if (state === "block") {
    throw new Error(`comentário de bloco não fechado (linha ${blockStartLine ?? 1})`);
  }

  return { text: out.join("") };
}

/**
 * Remove a vírgula que sobra antes de `}` ou `]` (JSONC permite, JSON não).
 * Só mexe fora de string: um `,` dentro de texto continua inteiro.
 */
export function stripTrailingCommas(text) {
  const s = String(text ?? "");
  const out = [];
  let dq = false;

  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];

    if (dq) {
      out.push(c);
      if (c === "\\") {
        i += 1;
        if (i < s.length) out.push(s[i]);
        continue;
      }
      if (c === '"') dq = false;
      continue;
    }

    if (c === '"') {
      dq = true;
      out.push(c);
      continue;
    }

    if (c === ",") {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j += 1;
      if (s[j] === "}" || s[j] === "]") continue;
    }

    out.push(c);
  }

  return out.join("");
}

/* ------------------------------------------------------------------ */
/* Descoberta                                                          */
/* ------------------------------------------------------------------ */

/** Raiz do home do usuário, sem depender de `process.env.HOME` no teste. */
function resolveHome(home) {
  if (typeof home === "string" && home.trim() !== "") return path.resolve(home);
  return path.resolve(process.env.HOME ?? process.env.USERPROFILE ?? ".");
}

/**
 * Caminho do `.pi/settings.json` que existir, ou `null`.
 *
 * @param {{ home?: string, configPath?: string }} [opts]
 * @returns {Promise<string|null>}
 */
export async function findMcpConfig({ home, configPath } = {}) {
  if (typeof configPath === "string" && configPath.trim() !== "") {
    const abs = path.resolve(configPath);
    try {
      const st = await stat(abs);
      return st.isFile() ? abs : null;
    } catch {
      return null;
    }
  }

  const base = resolveHome(home);
  for (const rel of MCP_CONFIG_FILES) {
    const abs = path.join(base, rel);
    try {
      const st = await stat(abs);
      if (st.isFile()) return abs;
    } catch {
      /* ausente: segue para o próximo candidato */
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Normalização                                                        */
/* ------------------------------------------------------------------ */

/**
 * Converte a entrada crua no formato público.
 *
 * `command` pode ser um array (comando + argumentos) ou uma string. Nos
 * dois casos a saída é `command` string e `args` array — a diferença entre
 * "não tem comando" e "tem" é o que define `status`, então ela não pode se
 * perder no caminho.
 */
export function normalizeServerEntry(name, raw) {
  const entry = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {};

  const type = typeof entry.type === "string" && entry.type.trim() !== "" ? entry.type.trim() : "local";

  let command = null;
  let args = [];

  if (Array.isArray(entry.command)) {
    const list = entry.command.filter((c) => typeof c === "string" && c.trim() !== "");
    command = list.length > 0 ? list[0] : null;
    args = list.slice(1);
  } else if (typeof entry.command === "string" && entry.command.trim() !== "") {
    command = entry.command.trim();
  }

  if (args.length === 0 && Array.isArray(entry.args)) {
    args = entry.args.filter((a) => typeof a === "string").map((a) => String(a));
  }

  const cwd = typeof entry.cwd === "string" && entry.cwd.trim() !== "" ? entry.cwd : null;

  const environment =
    typeof entry.environment === "object" && entry.environment !== null && !Array.isArray(entry.environment)
      ? { ...entry.environment }
      : {};

  const timeout =
    typeof entry.timeout === "object" && entry.timeout !== null && !Array.isArray(entry.timeout)
      ? { ...entry.timeout }
      : {};

  const disabled = entry.disabled === true || entry.enabled === false;

  return { name, type, command, args, cwd, environment, timeout, disabled };
}

/** Expande `~` no começo do caminho. */
function expandHome(p, home) {
  const s = String(p);
  if (s === "~") return resolveHome(home);
  if (s.startsWith("~/") || s.startsWith("~\\")) return path.join(resolveHome(home), s.slice(2));
  return s;
}

/**
 * O caminho existe? `lstatSync` e não `existsSync`, por um motivo medido:
 * alias do Microsoft Store (`WindowsApps\python.exe`) e reparse point, e
 * `existsSync` devolve `false` para ele. Um alias instalado e legitimo viraria
 * "broken" — falso positivo que faria a CLI mentir sobre o usuario.
 */
function presente(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Status de um servidor: disabled | broken | configured. */
export function statusOf(server, { home } = {}) {
  if (server.disabled) return STATUS.DISABLED;

  if (!TIPOS_CONHECIDOS.has(server.type)) return STATUS.BROKEN;

  if (server.type === "remote") return STATUS.CONFIGURED; // tem url, não tem processo local

  if (!server.command) return STATUS.BROKEN;

  const alvo = expandHome(server.command, home);
  if (!presente(alvo)) return STATUS.BROKEN;

  return STATUS.CONFIGURED;
}

/* ------------------------------------------------------------------ */
/* Leitura                                                             */
/* ------------------------------------------------------------------ */

/**
 * Lê a configuração global do SelfEvoPI e devolve os servidores com status.
 *
 * Lança quando o arquivo existe mas não pode ser lido ou interpretado — e o
 * erro diz a linha. Não lança quando o arquivo simplesmente não existe: nesse
 * caso a lista é vazia, que é a verdade.
 *
 * @param {{ home?: string, configPath?: string }} [opts]
 * @returns {Promise<Array<{name:string,type:string,command:string|null,args:string[],cwd:string|null,environment:object,timeout:object,status:"configured"|"disabled"|"broken"}>>}
 */
export async function listConfiguredMcp({ home, configPath } = {}) {
  const file = await findMcpConfig({ home, configPath });
  if (!file) return [];

  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    throw new Error(`não consegui ler ${file}: ${err?.message ?? err}`);
  }

  let doc;
  try {
    const { text } = stripJsonc(raw);
    doc = JSON.parse(stripTrailingCommas(text));
  } catch (err) {
    const msg = String(err?.message ?? err);
    const m = /line (\d+) column (\d+)/.exec(msg);
    const onde = m ? ` (linha ${m[1]}, coluna ${m[2]})` : "";
    throw new Error(`configuração inválida em ${file}${onde}: ${msg}`);
  }

  const map =
    doc && typeof doc === "object" && doc.mcpServers && typeof doc.mcpServers === "object"
      ? doc.mcpServers
      : doc && typeof doc === "object" && doc.mcp && typeof doc.mcp === "object" && doc.mcp.servers
        ? doc.mcp.servers
        : {};

  return Object.entries(map)
    .map(([name, raw2]) => {
      const server = normalizeServerEntry(name, raw2);
      return {
        name: server.name,
        type: server.type,
        command: server.command,
        args: server.args,
        cwd: server.cwd,
        environment: server.environment,
        timeout: server.timeout,
        status: statusOf(server, { home }),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ */
/* Probe                                                               */
/* ------------------------------------------------------------------ */

/** Mata o processo e a árvore dele, sem lançar. */
async function killTree(child) {
  if (!child || child.pid === undefined || child.pid === null) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.on("error", () => resolve());
      killer.on("close", () => resolve());
    });
    return;
  }
  try {
    child.kill("SIGKILL");
  } catch {
    /* já morreu */
  }
}

/**
 * Abre o servidor MCP, faz o handshake e devolve as ferramentas.
 *
 * O handshake é JSON-RPC de verdade em stdio (uma mensagem por linha):
 * `initialize` → `notifications/initialized` → `tools/list`.
 *
 * Orçamento curto (5 s no total): se o servidor não responde, `ok` é `false`
 * e o processo morre de qualquer jeito.
 *
 * @param {{ name: string, home?: string, configPath?: string, timeoutMs?: number }} opts
 * @returns {Promise<{ok: boolean, tools: string[], error: string|null}>}
 */
export async function probeMcpServer({ name, home, configPath, timeoutMs = 5_000 } = {}) {
  const vazio = { ok: false, tools: [], error: null };

  if (typeof name !== "string" || name.trim() === "") {
    return { ...vazio, error: "informe o nome do servidor" };
  }

  const servidores = await listConfiguredMcp({ home, configPath });
  const alvo = servidores.find((s) => s.name === name);
  if (!alvo) return { ...vazio, error: `servidor "${name}" não está na configuração` };
  if (alvo.type === "remote") {
    return { ...vazio, error: `servidor "${name}" é remoto: não há processo local para sondar` };
  }
  if (alvo.status === "disabled") {
    return { ...vazio, error: `servidor "${name}" está desabilitado na configuração` };
  }
  if (alvo.status === "broken" || !alvo.command) {
    return { ...vazio, error: `servidor "${name}" não tem comando executável` };
  }

  const env = {};
  for (const k of ENV_BASE) if (process.env[k] !== undefined) env[k] = process.env[k];
  for (const [k, v] of Object.entries(alvo.environment)) env[k] = String(v);

  const inicio = Date.now();
  const teto = Math.max(500, Number(timeoutMs) || 5_000);

  let child;
  try {
    // No Windows, .cmd/.bat (npx.cmd, uv.cmd) exigem shell: true ou spawn
    // responde EINVAL. .exe com caminho (node.exe em "Program Files") NAO pode
    // receber shell: true ou o cmd.exe quebra no espaco. A regra e: so .cmd/.bat
    // vao para o shell.
    const cmd = expandHome(alvo.command, home);
    const precisaShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(cmd);
    child = spawn(cmd, alvo.args, {
      cwd: alvo.cwd ? expandHome(alvo.cwd, home) : resolveHome(home),
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: precisaShell,
    });
  } catch (err) {
    return { ok: false, tools: [], error: `não consegui iniciar o processo: ${err?.message ?? err}` };
  }

  const linhas = [];
  let stderr = "";
  let erroSpawn = null;

  // Buffer acumulado: servidores *-cli.exe mandam mensagens grandes (catálogo
  // de 150KB) em múltiplos chunks stdout SEM \n entre eles (só \n no final).
  // split(/\r?\n/) quebra o JSON em pedaços não-parseáveis. Acumular e parsear
  // por profundidade de chaves resolve sem quebrar o caso que já funcionava
  // (servidores newline-delimited continuam funcionando: cada linha completa
  // é um objeto JSON que fecha antes do próximo \n).
  const MAX_BUFFER = 4 * 1024 * 1024; // 4 MB — catálogo do lightcraft ~150KB, folga 26x
  let buffer = "";
  const mensagens = []; // objetos JSON-RPC já parseados e prontos

  /** Extrai objetos JSON completos do buffer, por profundidade de chaves. */
  function drenarBuffer() {
    let i = 0;
    while (i < buffer.length) {
      // Pula whitespace e newlines entre mensagens
      while (i < buffer.length && /\s/.test(buffer[i])) i++;
      if (i >= buffer.length) { buffer = ""; return; }

      if (buffer[i] === "{") {
        // Parse por profundidade: conta { e } respeitando strings
        let depth = 0;
        let inStr = false;
        let esc = false;
        let fim = -1;
        for (let j = i; j < buffer.length; j++) {
          const ch = buffer[j];
          if (esc) { esc = false; continue; }
          if (ch === "\\" && inStr) { esc = true; continue; }
          if (ch === '"') { inStr = !inStr; continue; }
          if (inStr) continue;
          if (ch === "{") depth++;
          else if (ch === "}") {
            depth--;
            if (depth === 0) { fim = j + 1; break; }
          }
        }
        if (fim === -1) {
          // Objeto ainda não fechou — buffer incompleto, espera mais dados
          buffer = buffer.slice(i);
          return;
        }
        const chunk = buffer.slice(i, fim);
        try {
          const msg = JSON.parse(chunk);
          mensagens.push(msg);
        } catch {
          // JSON inválido (não deveria acontecer se a profundidade está certa)
        }
        i = fim;
      } else {
        // Não é início de objeto: pode ser log do servidor. Pula até \n.
        const nl = buffer.indexOf("\n", i);
        if (nl === -1) { buffer = buffer.slice(i); return; }
        i = nl + 1;
      }
    }
    buffer = "";
  }

  child.stdout.on("data", (c) => {
    buffer += String(c);
    // Teto de segurança: se o buffer passar de 4 MB sem fechar um objeto,
    // o servidor está mal comportado (travou, saída corrompida). Descarta
    // e segue — o probe vai reportar tools/list não respondeu.
    if (buffer.length > MAX_BUFFER) buffer = "";
    drenarBuffer();
  });
  child.stderr.on("data", (c) => {
    if (stderr.length < 2_000) stderr += String(c).slice(0, 2_000);
  });
  child.on("error", (e) => {
    erroSpawn = e;
  });

  /** Espera uma resposta JSON-RPC com o id pedido, até `ms`. */
  const esperar = (id, ms) =>
    new Promise((resolve) => {
      const fim = Date.now() + ms;
      const proc = () => {
        // Varre mensagens já parseadas (fonte de verdade: buffer acumulado).
        for (const msg of mensagens) {
          if (msg && msg.id === id) {
            resolve(msg);
            return;
          }
        }
        if (Date.now() > fim) {
          resolve(null);
          return;
        }
        setTimeout(proc, 25);
      };
      proc();
    });

  const pedir = (obj) => {
    try {
      child.stdin.write(JSON.stringify(obj) + "\n");
      return true;
    } catch {
      return false;
    }
  };

  let ferramentas = [];
  let erro = null;

  try {
    pedir({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "selfevopi", version: "0.0.0" },
      },
    });

    const init = await esperar(1, Math.max(400, teto - (Date.now() - inicio)));

    if (erroSpawn) {
      return {
        ok: false,
        tools: [],
        error: `não consegui iniciar o processo: ${erroSpawn.code ?? erroSpawn.message}`,
      };
    }
    if (!init) {
      const detalhe = stderr.trim().split("\n")[0];
      return {
        ok: false,
        tools: [],
        error: `o servidor não respondeu ao initialize em ${teto} ms${detalhe ? ` — stderr: ${detalhe}` : ""}`,
      };
    }
    if (init.result === undefined || init.result === null) {
      return {
        ok: false,
        tools: [],
        error: `initialize respondeu sem result: ${JSON.stringify(init.error ?? init)}`,
      };
    }

    const restante = teto - (Date.now() - inicio);
    if (restante > 300) {
      pedir({ jsonrpc: "2.0", method: "notifications/initialized" });
      pedir({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      // o servidor declara o teto do catalogo (timeout.catalog); 2 s fixos
      // era curto para app GUI, que responde initialize e demora o catalogo.
      // O orcamento do chamador (timeoutMs) continua sendo o limite de fora.
      const catalogo = Number(alvo.timeout?.catalog);
      const tetoCatalogo = Number.isFinite(catalogo) && catalogo > 0 ? catalogo : 2_000;
      const lista = await esperar(2, Math.min(tetoCatalogo, restante));
      if (lista && Array.isArray(lista.result?.tools)) {
        ferramentas = lista.result.tools
          .map((t) => (typeof t?.name === "string" ? t.name : null))
          .filter(Boolean);
      } else if (!lista) {
        erro = "initialize ok, mas tools/list não respondeu a tempo";
      }
    } else {
      erro = "initialize ok, mas o orçamento de tempo acabou antes de tools/list";
    }

    return { ok: true, tools: ferramentas, error: erro };
  } finally {
    try {
      child.stdin.end();
    } catch {
      /* já fechado */
    }
    await killTree(child);
  }
}

// Alias de compatibilidade: o nome legado `listOpencodeMcp` continua exportado
// para importadores antigos (probe-mcps, testes). Este módulo lê
// ~/.pi/settings.json (config do próprio SelfEvoPI), não a de outro produto.
export const listOpencodeMcp = listConfiguredMcp;

// Aliases legados dos demais símbolos (nomes antigos com "Opencode"). Mantidos
// só por compatibilidade — o código novo usa os nomes agnósticos acima.
export const OPENCODE_CONFIG_FILES = MCP_CONFIG_FILES;
export const findOpencodeConfig = findMcpConfig;
export const normalizeOpencodeServer = normalizeServerEntry;
export const probeOpencodeMcp = probeMcpServer;

export default {
  MCP_CONFIG_FILES,
  STATUS,
  stripJsonc,
  stripTrailingCommas,
  findMcpConfig,
  normalizeServerEntry,
  statusOf,
  listConfiguredMcp,
  probeMcpServer,
};