/**
 * selfevopi-forge-contract — contrato de artefato do Núcleo Evolutivo (Forge).
 *
 * Sem dependencias. Determinístico. Não gera código nem executa sandbox
 * (isso é A6 / fase posterior): aqui só se define o que o loop evolutivo
 * pede, valida e promove.
 *
 * Modelo mental (docs/research/inspiracoes.md §2.4, §2.5):
 *  - Octopus-SI-OS: "capacidades são contratos", não add-ons.
 *  - Voyager: skill library executável, só promovida após passar no verifier.
 *
 * Este módulo é a espinha desse modelo: um artefato é um contrato que
 * declara entradas, saídas, permissões e proibições, e só é promovido
 * quando um resultado traz evidência de teste e respeita as restrições.
 */

/* ------------------------------------------------------------------ */
/* Kinds — do mais leve ao mais pesado                                   */
/* ------------------------------------------------------------------ */

/**
 * Ordem de preferência: mcp-config < skill < cli < extension < mcp-server.
 * Prefira sempre o kind mais leve que atenda (ver `chooseKind`).
 */
export const ARTIFACT_KINDS = ["mcp-config", "skill", "cli", "extension", "mcp-server"];

/** Índice de leveza: menor = mais leve. Usado na ordenação do chooseKind. */
export const KIND_ORDER = new Map(ARTIFACT_KINDS.map((k, i) => [k, i]));

/** Capacidades que cada kind entrega por natureza. Um kind "atende" se cobre o pedido. */
const KIND_CAPABILITIES = {
  "mcp-config": ["config", "mcp"],
  skill: ["skill", "procedure", "knowledge", "config", "mcp"],
  cli: ["cli", "automation", "skill", "procedure", "config", "mcp"],
  extension: ["extension", "ui", "automation", "cli", "skill", "procedure", "config", "mcp"],
  "mcp-server": ["server", "mcp", "automation", "cli", "extension", "skill", "procedure", "config"],
};

/* ------------------------------------------------------------------ */
/* Helpers de validação                                                  */
/* ------------------------------------------------------------------ */

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fail(msg) {
  throw new Error(`forge-contract: ${msg}`);
}

/** Normaliza uma lista de strings de um campo, ou null se ausente. */
function normalizeList(value, field, { nonEmpty = false } = {}) {
  if (value === undefined || value === null) {
    if (nonEmpty) fail(`"${field}" é obrigatório e não pode ser vazio`);
    return [];
  }
  if (!Array.isArray(value)) fail(`"${field}" deve ser um array de strings`);
  const out = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      fail(`"${field}" contém item que não é string não-vazia`);
    }
    out.push(item.trim());
  }
  if (nonEmpty && out.length === 0) fail(`"${field}" é obrigatório e não pode ser vazio`);
  return out;
}

/** Normaliza um mapa string->string (inputs/outputs), ou null se ausente. */
function normalizeStringMap(value, field) {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) fail(`"${field}" deve ser um objeto { nome: descrição }`);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k.trim() === "") fail(`"${field}" tem chave vazia`);
    if (typeof v !== "string") fail(`"${field}.${k}" deve ser string (descrição)`);
    out[k.trim()] = v;
  }
  return out;
}

/** Normaliza um array de objetos de teste. */
function normalizeTests(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail('"tests" deve ser um array de casos de teste');
  const out = [];
  for (let i = 0; i < value.length; i++) {
    const t = value[i];
    if (!isPlainObject(t)) fail(`"tests[${i}]" deve ser um objeto`);
    if (typeof t.name !== "string" || t.name.trim() === "") {
      fail(`"tests[${i}].name" deve ser string não-vazia`);
    }
    if (typeof t.command !== "string" || t.command.trim() === "") {
      fail(`"tests[${i}].command" deve ser string não-vazia (o que será executado)`);
    }
    const expect = t.expect;
    if (expect !== undefined && expect !== null && typeof expect !== "string") {
      fail(`"tests[${i}].expect" deve ser string quando presente`);
    }
    out.push({ name: t.name.trim(), command: t.command.trim(), expect: expect ?? null });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* createArtifactRequest                                                 */
/* ------------------------------------------------------------------ */

/**
 * Cria e valida um pedido de artefato. Normaliza todos os campos.
 *
 * @param {object} req
 * @param {string} req.goal        objetivo do artefato (obrigatório)
 * @param {string} req.kind        um de ARTIFACT_KINDS (obrigatório)
 * @param {object} [req.inputs]    { nome: descrição } de entradas
 * @param {object} [req.outputs]   { nome: descrição } de saídas
 * @param {string[]} [req.permissions] o que o artefato PODE fazer
 * @param {string[]} req.forbidden o que o artefato NÃO pode fazer (obrigatório, não-vazio)
 * @param {object[]} [req.tests]   casos de teste [{ name, command, expect? }] (obrigatório, não-vazio)
 * @returns {object} request normalizado
 */
export function createArtifactRequest({ goal, kind, inputs, outputs, permissions, forbidden, tests } = {}) {
  if (typeof goal !== "string" || goal.trim() === "") {
    fail('"goal" é obrigatório e deve ser string não-vazia');
  }
  if (!ARTIFACT_KINDS.includes(kind)) {
    fail(`"kind" inválido "${kind}"; esperado um de: ${ARTIFACT_KINDS.join(", ")}`);
  }

  const norm = {
    goal: goal.trim(),
    kind,
    inputs: normalizeStringMap(inputs, "inputs"),
    outputs: normalizeStringMap(outputs, "outputs"),
    permissions: normalizeList(permissions, "permissions"),
    forbidden: normalizeList(forbidden, "forbidden", { nonEmpty: true }),
    tests: normalizeTests(tests),
  };

  if (norm.tests.length === 0) {
    fail('"tests" é obrigatório e deve trazer ao menos um caso (sem teste não há evidência)');
  }
  return norm;
}

/* ------------------------------------------------------------------ */
/* validateArtifactResult                                                */
/* ------------------------------------------------------------------ */

/**
 * Confere se um resultado de artefato traz evidência de teste e respeitou
 * as proibições. Não executa nada: lê o que o gerador/sandbox devolveu.
 *
 * @param {object} result
 * @param {string} [result.kind]        kind do artefato gerado
 * @param {string} [result.artifactId]  identificador do artefato
 * @param {object[]} [result.tests]     resultados de teste executados
 * @param {string[]} [result.violations] proibições que o artefato infringiu
 * @param {string[]} [result.permissionsUsed] permissões efetivamente usadas
 * @param {object} [request] o pedido que originou o resultado (para conferir kind e forbidden)
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function validateArtifactResult(result, request = null) {
  const reasons = [];
  if (!isPlainObject(result)) {
    return { ok: false, reasons: ["resultado não é um objeto"] };
  }

  // 1. Evidência de teste: precisa haver testes executados, e todos aprovados.
  const tests = Array.isArray(result.tests) ? result.tests : [];
  if (tests.length === 0) {
    reasons.push("sem evidência de teste: nenhum caso executado");
  } else {
    for (let i = 0; i < tests.length; i++) {
      const t = tests[i];
      if (!isPlainObject(t)) {
        reasons.push(`tests[${i}] não é um objeto`);
        continue;
      }
      if (typeof t.name !== "string" || t.name.trim() === "") {
        reasons.push(`tests[${i}] sem nome`);
      }
      if (t.passed !== true) {
        reasons.push(`teste "${t.name ?? `#${i}`}" não passou (passed !== true)`);
      }
    }
  }

  // 2. Proibições respeitadas: nenhuma violação declarada.
  const violations = Array.isArray(result.violations) ? result.violations : [];
  if (violations.length > 0) {
    reasons.push(`proibições infringidas: ${violations.join("; ")}`);
  }

  // 3. Se veio o request, confere kind e cruzamento forbidden/permissions.
  if (request && isPlainObject(request)) {
    if (result.kind && request.kind && result.kind !== request.kind) {
      reasons.push(`kind divergente: pedido=${request.kind}, resultado=${result.kind}`);
    }
    const forbidden = Array.isArray(request.forbidden) ? request.forbidden : [];
    const used = Array.isArray(result.permissionsUsed) ? result.permissionsUsed : [];
    for (const f of forbidden) {
      if (used.includes(f)) reasons.push(`usou algo proibido: ${f}`);
    }
  }

  return { ok: reasons.length === 0, reasons };
}

/* ------------------------------------------------------------------ */
/* chooseKind                                                            */
/* ------------------------------------------------------------------ */

/**
 * Dado um conjunto de capacidades necessárias, escolhe o kind mais leve
 * que as atende — e comprovadamente prefere config/MCP existente antes de
 * criar servidor novo.
 *
 * @param {string[]|string} candidates capacidades necessárias
 * @returns {{ kind: string, covers: string[], missing: string[], ranked: Array<{kind, covers, missing}> }}
 */
export function chooseKind(candidates) {
  const need = (Array.isArray(candidates) ? candidates : [candidates])
    .filter((c) => typeof c === "string" && c.trim() !== "")
    .map((c) => c.trim());

  const ranked = ARTIFACT_KINDS.map((kind) => {
    const caps = KIND_CAPABILITIES[kind] ?? [];
    const covers = need.filter((n) => caps.includes(n));
    const missing = need.filter((n) => !caps.includes(n));
    return { kind, covers, missing };
  });

  // Mais leve que atende tudo; se nenhum cobre tudo, o mais leve que cobre o máximo
  // (menos faltas, depois mais leve).
  ranked.sort((a, b) => {
    const aFull = a.missing.length === 0;
    const bFull = b.missing.length === 0;
    if (aFull !== bFull) return aFull ? -1 : 1;
    if (a.missing.length !== b.missing.length) return a.missing.length - b.missing.length;
    return KIND_ORDER.get(a.kind) - KIND_ORDER.get(b.kind);
  });

  const best = ranked[0];

  // Caso degenerado: nenhuma capacidade casa com nada. Escolher "o mais leve"
  // aqui produziria um `mcp-config` para um pedido que não fala de MCP nenhum.
  // Quando não há cobertura, o artefato honesto é a skill — a única que sempre
  // pode ser produzida sem inventar interface.
  if (best.covers.length === 0) {
    const skill = ranked.find((r) => r.kind === "skill");
    return {
      kind: "skill",
      covers: [],
      missing: need,
      ranked: ranked.map((r) => ({ kind: r.kind, covers: r.covers, missing: r.missing })),
      fallback: true,
      note: "nenhuma capacidade reconhecida; usando skill (sempre produzível)",
      skill,
    };
  }

  return {
    kind: best.kind,
    covers: best.covers,
    missing: best.missing,
    ranked: ranked.map((r) => ({ kind: r.kind, covers: r.covers, missing: r.missing })),
  };
}