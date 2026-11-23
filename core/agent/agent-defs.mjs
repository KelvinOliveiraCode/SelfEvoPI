/**
 * core/agent/agent-defs.mjs — agentes definidos por arquivo, sem dependência.
 *
 * Lê definições em duas fontes, nesta ordem de precedência:
 *   1. <root>/.pi/agents/*.md          (projeto)
 *   2. <home>/.pi/agent/agents/*.md    (usuário; última regra vence)
 *
 * Frontmatter simples entre `---`, analisado à mão (sem YAML, sem npm):
 *
 *   ---
 *   description: rever difusão antes de promover
 *   mode: subagent
 *   model: p1/m1#v1
 *   steps: |
 *     coletar evidência
 *     refutar hipótese
 *   hidden: false
 *   permissions: |
 *     read/<curinga>/allow
 *     write/dist/deny
 *   ---
 *
 * `steps` e `permissions` aceitam uma por linha (bloco `|` ou `>`) ou uma
 * lista separada por vírgula na mesma linha. Nada aqui lança: diretório
 * ausente, arquivo ilegível ou frontmatter quebrado devolvem lista vazia ou
 * uma definição com campos não declarados.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const PROJECT_AGENTS_SUBDIR = join(".pi", "agents");
export const USER_AGENTS_SUBDIR = join(".pi", "agent", "agents");
export const AGENT_MODES = Object.freeze(["primary", "subagent", "all"]);
export const PERMISSION_EFFECTS = Object.freeze(["allow", "ask", "deny"]);

const FIELDS = Object.freeze([
  "description",
  "mode",
  "model",
  "steps",
  "hidden",
  "permissions",
]);

/** Home do usuário (injetável no teste; nunca impresso). */
export function resolveHome(home) {
  if (typeof home === "string" && home.trim()) return home;
  return process.env.USERPROFILE || process.env.HOME || process.cwd();
}

/** Diretórios lidos, em ordem de precedência (o último vence). */
export function agentDefDirs(root, home) {
  const base = typeof root === "string" && root.trim() ? root : process.cwd();
  return [
    { dir: join(base, PROJECT_AGENTS_SUBDIR), source: "project" },
    { dir: join(resolveHome(home), USER_AGENTS_SUBDIR), source: "user" },
  ];
}

/* ------------------------------------------------------------------ */
/* Parser de frontmatter (à mão)                                       */
/* ------------------------------------------------------------------ */

/**
 * Devolve `{ chave: texto }` do bloco entre as duas primeiras linhas `---`.
 * Blocos `|`/`>` são devolvidos com uma linha por item (não achatados), porque
 * `steps` e `permissions` são listas ordenadas.
 */
export function parseFrontmatter(raw) {
  const lines = String(raw ?? "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return {};
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") { end = i; break; }
  }
  if (end === -1) return {};

  const out = {};
  let key = null;
  let block = null;
  for (const line of lines.slice(1, end)) {
    if (block !== null) {
      if (line.trim() === "" || /^\s+/.test(line)) {
        block.push(line.trim());
        continue;
      }
      out[key] = block.join("\n").trim();
      block = null;
      key = null;
    }
    const m = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    key = m[1];
    const value = m[2].trim();
    if (value === "|" || value === ">") block = [];
    else out[key] = value;
  }
  if (block !== null) out[key] = block.join("\n").trim();
  return out;
}

/** Lista ordenada de uma linha por item ou de uma linha com vírgulas. */
export function parseList(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value)
    .split(/\r?\n|,/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Booleano tolerante; valor desconhecido mantém o fallback. */
export function parseBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on", "sim"].includes(s)) return true;
  if (["false", "0", "no", "off", "nao", "não", ""].includes(s)) return false;
  return fallback;
}

/** `provider/model#variant` -> partes nomeadas. Devolve null se incompleto. */
export function parseModel(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const hash = raw.indexOf("#");
  const variant = hash === -1 ? null : raw.slice(hash + 1).trim();
  if (hash !== -1 && !variant) return null;
  const core = (hash === -1 ? raw : raw.slice(0, hash)).trim();
  const slash = core.indexOf("/");
  if (slash <= 0 || slash === core.length - 1) return null;
  const provider = core.slice(0, slash).trim();
  const name = core.slice(slash + 1).trim();
  if (!provider || !name) return null;
  return { provider, name, variant, raw };
}

/**
 * Regra `action/resource/effect`. O recurso pode conter `/`; por isso a
 * divisão é feita na primeira e na última barra. Objeto nomeado também serve.
 */
export function parseRule(value) {
  let action;
  let resource;
  let effect;
  let raw;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    action = String(value.action ?? "").trim();
    resource = String(value.resource ?? "").trim();
    effect = String(value.effect ?? "").trim().toLowerCase();
    raw = `${action}/${resource}/${effect}`;
  } else {
    raw = String(value ?? "").trim();
    const first = raw.indexOf("/");
    const last = raw.lastIndexOf("/");
    if (first <= 0 || last <= first || last === raw.length - 1) return null;
    action = raw.slice(0, first).trim();
    resource = raw.slice(first + 1, last).trim();
    effect = raw.slice(last + 1).trim().toLowerCase();
  }
  if (!action || !resource || !PERMISSION_EFFECTS.includes(effect)) return null;
  return { action, resource, effect, raw };
}

/* ------------------------------------------------------------------ */
/* Definição e leitura                                                 */
/* ------------------------------------------------------------------ */

/** Converte o frontmatter em definição; `defined` guarda os campos declarados. */
function makeDef(id, meta, path, source) {
  const defined = [];
  const def = {
    id,
    description: "",
    mode: null,
    model: null,
    steps: [],
    hidden: false,
    permissions: [],
    path,
    source,
    defined,
  };
  if (meta.description !== undefined) {
    def.description = String(meta.description).trim();
    defined.push("description");
  }
  if (meta.mode !== undefined) {
    def.mode = String(meta.mode).trim().toLowerCase();
    defined.push("mode");
  }
  if (meta.model !== undefined) {
    def.model = String(meta.model).trim() || null;
    defined.push("model");
  }
  if (meta.steps !== undefined) {
    def.steps = parseList(meta.steps);
    defined.push("steps");
  }
  if (meta.hidden !== undefined) {
    def.hidden = parseBool(meta.hidden);
    defined.push("hidden");
  }
  if (meta.permissions !== undefined) {
    def.permissions = parseList(meta.permissions);
    defined.push("permissions");
  }
  return def;
}

function readDir(dir, source, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const files = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md"))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  for (const entry of files) {
    const path = join(dir, entry.name);
    try {
      out.push(makeDef(entry.name.slice(0, -3), parseFrontmatter(readFileSync(path, "utf8")), path, source));
    } catch {
      // arquivo que sumiu ou não pôde ser lido: não interrompe a varredura
    }
  }
}

/**
 * Lê todas as definições. Nunca lança. Projeto vem primeiro, usuário depois.
 *
 * @param {string} root diretório do workspace
 * @param {{home?: string}} [opts] home injetável (teste)
 * @returns {Array<object>}
 */
export function readAgentDefs(root, opts = {}) {
  const out = [];
  for (const { dir, source } of agentDefDirs(root, opts?.home)) readDir(dir, source, out);
  return out;
}

/* ------------------------------------------------------------------ */
/* Resolução e permissão                                               */
/* ------------------------------------------------------------------ */

/**
 * Mescla as definições de um id na ordem recebida. A última definição que
 * declara um campo vence; arrays são substituídos, nunca concatenados.
 * Devolve `null` quando o id não existe.
 */
export function resolveAgent(defs, id) {
  const matching = (Array.isArray(defs) ? defs : []).filter((d) => d?.id === id);
  if (matching.length === 0) return null;

  const agent = {
    id,
    description: "",
    mode: "all",
    model: null,
    modelRef: null,
    steps: [],
    hidden: false,
    permissions: [],
    sources: [],
    warnings: [],
  };

  for (const def of matching) {
    agent.sources.push(def.path);
    for (const field of FIELDS) {
      if (!(def.defined ?? []).includes(field)) continue;
      if (field === "steps" || field === "permissions") agent[field] = [...(def[field] ?? [])];
      else agent[field] = def[field];
    }
  }

  if (!AGENT_MODES.includes(agent.mode)) {
    agent.warnings.push(`modo ${JSON.stringify(agent.mode)} inválido; usando all`);
    agent.mode = "all";
  }
  if (agent.model) {
    agent.modelRef = parseModel(agent.model);
    if (!agent.modelRef) agent.warnings.push("modelo inválido; usando padrão do motor");
  }
  return agent;
}

function matches(pattern, value) {
  return pattern === "*" || pattern === value;
}

/** Aplica as regras em ordem; a última que casa vence. Sem casa -> `ask`. */
export function checkPermission(agent, action, resource) {
  let effect = "ask";
  const a = String(action ?? "");
  const r = String(resource ?? "");
  for (const raw of agent?.permissions ?? []) {
    const rule = parseRule(raw);
    if (!rule) continue;
    if (matches(rule.action, a) && matches(rule.resource, r)) effect = rule.effect;
  }
  return effect;
}
