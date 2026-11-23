/**
 * core/agent/team.mjs — equipes persistentes com quadro, caixa de mensagens e
 * passo determinístico.
 *
 * Uma equipe é um documento JSON versionado e persistido em
 * `.pi/harness/teams/<id>.json`. O documento carrega membros, tarefas e
 * mensagens; toda a mutação é atómica (tmp + rename). O módulo é Windows
 * nativo, ESM puro, zero dependência (só `node:`) e nunca lança em arquivo
 * corrompido: devolve `{ ok:false, error }` explícito.
 *
 * Contrato:
 *   createTeam({ name, members?, root? })            -> { ok, team }
 *   postMessage(teamId, { from, to, text }, opts?)   -> { ok, message }
 *   inbox(teamId, agentId, opts?)                    -> { ok, messages }
 *   markRead(teamId, agentId, opts?)                 -> { ok, marked }
 *   assignTask(teamId, { agentId, goal, context? })  -> { ok, task }
 *   advanceTask(teamId, taskId, status, opts?)       -> { ok, task }
 *   board(teamId, opts?)                             -> { ok, board }
 *   runTeamStep(teamId, ctx?)                        -> { ok, step }
 *
 * Estados de tarefa (declarados) e as transições permitidas:
 *   pending -> active | blocked
 *   active  -> done | blocked
 *   blocked -> active | pending
 *   done    -> (terminal)
 *
 * `runTeamStep` avança UMA transição determinística (sem modelo, sem threads,
 * sem rede) e entrega UMA mensagem de notificação ao agente dono da tarefa:
 *   - 1ª tarefa `pending` (ordem de criação) -> `active`, avisa o agente;
 *   - senão 1ª tarefa `active`               -> `done`,   avisa o agente;
 *   - senão nada a fazer.
 *
 * As opções `opts` (e `ctx`) aceitam `root` (base do diretório de equipes,
 * default `process.cwd()`) e `now`/`at` (relógio/instante injetáveis para
 * determinismo em teste). Nenhum caminho pessoal é usado.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

/** Versão do documento de equipe. */
export const TEAM_VERSION = 1;

/** Estados válidos de uma tarefa. */
export const TASK_STATES = Object.freeze(["pending", "active", "blocked", "done"]);

/** Estado terminal (não transita para nenhum outro). */
export const TASK_TERMINAL = "done";

/**
 * Transições permitidas por estado de origem. `done` é terminal (lista vazia).
 * Congelado para não ser mutado por engano.
 */
export const TASK_TRANSITIONS = Object.freeze({
  pending: Object.freeze(["active", "blocked"]),
  active: Object.freeze(["done", "blocked"]),
  blocked: Object.freeze(["active", "pending"]),
  done: Object.freeze([]),
});

const STATE_SET = new Set(TASK_STATES);

/** Formato do id de equipe (slug): minúsculo, dígitos e hífen. */
const TEAM_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Remetente das mensagens geradas pelo passo determinístico. */
const SYSTEM_FROM = "team";

/* ------------------------------------------------------------------ */
/* Helpers de caminho e serialização                                   */
/* ------------------------------------------------------------------ */

/** Conjunto de ids já usados na pasta (evita colisão de nome no tmp). */
let tmpSeq = 0;

/** Diretório das equipes, relativo a `root`. */
export function teamsDir(root = process.cwd()) {
  return join(String(root), ".pi", "harness", "teams");
}

/** Caminho do arquivo de uma equipe. */
function teamFile(root, teamId) {
  return join(teamsDir(root), `${teamId}.json`);
}

/** Valida um id de equipe (slug seguro, sem separador de caminho). */
function assertTeamId(teamId) {
  if (typeof teamId !== "string" || !TEAM_ID_RE.test(teamId)) {
    return { ok: false, error: `team: id de equipe inválido "${teamId}" (use minúsculas, dígitos e hífen)` };
  }
  return { ok: true };
}

/** Converte um nome em slug estável (sem acento, minúsculo, hífen). */
export function slugifyTeamName(name) {
  const slug = String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug;
}

/** Escreve um arquivo atomicamente: tmp no mesmo diretório + rename. */
async function writeAtomic(file, text) {
  const dir = dirname(file);
  await mkdir(dir, { recursive: true });
  tmpSeq = (tmpSeq + 1) % 1_000_000;
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${tmpSeq}`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
}

/** Serializa um documento com indentação e nova linha final. */
function serialize(doc) {
  return JSON.stringify(doc, null, 2) + "\n";
}

/**
 * Lê e faz parse do documento de uma equipe.
 * NUNCA lança: arquivo ausente, vazio ou corrompido viram `{ ok:false }`.
 */
async function readTeamDoc(root, teamId) {
  const raw = await readFile(teamFile(root, teamId), "utf8").catch(() => null);
  if (raw == null) {
    return { ok: false, code: "missing", error: `team: equipe "${teamId}" não encontrada` };
  }
  if (raw.trim() === "") {
    return { ok: false, code: "corrupt", error: `team: arquivo da equipe "${teamId}" está vazio` };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: "corrupt", error: `team: arquivo da equipe "${teamId}" está corrompido (JSON inválido)` };
  }
  return { ok: true, doc: normalizeDoc(parsed) };
}

/** Garante que um documento parseado tenha todos os campos esperados. */
function normalizeDoc(doc) {
  const d = doc && typeof doc === "object" && !Array.isArray(doc) ? doc : {};
  if (!Array.isArray(d.members)) d.members = [];
  if (!Array.isArray(d.tasks)) d.tasks = [];
  if (!Array.isArray(d.messages)) d.messages = [];
  if (!d.seq || typeof d.seq !== "object") d.seq = { task: 0, message: 0 };
  if (typeof d.seq.task !== "number") {
    d.seq.task = d.tasks.reduce((m, t) => Math.max(m, taskSeqOf(t && t.id)), 0);
  }
  if (typeof d.seq.message !== "number") {
    d.seq.message = d.messages.reduce((m, x) => Math.max(m, messageSeqOf(x && x.id)), 0);
  }
  if (!d.cursor || typeof d.cursor !== "object") d.cursor = { step: 0 };
  if (typeof d.cursor.step !== "number") d.cursor.step = 0;
  return d;
}

/** Extrai o número de um id de tarefa `tN` (0 se não casar). */
function taskSeqOf(id) {
  const m = /^t(\d+)$/.exec(String(id ?? ""));
  return m ? Number.parseInt(m[1], 10) : 0;
}

/** Extrai o número de um id de mensagem `mN` (0 se não casar). */
function messageSeqOf(id) {
  const m = /^m(\d+)$/.exec(String(id ?? ""));
  return m ? Number.parseInt(m[1], 10) : 0;
}

/** Próximo id de tarefa (`t<n>`). */
function nextTaskId(doc) {
  doc.seq.task += 1;
  return `t${doc.seq.task}`;
}

/** Próximo id de mensagem (`m<n>`). */
function nextMessageId(doc) {
  doc.seq.message += 1;
  return `m${doc.seq.message}`;
}

/** Normaliza a lista de membros (aceita string ou { id|name, role }). */
function normalizeMembers(list) {
  const out = [];
  for (const m of Array.isArray(list) ? list : []) {
    if (typeof m === "string") {
      const id = m.trim();
      if (id) out.push({ id, role: "member" });
    } else if (m && typeof m === "object") {
      const id = String(m.id ?? m.name ?? m.agentId ?? "").trim();
      if (id) out.push({ id, role: String(m.role ?? "member") });
    }
  }
  return out;
}

/** Instante ISO a partir de opts (now injetável) ou um `at` explícito. */
function stampOf(opts = {}, at = undefined) {
  if (typeof at === "string" && at.trim() !== "") return at;
  if (opts && typeof opts.now === "function") return opts.now().toISOString();
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ */
/* createTeam                                                          */
/* ------------------------------------------------------------------ */

/**
 * Cria (ou recusa recriar) uma equipe persistente.
 *
 * @param {object} p
 * @param {string} p.name     nome legível da equipe (vira o id por slug)
 * @param {Array}  [p.members] membros: string ou { id|name, role }
 * @param {string} [p.root]   base do diretório de equipes (default cwd)
 * @param {Function} [p.now]  relógio injetável
 * @returns {Promise<{ ok: boolean, team?: object, error?: string, code?: string }>}
 */
export async function createTeam({ name, members = [], root = process.cwd(), now } = {}) {
  const id = slugifyTeamName(name);
  if (!id || !TEAM_ID_RE.test(id)) {
    return { ok: false, code: "invalid", error: "team: `name` vazio ou sem slug válido" };
  }
  const file = teamFile(root, id);

  // Recusa recriar por cima de uma equipe existente (não sobrescreve dados).
  const existing = await readFile(file, "utf8").catch(() => null);
  if (existing != null) {
    return { ok: false, code: "exists", error: `team: equipe "${id}" já existe` };
  }

  const at = stampOf({ now });
  const team = {
    version: TEAM_VERSION,
    id,
    name: String(name).trim(),
    createdAt: at,
    updatedAt: at,
    members: normalizeMembers(members),
    tasks: [],
    messages: [],
    seq: { task: 0, message: 0 },
    cursor: { step: 0 },
  };

  const res = await writeAtomic(file, serialize(team)).then(
    () => ({ ok: true }),
    (err) => ({ ok: false, error: `team: falha ao gravar: ${String(err?.message ?? err)}` }),
  );
  return res.ok ? { ok: true, team, file } : res;
}

/* ------------------------------------------------------------------ */
/* Mensagens                                                           */
/* ------------------------------------------------------------------ */

/**
 * Grava uma mensagem com remetente, destinatário, texto e instante.
 *
 * @param {string} teamId
 * @param {object} m   { from, to, text, at? }
 * @param {object} [opts] { root?, now? }
 * @returns {Promise<{ ok: boolean, message?: object, error?: string }>}
 */
export async function postMessage(teamId, { from, to, text, at } = {}, opts = {}) {
  const id = assertTeamId(teamId);
  if (!id.ok) return id;

  const fromId = String(from ?? "").trim();
  const toId = String(to ?? "").trim();
  const body = String(text ?? "").trim();
  if (!fromId) return { ok: false, error: "team: mensagem sem `from`" };
  if (!toId) return { ok: false, error: "team: mensagem sem `to`" };
  if (!body) return { ok: false, error: "team: mensagem sem `text`" };

  const loaded = await readTeamDoc(opts.root, teamId);
  if (!loaded.ok) return loaded;
  const doc = loaded.doc;

  const message = {
    id: nextMessageId(doc),
    from: fromId,
    to: toId,
    text: body,
    at: stampOf(opts, at),
    read: false,
  };
  doc.messages.push(message);
  doc.updatedAt = message.at;

  const res = await writeAtomic(teamFile(opts.root, teamId), serialize(doc)).then(
    () => ({ ok: true }),
    (err) => ({ ok: false, error: `team: falha ao gravar: ${String(err?.message ?? err)}` }),
  );
  return res.ok ? { ok: true, message, file: teamFile(opts.root, teamId) } : res;
}

/**
 * Devolve as mensagens NÃO lidas destinadas a um agente.
 *
 * @param {string} teamId
 * @param {string} agentId
 * @param {object} [opts] { root? }
 * @returns {Promise<{ ok: boolean, messages?: object[], error?: string }>}
 */
export async function inbox(teamId, agentId, opts = {}) {
  const id = assertTeamId(teamId);
  if (!id.ok) return id;
  const who = String(agentId ?? "").trim();
  if (!who) return { ok: false, error: "team: `agentId` vazio" };

  const loaded = await readTeamDoc(opts.root, teamId);
  if (!loaded.ok) return loaded;

  const messages = loaded.doc.messages
    .filter((m) => m && m.to === who && m.read === false)
    .map((m) => ({ ...m }));
  return { ok: true, messages };
}

/**
 * Marca como lidas as mensagens de um agente. Sem `ids`, marca todas as não
 * lidas do agente; com `ids`, marca apenas aquelas.
 *
 * @param {string} teamId
 * @param {string} agentId
 * @param {object} [opts] { root?, ids? }
 * @returns {Promise<{ ok: boolean, marked?: number, error?: string }>}
 */
export async function markRead(teamId, agentId, opts = {}) {
  const id = assertTeamId(teamId);
  if (!id.ok) return id;
  const who = String(agentId ?? "").trim();
  if (!who) return { ok: false, error: "team: `agentId` vazio" };

  const ids = Array.isArray(opts.ids) ? new Set(opts.ids.map(String)) : null;

  const loaded = await readTeamDoc(opts.root, teamId);
  if (!loaded.ok) return loaded;
  const doc = loaded.doc;

  let marked = 0;
  for (const m of doc.messages) {
    if (!m || m.to !== who || m.read !== false) continue;
    if (ids && !ids.has(m.id)) continue;
    m.read = true;
    m.readAt = stampOf(opts);
    marked += 1;
  }

  if (marked > 0) {
    doc.updatedAt = stampOf(opts);
    const res = await writeAtomic(teamFile(opts.root, teamId), serialize(doc)).then(
      () => ({ ok: true }),
      (err) => ({ ok: false, error: `team: falha ao gravar: ${String(err?.message ?? err)}` }),
    );
    if (!res.ok) return res;
  }
  return { ok: true, marked };
}

/* ------------------------------------------------------------------ */
/* Tarefas                                                             */
/* ------------------------------------------------------------------ */

/**
 * Atribui uma tarefa a um agente (estado inicial `pending`).
 *
 * @param {string} teamId
 * @param {object} t   { agentId, goal, context?, at? }
 * @param {object} [opts] { root?, now? }
 * @returns {Promise<{ ok: boolean, task?: object, error?: string }>}
 */
export async function assignTask(teamId, { agentId, goal, context = "", at } = {}, opts = {}) {
  const id = assertTeamId(teamId);
  if (!id.ok) return id;

  const who = String(agentId ?? "").trim();
  const target = String(goal ?? "").trim();
  if (!who) return { ok: false, error: "team: tarefa sem `agentId`" };
  if (!target) return { ok: false, error: "team: tarefa sem `goal`" };

  const loaded = await readTeamDoc(opts.root, teamId);
  if (!loaded.ok) return loaded;
  const doc = loaded.doc;

  const atIso = stampOf(opts, at);
  const task = {
    id: nextTaskId(doc),
    agentId: who,
    goal: target,
    context: String(context ?? ""),
    status: "pending",
    createdAt: atIso,
    updatedAt: atIso,
  };
  doc.tasks.push(task);
  doc.updatedAt = atIso;

  const res = await writeAtomic(teamFile(opts.root, teamId), serialize(doc)).then(
    () => ({ ok: true }),
    (err) => ({ ok: false, error: `team: falha ao gravar: ${String(err?.message ?? err)}` }),
  );
  return res.ok ? { ok: true, task, file: teamFile(opts.root, teamId) } : res;
}

/**
 * Avança uma tarefa para um novo estado, respeitando a máquina de estados.
 *
 * @param {string} teamId
 * @param {string} taskId
 * @param {string} status  estado de destino
 * @param {object} [opts]  { root?, now? }
 * @returns {Promise<{ ok: boolean, task?: object, changed?: boolean, error?: string }>}
 */
export async function advanceTask(teamId, taskId, status, opts = {}) {
  const id = assertTeamId(teamId);
  if (!id.ok) return id;

  const tid = String(taskId ?? "").trim();
  const to = String(status ?? "").trim();
  if (!STATE_SET.has(to)) {
    return { ok: false, error: `team: estado inválido "${to}" (use: ${TASK_STATES.join(", ")})` };
  }

  const loaded = await readTeamDoc(opts.root, teamId);
  if (!loaded.ok) return loaded;
  const doc = loaded.doc;

  const task = doc.tasks.find((t) => t && t.id === tid);
  if (!task) return { ok: false, error: `team: tarefa "${tid}" não encontrada` };

  const from = task.status;
  if (to === from) {
    // Redefinir para o mesmo estado é no-op bem-sucedido (idempotente).
    return { ok: true, task: { ...task }, changed: false };
  }

  const allowed = TASK_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      error: `team: transição inválida ${from} -> ${to} (permitido: ${allowed.join(", ") || "nenhum"})`,
    };
  }

  const atIso = stampOf(opts);
  task.status = to;
  task.updatedAt = atIso;
  doc.updatedAt = atIso;

  const res = await writeAtomic(teamFile(opts.root, teamId), serialize(doc)).then(
    () => ({ ok: true }),
    (err) => ({ ok: false, error: `team: falha ao gravar: ${String(err?.message ?? err)}` }),
  );
  return res.ok ? { ok: true, task: { ...task }, changed: true } : res;
}

/* ------------------------------------------------------------------ */
/* Quadro                                                              */
/* ------------------------------------------------------------------ */

/**
 * Devolve o quadro agrupado por estado, pronto para a TUI.
 *
 * @param {string} teamId
 * @param {object} [opts] { root? }
 * @returns {Promise<{ ok: boolean, board?: object, error?: string }>}
 */
export async function board(teamId, opts = {}) {
  const id = assertTeamId(teamId);
  if (!id.ok) return id;

  const loaded = await readTeamDoc(opts.root, teamId);
  if (!loaded.ok) return loaded;
  const doc = loaded.doc;

  const grouped = { pending: [], active: [], blocked: [], done: [] };
  for (const t of doc.tasks) {
    if (!t || !grouped[t.status]) continue;
    grouped[t.status].push({ ...t });
  }

  return {
    ok: true,
    board: {
      id: doc.id,
      name: doc.name,
      updatedAt: doc.updatedAt,
      members: doc.members.map((m) => ({ ...m })),
      counts: {
        pending: grouped.pending.length,
        active: grouped.active.length,
        blocked: grouped.blocked.length,
        done: grouped.done.length,
      },
      columns: grouped,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Passo determinístico                                                */
/* ------------------------------------------------------------------ */

/**
 * Executa UM passo determinístico da equipe: uma transição de estado e a
 * entrega de uma mensagem de notificação ao agente dono da tarefa. Não chama
 * modelo, não abre thread, não faz I/O de rede — só lê e grava o documento.
 *
 * Regra de avanço (determinística):
 *   - 1ª tarefa `pending` (ordem de criação) -> `active`, avisa o agente;
 *   - senão 1ª tarefa `active`               -> `done`,   avisa o agente;
 *   - senão nada a fazer (advanced:null).
 *
 * @param {string} teamId
 * @param {object} [ctx] { root?, now?, taskId? }
 *   `taskId` força a tarefa alvo; sem ele, vale a regra de prioridade acima.
 * @returns {Promise<{ ok: boolean, step: object, error?: string }>}
 */
export async function runTeamStep(teamId, ctx = {}) {
  const id = assertTeamId(teamId);
  if (!id.ok) return id;

  const loaded = await readTeamDoc(ctx.root, teamId);
  if (!loaded.ok) return loaded;
  const doc = loaded.doc;

  // 1. Passo do cursor (determinístico, monotónico).
  doc.cursor.step = (doc.cursor.step || 0) + 1;
  const stepNo = doc.cursor.step;
  const atIso = stampOf(ctx);

  // 2. Escolhe a tarefa alvo e a transição.
  let target = null;
  let toStatus = null;
  const forced = ctx.taskId != null ? String(ctx.taskId).trim() : "";
  if (forced) {
    target = doc.tasks.find((t) => t && t.id === forced) || null;
    if (target && target.status === "pending") toStatus = "active";
    else if (target && target.status === "active") toStatus = "done";
  } else {
    target = doc.tasks.find((t) => t && t.status === "pending") || null;
    if (target) toStatus = "active";
    if (!target) {
      target = doc.tasks.find((t) => t && t.status === "active") || null;
      if (target) toStatus = "done";
    }
  }

  // 3. Sem transição possível: persiste o cursor e devolve passo vazio.
  if (!target || !toStatus) {
    doc.updatedAt = atIso;
    const res = await writeAtomic(teamFile(ctx.root, teamId), serialize(doc)).then(
      () => ({ ok: true }),
      (err) => ({ ok: false, error: `team: falha ao gravar: ${String(err?.message ?? err)}` }),
    );
    if (!res.ok) return res;
    return { ok: true, step: { step: stepNo, taskId: null, from: null, to: null, message: null } };
  }

  // 4. Aplica a transição.
  const fromStatus = target.status;
  target.status = toStatus;
  target.updatedAt = atIso;

  // 5. Entrega uma mensagem de notificação ao agente dono da tarefa.
  const text = toStatus === "active"
    ? `task ${target.id} started for ${target.agentId}: ${target.goal}`
    : `task ${target.id} done`;
  const message = {
    id: nextMessageId(doc),
    from: SYSTEM_FROM,
    to: target.agentId,
    text,
    at: atIso,
    read: false,
  };
  doc.messages.push(message);
  doc.updatedAt = atIso;

  const res = await writeAtomic(teamFile(ctx.root, teamId), serialize(doc)).then(
    () => ({ ok: true }),
    (err) => ({ ok: false, error: `team: falha ao gravar: ${String(err?.message ?? err)}` }),
  );
  if (!res.ok) return res;

  return {
    ok: true,
    step: {
      step: stepNo,
      taskId: target.id,
      from: fromStatus,
      to: toStatus,
      message: { id: message.id, from: message.from, to: message.to, text: message.text },
    },
  };
}

export default {
  createTeam,
  postMessage,
  inbox,
  markRead,
  assignTask,
  advanceTask,
  board,
  runTeamStep,
  slugifyTeamName,
  teamsDir,
  TASK_STATES,
  TASK_TRANSITIONS,
  TASK_TERMINAL,
  TEAM_VERSION,
};