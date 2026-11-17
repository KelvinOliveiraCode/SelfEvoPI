/**
 * core/agent/mcp.mjs — inventário dos servidores MCP que o projeto declara.
 *
 * Existe para responder `/mcp`: "o que este projeto diz que tem?".
 * É uma pergunta de **diagnóstico**, não de execução — e é por isso que este
 * módulo tem um limite rígido:
 *
 *   - NÃO conecta em nada.
 *   - NÃO sobe processo, não abre socket, não lê a rede.
 *   - NÃO devolve `env` de nenhum servidor. Credencial não sai daqui.
 *
 * Interface pública (é ela que o CLI e o desktop vão consumir):
 *
 *   import { listMcpServers } from "./core/agent/mcp.mjs";
 *
 *   const servidores = await listMcpServers({ root });
 *   // [{ name, command, args, status }]
 *   //  status: "configured" | "missing" | "disabled"
 *
 *   import { readMcpConfig } from "./core/agent/mcp.mjs";
 *   const diagnostico = await readMcpConfig({ root });
 *   // { files: [{ path, exists, ok, error, servers }] }
 *
 * As duas leituras coexistem de propósito: `listMcpServers` é a resposta limpa
 * para o usuário, `readMcpConfig` é o que o diagnóstico usa quando o arquivo
 * está quebrado e alguém precisa saber **por que** a lista veio vazia.
 *
 * Formatos aceitos (o que o próprio SelfEvoPI gera e o que o PI usa):
 *
 *   .mcp.json
 *   { "mcpServers": { "<nome>": { "command": "node", "args": ["server.mjs"] } } }
 *
 *   .pi/settings.json
 *   { "mcpServers": { ... } }             (formato plano)
 *   { "mcp": { "servers": { ... } } }     (formato aninhado)
 *
 * "Nunca credencial" é uma decisão de projeto, não um detalhe: `env` é lido
 * do arquivo para descartado em seguida. Nenhuma chave, token ou valor de
 * ambiente chega ao chamador.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

/**
 * Arquivos lidos, nesta ordem. A ordem importa: na colisão de nomes o
 * primeiro arquivo vence, e `.mcp.json` é o canônico (é o que o
 * generate-mcp-config do Forge escreve).
 */
export const MCP_FILES = [".mcp.json", ".pi/settings.json"];

/** Status possíveis de um servidor. */
export const STATUS = {
  CONFIGURED: "configured",
  MISSING: "missing",
  DISABLED: "disabled",
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Caminho relativo sempre com `/`, para a saída não depender de plataforma. */
function posix(p) {
  return String(p).split(path.sep).join("/");
}

/** Lê e parseia um JSON sem lançar. Devolve { ok, value } ou { ok, error }. */
async function readJsonFile(absPath) {
  let raw;
  try {
    raw = await readFile(absPath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return { ok: true, value: null, exists: false };
    return { ok: false, exists: true, error: `não consegui ler: ${err?.message ?? err}` };
  }

  try {
    return { ok: true, value: JSON.parse(raw), exists: true };
  } catch (err) {
    return { ok: false, exists: true, error: `JSON inválido: ${err?.message ?? err}` };
  }
}

/**
 * Extrai o mapa de servidores de um documento de configuração.
 * Aceita tanto `{ mcpServers: {...} }` quanto `{ mcp: { servers: {...} } }`.
 */
export function serversFromConfig(doc) {
  if (!isPlainObject(doc)) return {};

  if (isPlainObject(doc.mcpServers)) return doc.mcpServers;

  if (isPlainObject(doc.mcp) && isPlainObject(doc.mcp.servers)) {
    return doc.mcp.servers;
  }

  return {};
}

/**
 * Normaliza uma entrada bruta no formato público.
 *
 * `command` sai `null` quando o servidor é remoto (só `url`) — o formato
 * pedido tem quatro campos, e inventar um comando seria mentir.
 */
export function normalizeServer(name, raw) {
  const entry = isPlainObject(raw) ? raw : {};
  const args = Array.isArray(entry.args)
    ? entry.args.map((a) => (typeof a === "string" ? a : String(a)))
    : [];

  const command =
    typeof entry.command === "string" && entry.command.trim() !== ""
      ? entry.command
      : null;

  const url =
    typeof entry.url === "string" && entry.url.trim() !== "" ? entry.url.trim() : null;

  const disabled = entry.disabled === true || entry.enabled === false;

  let status;
  if (disabled) status = STATUS.DISABLED;
  else if (command || url) status = STATUS.CONFIGURED;
  else status = STATUS.MISSING;

  return { name, command, args, status };
}

/* ------------------------------------------------------------------ */
/* Leitura                                                             */
/* ------------------------------------------------------------------ */

/**
 * Lê os arquivos de MCP do projeto e devolve o diagnóstico por arquivo.
 * Não lança: um arquivo quebrado vira `ok: false` com o motivo.
 *
 * @param {{ root?: string }} [config]
 */
export async function readMcpConfig({ root = process.cwd() } = {}) {
  const base = path.resolve(root);
  const files = [];

  for (const rel of MCP_FILES) {
    const abs = path.join(base, rel);
    const parsed = await readJsonFile(abs);

    if (!parsed.exists) {
      files.push({ path: posix(rel), exists: false, ok: true, error: null, servers: [] });
      continue;
    }

    if (!parsed.ok) {
      files.push({
        path: posix(rel),
        exists: true,
        ok: false,
        error: parsed.error,
        servers: [],
      });
      continue;
    }

    const map = serversFromConfig(parsed.value);
    const servers = Object.entries(map)
      .map(([name, raw]) => normalizeServer(name, raw))
      .sort((a, b) => a.name.localeCompare(b.name));

    files.push({ path: posix(rel), exists: true, ok: true, error: null, servers });
  }

  return { root: base, files };
}

/**
 * Lista os servidores MCP declarados, com status.
 *
 * Não lança. Arquivo ausente é ausência; arquivo quebrado é ignorado (e
 * aparece em `readMcpConfig`). Na colisão de nomes, vence o arquivo mais
 * à esquerda em `MCP_FILES`.
 *
 * @param {{ root?: string }} [config]
 * @returns {Promise<Array<{ name: string, command: string|null, args: string[], status: "configured"|"missing"|"disabled" }>>}
 */
export async function listMcpServers({ root = process.cwd() } = {}) {
  const diagnostic = await readMcpConfig({ root });
  const byName = new Map();

  for (const file of diagnostic.files) {
    if (!file.ok) continue;
    for (const server of file.servers) {
      if (!byName.has(server.name)) byName.set(server.name, server);
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}