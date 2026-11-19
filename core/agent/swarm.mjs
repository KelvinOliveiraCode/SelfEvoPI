/**
 * core/agent/swarm.mjs — modo swarm: o modelo principal vira orquestrador.
 *
 * `/swarm <tarefa>` cria N subagentes, distribui o trabalho, coleta e sintetiza.
 * `/swarm <n> <tarefa>` define N (default 3, teto 8).
 *
 * Três funções puras, sem efeito colateral, zero dependência nova (só `node:`):
 *
 *   planSwarm({ task, n, providers }) -> { subtasks: [{ id, goal, provider, model }] }
 *   normalizeResults({ results })     -> { ok: [...], failed: [...], synthesis }
 *   renderSwarm({ plan, results })    -> string[]   // <= 72 colunas
 *
 * A execução real dos subagentes é da integração (apps/cli.mjs). Aqui só a
 * lógica: planejar, normalizar e renderizar. Determinístico — mesma entrada,
 * mesma saída.
 *
 * Desenho:
 *   - O principal escolhe os provedores, mas só entre os configurados. Provedor
 *     inexistente cai no primeiro disponível e diz isso (fallback avisado).
 *   - Subagente que falha não derruba o enxame: vira `failed` com o motivo.
 *   - A síntese cita qual subagente disse o quê — nada de resposta genérica.
 */

/** Teto de subagentes (o enxame não vira multidão). */
export const MAX_SUBAGENTS = 8;

/** Default de subagentes quando `/swarm <tarefa>` não diz N. */
export const DEFAULT_SUBAGENTS = 3;

/** Largura máxima de renderização (cabe no terminal padrão). */
export const WIDTH = 72;

/** Comprimento máximo de uma citação quando o prefixo não diz o resto. */
const SYNTHESIS_QUOTE = 60;

/* ------------------------------------------------------------------ */
/* Parsing de argumentos                                               */
/* ------------------------------------------------------------------ */

/**
 * Interpreta o argumento de `/swarm`: `[n] <tarefa>`.
 *
 * - `/swarm <tarefa>`    -> n default
 * - `/swarm 5 <tarefa>`  -> n 5
 * - `/swarm 99 <tarefa>` -> n 8 (teto)
 * - `/swarm 1 tarefa`    -> n 1
 * - `/swarm abc tarefa`  -> "abc" não é número, vira parte da tarefa
 *
 * @param {string} raw  argumento cru do comando
 * @returns {{ n: number, task: string }}
 */
export function parseSwarmArgs(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { n: DEFAULT_SUBAGENTS, task: "" };

  const first = text.split(/\s+/)[0];
  // só trata como N se for inteiro puro (>= 1); "1abc" e "abc" ficam na tarefa
  if (/^\d+$/.test(first)) {
    const asked = Number.parseInt(first, 10);
    const n = Math.max(1, Math.min(MAX_SUBAGENTS, asked));
    const task = text.slice(first.length).trim();
    return { n, task };
  }

  return { n: DEFAULT_SUBAGENTS, task: text };
}

/* ------------------------------------------------------------------ */
/* Provedores                                                          */
/* ------------------------------------------------------------------ */

/**
 * Lista os nomes de provedores configurados, na ordem.
 * Aceita array de strings ou de objetos { provider, model?, name?, id? }.
 */
function providerNames(providers) {
  if (!Array.isArray(providers)) return [];
  const out = [];
  for (const p of providers) {
    const name = typeof p === "string" ? p : p && (p.provider || p.name);
    if (name && !out.includes(name)) out.push(String(name));
  }
  return out;
}

/**
 * Resolve o provedor de um subagente: o pedido, se existir; senão o primeiro
 * disponível, numa volta determinística (round-robin) sobre os configurados.
 *
 * @param {object} p
 * @param {string} p.requested     provedor pedido (pode não existir)
 * @param {string[]} p.available    provedores configurados
 * @param {number} p.index          índice do subagente (0-based)
 * @returns {{ provider: string|null, fallback: { from: string, to: string|null }|null }}
 */
export function resolveProvider({ requested, available, index = 0 } = {}) {
  const list = Array.isArray(available) ? available : [];
  if (list.length === 0) {
    return { provider: null, fallback: requested ? { from: requested, to: null } : null };
  }

  const wanted = String(requested ?? "").trim();

  if (wanted && list.includes(wanted)) {
    return { provider: wanted, fallback: null };
  }

  // sem pedido: distribui em volta; com pedido inexistente: cai no 0 e avisa.
  const pick = wanted ? list[0] : list[index % list.length];
  const fallback = wanted ? { from: wanted, to: pick } : null;
  return { provider: pick, fallback };
}

/** Rótulo de um modelo (string ou { model?, id?, name? }). */
function modelLabel(m) {
  if (typeof m === "string") return m;
  if (!m || typeof m !== "object") return "";
  return String(m.model || m.id || m.name || "");
}

/**
 * Escolhe o modelo de um subagente: procura um modelo daquele provedor; se não
 * houver, usa o primeiro modelo disponível e diz.
 *
 * @param {object} p
 * @param {string} p.provider   provedor resolvido
 * @param {Array}  p.models     modelos resolvidos ([{ provider, id }] ou [string])
 * @param {number} p.index      índice do subagente
 * @returns {{ model: string|null, fallback: { from: string, to: string }|null }}
 */
function resolveModel({ provider, models, index = 0 } = {}) {
  const list = Array.isArray(models) ? models : [];
  if (list.length === 0) return { model: null, fallback: null };

  const provOf = (m) => (m && typeof m === "object" ? m.provider : null);

  // modelos do provedor escolhido, nesta ordem
  const mine = list.filter((m) => provOf(m) === provider);
  if (mine.length > 0) {
    const pick = modelLabel(mine[index % mine.length]);
    return { model: pick || null, fallback: null };
  }

  // nenhum modelo daquele provedor: cai no primeiro disponível e avisa.
  const pick = modelLabel(list[0]);
  return { model: pick || null, fallback: pick ? { from: provider, to: pick } : null };
}

/* ------------------------------------------------------------------ */
/* planSwarm                                                           */
/* ------------------------------------------------------------------ */

/**
 * Monta o plano do enxame: N subtarefas, cada uma com provedor e modelo.
 *
 * @param {object} p
 * @param {string} p.task        a tarefa (já sem o N, se houver)
 * @param {number} [p.n]         número de subagentes (default 3, teto 8)
 * @param {Array}  [p.providers] provedores configurados
 *                             ([string] ou [{ provider, models? }])
 * @param {Array}  [p.models]    modelos resolvidos ([{ provider, id }] ou [string])
 * @param {string} [p.requested] provedor pedido pelo usuário (opcional)
 * @returns {{ subtasks: Array, notices: string[] }}
 *   subtasks: [{ id, goal, provider, model }]
 *   notices:  avisos de fallback ("provedor X não existe, usei Y")
 */
export function planSwarm({ task, n, providers, models, requested } = {}) {
  const goal = String(task ?? "").trim();
  if (!goal) {
    throw new Error("swarm: `task` não pode ser vazio");
  }

  const askedN = Number(n);
  const count = Number.isFinite(askedN)
    ? Math.max(1, Math.min(MAX_SUBAGENTS, Math.floor(askedN)))
    : DEFAULT_SUBAGENTS;

  const available = providerNames(providers);
  const resModels = Array.isArray(models) ? models : [];
  const notices = [];

  // provedor pedido que não existe: avisa uma vez, não uma por subagente.
  const wanted = String(requested ?? "").trim();
  if (wanted && available.length > 0 && !available.includes(wanted)) {
    notices.push(`provedor "${wanted}" não existe, usei "${available[0]}" (primeiro disponível)`);
  }

  const subtasks = [];
  for (let i = 0; i < count; i++) {
    const { provider } = resolveProvider({ requested, available, index: i });

    const { model, fallback: modelFallback } = resolveModel({
      provider,
      models: resModels,
      index: i,
    });

    if (modelFallback) {
      notices.push(`sem modelo em "${modelFallback.from}", usei "${modelFallback.to}"`);
    }

    subtasks.push({
      id: `s${i + 1}`,
      goal: `subtarefa ${i + 1}/${count} de: ${goal}`,
      provider: provider ?? null,
      model: model ?? null,
    });
  }

  // avisos sem repetição, na ordem em que apareceram
  const uniqueNotices = [...new Set(notices)];
  return { subtasks, notices: uniqueNotices };
}

/* ------------------------------------------------------------------ */
/* normalizeResults                                                    */
/* ------------------------------------------------------------------ */

/** Texto de um resultado (aceita string, { text }, { output }, { content }). */
function resultText(r) {
  if (typeof r === "string") return r;
  if (!r || typeof r !== "object") return "";
  for (const k of ["text", "output", "content", "result"]) {
    if (typeof r[k] === "string") return r[k];
  }
  return "";
}

/** Um resultado é "útil" quando tem texto não-vazio depois de trim. */
function isUseful(r) {
  return resultText(r).trim().length > 0;
}

/** Motivo de uma falha, sem inventar: usa `error`/`reason`/`status` do objeto. */
function failureReason(r) {
  if (!r || typeof r !== "object") return "sem retorno";
  for (const k of ["error", "reason", "message"]) {
    if (typeof r[k] === "string" && r[k].trim()) return r[k].trim();
  }
  if (r.status != null) return `status ${r.status}`;
  if (r.ok === false) return "resultado marcado como falha";
  return "sem retorno";
}

/** Recorta um texto para uma linha, com reticências quando passa do teto. */
function clip(text, max = SYNTHESIS_QUOTE) {
  const one = String(text ?? "").replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return one.slice(0, Math.max(1, max - 1)).trimEnd() + "…";
}

/** Monta as linhas da síntese (uma por subagente, com citação, <= 72 colunas). */
function buildSynthesis({ ok, failed, total }) {
  const lines = [];

  if (total === 0) {
    lines.push("  síntese: nenhum subagente respondeu.");
    return lines;
  }

  for (const r of ok) {
    const who = r.provider ? `${r.id} (${r.provider})` : r.id;
    // o que sobrar depois do prefixo "  <quem>: " é o espaço da citação.
    const prefix = `  ${who}: `;
    const room = Math.max(8, WIDTH - prefix.length);
    lines.push(prefix + clip(r.text, room));
  }

  for (const f of failed) {
    const who = f.provider ? `${f.id} (${f.provider})` : f.id;
    const prefix = `  ${who}: falhou - `;
    const room = Math.max(8, WIDTH - prefix.length);
    lines.push(prefix + clip(f.reason, room));
  }

  if (ok.length === 0 && failed.length === 0) {
    lines.push("  síntese: nada a sintetizar.");
  }

  return lines;
}

/**
 * Separa o que voltou útil do que voltou lixo e monta a síntese.
 *
 * A síntese cita qual subagente disse o quê — uma linha por subagente útil,
 * e uma linha por falha com o motivo. Nada de resposta genérica.
 *
 * @param {object} p
 * @param {Array}  p.results        resultados dos subagentes, na ordem do plano
 *                                 (string | { id?, text?, error?, ok?, ... })
 * @param {Array}  [p.subtasks]     plano (para casar id/provider/model)
 * @returns {{ ok: Array, failed: Array, synthesis: string[] }}
 *   ok:    [{ id, provider, model, text }]
 *   failed:[{ id, provider, model, reason }]
 *   synthesis: string[]  (<= 72 colunas por linha)
 */
export function normalizeResults({ results, subtasks } = {}) {
  const list = Array.isArray(results) ? results : [];
  const plan = Array.isArray(subtasks) ? subtasks : [];

  const meta = (i) => {
    const st = plan[i] || {};
    return { id: st.id ?? `s${i + 1}`, provider: st.provider ?? null, model: st.model ?? null };
  };

  const ok = [];
  const failed = [];

  list.forEach((r, i) => {
    const m = meta(i);
    const useful = isUseful(r);
    // falha explícita (ok:false / error) mesmo com texto, ou resultado vazio.
    const explicitFail =
      r && typeof r === "object" && (r.ok === false || (typeof r.error === "string" && r.error));

    if (!useful || explicitFail) {
      failed.push({ ...m, reason: failureReason(r) });
    } else {
      ok.push({ ...m, text: resultText(r) });
    }
  });

  return { ok, failed, synthesis: buildSynthesis({ ok, failed, total: list.length }) };
}

/* ------------------------------------------------------------------ */
/* renderSwarm                                                         */
/* ------------------------------------------------------------------ */

/** Corta uma linha a `width` colunas (por code point), com reticências. */
function fit(line, width) {
  const chars = [...String(line)];
  if (chars.length <= width) return String(line);
  return chars.slice(0, Math.max(1, width - 1)).join("").trimEnd() + "…";
}

/** Uma linha com id + provedor/modelo + marcador de estado. */
function subagentLine(st, state) {
  const where = [st.provider, st.model].filter(Boolean).join("/");
  const tag = where ? `${st.id} ${where}` : st.id;
  const mark = state === "ok" ? "[ok]" : state === "failed" ? "[x]" : "[ ]";
  return `  ${mark} ${tag}`;
}

/**
 * Renderiza o plano e o resultado por subagente, uma linha cada.
 *
 * @param {object} p
 * @param {Array}  p.plan     subtasks (de planSwarm)
 * @param {object} [p.results] { ok, failed, synthesis } (de normalizeResults)
 * @param {Array}  [p.notices] avisos de fallback (de planSwarm)
 * @param {number} [p.width=72]
 * @returns {string[]}  linhas <= width colunas
 */
export function renderSwarm({ plan, results, notices, width = WIDTH } = {}) {
  const W = Math.max(40, Math.floor(width) || WIDTH);
  // `plan` aceita a saida inteira de planSwarm ({ subtasks, notices }) ou so a
  // lista de subtarefas. Assim o aviso "cai no primeiro disponivel e diz isso"
  // viaja junto no plano, sem o chamador precisar separar os avisos a mao.
  const subtasks = Array.isArray(plan) ? plan : Array.isArray(plan && plan.subtasks) ? plan.subtasks : [];
  const fromPlan = !Array.isArray(plan) && Array.isArray(plan && plan.notices) ? plan.notices : [];
  const allNotices = notices != null ? notices : fromPlan;
  const res = results && typeof results === "object" ? results : { ok: [], failed: [], synthesis: [] };

  const byId = new Map();
  for (const o of Array.isArray(res.ok) ? res.ok : []) byId.set(o.id, { state: "ok", item: o });
  for (const f of Array.isArray(res.failed) ? res.failed : []) byId.set(f.id, { state: "failed", item: f });

  const out = [];
  out.push(fit(`  enxame - ${subtasks.length} subagente(s)`, W));

  if (subtasks.length === 0) {
    out.push(fit("  nenhum subagente planejado.", W));
  }

  // plano/estado: uma linha por subagente
  for (const st of subtasks) {
    const hit = byId.get(st.id);
    const state = hit ? hit.state : "pending";
    out.push(fit(subagentLine(st, state), W));

    // detalhe do resultado (o que ele trouxe), uma linha
    if (hit && hit.state === "ok") {
      out.push(fit(`      ${clip(hit.item.text, W - 6)}`, W));
    } else if (hit && hit.state === "failed") {
      out.push(fit(`      ${clip(hit.item.reason, W - 6)}`, W));
    } else if (st.goal) {
      out.push(fit(`      ${clip(st.goal, W - 6)}`, W));
    }
  }

  // avisos de fallback (provedor que não existia)
  for (const n of Array.isArray(allNotices) ? allNotices : []) {
    out.push(fit(`  ! ${n}`, W));
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Default export                                                      */
/* ------------------------------------------------------------------ */

export default {
  planSwarm,
  normalizeResults,
  renderSwarm,
  parseSwarmArgs,
  resolveProvider,
  MAX_SUBAGENTS,
  DEFAULT_SUBAGENTS,
  WIDTH,
};