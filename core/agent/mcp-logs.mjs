/**
 * core/agent/mcp-logs.mjs — diagnóstico de logs de servidores MCP e plugins.
 *
 * Existe porque o usuário pediu uma coisa específica: quando um MCP ou plugin
 * tem problema, tem que dar para **ver o log e levar embora** — copiar o
 * contexto do erro e corrigir numa sessão à parte.
 *
 * Então este módulo tem três saídas, e cada uma tem um motivo:
 *
 *   listMcpLogs({ root, server })   entradas estruturadas, para a CLI listar
 *   readMcpLog({ root, server })    linhas cruas, para quem quer ler tudo
 *   formatErrorReport({ root, server })  o texto que o usuário cola
 *
 * Três decisões que definem o módulo:
 *
 *   1. **Nada é inventado.** Se o servidor não tem log, a resposta diz
 *      `reason: "sem log"` e `lines: []`. Um log vazio com cara de sucesso
 *      seria pior do que não ter log: o usuário procuraria o erro no lugar
 *      errado.
 *
 *   2. **Tudo que sai daqui é redigido.** O usuário vai colar este texto em
 *      outra sessão, num chat, num issue. `apiKey=...`, `token=...`,
 *      `sk-...`, `Bearer ...` e senha em URL viram `[redigido]` — no relatório
 *      **e** nas linhas de `readMcpLog`, porque a saída de diagnóstico é
 *      sempre uma saída de dados.
 *
 *   3. **Nunca lê um arquivo inteiro.** Um log de 10 MB não vira string na
 *      memória: a leitura começa nos últimos `maxBytes` e devolve o rabo.
 *      `truncated` diz se o começo ficou de fora.
 *
 * Convenção de caminhos (é convenção deste módulo; o SelfEvoPI ainda não
 * escreve esses arquivos — quando passar a escrever, é aqui que se lê):
 *
 *   .pi/harness/logs/mcp/<servidor>.log     log próprio de um servidor
 *   .pi/harness/logs/plugins/<plugin>.log   log próprio de um plugin
 *   .pi/harness/logs/mcp.jsonl              log consolidado (campo `server`)
 *
 * Extensões aceitas: `.log`, `.jsonl`, `.txt`. Linha em branco é ignorada.
 * JSONL é o formato canônico (é o que o ledger usa): cada linha é
 * `{"at":"ISO","level":"error|warn|info|debug","message":"..."}`.
 *
 * Interface pública:
 *
 *   import { listMcpLogs, readMcpLog, formatErrorReport, redact } from
 *     "./core/agent/mcp-logs.mjs";
 */

import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { listMcpServers } from "./mcp.mjs";

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

/** Onde procurar log, por tipo. A ordem é a de preferência na busca. */
export const LOG_LAYOUT = {
  mcp: ".pi/harness/logs/mcp",
  plugins: ".pi/harness/logs/plugins",
  consolidated: ".pi/harness/logs/mcp.jsonl",
};

/** Extensões reconhecidas como log. */
const LOG_EXTENSIONS = [".log", ".jsonl", ".txt"];

/** Quanto do fim de um arquivo pode ser lido de uma vez. */
const DEFAULT_MAX_BYTES = 64 * 1024;

/** Quantas linhas um `readMcpLog` devolve por padrão. */
const DEFAULT_TAIL = 50;

/** Quantas entradas um `listMcpLogs` devolve por padrão. */
const DEFAULT_LIMIT = 50;

/** Teto do relatório: linhas e bytes. O que passar disso é cortado com aviso. */
const REPORT_MAX_LINES = 200;
const REPORT_MAX_BYTES = 16 * 1024;

/** Mensagem que aparece quando não existe log para o servidor. */
const SEM_LOG = "sem log";

const LEVELS = new Set(["error", "warn", "info", "debug", "trace"]);

/* ------------------------------------------------------------------ */
/* Redigência                                                          */
/* ------------------------------------------------------------------ */

const REDACTED = "[redigido]";

/**
 * Remove credencial de um texto. Ordem importa: os padrões mais específicos
 * vêm primeiro, para `api_key=sk-abc...` virar `api_key=[redigido]` e não
 * sobrar o valor no meio.
 */
export function redact(text) {
  if (typeof text !== "string" || text === "") return text;

  let out = text;

  // 1. atribuições nomeadas: apiKey=..., token: "...", secret='...'
  out = out.replace(
    /\b(api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|token|secret|client[_-]?secret|password|passwd|pwd|credential|credentials|sas|signature)\b(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s&,;]+)/gi,
    (_m, nome, sep) => `${nome}${sep}${REDACTED}`,
  );

  // 2. cabeçalho de autorização
  out = out.replace(/\b(Bearer|Basic|Token)(\s+)[A-Za-z0-9._~+\/=-]{6,}/gi, (_m, esquema, esp) => `${esquema}${esp}${REDACTED}`);

  // 3. chaves de API com prefixo conhecido
  out = out.replace(/\bsk-[A-Za-z0-9_\-]{8,}/g, REDACTED);
  out = out.replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{8,}/g, REDACTED);
  out = out.replace(/\bxox[baprs]-[A-Za-z0-9-]{8,}/g, REDACTED);
  out = out.replace(/\bAKIA[0-9A-Z]{16}\b/g, REDACTED);
  out = out.replace(/\bAIza[0-9A-Za-z_\-]{20,}/g, REDACTED);

  // 4. JWT (header.payload.assinatura)
  out = out.replace(/\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{6,}/g, REDACTED);

  // 5. credencial embutida em URL: https://usuario:senha@host
  out = out.replace(/(\b[a-z][a-z0-9+.\-]*:\/\/)([^/\s@]+)@/gi, (_m, esquema) => `${esquema}${REDACTED}@`);

  // 6. parâmetro de URL: ?api_key=xyz &token=abc
  out = out.replace(
    /([?&](?:api[_-]?key|apikey|token|access[_-]?token|key|secret|password|sig|signature)=)[^&\s"']+/gi,
    (_m, prefixo) => `${prefixo}${REDACTED}`,
  );

  return out;
}

/* ------------------------------------------------------------------ */
/* Descoberta de arquivos                                              */
// ------------------------------------------------------------------ */

function isLogFile(name) {
  return LOG_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}

/** Lista os arquivos de log de um diretório, ordenados por nome. */
async function listFilesIn(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && isLogFile(e.name))
      .map((e) => path.join(dir, e.name))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Descobre os arquivos de log relevantes.
 *
 * @returns {Promise<Array<{ server: string, kind: "mcp"|"plugins", file: string, rel: string }>>}
 */
async function discoverLogs(root) {
  const found = [];

  for (const kind of ["mcp", "plugins"]) {
    const dir = path.join(root, LOG_LAYOUT[kind]);
    for (const file of await listFilesIn(dir)) {
      const base = path.basename(file);
      const server = base.slice(0, base.length - path.extname(base).length);
      found.push({
        server,
        kind,
        file,
        rel: path.relative(root, file).split(path.sep).join("/"),
      });
    }
  }

  // consolidado: um arquivo só, com `server` em cada registro
  const consolidated = path.join(root, LOG_LAYOUT.consolidated);
  try {
    const st = await stat(consolidated);
    if (st.isFile()) {
      found.push({
        server: null,
        kind: "consolidated",
        file: consolidated,
        rel: path.relative(root, consolidated).split(path.sep).join("/"),
      });
    }
  } catch {
    // sem consolidado: tudo bem
  }

  return found;
}

/* ------------------------------------------------------------------ */
/* Leitura                                                             */
// ------------------------------------------------------------------ */

/**
 * Lê o rabo de um arquivo sem carregar o inteiro.
 *
 * @returns {Promise<{ lines: string[], total: number, truncated: boolean, size: number }>}
 */
async function readTail(absPath, { maxBytes = DEFAULT_MAX_BYTES, tail = DEFAULT_TAIL } = {}) {
  const handle = await open(absPath, "r");
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - maxBytes);
    const length = size - start;

    const buffer = Buffer.alloc(length);
    if (length > 0) await handle.read(buffer, 0, length, start);

    let text = buffer.toString("utf8");
    const truncated = start > 0;

    // se começamos no meio do arquivo, a primeira linha é lixo: descarta
    if (truncated) {
      const nl = text.indexOf("\n");
      text = nl >= 0 ? text.slice(nl + 1) : "";
    }

    const all = text.split(/\r?\n/).filter((line) => line.trim() !== "");
    return {
      lines: all.slice(-tail),
      total: all.length,
      truncated,
      size,
    };
  } finally {
    await handle.close().catch(() => {});
  }
}

/**
 * Nível de uma linha.
 *
 * Ordem: campo `level` do JSONL, depois um marcador no começo do texto —
 * **depois** de remover um carimbo de tempo na frente, porque o formato mais
 * comum é "2026-11-15T22:00:00Z ERROR ...". Sem o marcador, o nível fica
 * "info": adivinhar pela palavra "error" no meio da mensagem daria falso
 * positivo em linha de texto normal.
 */
function parseLevel(raw) {
  const text = String(raw);

  const asJson = tryJson(text);
  if (asJson && typeof asJson.level === "string") {
    const fromJson = normalizeLevel(asJson.level);
    if (fromJson) return fromJson;
  }

  // tira carimbo de tempo e colchetes da frente
  let resto = text.replace(/^\s*\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\s*/, "");
  // [2026-11-15T22:00:00Z] é carimbo entre colchetes; [ERROR] é nível —
  // só tira colchete que tenha dígito dentro, senão comeríamos o marcador.
  resto = resto.replace(/^\s*\[[^\]]*\d[^\]]*\]\s*/, "");

  const m = resto.match(/^\s*\[?(error|err|warn|warning|info|debug|trace)\]?\b/i);
  if (!m) return "info";
  return normalizeLevel(m[1]) ?? "info";
}

/** "err" -> "error", "warning" -> "warn"; null quando não é nível conhecido. */
function normalizeLevel(value) {
  const level = String(value).toLowerCase();
  if (level === "err") return "error";
  if (level === "warning") return "warn";
  return LEVELS.has(level) ? level : null;
}

/** `at` de uma linha: campo do JSONL, depois ISO no começo do texto. */
function parseAt(raw) {
  const asJson = tryJson(raw);
  if (asJson && typeof asJson.at === "string") return asJson.at;

  const text = String(raw);
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\b/);
  return iso ? iso[1] : null;
}

/** `message` de uma linha: campo do JSONL, senão a linha inteira. */
function parseMessage(raw) {
  const asJson = tryJson(raw);
  if (asJson && typeof asJson.message === "string") return asJson.message;
  if (asJson && typeof asJson.msg === "string") return asJson.msg;
  return String(raw);
}

function tryJson(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const value = JSON.parse(trimmed);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** De qual servidor é uma linha do consolidado. */
function serverOfRecord(raw) {
  const asJson = tryJson(raw);
  if (asJson && typeof asJson.server === "string" && asJson.server.trim() !== "") {
    return asJson.server.trim();
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* API pública                                                         */
// ------------------------------------------------------------------ */

/**
 * Lista as entradas de log mais recentes de todos os servidores.
 *
 * Não lança. Arquivo ilegível é ignorado; a ausência de log aparece como
 * lista vazia (e `readMcpLog` explica por quê).
 *
 * @param {{ root?: string, server?: string, limit?: number, tail?: number }} [options]
 * @returns {Promise<Array<{ server: string, at: string|null, level: string, message: string, source: string }>>}
 */
export async function listMcpLogs({
  root = process.cwd(),
  server = null,
  limit = DEFAULT_LIMIT,
  tail = DEFAULT_TAIL,
} = {}) {
  const base = path.resolve(root);
  const files = await discoverLogs(base);

  const wanted = typeof server === "string" && server.trim() !== "" ? server.trim() : null;
  const entries = [];

  for (const entry of files) {
    if (entry.kind === "consolidated") {
      const { lines } = await readTail(entry.file, { tail: Number.MAX_SAFE_INTEGER });
      for (const line of lines) {
        const dono = serverOfRecord(line);
        if (!dono) continue;
        if (wanted && dono !== wanted) continue;
        entries.push({
          server: dono,
          at: parseAt(line),
          level: parseLevel(line),
          message: redact(parseMessage(line)),
          source: entry.rel,
        });
      }
      continue;
    }

    if (wanted && entry.server !== wanted) continue;

    const { lines } = await readTail(entry.file, { tail: Number.MAX_SAFE_INTEGER });
    for (const line of lines) {
      entries.push({
        server: entry.server,
        at: parseAt(line),
        level: parseLevel(line),
        message: redact(parseMessage(line)),
        source: entry.rel,
      });
    }
  }

  // mais recentes primeiro; sem `at`, por último; empate por origem+texto
  entries.sort((a, b) => {
    if (a.at && b.at && a.at !== b.at) return a.at < b.at ? 1 : -1;
    if (a.at && !b.at) return -1;
    if (!a.at && b.at) return 1;
    if (a.source !== b.source) return a.source < b.source ? -1 : 1;
    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
  });

  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_LIMIT;
  return entries.slice(0, max);
}

/**
 * Lê as últimas linhas do log de um servidor.
 *
 * Não lança. Quando não há log, devolve `lines: []` e `reason: "sem log"` —
 * nunca uma lista vazia fingindo sucesso.
 *
 * @param {{ root?: string, server: string, tail?: number, maxBytes?: number }} options
 * @returns {Promise<{ server: string, lines: string[], truncated: boolean, total: number, size: number, source: string|null, reason: string|null }>}
 */
export async function readMcpLog({
  root = process.cwd(),
  server,
  tail = DEFAULT_TAIL,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  const nome = typeof server === "string" ? server.trim() : "";

  const base = { server: nome, lines: [], truncated: false, total: 0, size: 0, source: null, reason: null };

  if (nome === "") return { ...base, reason: "servidor não informado" };

  const rootAbs = path.resolve(root);
  const files = await discoverLogs(rootAbs);

  // log próprio do servidor tem preferência sobre o consolidado
  const own = files.find((f) => f.kind !== "consolidated" && f.server === nome);
  if (own) {
    const lido = await readTail(own.file, { tail, maxBytes });
    return {
      server: nome,
      lines: lido.lines.map(redact),
      truncated: lido.truncated,
      total: lido.total,
      size: lido.size,
      source: own.rel,
      reason: null,
    };
  }

  // senão, tenta o consolidado filtrando pelo campo `server`
  const consolidated = files.find((f) => f.kind === "consolidated");
  if (consolidated) {
    const lido = await readTail(consolidated.file, { tail: Number.MAX_SAFE_INTEGER, maxBytes });
    const doServidor = lido.lines.filter((line) => serverOfRecord(line) === nome);
    if (doServidor.length > 0) {
      const linhas = doServidor.slice(-tail).map(redact);
      return {
        server: nome,
        lines: linhas,
        truncated: lido.truncated,
        total: doServidor.length,
        size: lido.size,
        source: consolidated.rel,
        reason: null,
      };
    }
  }

  return { ...base, reason: SEM_LOG };
}

/**
 * Monta o relatório que o usuário copia para outra sessão.
 *
 * Cabeçalho com servidor e comando, últimos eventos, e aviso de truncamento
 * quando houver. Tudo redigido. Teto de 200 linhas / 16 KB.
 *
 * @param {{ root?: string, server: string, tail?: number, maxLines?: number, maxBytes?: number }} options
 * @returns {Promise<string>}
 */
export async function formatErrorReport({
  root = process.cwd(),
  server,
  tail = DEFAULT_TAIL,
  maxLines = REPORT_MAX_LINES,
  maxBytes = REPORT_MAX_BYTES,
} = {}) {
  const nome = typeof server === "string" ? server.trim() : "";
  const lines = [];

  lines.push("# SelfEvoPI — diagnóstico de MCP/plugin");
  lines.push("");

  if (nome === "") {
    lines.push("servidor: (não informado)");
    lines.push("");
    lines.push("Nada a relatar: passe o nome do servidor.");
    return lines.join("\n");
  }

  let alvo = null;
  try {
    const servidores = await listMcpServers({ root });
    alvo = servidores.find((s) => s.name === nome) ?? null;
  } catch {
    // se a config não puder ser lida, o relatório ainda sai com o log
  }

  lines.push(`servidor: ${nome}`);
  if (alvo) {
    lines.push(`status:   ${alvo.status}`);
    lines.push(`comando:  ${alvo.command ?? "(remoto — sem comando)"}`);
    if (Array.isArray(alvo.args) && alvo.args.length > 0) {
      lines.push(`argumentos: ${alvo.args.join(" ")}`);
    }
  } else {
    lines.push("status:   (não declarado em .mcp.json nem em .pi/settings.json)");
  }
  lines.push("");

  const lido = await readMcpLog({ root, server: nome, tail });

  lines.push(`## Últimos eventos${lido.source ? ` — ${lido.source}` : ""}`);
  lines.push("");

  if (lido.reason === SEM_LOG || lido.lines.length === 0) {
    lines.push("Nenhum log encontrado para este servidor.");
    lines.push("");
    lines.push("Caminhos onde este módulo procura:");
    lines.push(`  ${LOG_LAYOUT.mcp}/<servidor>.log`);
    lines.push(`  ${LOG_LAYOUT.plugins}/<servidor>.log`);
    lines.push(`  ${LOG_LAYOUT.consolidated}`);
    lines.push("");
    lines.push("Se o servidor deveria estar gravando, verifique o caminho acima.");
    return lines.join("\n");
  }

  const corpo = lido.lines.join("\n");
  lines.push("```");
  lines.push(corpo);
  lines.push("```");
  lines.push("");

  // ---- teto de tamanho: linhas e bytes ----
  let aviso = [];
  if (lido.total > lido.lines.length) {
    aviso.push(
      `apenas as últimas ${lido.lines.length} de ${lido.total} linhas (use tail maior para ver mais)`,
    );
  }
  if (lido.truncated) {
    aviso.push("o começo do arquivo ficou de fora (limite de leitura por chamada)");
  }

  let texto = lines.join("\n");

  if (texto.length > maxBytes) {
    texto = texto.slice(0, maxBytes);
    aviso.push(`relatório cortado em ${maxBytes} bytes`);
  }

  const todas = texto.split("\n");
  if (todas.length > maxLines) {
    texto = todas.slice(0, maxLines).join("\n");
    aviso.push(`relatório cortado em ${maxLines} linhas`);
  }

  if (aviso.length > 0) {
    texto += "\n\n> **Atenção:** " + aviso.join("; ") + ".";
  }

  texto = texto.replace(/\n{3,}/g, "\n\n");
  texto += "\n---\n";
  texto += "Log bruto: " + (lido.source ?? "(desconhecido)");
  if (lido.truncated) texto += " (parcial)";
  texto += "\n";
  texto += "Gerado por core/agent/mcp-logs.mjs. Credenciais foram redigidas.";
  texto += "\nRevise antes de colar em outra sessão.\n";

  return texto;
}