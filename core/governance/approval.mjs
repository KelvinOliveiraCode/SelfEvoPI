#!/usr/bin/env node
/**
 * selfevopi-approval — pausa obrigatória para decisão humana.
 *
 * O loop evolutivo é autônomo, mas três pedidos não são dele para decidir:
 * **rede**, **credencial/segredo** e **escrita fora do workspace**. Qualquer um
 * dos três devolve `needsHuman: true` com perguntas objetivas — não um "tem certeza?".
 *
 * Duas fontes, e as duas contam:
 *  - `request`: o que o artefato **pede** (declarado na spec)
 *  - `scan`: o resultado do `static-gate.evaluate(...)` — o que o código **faz**
 *
 *   reviewApproval({ request, scan }) -> { needsHuman, reasons, questions, triggers }
 *
 * Um pedido pode declarar nada e o scan revelar tudo; por isso o scan nunca é
 * opcional na prática. `request` vazia ou ausente é tratada como "nada declarado".
 */

import { RULES } from "../sandbox/static-gate.mjs";

export const TRIGGERS = Object.freeze({
  NETWORK: "network",
  CREDENTIALS: "credentials",
  WRITE_OUTSIDE: "write-outside-workspace",
  GATE_BLOCK: "gate-block",
});

/** Regras do gate que significam cada gatilho. */
const RULES_BY_TRIGGER = Object.freeze({
  [TRIGGERS.NETWORK]: ["network-access"],
  [TRIGGERS.CREDENTIALS]: [
    "credential-store",
    "secret-env-read",
    "ssh-access",
    "userprofile-config",
    "embedded-secret",
  ],
  [TRIGGERS.WRITE_OUTSIDE]: ["outside-workspace-path"],
});

/** Perguntas por gatilho: curtas, objetivas, específicas. */
const QUESTIONS = Object.freeze({
  [TRIGGERS.NETWORK]: [
    "Qual domínio ou serviço este artefato precisa acessar?",
    "A chamada pode ser feita offline, contra um arquivo ou fixture local?",
  ],
  [TRIGGERS.CREDENTIALS]: [
    "Quais credenciais ele precisa e de qual serviço ou repositório?",
    "O acesso pode ser feito por um token de escopo mínimo, com validade curta?",
  ],
  [TRIGGERS.WRITE_OUTSIDE]: [
    "Qual caminho fora do workspace precisa ser escrito, e por quê?",
    "O artefato pode escrever dentro do workspace e copiar o resultado depois?",
  ],
  [TRIGGERS.GATE_BLOCK]: [
    "Qual regra do gate é falso positivo aqui, e qual trecho do código justifica liberar?",
    "Se a regra estiver certa, o artefato deve ser reescrito em vez de aprovado?",
  ],
});

/* ------------------------------------------------------------------ */
/* Leitura do request                                                  */
/* ------------------------------------------------------------------ */

function declared(request, names) {
  if (!request || typeof request !== "object") return false;
  for (const name of names) {
    const value = request[name];
    if (value === true) return true;
    if (typeof value === "string" && /^(true|yes|required|sim)$/i.test(value.trim())) return true;
    if (Array.isArray(value) && value.length > 0) return true;
    if (value && typeof value === "object" && Object.keys(value).length > 0) return true;
  }
  return false;
}

/** O que o pedido declara, em três famílias. */
function fromRequest(request) {
  const found = new Set();
  if (declared(request, ["network", "requiresNetwork", "networkAccess", "internet"])) {
    found.add(TRIGGERS.NETWORK);
  }
  if (
    declared(request, ["credentials", "secrets", "requiresCredentials", "credentialAccess", "tokens", "envSecrets"])
  ) {
    found.add(TRIGGERS.CREDENTIALS);
  }
  if (
    declared(request, ["writesOutside", "writeOutsideWorkspace", "writesOutsideWorktree", "outsideWorkspace"]) ||
    request?.access?.write === "outside" ||
    request?.fs?.write === "outside"
  ) {
    found.add(TRIGGERS.WRITE_OUTSIDE);
  }
  return found;
}

/* ------------------------------------------------------------------ */
/* Leitura do scan                                                     */
/* ------------------------------------------------------------------ */

/** O que o scan do gate revela, pelas regras que pesaram. */
function fromScan(scan) {
  const found = new Set();
  if (!scan || typeof scan !== "object") {
    return { triggers: found, blocking: [], warnings: [], violations: [], unexplained: [] };
  }

  const blocking = Array.isArray(scan.blockingRules) ? scan.blockingRules : [];
  const warnings = Array.isArray(scan.warningRules) ? scan.warningRules : [];
  const violations = Array.isArray(scan.violations) ? scan.violations : [];

  for (const [trigger, rules] of Object.entries(RULES_BY_TRIGGER)) {
    if (rules.some((rule) => blocking.includes(rule) || warnings.includes(rule))) {
      found.add(trigger);
    }
  }

  // `recursive-force-delete` bloqueia quando o alvo está fora do workspace e
  // só avisa quando está dentro; nos dois casos é remoção de árvore.
  if (blocking.includes("recursive-force-delete")) found.add(TRIGGERS.WRITE_OUTSIDE);

  // `gate-block` só entra quando o bloqueio tem regra que nenhum outro gatilho explica.
  // Sem isso, um fetch que já pede rede apareceria duas vezes.
  const covered = new Set(Object.values(RULES_BY_TRIGGER).flat());
  covered.add("recursive-force-delete");
  const unexplained = blocking.filter((rule) => !covered.has(rule));
  if ((scan.decision === "block" || scan.blocked === true) && unexplained.length > 0) {
    found.add(TRIGGERS.GATE_BLOCK);
  }

  return { triggers: found, blocking, warnings, violations, unexplained };
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

/**
 * @param {object} opts
 * @param {object} [opts.request] pedido/artefato (spec, mode, access…)
 * @param {object} [opts.scan]    resultado de static-gate.evaluate(code)
 * @returns {{needsHuman: boolean, reasons: string[], questions: string[], triggers: string[]}}
 */
export function reviewApproval({ request = null, scan = null } = {}) {
  const declaredTriggers = fromRequest(request);
  const scanInfo = fromScan(scan);

  const triggers = new Set([...declaredTriggers, ...scanInfo.triggers]);
  const reasons = [];

  // ordem fixa: pedido declarado primeiro, depois o que o scan revelou
  for (const trigger of [
    TRIGGERS.NETWORK,
    TRIGGERS.CREDENTIALS,
    TRIGGERS.WRITE_OUTSIDE,
    TRIGGERS.GATE_BLOCK,
  ]) {
    if (declaredTriggers.has(trigger)) {
      reasons.push(`${trigger}: o pedido declara ${labelOf(trigger)}`);
    }
    if (scanInfo.triggers.has(trigger) && !declaredTriggers.has(trigger)) {
      reasons.push(`${trigger}: o scan aponta ${scanEvidence(trigger, scanInfo)}`);
    }
  }

  const questions = [];
  for (const trigger of [
    TRIGGERS.NETWORK,
    TRIGGERS.CREDENTIALS,
    TRIGGERS.WRITE_OUTSIDE,
    TRIGGERS.GATE_BLOCK,
  ]) {
    if (!triggers.has(trigger)) continue;
    for (const q of QUESTIONS[trigger]) if (!questions.includes(q)) questions.push(q);
  }

  return {
    needsHuman: triggers.size > 0,
    reasons,
    questions,
    triggers: [...triggers],
  };
}

function labelOf(trigger) {
  switch (trigger) {
    case TRIGGERS.NETWORK:
      return "acesso à rede";
    case TRIGGERS.CREDENTIALS:
      return "acesso a credenciais ou segredos";
    case TRIGGERS.WRITE_OUTSIDE:
      return "escrita fora do workspace";
    default:
      return trigger;
  }
}

/** Evidência curta: quais regras, em que linha. */
function scanEvidence(trigger, scanInfo) {
  const lines = (scanInfo.violations ?? []).map((v) => `${v.rule}@${v.line}`);

  if (trigger === TRIGGERS.GATE_BLOCK) {
    const regras = scanInfo.unexplained ?? [];
    const comLinha = regras.map((rule) => {
      const hit = (scanInfo.violations ?? []).find((v) => v.rule === rule);
      return hit ? `${rule}@${hit.line}` : rule;
    });
    return comLinha.length > 0 ? comLinha.join(", ") : "bloqueio do gate";
  }

  const relevant = lines.filter((l) => {
    if (trigger === TRIGGERS.NETWORK) return l.startsWith("network-access");
    if (trigger === TRIGGERS.CREDENTIALS) {
      return /^(credential-store|secret-env-read|ssh-access|userprofile-config|embedded-secret)@/.test(l);
    }
    if (trigger === TRIGGERS.WRITE_OUTSIDE) {
      return /^(outside-workspace-path|recursive-force-delete)@/.test(l);
    }
    return false;
  });

  return relevant.length > 0 ? relevant.join(", ") : trigger;
}

/** Todas as regras conhecidas, para quem quiser listar o vocabulário. */
export const RULE_VOCABULARY = RULES.map((r) => r.id);