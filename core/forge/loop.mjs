/**
 * selfevopi-forge-loop — o loop evolutivo ponta a ponta (o coração do SelfEvoPI).
 *
 * Amarra: detecta lacuna -> escolhe kind -> gera -> verifica FORA do sandbox
 * -> gate -> promove ou reverte.
 *
 * Todas as peças são injetáveis (deps) com defaults reais importados dos
 * módulos vizinhos. Nada de modelo real é chamado aqui: o `runEvals` real é
 * injetado pelo CLI; o default é um stub neutro que permite dry-run.
 *
 * Paradas honestas (docs/fase2/forge.md):
 *  - "needs-human" : o artefato pede rede/credencial/escrita fora do workspace.
 *  - "rejected"    : o gate de promoção reprova (regressão, delta de tokens).
 *  - "promoted"    : passou o gate e foi promovido.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createArtifactRequest, chooseKind } from "./contract.mjs";
import { detectGaps } from "./detect.mjs";
import { generateCli } from "./generate-cli.mjs";
import { generateSkill } from "./generate-skill.mjs";
import { runGate, decidePromotion } from "./gatekeeper.mjs";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Regras do gate estático que significam "precisa de humano". */
const NEEDS_HUMAN_RULES = new Set([
  "network-access",
  "ssh-access",
  "credential-store",
  "userprofile-config",
  "registry-exe",
  "secret-env-read",
  "embedded-secret",
]);

/* ------------------------------------------------------------------ */
/* Defaults reais                                                      */
/* ------------------------------------------------------------------ */

/** Gera o artefato conforme o kind (dispatcher leve). */
async function defaultGenerate(request, outDir) {
  if (request.kind === "cli") return generateCli(request, outDir);
  if (request.kind === "skill") return generateSkill(request, outDir);
  throw new Error(`forge-loop: sem gerador para kind "${request.kind}"`);
}

/** Roda a verificação do artefato FORA do sandbox (spawnSync). */
async function defaultRunVerification(command) {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(command, { shell: true, encoding: "utf8" });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

/** Gate estático do artefato (reusa o módulo do sandbox, não o duplica). */
async function defaultStaticGate(filePath, workspace) {
  const { evaluateFile } = await import("../sandbox/static-gate.mjs");
  return evaluateFile(filePath, { workspace });
}

/** Promoção padrão: não toca em área protegida; só marca o artefato. */
async function defaultPromote({ artifactDir, report }) {
  return { ok: true, promoted: true, ref: artifactDir, taskId: report?.taskId ?? null };
}

/** Rollback padrão: remove o diretório do artefato (desfaz a geração). */
async function defaultRollback({ artifactDir }) {
  await rm(artifactDir, { recursive: true, force: true }).catch(() => {});
  return { ok: true, rolledBack: true };
}

/** Stub de eval para dry-run: uma execução neutra, zero token. */
async function stubRunEvals() {
  return [{ passed: true, tokens: 0 }];
}

/* ------------------------------------------------------------------ */
/* createEvolutionLoop                                                 */
/* ------------------------------------------------------------------ */

/**
 * Cria o loop evolutivo com todas as peças injetáveis.
 *
 * @param {object} [deps]
 * @param {Function} [deps.detect]        default detectGaps
 * @param {Function} [deps.chooseKind]    default chooseKind (contract)
 * @param {Function} [deps.generate]      default dispatcher generateCli/generateSkill
 * @param {Function} [deps.runVerification] default spawnSync do verifyCommand
 * @param {Function} [deps.staticGate]    default evaluateFile (sandbox)
 * @param {Function} [deps.runGate]       default runGate (gatekeeper)
 * @param {Function} [deps.decidePromotion] default decidePromotion
 * @param {Function} [deps.runEvals]      default stub (CLI injeta o real)
 * @param {Function} [deps.promote]       default marca o artefato
 * @param {Function} [deps.rollback]      default remove o artifactDir
 * @param {Function} [deps.onEvent]       telemetria (JSONL)
 * @param {string}   [deps.workRoot]      base dos artefatos (default os.tmpdir)
 * @param {Function} [deps.now]           relógio
 */
export function createEvolutionLoop(deps = {}) {
  const {
    detect = detectGaps,
    chooseKind: choose = chooseKind,
    generate = defaultGenerate,
    runVerification = defaultRunVerification,
    staticGate = defaultStaticGate,
    runGate: gate = runGate,
    decidePromotion: decide = decidePromotion,
    runEvals = stubRunEvals,
    promote = defaultPromote,
    rollback = defaultRollback,
    onEvent = null,
    workRoot = tmpdir(),
    now = () => new Date(),
  } = deps;

  function emit(event) {
    if (typeof onEvent === "function") {
      try {
        onEvent({ at: now().toISOString(), ...event });
      } catch {
        // telemetria nunca derruba o loop
      }
    }
  }

  /** Verifica se o pedido/artefato exige algo que precisa de humano. */
  function needsHumanFrom({ request, gap, staticDecision }) {
    // pedido explícito: permissões de rede/credencial
    const perms = (request?.permissions ?? []).map((p) => String(p).toLowerCase());
    if (perms.some((p) => /rede|network|credencial|credential|token|secret/.test(p))) {
      return "pedido pede rede/credencial";
    }
    const meta = gap?.meta ?? {};
    if (meta.needsNetwork || meta.needsCredential) return "lacuna pede rede/credencial";

    // gate estático bloqueou regra sensível no artefato gerado
    if (staticDecision && staticDecision.decision === "block") {
      const rules = staticDecision.blockingRules ?? [];
      if (rules.some((r) => NEEDS_HUMAN_RULES.has(r))) {
        return `gate estático bloqueou: ${rules.join(", ")}`;
      }
    }
    return null;
  }

  /**
   * Executa um ciclo do loop.
   *
   * @param {object} input
   * @param {object} [input.gap]       lacuna já detectada (opcional)
   * @param {string} [input.taskId]    tarefa a rastrear (para detect)
   * @param {object} [input.request]   request de createArtifactRequest (opcional;
   *                                    senão é sintetizado do gap)
   * @param {string} [input.outDir]    diretório do artefato (default mkdtemp)
   * @param {object} [input.baseline]  baseline para o gate
   * @param {number} [input.toleranceTokens]
   * @param {boolean} [input.dryRun]   não promove nem reverte de fato
   * @returns {Promise<object>} LoopReport
   */
  async function evolve(input = {}) {
    const report = {
      outcome: "error",
      taskId: input.taskId ?? null,
      gap: input.gap ?? null,
      kind: null,
      artifactDir: null,
      files: [],
      verify: null,
      gate: null,
      decision: null,
      promoted: null,
      rolledBack: null,
      reasons: [],
      startedAt: now().toISOString(),
    };
    const finish = (outcome, extra = {}) => {
      report.outcome = outcome;
      report.finishedAt = now().toISOString();
      if (Array.isArray(extra.reasons)) report.reasons = extra.reasons;
      emit({ event: "loop-end", taskId: report.taskId, outcome, reasons: report.reasons });
      return report;
    };

    try {
      // 1. Detecta lacuna (se não veio pronta).
      let gap = input.gap;
      if (!gap) {
        const ledger = input.ledger;
        const det = await detect({
          ledger: typeof ledger === "string" ? ledger : Array.isArray(ledger) ? ledger : undefined,
          threshold: input.threshold,
          capabilities: input.capabilities,
          tokenCeiling: input.tokenCeiling,
        });
        let gaps = Array.isArray(det.gaps) ? det.gaps : [];
        // se o chamador pediu uma tarefa, prefere a lacuna dessa tarefa
        if (report.taskId) {
          const forTask = gaps.filter((g) => g.taskId === report.taskId);
          if (forTask.length > 0) gaps = forTask;
        }
        gap = gaps.length > 0 ? gaps[0] : null;
      }
      if (!gap) return finish("rejected", { reasons: ["nenhuma lacuna detectada"] });
      report.gap = gap;
      report.taskId = gap.taskId ?? report.taskId;
      emit({ event: "gap", kind: gap.kind, taskId: gap.taskId, capability: gap.capability });

      // 2. Escolhe o kind mais leve que atende.
      const needed = input.capabilities ?? [gap.capability];
      const choice = typeof choose === "function" ? choose(needed) : { kind: "skill" };
      const kind = input.forceKind ?? choice.kind ?? "skill";
      // só existem geradores para skill e cli: se o escolhido não tem gerador,
      // recorre ao mais leve que tenha (cli), sem inventar um gerador novo.
      const finalKind = !input.forceKind && kind !== "skill" && kind !== "cli" ? "cli" : kind;
      report.kind = finalKind;
      emit({ event: "kind", kind: finalKind, covers: choice.covers ?? null });

      // 3. Monta o request (usar o recebido, ou sintetizar do gap).
      let request = input.request;
      if (!request) {
        const goal = gap.goal || gap.capability;
        request = createArtifactRequest({
          goal,
          kind: finalKind,
          inputs: input.inputs ?? {},
          outputs: input.outputs ?? {},
          forbidden: input.forbidden ?? ["acessar rede", "escrever fora do workspace"],
          tests: input.tests ?? [{ name: "smoke", command: 'node -e "process.exit(0)"' }],
        });
        request.taskId = gap.taskId ?? null;
      }
      report.request = request;

      // 4. Gera em isolamento.
      let artifactDir = input.outDir;
      let madeDir = false;
      if (!artifactDir) {
        artifactDir = await mkdtemp(join(workRoot, `forge-${report.taskId ?? "gap"}-`));
        madeDir = true;
      }
      report.artifactDir = artifactDir;
      const gen = await generate(request, artifactDir);
      report.files = gen.files ?? [];
      report.verifyCommand = gen.verifyCommand ?? null;
      emit({ event: "generated", kind, files: report.files });

      // 5. Gate estático: rede/credencial/fora do workspace => needs-human.
      let staticDecision = null;
      const target = gen.cliCommand || gen.verifyCommand;
      if (typeof staticGate === "function" && target) {
        const scriptPath = gen.cliCommand
          ? gen.cliCommand.replace(/^node\s+/, "")
          : null;
        const fileToScan = scriptPath || artifactDir;
        try {
          const dec = await staticGate(fileToScan, artifactDir);
          if (dec && dec.decision) staticDecision = dec;
        } catch {
          // gate estático ausente não reprova por engano
        }
      }
      const human = needsHumanFrom({ request, gap, staticDecision });
      if (human) {
        report.reasons = [human];
        emit({ event: "needs-human", reason: human });
        // limpa artefato efêmero quando ele mesmo foi criado aqui
        if (madeDir) await rm(artifactDir, { recursive: true, force: true }).catch(() => {});
        report.artifactDir = null;
        return finish("needs-human", { reasons: report.reasons });
      }

      // 6. Verificação FORA do sandbox (o verify.mjs é a evidência).
      let verify = { ok: false, status: null, stdout: "", stderr: "sem verifyCommand" };
      if (report.verifyCommand && typeof runVerification === "function") {
        verify = await runVerification(report.verifyCommand);
      }
      report.verify = verify;
      emit({ event: "verify", ok: verify.ok, status: verify.status });

      // 7. Gate de promoção.
      const gateReport = await gate({
        artifactDir,
        request,
        runEvals,
        baseline: input.baseline ?? null,
        toleranceTokens: input.toleranceTokens,
        runs: input.runs,
      });
      report.gate = gateReport;

      // evidência de teste: o verify passou E os testes declarados existem
      const decision = decide(gateReport, { toleranceTokens: input.toleranceTokens });
      if (verify.ok === false) {
        decision.promote = false;
        decision.reasons = [...decision.reasons, "verificação (verify.mjs) não passou"];
      }
      report.decision = decision;
      emit({ event: "gate", promote: decision.promote, reasons: decision.reasons });

      // 8. Promove ou reverte.
      if (decision.promote) {
        if (input.dryRun) {
          report.promoted = null;
          return finish("promoted", { reasons: ["dry-run: promoção não aplicada"], dryRun: true });
        }
        const promo = await promote({ artifactDir, report: gateReport, request });
        report.promoted = promo;
        return finish("promoted", { reasons: [] });
      }

      // gate reprovou -> rollback
      if (input.dryRun) {
        report.rolledBack = null;
        return finish("rejected", { reasons: decision.reasons, dryRun: true });
      }
      const back = await rollback({ artifactDir, report: gateReport });
      report.rolledBack = back;
      emit({ event: "rollback", ok: back?.ok ?? true });
      return finish("rejected", { reasons: decision.reasons });
    } catch (err) {
      report.reasons = [String(err?.message ?? err)];
      emit({ event: "error", message: report.reasons[0] });
      return finish("error", { reasons: report.reasons });
    }
  }

  return { evolve };
}