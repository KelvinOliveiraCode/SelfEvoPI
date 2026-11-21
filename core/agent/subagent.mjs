/**
 * core/agent/subagent.mjs — subagentes moldáveis (filosofia "dsh").
 *
 * O modelo principal molda cada subagente para a tarefa:
 *   - modo (plan/build/ask/goal) — governa o que ele pode fazer
 *   - effort (off/low/medium/high) — profundidade de raciocínio
 *   - provider + modelo — qual motor e cérebro
 *   - tarefa — o que ele faz
 *   - identidade (nome) — como o principal o chama
 * E escolhe entre:
 *   - temporário: cria o cliente, executa e some (fecha ao fim)
 *   - persistente: mantém o cliente (sessão própria) entre chamadas, reutilizável
 *
 * Sem dependência nova (só `node:` + pi-rpc). O cliente é injetável
 * (`opts.createClient`) para testar sem motor.
 */

import { createPiClient as _createPiClient } from "./pi-rpc.mjs";
import { registerActivity, updateActivity, unregisterActivity } from "./activity.mjs";

const activityId = (name) => `sub:${name}`;

/** Registro de subagentes PERSISTENTES (sessão própria), por nome. */
const persistent = new Map();

/** Nomes dos subagentes persistentes ativos. */
export function listPersistent() {
  return [...persistent.keys()];
}

/** Fecha e esquece um subagente persistente. */
export async function closePersistent(name) {
  const c = persistent.get(name);
  persistent.delete(name);
  unregisterActivity(activityId(name));
  if (c) {
    try { await c.close(); } catch { /* fechar nunca derruba */ }
  }
}

/** Fecha todos os persistentes (no encerramento do harness). */
export async function closeAllPersistent() {
  const nomes = [...persistent.keys()];
  await Promise.all(nomes.map(closePersistent));
  return nomes;
}

/**
 * Molda um cliente (define modelo e effort). Não lança: se o motor recusar,
 * o subagente roda no padrão do cliente.
 */
async function shapeClient(client, { provider, model, effort }) {
  if (!client) return;
  if (provider && model) {
    try { await client.setModel(provider, model); } catch { /* usa o padrão */ }
  }
  if (effort && client._rpc && typeof client._rpc.setThinkingLevel === "function") {
    try { await client._rpc.setThinkingLevel(effort); } catch { /* idem */ }
  }
}

/**
 * Executa uma tarefa num subagente moldado.
 *
 * @param {object} spec
 * @param {string} [spec.name]       como o principal o chama (default "sub")
 * @param {string} [spec.provider]   provedor
 * @param {string} [spec.model]      modelo
 * @param {string} [spec.effort]     off|low|medium|high
 * @param {string} [spec.mode]       plan|build|ask|goal (informativo; a
 *                                   governança real é do harness, aqui só
 *                                   rotula a intenção)
 * @param {string} spec.task         a tarefa (obrigatória)
 * @param {boolean} [spec.persistent] mantém sessão própria entre chamadas
 * @param {object} [opts]
 * @param {string} [opts.cwd]        workspace do subagente
 * @param {number} [opts.timeoutMs]  teto por tarefa (default 120s)
 * @param {Function} [opts.createClient] fábrica injetável (teste/frota)
 * @returns {Promise<{name,provider,model,effort,mode,task,text,ok,error?}>}
 */
export async function runSubagent(spec = {}, opts = {}) {
  const {
    name = "sub",
    provider = null,
    model = null,
    effort = null,
    mode = null,
    task = "",
  } = spec;
  const cwd = opts.cwd || process.cwd();
  const timeoutMs = opts.timeoutMs || 120_000;
  const createClient = opts.createClient || _createPiClient;

  if (!String(task).trim()) {
    return { name, provider, model, effort, mode, task, text: "", ok: false, error: "subagent: `task` vazia" };
  }

  let client = null;
  let closeAfter = false;

  if (spec.persistent && persistent.has(name)) {
    // reutiliza a sessão própria (ijá moldada na criação)
    client = persistent.get(name);
  } else {
    client = await createClient({ cwd });
    closeAfter = !spec.persistent;
    await shapeClient(client, { provider, model, effort });
    if (spec.persistent && client) persistent.set(name, client);
  }

  if (!client) {
    return { name, provider, model, effort, mode, task, text: "", ok: false, error: "subagent: sem cliente (motor ausente?)" };
  }

  // registra a atividade (para a lista de atividade Ctrl+P)
  registerActivity({
    id: activityId(name),
    kind: "subagent",
    name,
    status: "running",
    startedAt: new Date().toISOString(),
    meta: { persistent: Boolean(spec.persistent), provider, model, effort, mode, task },
  });

  try {
    const text = await client.promptAndWait(task, timeoutMs);
    updateActivity(activityId(name), { status: "done", endedAt: new Date().toISOString() });
    return { name, provider, model, effort, mode, task, text: text ?? "", ok: true };
  } catch (err) {
    updateActivity(activityId(name), { status: "crashed", endedAt: new Date().toISOString(), meta: { error: String(err?.message || err) } });
    return { name, provider, model, effort, mode, task, text: "", ok: false, error: String(err?.message || err) };
  } finally {
    if (closeAfter && client) {
      try { await client.close(); } catch { /* idem */ }
      unregisterActivity(activityId(name));
    }
  }
}

/**
 * Executa vários subagentes em paralelo, cada um com sua spec, e devolve os
 * resultados na ordem. Falha de um não derruba os outros.
 *
 * @param {Array} specs  specs (cada uma com `task`)
 * @param {object} [opts]  { cwd, timeoutMs, createClient }
 */
export async function runSwarmExecution(specs, opts = {}) {
  const lista = Array.isArray(specs) ? specs : [];
  const settled = await Promise.allSettled(lista.map((s) => runSubagent(s, opts)));
  return settled.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : {
          name: lista[i]?.name || `s${i + 1}`,
          provider: lista[i]?.provider ?? null,
          model: lista[i]?.model ?? null,
          effort: lista[i]?.effort ?? null,
          mode: lista[i]?.mode ?? null,
          task: lista[i]?.task ?? "",
          text: "",
          ok: false,
          error: String(r.reason?.message || r.reason),
        },
  );
}

/**
 * A2A (agente-para-agente): um subagente PERSISTENTE manda uma mensagem para
 * outro subagente persistente (ou para o orquestrador). Só persistentes têm
 * sessão própria para receber; temporários não são endereçáveis.
 *
 * @param {object} p
 * @param {string} p.from  nome do subagente de origem (persistente)
 * @param {string} p.to    nome do subagente de destino, ou "orquestrador"/"main"
 * @param {string} p.message
 * @param {number} [p.timeoutMs]
 * @returns {Promise<{ok, from, to, text?, error?, deliver?: "orchestrator"}>}
 */
export async function sendA2A({ from, to, message, timeoutMs = 120_000 } = {}) {
  const origem = persistent.get(from);
  if (!origem) return { ok: false, from, to, error: `subagente "${from}" não existe ou não é persistente` };
  if (!String(message ?? "").trim()) return { ok: false, from, to, error: "mensagem vazia" };

  // @orquestrador: não há canal direto no módulo; devolve para o chamador injetar
  if (to === "orquestrador" || to === "@orquestrador" || to === "main") {
    return { ok: true, from, to: "orquestrador", text: message, deliver: "orchestrator" };
  }

  const alvo = persistent.get(to);
  if (!alvo) return { ok: false, from, to, error: `destinatário "${to}" não existe ou não é persistente` };
  try {
    const text = await alvo.promptAndWait(message, timeoutMs);
    updateActivity(activityId(to), { meta: { lastA2A: { from, at: new Date().toISOString() } } });
    return { ok: true, from, to, text: text ?? "" };
  } catch (err) {
    return { ok: false, from, to, error: String(err?.message || err) };
  }
}

/**
 * Sintetiza os resultados num texto curto (quem disse o quê).
 */
export function synthesizeSubagents(results) {
  const ok = results.filter((r) => r.ok && String(r.text).trim());
  const fail = results.filter((r) => !r.ok);
  const linhas = [];
  for (const r of ok) {
    const cab = [r.name, r.provider && r.model ? `${r.provider}/${r.model}` : null, r.effort ? `think:${r.effort}` : null]
      .filter(Boolean)
      .join(" · ");
    linhas.push(`【${cab}】`);
    linhas.push(String(r.text).trim());
    linhas.push("");
  }
  if (fail.length) {
    linhas.push(paintFail(fail));
  }
  return linhas.join("\n").trim();
}

function paintFail(fail) {
  return fail.map((r) => `✗ ${r.name}: ${r.error || "falhou"}`).join("\n");
}