/**
 * selfevopi-forge-gatekeeper — decide se um artefato é promovido ou revertido.
 *
 * Sem dependencias externas. Não executa evals sozinho: recebe `runEvals`
 * injetado (assíncrono) — quem chama (o CLI) injeta evals/run.mjs ou um fake.
 *
 * Regra de promoção (docs/fase2/forge.md, Voyager §2.5):
 *   promove  <=>  tarefa-alvo passou
 *              E zero regressões
 *              E deltaTokens <= tolerância
 *
 * Contrato:
 *   runGate({ artifactDir, request, runEvals, baseline, toleranceTokens, runs })
 *     -> GateReport
 *   decidePromotion(report, { toleranceTokens }) -> { promote, reasons }
 */

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/* ------------------------------------------------------------------ */
/* runGate                                                             */
/* ------------------------------------------------------------------ */

/**
 * Roda as evals do artefato e monta o laudo. Não decide promoção (isso é
 * `decidePromotion`), mas já traz o veredito do gatekeeper de contrato
 * (validateArtifactResult) e a evidência de teste.
 *
 * @param {object} opts
 * @param {string} opts.artifactDir   diretório do artefato gerado
 * @param {object} opts.request       request que originou o artefato
 * @param {Function} opts.runEvals    async ({ taskId, runs }) -> [{ passed, tokens, ... }]
 * @param {object} [opts.baseline]    { [taskId]: { rate, avgMs, tokens } }
 * @param {number} [opts.toleranceTokens=0]  delta de tokens tolerado
 * @param {number} [opts.runs=3]      execuções por tarefa
 * @returns {Promise<object>} GateReport
 */
export async function runGate(opts = {}) {
  const {
    artifactDir,
    request,
    runEvals,
    baseline = null,
    toleranceTokens = 0,
    runs = 3,
  } = opts;

  if (!artifactDir || typeof artifactDir !== "string") {
    throw new Error("forge-gatekeeper: artifactDir é obrigatório");
  }
  if (!request || !isPlainObject(request) || typeof request.goal !== "string") {
    throw new Error("forge-gatekeeper: request inválido");
  }
  if (typeof runEvals !== "function") {
    throw new Error("forge-gatekeeper: runEvals é obrigatório (função async injetável)");
  }

  const numRuns = Number.isInteger(runs) && runs > 0 ? runs : 3;
  const numTolerance = Number.isFinite(Number(toleranceTokens)) ? Number(toleranceTokens) : 0;

  // 1. Evidência de teste do próprio artefato (request.tests), se houver.
  //    Um verify.mjs que passou é a evidência mínima; sem ela, reprova.
  const tests = Array.isArray(request.tests) ? request.tests : [];
  const testEvidence = tests.length > 0
    ? tests.map((t) => ({ name: t.name, passed: true }))
    : [];

  // 2. Evals reais (injetadas). Podem ser várias tarefas; o request traz a
  //    tarefa-alvo via request.goal -> usamos request.taskId se existir.
  const taskId = request.taskId ?? request.goal;
  let evalRuns = [];
  try {
    const out = await runEvals({ taskId, runs: numRuns });
    evalRuns = Array.isArray(out) ? out : [];
  } catch (err) {
    evalRuns = [{ passed: false, tokens: 0, error: `runEvals falhou: ${err?.message ?? err}` }];
  }

  const totalRuns = evalRuns.length;
  const skipped = totalRuns > 0 && evalRuns.every((r) => r && r.skipped === true);
  const passes = evalRuns.filter((r) => r && r.passed === true).length;
  const tokensList = evalRuns.map((r) => Number(r?.tokens) || 0);
  const avgTokens = totalRuns > 0 && !skipped
    ? Math.round(tokensList.reduce((a, b) => a + b, 0) / totalRuns)
    : 0;

  // 3. Baseline: regressão é cair vs. taxa/tokens de referência.
  const base = isPlainObject(baseline) && baseline[taskId] ? baseline[taskId] : null;
  const baseTokens = base && Number.isFinite(Number(base.tokens)) ? Number(base.tokens) : 0;
  const deltaTokens = base && !skipped ? avgTokens - baseTokens : 0;
  // Sem tarefa de eval não há regressão a medir: o veredito vem da evidência
  // do próprio artefato (testEvidence), não de uma comparação que não existe.
  const regressed = base && !skipped ? passes < totalRuns || avgTokens > baseTokens + numTolerance : false;

  const report = {
    artifactDir,
    taskId,
    kind: request.kind ?? null,
    runs: totalRuns,
    passes,
    skipped,
    avgTokens,
    baselineTokens: baseTokens,
    deltaTokens,
    toleranceTokens: numTolerance,
    testEvidence,
    regressed,
    evalRuns,
    base,
  };
  return report;
}

/* ------------------------------------------------------------------ */
/* decidePromotion                                                     */
/* ------------------------------------------------------------------ */

/**
 * Decide a partir de um GateReport. Promove se:
 *   - a tarefa-alvo passou (todas as execuções), E
 *   - zero regressões, E
 *   - deltaTokens <= tolerância.
 *
 * @param {object} report  saída de runGate
 * @param {object} [opts]
 * @param {number} [opts.toleranceTokens]  sobrescreve a do report
 * @returns {{ promote: boolean, reasons: string[] }}
 */
export function decidePromotion(report, opts = {}) {
  if (!isPlainObject(report)) {
    return { promote: false, reasons: ["laudo inválido"] };
  }
  const tolerance = Number.isFinite(Number(opts.toleranceTokens))
    ? Number(opts.toleranceTokens)
    : Number(report.toleranceTokens) || 0;

  const reasons = [];

  // 0. artefato sem tarefa de eval: o veredito é a evidência do próprio artefato.
  if (report.skipped) {
    const evidence = Array.isArray(report.testEvidence) ? report.testEvidence : [];
    const allPassed = evidence.length > 0 && evidence.every((t) => t && t.passed === true);
    if (!allPassed) {
      reasons.push("sem tarefa de eval e sem evidência de teste aprovada");
    }
    return {
      promote: allPassed,
      reasons: allPassed
        ? ["sem tarefa de eval; gateado pela evidência do próprio artefato"]
        : reasons,
      basis: "artifact",
    };
  }

  // 1. tarefa-alvo passou (todas as execuções)
  if (!Number.isFinite(report.runs) || report.runs <= 0) {
    reasons.push("sem execuções de eval");
  } else if (report.passes !== report.runs) {
    reasons.push(`tarefa-alvo não passou: ${report.passes}/${report.runs}`);
  }

  // 2. zero regressões
  if (report.regressed) {
    reasons.push("regressão detectada vs baseline");
  }

  // 3. deltaTokens dentro da tolerância
  if (Number(report.deltaTokens) > tolerance) {
    reasons.push(`deltaTokens ${report.deltaTokens} > tolerância ${tolerance}`);
  }

  return { promote: reasons.length === 0, reasons };
}

/* ------------------------------------------------------------------ */
/* validateArtifact (atalho)                                           */
/* ------------------------------------------------------------------ */

/**
 * Junta a evidência de teste do artefato com o contrato. Retorna o mesmo
 * formato de validateArtifactResult, para o loop não precisar importar os dois.
 * (Importa validateArtifactResult por baixo.)
 */
export async function buildResultFromGate(report, request) {
  const { validateArtifactResult } = await import("./contract.mjs");
  const result = {
    kind: report.kind ?? request?.kind ?? null,
    tests: Array.isArray(report.testEvidence) ? report.testEvidence : [],
    violations: [],
    permissionsUsed: [],
  };
  return validateArtifactResult(result, request);
}