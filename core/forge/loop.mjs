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
import { createGap, detectGaps } from "./detect.mjs";
import { generateCli } from "./generate-cli.mjs";
import { generateSkill } from "./generate-skill.mjs";
import { specifyGap } from "./specify.mjs";
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

/** Gera o artefato conforme o kind (dispatcher por módulo). */
async function defaultGenerate(request, outDir) {
  const spec = GENERATOR_BY_KIND[request.kind];
  if (!spec) {
    throw new Error(
      `forge-loop: sem gerador para kind "${request.kind}" (conhecidos: ${Object.keys(GENERATOR_BY_KIND).join(", ")})`,
    );
  }
  const mod = await import(spec.module).catch((err) => {
    const needsGenerators = Object.entries(GENERATOR_BY_KIND)
      .filter(([, s]) => s.module === spec.module)
      .map(([k]) => k);
    throw new Error(
      `forge-loop: sem gerador para kind "${request.kind}" ` +
        `(${spec.module} ausente: ${err?.message ?? err})`,
    );
  });
  const fn = mod[spec.exportName];
  if (typeof fn !== "function") {
    throw new Error(`forge-loop: ${spec.module} não exporta ${spec.exportName}`);
  }
  return fn(request, outDir);
}

/** Mapa kind -> módulo e exportação do gerador. */
const GENERATOR_BY_KIND = {
  cli: { module: "./generate-cli.mjs", exportName: "generateCli" },
  skill: { module: "./generate-skill.mjs", exportName: "generateSkill" },
  "mcp-config": { module: "./generate-mcp-config.mjs", exportName: "generateMcpConfig" },
  "mcp-server": { module: "./generate-mcp-server.mjs", exportName: "generateMcpServer" },
  extension: { module: "./generate-extension.mjs", exportName: "generateExtension" },
};

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
/* Testes sintetizados                                                 */
/* ------------------------------------------------------------------ */

/**
 * Quando o pedido não traz testes, cria um teste de interface real:
 * roda o CLI com uma amostra de cada entrada declarada e exige que a saída
 * tenha as chaves declaradas.
 *
 * Sem isso, o default era um "smoke test" que sempre passa — e um artefato com
 * uma interface errada (ler args posicionais em vez de `--flag`) era promovido
 * com evidência falsa. O teste de interface é a diferença entre "executou" e
 * "funciona".
 */
export function synthesizeTests(request, { cliPath = "cli.mjs" } = {}) {
  const inputs = Object.keys(request.inputs ?? {});
  const outputs = Object.keys(request.outputs ?? {});

  if (inputs.length === 0) {
    return [{ name: "interface", command: `node ${cliPath}`, expect: null }];
  }

  // Entradas que são caminho de arquivo recebem um fixture real: passar "1"
  // para um `--arquivo` faz um CLI honesto falhar por um motivo irrelevante
  // (arquivo inexistente), e o artefato seria reprovado por azar.
  //
  // O comando usa aspas simples de propósito: ele vai para um shell, e aspas
  // duplas aqui brigariam com as do próprio comando.
  const FILEISH = /(arquivo|file|path|csv|html|json|input|entrada|dir|pasta)/i;
  const fixtures = [];
  const flags = [];

  for (const k of inputs) {
    if (FILEISH.test(k)) {
      const name = `fixture-${k.replace(/[^a-z0-9_-]/gi, "")}.txt`;
      fixtures.push(`require('fs').writeFileSync('${name}','a,b,c\\n1,2,3\\n4,5,6\\n')`);
      flags.push(`--${k} ${name}`);
    } else {
      flags.push(`--${k} 1`);
    }
  }

  // a expect é um regex: exige que TODAS as chaves declaradas apareçam no JSON
  const expect = outputs.length > 0 ? outputs.map((o) => `"${o}"`).join(".*") : null;

  const prelude = fixtures.length > 0 ? `node -e "${fixtures.join("; ")}" && ` : "";
  const command = `${prelude}node ${cliPath} ${flags.join(" ")}`;

  return [
    {
      name: `interface (${inputs.map((k) => `--${k}`).join(" ")})`,
      command,
      expect,
    },
  ];
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
 * @param {Function} [deps.specify]       default specifyGap (SpecWriter da lacuna em contrato)
 * @param {Function} [deps.generate]      default dispatcher por kind
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
    specify = specifyGap,
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
      // Objetivo explícito (--goal) sintetiza a lacuna na hora: é o caminho do
      // "gere um artefato para isto" sem depender de uma falha no ledger.
      if (!gap && typeof input.goal === "string" && input.goal.trim() !== "") {
        const slug = input.goal
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 40) || "objetivo";
        gap = createGap({
          kind: "tool-missing",
          taskId: input.taskId ?? slug,
          capability: input.goal.trim(),
          goal: input.goal.trim(),
          evidence: ["--goal (pedido explícito do operador)"],
          meta: { source: "cli" },
        });
      }
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

      // 2. Escolhe o kind mais leve que atende — mas só quando o operador deu
      // capacidades estruturadas. Uma lacuna em linguagem de gente não é uma
      // capability: passá-la crua fazia o chooseKind cair no caso degenerado.
      const needed = Array.isArray(input.capabilities) && input.capabilities.length > 0
        ? input.capabilities
        : null;
      const choice = needed && typeof choose === "function" ? choose(needed) : null;
      const kind = input.forceKind ?? choice?.kind ?? "skill";
      report.kind = kind;
      emit({ event: "kind", kind, covers: choice?.covers ?? null, fallback: choice?.fallback ?? false });

      // 3. Especifica (SpecWriter do plano) e monta o request.
      //
      // Duas entradas possíveis:
      //   a) o operador já deu request pronto       -> usa como está
      //   b) temos uma lacuna e o SpecWriter extrai  -> contrato do modelo, com
      //      as opções do operador por cima quando ele as deu
      //
      // O `finalKind` que recaía para cli foi removido: recair para o artefato
      // errado é pior que falhar dizendo que não há gerador.
      let request = input.request;
      if (!request) {
        let base = null;
        if (typeof specify === "function") {
          const spec = await specify({
            gap,
            context: input.context ?? null,
            allowHeuristic: input.allowHeuristic !== false,
          });
          base = spec.request;
          report.spec = { basis: spec.basis, notes: spec.notes ?? [] };
          emit({ event: "spec", basis: spec.basis, kind: base.kind });
        }

        // sobreposições do operador (quando ele foi explícito).
        // A hierarquia de artefatos (chooseKind) ganha do palpite do modelo: o plano
        // manda preferir o mais leve que atenda, e o SpecWriter não sabe disso.
        const opInputs = input.inputs && Object.keys(input.inputs).length > 0 ? input.inputs : base?.inputs;
        const opOutputs = input.outputs && Object.keys(input.outputs).length > 0 ? input.outputs : base?.outputs;
        const opKind = input.forceKind ?? choice?.kind ?? base?.kind ?? "skill";
        const opGoal = gap.goal || gap.capability || base?.goal;

        // Testes: os do operador, os do SpecWriter, ou um teste de interface
        // sintetizado do contrato. Nunca um smoke test vazio.
        //
        // Quando o kind final é diferente do que o SpecWriter propôs, os testes dele
        // não valem: um teste que procura SKILL.md não serve para um cli.mjs.
        const baseKindMatches = base && base.kind === opKind;
        const tests = Array.isArray(input.tests) && input.tests.length > 0
          ? input.tests
          : baseKindMatches && Array.isArray(base?.tests) && base.tests.length > 0
            ? base.tests
            : synthesizeTests({ inputs: opInputs ?? {}, outputs: opOutputs ?? {} });

        request = createArtifactRequest({
          goal: opGoal,
          kind: opKind,
          inputs: opInputs ?? {},
          outputs: opOutputs ?? {},
          forbidden: input.forbidden ?? base?.forbidden ?? ["acessar rede", "escrever fora do workspace"],
          tests,
        });
        request.taskId = gap.taskId ?? null;
      }
      report.request = request;
      report.kind = request.kind ?? report.kind;

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