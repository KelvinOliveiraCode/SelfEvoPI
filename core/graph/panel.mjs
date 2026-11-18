/**
 * selfevopi-graph-panel — visualização em tempo real do grafo (Fase 3).
 *
 * Sem dependências. Node ESM puro. Sem rede, sem canvas pesado, sem screenshot.
 *
 * Duas funções:
 *   renderAscii(graph, state) -> string   (grafo em árvore ASCII, nós por estado)
 *   renderHtml(graph, state)  -> string   (página HTML autocontida, polling de JSON)
 *
 * `state` é o que `runtime.status()` devolve (ou o JSON do checkpoint):
 *   { runId, nodes: [{ id, status }], waitingFor, checkpoints }
 *
 * Símbolos de estado:
 *   ○ pending   ● done   ✗ failed   ⏸ waiting   ⊘ blocked/skipped
 */

import { topologicalOrder } from "./model.mjs";

/* ------------------------------------------------------------------ */
/* Símbolos e cores                                                    */
/* ------------------------------------------------------------------ */
export const SYMBOLS = Object.freeze({
  pending: "○",
  running: "◐",
  done: "●",
  failed: "✗",
  waiting: "⏸",
  blocked: "⊘",
  skipped: "⊘",
});

/** Cor por status (usada no HTML). */
export const COLORS = Object.freeze({
  pending: "#94a3b8",
  running: "#38bdf8",
  done: "#22c55e",
  failed: "#ef4444",
  waiting: "#f59e0b",
  blocked: "#a78bfa",
  skipped: "#64748b",
});

/** Ordem topológica tolerante a falha (não deve falhar: grafo já validado). */
function safeOrder(graph) {
  try {
    return topologicalOrder(graph);
  } catch {
    return (graph?.nodes ?? []).map((n) => n.id);
  }
}

function symbolFor(status) {
  return SYMBOLS[status] ?? SYMBOLS.pending;
}

/** Mapa id -> status a partir de um `state` (aceita shape de runtime ou crua). */
function statusMap(state) {
  const map = new Map();
  if (state && Array.isArray(state.nodes)) {
    for (const n of state.nodes) if (n && typeof n.id === "string") map.set(n.id, n.status ?? "pending");
  } else if (state && state.nodes && typeof state.nodes === "object") {
    for (const [id, rec] of Object.entries(state.nodes)) {
      map.set(id, typeof rec === "string" ? rec : rec?.status ?? "pending");
    }
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* Árvore ASCII                                                        */
/* ------------------------------------------------------------------ */

/**
 * Devolve uma árvore ASCII do grafo, com nós coloridos (símbolos) por estado.
 * A árvore segue `dependsOn` (raiz = nó sem dependência). Arestas que não são
 * dependência não aparecem na árvore (elas são visuais, não estruturais).
 */
export function renderAscii(graph, state = {}) {
  const nodes = graph?.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sm = statusMap(state);
  const order = safeOrder(graph);

  // filhos[dep] = nós que dependem de dep
  const childrenOf = new Map();
  const indeg = new Map();
  for (const id of order) indeg.set(id, 0);
  for (const n of nodes) {
    const deps = Array.isArray(n.dependsOn) ? n.dependsOn : [];
    indeg.set(n.id, (indeg.get(n.id) ?? 0) + deps.length);
    for (const d of deps) {
      if (!childrenOf.has(d)) childrenOf.set(d, []);
      childrenOf.get(d).push(n.id);
    }
  }

  // raízes: sem dependência (ou dependência ausente)
  const roots = order.filter((id) => (indeg.get(id) ?? 0) === 0);

  const lines = [];
  const seen = new Set();

  const label = (id) => {
    const status = sm.get(id) ?? "pending";
    const node = byId.get(id);
    const kind = node?.kind ? ` (${node.kind})` : "";
    return `${symbolFor(status)} ${id}${kind} [${status}]`;
  };

  const walk = (id, prefix, isLast) => {
    const branch = isLast ? "└─ " : "├─ ";
    lines.push(`${prefix}${branch}${label(id)}`);
    seen.add(id);
    const kids = (childrenOf.get(id) ?? []).filter((k) => !seen.has(k));
    const nextPrefix = prefix + (isLast ? "   " : "│  ");
    kids.forEach((kid, i) => walk(kid, nextPrefix, i === kids.length - 1));
  };

  // raízes: cada uma é uma linha de topo; filhos herdam o recuo
  roots.forEach((r) => {
    if (roots.length === 1) {
      // raiz única: imprime sem galho, filhos recuados
      lines.push(label(r));
      seen.add(r);
      const kids = (childrenOf.get(r) ?? []).filter((k) => !seen.has(k));
      kids.forEach((kid, i) => walk(kid, "   ", i === kids.length - 1));
    } else {
      lines.push(label(r));
      seen.add(r);
      const kids = (childrenOf.get(r) ?? []).filter((k) => !seen.has(k));
      kids.forEach((kid, i) => walk(kid, "", i === kids.length - 1));
    }
  });

  // nós não alcançados (ex.: ciclo remanescente ou órfãos) entram no fim
  for (const id of order) {
    if (!seen.has(id)) lines.push(label(id));
  }

  // cabeçalho
  const runId = state?.runId ? ` run=${state.runId}` : "";
  const waiting = state?.waitingFor ? `  ⏸ aguardando ${state.waitingFor}` : "";
  const cps = typeof state?.checkpoints === "number" ? `  checkpoints=${state.checkpoints}` : "";

  return `grafo${runId}${waiting}${cps}\n${lines.join("\n")}`;
}

/* ------------------------------------------------------------------ */
/* HTML                                                                */
/* ------------------------------------------------------------------ */

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * Página HTML autocontida que mostra o grafo e atualiza por polling de um JSON.
 *
 * O HTML não embute dependências nem usa rede externa. Ele lê um `state` inicial
 * (embutido) e, se `pollUrl` for informado, faz `fetch` periódico desse JSON para
 * atualizar o painel em tempo real. Sem `pollUrl`, mostra o estado inicial.
 *
 * `indexUrl` (opcional) aponta para o `index.json` da ponte (`harness-store`): quando
 * existir, o painel mostra a lista de runs com status/progresso — é o que um desktop
 * lê sem varrer diretório.
 *
 * @param {object} graph
 * @param {object} state
 * @param {object} [opts]
 * @param {string} [opts.pollUrl]    JSON do estado de um run (runtime.status())
 * @param {string} [opts.indexUrl]   JSON do index.json da ponte (lista de runs)
 * @param {string} [opts.title]
 */
export function renderHtml(graph, state = {}, { pollUrl = null, indexUrl = null, title = "SelfEvoPI — Grafo" } = {}) {
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const sm = statusMap(state);

  // inicial: cada nó com seu status
  const initialNodes = nodes.map((n) => ({
    id: n.id,
    agent: n.agent ?? null,
    kind: n.kind ?? "task",
    status: sm.get(n.id) ?? "pending",
    dependsOn: Array.isArray(n.dependsOn) ? n.dependsOn : [],
  }));

  const payload = JSON.stringify({
    runId: state?.runId ?? null,
    nodes: initialNodes,
    edges: edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind ?? "handoff" })),
    waitingFor: state?.waitingFor ?? null,
    checkpoints: state?.checkpoints ?? 0,
  }).replace(/</g, "\\u003c");

  const poll = (pollUrl || indexUrl)
    ? `setInterval(refresh, 1500);`
    : `/* sem pollUrl/indexUrl: estado estático */`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  :root {
    --bg: #0f172a; --panel: #1e293b; --ink: #e2e8f0; --muted: #94a3b8;
    --pending:#94a3b8; --running:#38bdf8; --done:#22c55e; --failed:#ef4444;
    --waiting:#f59e0b; --blocked:#a78bfa; --skipped:#64748b;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
    font: 14px/1.5 ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif; padding: 16px; }
  header { display: flex; flex-wrap: wrap; gap: 12px; align-items: baseline; margin-bottom: 16px; }
  h1 { font-size: 18px; margin: 0; }
  .meta { color: var(--muted); font-size: 13px; }
  .legend { display: flex; flex-wrap: wrap; gap: 12px; margin: 12px 0 20px; color: var(--muted); }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
  ul.tree { list-style: none; margin: 0; padding: 0; }
  ul.tree ul { list-style: none; margin: 0; padding-left: 22px; border-left: 2px solid #334155; }
  li.node { display: flex; align-items: center; gap: 10px; padding: 8px 10px; margin: 4px 0;
    background: var(--panel); border-radius: 8px; border: 1px solid #334155; }
  .sym { font-size: 16px; width: 18px; text-align: center; flex: 0 0 auto; }
  .nid { font-weight: 600; }
  .badge { margin-left: auto; font-size: 12px; padding: 1px 8px; border-radius: 999px;
    background: #0b1220; border: 1px solid #334155; color: var(--muted); }
  .kind { color: var(--muted); font-size: 12px; }
  .wait { color: var(--waiting); font-weight: 600; }
  footer { margin-top: 20px; color: var(--muted); font-size: 12px; }
  .runs { margin-bottom: 20px; }
  .runs h2 { font-size: 14px; margin: 0 0 8px; color: var(--muted); font-weight: 600; }
  .runlist { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .runitem { display: grid; grid-template-columns: 130px 1fr 90px; gap: 10px; align-items: center;
    background: var(--panel); border: 1px solid #334155; border-radius: 8px; padding: 8px 10px; }
  .runid { font-family: ui-monospace, monospace; font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
  .bar { height: 8px; background: #0b1220; border-radius: 999px; overflow: hidden; }
  .bar > i { display: block; height: 100%; background: var(--done); width: 0%; }
  .runstat { font-size: 12px; color: var(--muted); text-align: right; }
  .runitem.active { border-color: var(--running); }
  .hidden { display: none; }
</style>
</head>
<body>
<header>
  <h1>${esc(title)}</h1>
  <div class="meta" id="meta"></div>
</header>
<div class="legend" id="legend"></div>
<div id="runs"></div>
<div id="root"></div>
<footer id="foot"></footer>
<script>
const DATA = ${payload};
const POLL = ${pollUrl ? JSON.stringify(pollUrl) : null};
const INDEX = ${indexUrl ? JSON.stringify(indexUrl) : null};
const SYMBOLS = ${JSON.stringify(SYMBOLS)};
const COLORS = ${JSON.stringify(COLORS)};

function symbolFor(s){ return SYMBOLS[s] || SYMBOLS.pending; }
function colorFor(s){ return COLORS[s] || COLORS.pending; }

function nodeById(id){
  // por id
  return DATA.nodes.find(n => n.id === id);
}

function buildTree(){
  const byId = new Map(DATA.nodes.map(n => [n.id, n]));
  const childrenOf = new Map();
  const hasDep = new Set();
  for(const n of DATA.nodes){
    for(const d of (n.dependsOn||[])){
      if(!childrenOf.has(d)) childrenOf.set(d, []);
      childrenOf.get(d).push(n.id);
      hasDep.add(n.id);
    }
  }
  const roots = DATA.nodes.filter(n => !hasDep.has(n.id)).map(n => n.id);
  const seen = new Set();
  const container = document.getElementById('root');
  container.innerHTML = '';
  const ul = document.createElement('ul');
  ul.className = 'tree';
  container.appendChild(ul);

  function makeLi(id){
    const n = byId.get(id);
    const li = document.createElement('li');
    li.className = 'node';
    const status = n?.status || 'pending';
    const sym = document.createElement('span');
    sym.className = 'sym';
    sym.textContent = symbolFor(status);
    sym.style.color = colorFor(status);
    const nid = document.createElement('span');
    nid.className = 'nid';
    nid.textContent = id;
    if(n?.agent){ const a = document.createElement('span'); a.className='kind'; a.textContent='@'+n.agent; li.appendChild(a); }
    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = n?.kind || 'task';
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = status;
    li.appendChild(sym); li.appendChild(nid); li.appendChild(kind); li.appendChild(badge);

    const kids = (childrenOf.get(id)||[]).filter(k => !seen.has(k));
    if(kids.length){
      const sub = document.createElement('ul');
      li.appendChild(sub);
      for(const k of kids){ seen.add(k); sub.appendChild(makeLi(k)); }
    }
    return li;
  }

  for(const r of roots){ if(seen.has(r)) continue; seen.add(r); ul.appendChild(makeLi(r)); }
  // nós não alcançados
  for(const n of DATA.nodes){ if(seen.has(n.id)) continue; ul.appendChild(makeLi(n.id)); }
}

function renderMeta(){
  const meta = document.getElementById('meta');
  const parts = [];
  if(DATA.runId) parts.push('run=' + DATA.runId);
  if(DATA.waitingFor) parts.push('aguardando ' + DATA.waitingFor);
  if(typeof DATA.checkpoints === 'number') parts.push('checkpoints=' + DATA.checkpoints);
  meta.textContent = parts.join(' · ');

  const legend = document.getElementById('legend');
  legend.innerHTML = '';
  for(const s of ['pending','running','done','failed','waiting','blocked','skipped']){
    const sp = document.createElement('span');
    const d = document.createElement('i'); d.className='dot'; d.style.background = colorFor(s);
    sp.appendChild(d); sp.appendChild(document.createTextNode(symbolFor(s)+' '+s));
    legend.appendChild(sp);
  }
  const foot = document.getElementById('foot');
  const bits = [];
  if(POLL) bits.push('estado de ' + POLL);
  if(INDEX) bits.push('runs de ' + INDEX);
  foot.textContent = bits.length ? ('atualizando ' + bits.join(' + ') + ' a cada 1,5 s') : 'estado estático (sem polling)';
}

function applyState(s){
  if(!s || !Array.isArray(s.nodes)) return;
  for(const sn of s.nodes){
    const n = nodeById(sn.id);
    if(n) n.status = sn.status || n.status;
  }
  if('runId' in s) DATA.runId = s.runId;
  if('waitingFor' in s) DATA.waitingFor = s.waitingFor;
  if('checkpoints' in s) DATA.checkpoints = s.checkpoints;
}

function renderRuns(runs){
  const box = document.getElementById('runs');
  if(!INDEX || !Array.isArray(runs) || runs.length === 0){ box.innerHTML = ''; return; }
  const wrap = document.createElement('div');
  wrap.className = 'runs';
  const h = document.createElement('h2');
  h.textContent = 'Runs (' + runs.length + ')';
  wrap.appendChild(h);
  const ul = document.createElement('ul');
  ul.className = 'runlist';
  for(const r of runs){
    const li = document.createElement('li');
    li.className = 'runitem' + (r.runId === DATA.runId ? ' active' : '');
    const id = document.createElement('span');
    id.className = 'runid';
    id.textContent = r.runId;
    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('i');
    const pct = Math.round((r.progress ?? 0) * 100);
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    const stat = document.createElement('span');
    stat.className = 'runstat';
    stat.textContent = (r.status ?? '?') + ' ' + (r.done ?? 0) + '/' + (r.nodes ?? 0);
    li.appendChild(id); li.appendChild(bar); li.appendChild(stat);
    ul.appendChild(li);
  }
  wrap.appendChild(ul);
  box.innerHTML = '';
  box.appendChild(wrap);
}

async function refresh(){
  if(!POLL && !INDEX) return;
  try{
    if(POLL){
      const res = await fetch(POLL, { cache: 'no-store' });
      if(res.ok){ applyState(await res.json()); buildTree(); renderMeta(); }
    }
    if(INDEX){
      const res = await fetch(INDEX, { cache: 'no-store' });
      if(res.ok){ const doc = await res.json(); renderRuns(doc.runs || []); }
    }
  }catch(e){ /* offline: mantém o último estado */ }
}

buildTree(); renderMeta();
${poll}
</script>
</body>
</html>`;
}