/**
 * selfevopi-graph — modelo de grafo de execução do SelfEvoPI (Fase 3).
 *
 * Sem dependências. Determinístico. Node ESM puro.
 *
 * O grafo é a fonte de verdade da orquestração: nós representam agentes,
 * tarefas, revisões, humanos e artefatos; arestas representam o fluxo
 * (handoff / approval / artifact); `dependsOn` decide a ordem de execução.
 * O módulo NÃO executa nada — apenas valida, ordena e diz o que está pronto.
 *
 * Contrato:
 *   createGraph({ nodes, edges }) -> grafo normalizado (ou lança GraphError)
 *   validate(graph)               -> { ok, errors }   (não lança)
 *   topologicalOrder(graph)       -> [id, ...]        (ordem de execução)
 *   nextReady(graph)              -> [node, ...]      (deps concluídas)
 *
 * Nó:    { id, agent, kind, status, dependsOn }
 * Aresta: { from, to, kind }
 */

/* ------------------------------------------------------------------ */
/* Vocabulário                                                         */
/* ------------------------------------------------------------------ */

/** Tipos de nó aceitos. */
export const NODE_KINDS = Object.freeze(["task", "review", "human", "artifact"]);

/** Estados de nó aceitos. */
export const NODE_STATUSES = Object.freeze(["pending", "running", "done", "failed", "blocked"]);

/** Tipos de aresta aceitos. */
export const EDGE_KINDS = Object.freeze(["handoff", "approval", "artifact"]);

const KIND_SET = new Set(NODE_KINDS);
const STATUS_SET = new Set(NODE_STATUSES);
const EDGE_KIND_SET = new Set(EDGE_KINDS);

/* ------------------------------------------------------------------ */
/* Erros                                                               */
/* ------------------------------------------------------------------ */

/**
 * Erro do domínio de grafo.
 * `code` é estável e serve para teste/automação; `errors` carrega a lista
 * completa quando o problema é um grafo inválido.
 */
export class GraphError extends Error {
  constructor(message, { code = "invalid", errors = null } = {}) {
    super(message);
    this.name = "GraphError";
    this.code = code;
    if (errors) this.errors = errors;
  }
}

function issue(code, message, extra = {}) {
  return { code, message, ...extra };
}

/* ------------------------------------------------------------------ */
/* Normalização                                                        */
/* ------------------------------------------------------------------ */

function normalizeNode(node, index) {
  if (!node || typeof node !== "object") {
    throw new GraphError(`createGraph: node[${index}] não é um objeto`, { code: "invalid-node" });
  }
  const id = typeof node.id === "string" ? node.id.trim() : "";
  // Preserva campos extras (ex.: timeoutMs, metadados) sem deixar passar
  // valores inválidos nos campos do núcleo.
  return {
    ...node,
    id,
    agent: typeof node.agent === "string" ? node.agent : null,
    kind: node.kind ?? "task",
    status: node.status ?? "pending",
    // dependsOn duplicado não acrescenta nada; remove para não contar 2x.
    dependsOn: Array.isArray(node.dependsOn) ? [...new Set(node.dependsOn)] : [],
  };
}

function normalizeEdge(edge, index) {
  if (!edge || typeof edge !== "object") {
    throw new GraphError(`createGraph: edge[${index}] não é um objeto`, { code: "invalid-edge" });
  }
  return {
    from: edge.from,
    to: edge.to,
    kind: edge.kind ?? "handoff",
  };
}

/* ------------------------------------------------------------------ */
/* Validação                                                           */
/* ------------------------------------------------------------------ */

/**
 * Valida um grafo e devolve `{ ok, errors }`. Nunca lança por grafo inválido.
 * Aceita tanto um grafo vindo de `createGraph` quanto um objeto cru
 * `{ nodes, edges }` (útil para inspecionar antes de construir).
 *
 * Regras de rejeição:
 *  - `duplicate-id`           id de nó repetido
 *  - `unknown-dependency`     `dependsOn` aponta para id inexistente
 *  - `cycle`                  ciclo em `dependsOn` (inclui auto-dependência)
 *  - `human-without-task`     nó `human` sem nenhuma tarefa anterior
 *
 * Além dessas, reprova estruturas quebradas (nó/aresta malformados, kind ou
 * status fora do vocabulário, aresta com ponta inexistente).
 */
export function validate(graph) {
  const errors = [];
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];

  if (!Array.isArray(graph?.nodes)) {
    errors.push(issue("invalid-nodes", "graph.nodes deve ser um array"));
  }
  if (!Array.isArray(graph?.edges)) {
    errors.push(issue("invalid-edges", "graph.edges deve ser um array"));
  }

  /* --- nós: id, kind, status -------------------------------------- */
  const ids = new Set();
  const byId = new Map();
  nodes.forEach((node, i) => {
    if (!node || typeof node !== "object") {
      errors.push(issue("invalid-node", `node[${i}] não é um objeto`));
      return;
    }
    const id = node.id;
    if (typeof id !== "string" || id.trim() === "") {
      errors.push(issue("missing-id", `node[${i}] sem id`));
      return;
    }
    if (ids.has(id)) {
      errors.push(issue("duplicate-id", `id duplicado "${id}"`, { node: id }));
      return;
    }
    ids.add(id);
    byId.set(id, node);

    const kind = node.kind ?? "task";
    if (!KIND_SET.has(kind)) {
      errors.push(issue("invalid-kind", `nó "${id}" tem kind inválido "${kind}"`, { node: id }));
    }
    const status = node.status ?? "pending";
    if (!STATUS_SET.has(status)) {
      errors.push(issue("invalid-status", `nó "${id}" tem status inválido "${status}"`, { node: id }));
    }
  });

  /* --- dependências: existentes e sem duplicata ------------------- */
  const deps = new Map(); // id -> [dep] (apenas deps existentes)
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const id = node.id;
    if (typeof id !== "string" || !byId.has(id)) continue;
    const list = Array.isArray(node.dependsOn) ? node.dependsOn : [];
    const seen = new Set();
    const clean = [];
    for (const dep of list) {
      if (typeof dep !== "string") {
        errors.push(issue("invalid-dependency", `dependência de "${id}" não é string`, { node: id }));
        continue;
      }
      if (seen.has(dep)) continue;
      seen.add(dep);
      if (!ids.has(dep)) {
        errors.push(
          issue("unknown-dependency", `nó "${id}" depende de "${dep}" que não existe`, {
            node: id,
            dependency: dep,
          })
        );
        continue;
      }
      clean.push(dep);
    }
    deps.set(id, clean);
  }

  /* --- ciclo em dependsOn ----------------------------------------- */
  const cycle = findCycle(ids, deps);
  if (cycle) {
    errors.push(issue("cycle", `ciclo em dependsOn: ${cycle.join(" -> ")}`, { cycle }));
  }

  /* --- nó humano exige tarefa anterior ---------------------------- */
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    if ((node.kind ?? "task") !== "human") continue;
    const id = node.id;
    if (typeof id !== "string" || !byId.has(id)) continue;
    if (!hasTaskAncestor(id, deps, byId)) {
      errors.push(issue("human-without-task", `nó humano "${id}" não tem tarefa anterior`, { node: id }));
    }
  }

  /* --- arestas: pontas existentes e kind válido ------------------- */
  edges.forEach((edge, i) => {
    if (!edge || typeof edge !== "object") {
      errors.push(issue("invalid-edge", `edge[${i}] não é um objeto`));
      return;
    }
    if (typeof edge.from !== "string" || !ids.has(edge.from)) {
      errors.push(issue("unknown-edge-endpoint", `aresta ${i} sai de "${edge.from}" que não existe`, {
        edge: i,
        endpoint: "from",
      }));
    }
    if (typeof edge.to !== "string" || !ids.has(edge.to)) {
      errors.push(issue("unknown-edge-endpoint", `aresta ${i} chega em "${edge.to}" que não existe`, {
        edge: i,
        endpoint: "to",
      }));
    }
    const kind = edge.kind ?? "handoff";
    if (!EDGE_KIND_SET.has(kind)) {
      errors.push(issue("invalid-edge-kind", `aresta ${i} tem kind inválido "${kind}"`, { edge: i }));
    }
  });

  return { ok: errors.length === 0, errors };
}

/* ------------------------------------------------------------------ */
/* Construção                                                          */
/* ------------------------------------------------------------------ */

/**
 * Constrói um grafo normalizado. Lança `GraphError` (`code: "invalid-graph"`,
 * com `.errors`) quando inválido.
 */
export function createGraph({ nodes = [], edges = [] } = {}) {
  if (!Array.isArray(nodes)) {
    throw new GraphError("createGraph: nodes deve ser um array", { code: "invalid-nodes" });
  }
  if (!Array.isArray(edges)) {
    throw new GraphError("createGraph: edges deve ser um array", { code: "invalid-edges" });
  }
  const graph = {
    nodes: nodes.map(normalizeNode),
    edges: edges.map(normalizeEdge),
  };
  const { ok, errors } = validate(graph);
  if (!ok) {
    const codes = [...new Set(errors.map((e) => e.code))].join(", ");
    throw new GraphError(`grafo inválido: ${codes}`, { code: "invalid-graph", errors });
  }
  return graph;
}

/* ------------------------------------------------------------------ */
/* Ordenação e prontidão                                               */
/* ------------------------------------------------------------------ */

/**
 * Ordem de execução (ids) respeitando `dependsOn`. Empates caem na ordem de
 * inserção dos nós, então a saída é determinística. Lança `GraphError`
 * (`code: "cycle"`) se houver ciclo.
 */
export function topologicalOrder(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const index = new Map(); // id -> posição de inserção
  nodes.forEach((node, i) => {
    if (node && typeof node.id === "string" && !index.has(node.id)) index.set(node.id, i);
  });

  const indeg = new Map(); // id -> nº de dependências presentes
  const dependents = new Map(); // dep -> [id que depende dele]
  for (const node of nodes) {
    if (!node || typeof node.id !== "string" || !index.has(node.id)) continue;
    const deps = Array.isArray(node.dependsOn)
      ? [...new Set(node.dependsOn)].filter((d) => index.has(d))
      : [];
    indeg.set(node.id, deps.length);
    for (const dep of deps) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep).push(node.id);
    }
  }

  const ready = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const byIndex = (a, b) => index.get(a) - index.get(b);
  ready.sort(byIndex);

  const order = [];
  while (ready.length > 0) {
    const id = ready.shift();
    order.push(id);
    for (const dependent of dependents.get(id) ?? []) {
      const next = indeg.get(dependent) - 1;
      indeg.set(dependent, next);
      if (next === 0) {
        ready.push(dependent);
        ready.sort(byIndex);
      }
    }
  }

  if (order.length !== index.size) {
    throw new GraphError("topologicalOrder: grafo contém ciclo em dependsOn", { code: "cycle" });
  }
  return order;
}

/**
 * Nós cuja(s) dependência(s) já terminaram (`status === "done"`), e que ainda
 * não começaram (`status === "pending"`). Nó sem dependência entra pronto.
 * Devolve os próprios nós (na ordem de inserção), não cópias.
 */
export function nextReady(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const byId = new Map();
  for (const node of nodes) {
    if (node && typeof node.id === "string" && !byId.has(node.id)) byId.set(node.id, node);
  }

  const ready = [];
  for (const node of nodes) {
    if (!node || typeof node.id !== "string") continue;
    if ((node.status ?? "pending") !== "pending") continue;
    const deps = Array.isArray(node.dependsOn) ? [...new Set(node.dependsOn)] : [];
    const done = deps.every((dep) => byId.get(dep)?.status === "done");
    if (done) ready.push(node);
  }
  return ready;
}

/* ------------------------------------------------------------------ */
/* Internos                                                            */
/* ------------------------------------------------------------------ */

/** DFS de três cores sobre `dependsOn`; devolve o ciclo como [a, b, ..., a] ou null. */
function findCycle(ids, deps) {
  const state = new Map(); // id -> 1 (cinza) | 2 (preto)
  const stack = [];
  let cycle = null;

  const visit = (id) => {
    if (cycle) return;
    state.set(id, 1);
    stack.push(id);
    for (const dep of deps.get(id) ?? []) {
      if (cycle) return;
      const s = state.get(dep) ?? 0;
      if (s === 0) {
        visit(dep);
      } else if (s === 1) {
        const at = stack.indexOf(dep);
        cycle = [...stack.slice(at), dep];
        return;
      }
    }
    stack.pop();
    state.set(id, 2);
  };

  for (const id of ids) {
    if (cycle) break;
    if ((state.get(id) ?? 0) === 0) visit(id);
  }
  return cycle;
}

/** Existe algum nó `task` entre os ancestrais (via dependsOn) de `id`? */
function hasTaskAncestor(id, deps, byId) {
  const seen = new Set();
  const stack = [...(deps.get(id) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    const node = byId.get(current);
    if (node && (node.kind ?? "task") === "task") return true;
    for (const dep of deps.get(current) ?? []) {
      if (!seen.has(dep)) stack.push(dep);
    }
  }
  return false;
}