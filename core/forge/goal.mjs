/**
 * selfevopi-forge-goal — condição de conclusão (goal) do loop evolutivo.
 *
 * Sem dependências. Determinístico. Não chama modelo, não escreve arquivo.
 *
 * O que é (pesquisa: Claude Code e Codex têm `/goal`):
 *  - define uma **condição de conclusão** que atravessa turnos;
 *  - um **avaliador separado** checa após cada turno — não é o modelo que executou;
 *  - limpa sozinho quando a condição vale, quando é julgada impossível, ou quando
 *    um turno falha por erro que o usuário precisa corrigir;
 *  - indicador de estado (`◎ /goal active`);
 *  - objetivo e modo são ortogonais — "a goal doesn't change your permission mode".
 *
 * O estado é um objeto simples que o **chamador persiste** (o módulo não escreve
 * arquivo). O formato:
 *
 *   { goal: { condition, setAt } | null }
 *
 * A avaliação é **puramente heurística e determinística**: casa a condição contra
 * o texto do último turno, normaliza, e devolve `done | impossible | pending` com o
 * motivo. Se o desenho pedir avaliação semântica, passe `deps.judge` — o default é
 * heurístico e nunca chama modelo.
 */

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

/** Marcador de impossibilidade: a condição é declarada impossível de satisfazer. */
const IMPOSSIBLE_MARKERS = [
  "impossivel",
  "nao e possivel",
  "cannot be done",
  "impossible",
  "can't be done",
  "nao pode ser feito",
  "desistir",
  "give up",
];

/** Marcador de falha de turno que exige correção do usuário. */
const FAILURE_MARKERS = [
  "erro",
  "falhou",
  "failed",
  "nao foi possivel concluir",
  "preciso que voce",
  "preciso de",
  "aguardando",
  "waiting for",
];

/**
 * Marcador de conclusão no turno: o agente sinaliza que terminou.
 * Usado em conjunto com a cobertura (ver DONE_COVERAGE_MIN).
 */
const DONE_MARKERS = [
  "pronto",
  "concluido",
  "feito",
  "terminei",
  "finalizado",
  "completei",
  "entregue",
  "done",
  "completed",
  "finished",
  "that's done",
];

/**
 * Limiar de cobertura quando há marcador de conclusão no turno (0..1).
 * Justificativa: uma frase de conclusão natural reformula em vez de repetir a
 * condição, então exige-se pouca sobreposição — só o suficiente para garantir que
 * o turno fala do tema da condição, não de outra coisa.
 */
export const DONE_COVERAGE_MIN = 0.3;

/**
 * Limiar de cobertura que fecha a goal sozinho, sem marcador (0..1).
 * Justificativa: se o turno cobre quase toda a condição, é conclusão por
 * evidência direta — reformulação nenhuma esconde isso.
 */
export const DONE_COVERAGE_STRONG = 0.8;

/** Normaliza texto: minúsculo, sem acento, espaços colapsados. */
function normalize(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Extrai tokens de uma string (palavras com 2+ chars). */
function tokens(text) {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

/**
 * Reduz uma palavra a um radical leve (stem) determinístico. Não é um stemmer
 * linguístico completo — é um corte de sufixos comuns do português/inglês, só
 * para casar flexões ("resolver"/"resolvido", "testes"/"testar") sem chamar modelo.
 */
function stem(word) {
  let w = word;
  // sufixos de flexão/derivação comuns (ordem: mais longos primeiro)
  const suffixes = [
    "ando", "endo", "indo", "ado", "ido", "ados", "idos",
    "ar", "er", "ir", "ou", "ei", "ia", "ao",
    "ando", "endo", "indo",
    "ado", "ido", "ados", "idos",
    "es", "s", "m", "n",
  ];
  for (const suf of suffixes) {
    if (w.length - suf.length >= 4 && w.endsWith(suf)) {
      w = w.slice(0, w.length - suf.length);
      break;
    }
  }
  return w;
}

/** Cobertura por radical: fração dos radicais da condição presentes no turno. */
function coverage(condition, turnText) {
  const condStems = new Set(tokens(condition).map(stem));
  if (condStems.size === 0) return 0;
  const turnStems = new Set(tokens(turnText).map(stem));
  let hit = 0;
  for (const s of condStems) if (turnStems.has(s)) hit++;
  return hit / condStems.size;
}

/* ------------------------------------------------------------------ */
/* setGoal / clearGoal                                                 */
/* ------------------------------------------------------------------ */

/**
 * Define (ou substitui) a condição de conclusão.
 *
 * @param {object} state  estado atual (pode ser `{}`)
 * @param {string} condition  condição de conclusão em linguagem natural
 * @param {{ at?: string }} [opts]
 * @returns {object} novo estado (não muta o anterior)
 */
export function setGoal(state, condition, { at = new Date().toISOString() } = {}) {
  const clean = String(condition ?? "").trim();
  if (clean === "") throw new Error("forge-goal: condição não pode ser vazia");
  return {
    ...(state && typeof state === "object" ? state : {}),
    goal: { condition: clean, setAt: at },
  };
}

/**
 * Limpa a condição de conclusão.
 *
 * @param {object} state
 * @returns {object} novo estado (não muta o anterior)
 */
export function clearGoal(state) {
  return {
    ...(state && typeof state === "object" ? state : {}),
    goal: null,
  };
}

/* ------------------------------------------------------------------ */
/* evaluateGoal                                                        */
/* ------------------------------------------------------------------ */

/**
 * Avalia a condição contra o texto do último turno. Heurístico e determinístico.
 *
 * Decisão (em ordem):
 *   1. sem goal → `done` (nada a fazer);
 *   2. turno com marcador de falha → `impossible` (erro que o usuário precisa corrigir);
 *   3. turno com marcador de impossibilidade → `impossible`;
 *   4. marcador de conclusão E cobertura >= DONE_COVERAGE_MIN (0.3) → `done`;
 *   5. cobertura >= DONE_COVERAGE_STRONG (0.8), com ou sem marcador → `done`;
 *   6. senão → `pending`.
 *
 * Se `deps.judge` for passado, ele tem a palavra final: recebe
 * `{ condition, lastTurn }` e devolve `{ done, impossible, reason }`. O default é a
 * heurística acima (nunca chama modelo).
 *
 * @param {object} state
 * @param {{ lastTurn?: string }} opts
 * @param {{ judge?: (args: { condition: string, lastTurn: string }) => { done: boolean, impossible: boolean, reason: string } }} [deps]
 * @returns {{ done: boolean, impossible: boolean, reason: string }}
 */
export function evaluateGoal(state, { lastTurn = "" } = {}, deps = {}) {
  const goal = state && typeof state === "object" ? state.goal : null;
  if (!goal || typeof goal.condition !== "string" || goal.condition.trim() === "") {
    return { done: true, impossible: false, reason: "sem goal ativa" };
  }

  const condition = goal.condition;
  const turn = String(lastTurn ?? "");
  const normTurn = normalize(turn);

  // Ponto de extensão: um juiz externo (ex.: LLM) tem a palavra final.
  if (typeof deps.judge === "function") {
    const verdict = deps.judge({ condition, lastTurn: turn });
    if (verdict && typeof verdict === "object") {
      return {
        done: verdict.done === true,
        impossible: verdict.impossible === true,
        reason: String(verdict.reason ?? (verdict.done ? "condição satisfeita" : "pendente")),
      };
    }
  }

  // 1. Turno com marcador de falha que exige correção do usuário.
  for (const marker of FAILURE_MARKERS) {
    if (normTurn.includes(marker)) {
      return {
        done: false,
        impossible: true,
        reason: `turno sinaliza falha que exige correção ("${marker}")`,
      };
    }
  }

  // 2. Turno declara a condição impossível.
  for (const marker of IMPOSSIBLE_MARKERS) {
    if (normTurn.includes(marker)) {
      return {
        done: false,
        impossible: true,
        reason: `condição julgada impossível ("${marker}")`,
      };
    }
  }

  // 3. Cobertura da condição no turno (heurística de satisfação).
  const cov = coverage(condition, turn);
  const hasDoneMarker = DONE_MARKERS.some((m) => normTurn.includes(m));

  // (a) marcador de conclusão + cobertura mínima → done
  if (hasDoneMarker && cov >= DONE_COVERAGE_MIN) {
    return {
      done: true,
      impossible: false,
      reason: `conclusão sinalizada ("${DONE_MARKERS.find((m) => normTurn.includes(m))}") com cobertura ${(cov * 100).toFixed(0)}% >= ${(DONE_COVERAGE_MIN * 100).toFixed(0)}%`,
    };
  }

  // (b) cobertura forte, sem precisar de marcador → done
  if (cov >= DONE_COVERAGE_STRONG) {
    return {
      done: true,
      impossible: false,
      reason: `condição satisfeita (cobertura ${(cov * 100).toFixed(0)}% >= ${(DONE_COVERAGE_STRONG * 100).toFixed(0)}%)`,
    };
  }

  // (c) marcador de conclusão mas cobertura insuficiente → não fecha
  if (hasDoneMarker) {
    return {
      done: false,
      impossible: false,
      reason: `marcador de conclusão presente, mas cobertura ${(cov * 100).toFixed(0)}% < ${(DONE_COVERAGE_MIN * 100).toFixed(0)}%`,
    };
  }

  return {
    done: false,
    impossible: false,
    reason: `pendente (cobertura ${(cov * 100).toFixed(0)}% < ${(DONE_COVERAGE_MIN * 100).toFixed(0)}% com marcador, < ${(DONE_COVERAGE_STRONG * 100).toFixed(0)}% sem marcador)`,
  };
}

/* ------------------------------------------------------------------ */
/* goalIndicator                                                       */
/* ------------------------------------------------------------------ */

/**
 * Indicador de estado da goal, para exibir no prompt/status.
 *
 * @param {object} state
 * @returns {string|null} `"◎ /goal active"` quando há goal, senão `null`
 */
export function goalIndicator(state) {
  const goal = state && typeof state === "object" ? state.goal : null;
  if (!goal || typeof goal.condition !== "string" || goal.condition.trim() === "") {
    return null;
  }
  return "◎ /goal active";
}

export default { setGoal, clearGoal, evaluateGoal, goalIndicator };