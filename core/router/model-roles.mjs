/**
 * core/router/model-roles.mjs — papéis de modelo e políticas de seleção.
 *
 * Camada PURA sobre o roteador existente: não faz I/O, não conhece a CLI e não
 * lê config do usuário. O chamador fornece a lista de modelos disponíveis e
 * recebe de volta uma escolha determinística, com cadeia de fallback e
 * cooldown para modelos que falharam.
 *
 * Inspirado no padrão de papéis de harnesses como Oh My Pi, mas sem depender
 * de runtime externo: um papel é só uma política de seleção com nome.
 */

export const ROLES = Object.freeze([
  "default", "smol", "slow", "plan", "commit",
  "advisor", "vision", "task", "tiny",
]);

const POLICIAS = Object.freeze({
  default: { minContext: 32_000, effort: null, preferImage: false, favor: "balanced" },
  smol: { minContext: 8_000, effort: "low", favor: "cheap" },
  slow: { minContext: 200_000, effort: "high", favor: "capable" },
  plan: { minContext: 64_000, effort: "medium", favor: "reasoning" },
  commit: { minContext: 8_000, effort: "low", favor: "cheap" },
  advisor: { minContext: 64_000, effort: "medium", favor: "reasoning", avoidFamily: null },
  vision: { minContext: 32_000, effort: null, preferImage: true, favor: "capable" },
  task: { minContext: 32_000, effort: "medium", favor: "capable" },
  tiny: { minContext: 4_000, effort: "low", favor: "cheap" },
});

function texto(v) {
  return String(v ?? "").trim().toLowerCase();
}

/** Normaliza um nome de papel. Nomes desconhecidos caem em `default`. */
export function normalizeRole(nome) {
  const n = texto(nome);
  return ROLES.includes(n) ? n : "default";
}

/** Política de um papel (cópia rasa, para o chamador não mutar a tabela). */
export function rolePolicy(nome) {
  return { ...POLICIAS[normalizeRole(nome)] };
}

/** Cadeia de fallback de um papel: o próprio papel e depois default. */
export function roleChain(nome, overrides = {}) {
  const role = normalizeRole(nome);
  const extra = Array.isArray(overrides[role]) ? overrides[role].map(normalizeRole) : [];
  return [...new Set([role, ...extra, "default"])];
}

function custo(modelo) {
  const c = modelo?.cost;
  if (Array.isArray(c)) {
    const primeiro = c[0] || {};
    return Number(primeiro.input ?? 0) + Number(primeiro.output ?? 0);
  }
  if (c && typeof c === "object") return Number(c.input ?? 0) + Number(c.output ?? 0);
  return Number(modelo?.price ?? 0);
}

function pontuacao(modelo, politica) {
  const contexto = Number(modelo?.contextWindow ?? modelo?.context ?? 0);
  let nota = 0;
  if (contexto >= (politica.minContext || 0)) nota += 100;
  else nota -= Math.max(10, 100 - (contexto / Math.max(1, politica.minContext)) * 100);
  if (politica.preferImage && Array.isArray(modelo?.input) && modelo.input.includes("image")) nota += 60;
  if (politica.effort && Array.isArray(modelo?.variants) && modelo.variants.includes(politica.effort)) nota += 20;
  const preco = custo(modelo);
  if (politica.favor === "cheap") nota += preco === 0 ? 40 : Math.max(0, 20 - preco * 4);
  if (politica.favor === "capable") nota += Math.min(40, contexto / 25_000);
  if (politica.favor === "reasoning") {
    nota += Number(modelo?.reasoning === true) * 25;
    nota += Math.min(40, contexto / 10_000); // entre dois modelos de raciocínio, o maior contexto vence
  }
  if (politica.favor === "balanced") nota += preco === 0 ? 10 : 5;
  return nota;
}

/**
 * Escolhe o melhor modelo para um papel.
 * @param {string} nome papel
 * @param {object} opts
 * @param {Array<{provider:string,id:string,ref?:string,contextWindow?:number,input?:string[],cost?:any,variants?:string[],reasoning?:boolean,family?:string}>} opts.models
 * @param {string|null} [opts.avoidRef] referência a evitar (ex.: modelo do autor)
 * @param {Cooldown} [opts.cooldown]
 * @returns {{ref:string, provider:string, id:string, role:string, effort:string|null}|null}
 */
export function resolveRole(nome, { models = [], avoidRef = null, avoidFamily = null, cooldown = null } = {}) {
  const role = normalizeRole(nome);
  const politica = rolePolicy(role);
  const familiaEvitada = texto(avoidFamily || politica.avoidFamily);
  const candidatos = (Array.isArray(models) ? models : [])
    .map((m, i) => ({ ...m, ref: m.ref || `${m.provider}/${m.id}`, ordem: i }))
    .filter((m) => m.ref !== avoidRef)
    .filter((m) => !familiaEvitada || texto(m.family) !== familiaEvitada)
    .filter((m) => !cooldown || cooldown.allow(m.ref))
    .sort((a, b) => pontuacao(b, politica) - pontuacao(a, politica) || a.ordem - b.ordem);
  if (!candidatos.length) return null;
  const escolhido = candidatos[0];
  return {
    ref: escolhido.ref,
    provider: escolhido.provider,
    id: escolhido.id,
    role,
    effort: politica.effort,
  };
}

/** Regra de escopo por caminho: `{ path: "apps/", roles: {...} }`. */
export function pathScopedRoles(rules = [], caminho = "") {
  const alvo = String(caminho ?? "").replace(/\\/g, "/");
  let resultado = {};
  for (const regra of Array.isArray(rules) ? rules : []) {
    const prefixo = String(regra?.path ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
    if (prefixo && alvo.startsWith(prefixo)) {
      resultado = { ...resultado, ...(regra.roles || {}) };
    }
  }
  return resultado;
}

/** Cooldown em memória para modelos que falharam (429, quota, conexão). */
export class Cooldown {
  constructor({ durationMs = 60_000, now = () => Date.now() } = {}) {
    this.durationMs = durationMs;
    this.now = now;
    this.ate = new Map();
  }

  failure(ref) {
    this.ate.set(String(ref), this.now());
  }

  allow(ref) {
    const momento = this.ate.get(String(ref));
    if (momento == null) return true;
    return this.now() - momento >= this.durationMs;
  }

  restore(ref) {
    this.ate.delete(String(ref));
  }

  clear() {
    this.ate.clear();
  }

  get size() {
    return this.ate.size;
  }
}

export default { ROLES, normalizeRole, rolePolicy, roleChain, resolveRole, pathScopedRoles, Cooldown };
