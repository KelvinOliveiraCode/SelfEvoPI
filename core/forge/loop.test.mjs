import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEvolutionLoop } from "./loop.mjs";

async function tempDir() {
  return mkdtemp(join(tmpdir(), "forge-loop-"));
}

/* Cenários com peças fake: nada de modelo real, nada de sandbox pesado. */

test("loop: lacuna detectada -> artefato aprovado (promoted)", async () => {
  const out = await tempDir();
  const events = [];
  const loop = createEvolutionLoop({
    runEvals: async () => [{ passed: true, tokens: 10 }, { passed: true, tokens: 10 }],
    onEvent: (e) => events.push(e),
    workRoot: out,
    // verify fake: sempre passa
    runVerification: async () => ({ ok: true, status: 0, stdout: "PASS", stderr: "" }),
    // gate estático fake: libera
    staticGate: async () => ({ decision: "allow" }),
  });

  const report = await loop.evolve({
    ledger: [{ at: "t", taskId: "D1", group: "D", passed: false, tokens: 0 }],
    threshold: 1,
    capabilities: ["cli"],
    toleranceTokens: 0,
  });

  assert.equal(report.outcome, "promoted");
  assert.equal(report.gap.taskId, "D1");
  assert.equal(report.kind, "cli");
  assert.deepEqual(report.files, ["cli.mjs", "README.md", "verify.mjs"]);
  assert.equal(report.verify.ok, true);
  assert.equal(report.decision.promote, true);
  assert.ok(events.some((e) => e.event === "gap"));
  assert.ok(events.some((e) => e.event === "generated"));
  await rm(out, { recursive: true, force: true });
});

test("loop: artefato reprovado por regressão (rejected) e rollback chamado", async () => {
  const out = await tempDir();
  let rollbackCalled = false;
  const loop = createEvolutionLoop({
    runEvals: async () => [{ passed: true, tokens: 900 }], // acima do baseline
    workRoot: out,
    runVerification: async () => ({ ok: true, status: 0 }),
    staticGate: async () => ({ decision: "allow" }),
    rollback: async ({ artifactDir }) => {
      rollbackCalled = true;
      await rm(artifactDir, { recursive: true, force: true }).catch(() => {});
      return { ok: true, rolledBack: true };
    },
  });

  const report = await loop.evolve({
    gap: { kind: "tool-fragile", taskId: "D2", capability: "cli leve" },
    request: {
      goal: "cli leve", kind: "cli", taskId: "D2",
      inputs: {}, outputs: {}, permissions: [], forbidden: ["acessar rede"],
      tests: [{ name: "smoke", command: 'node -e "process.exit(0)"', expect: null }],
    },
    baseline: { D2: { tokens: 100 } },
    toleranceTokens: 0,
    runs: 1,
  });

  assert.equal(report.outcome, "rejected");
  assert.equal(report.decision.promote, false);
  assert.ok(report.decision.reasons.some((r) => /regressão|tolerância/.test(r)));
  assert.equal(rollbackCalled, true);
  assert.ok(report.rolledBack?.rolledBack);
  await rm(out, { recursive: true, force: true });
});

test("loop: verify.mjs falha reprova mesmo com eval ok", async () => {
  const out = await tempDir();
  const loop = createEvolutionLoop({
    runEvals: async () => [{ passed: true, tokens: 10 }],
    workRoot: out,
    runVerification: async () => ({ ok: false, status: 1, stdout: "", stderr: "FAIL smoke" }),
    staticGate: async () => ({ decision: "allow" }),
  });

  const report = await loop.evolve({
    gap: { kind: "tool-missing", taskId: "X", capability: "cli" },
    baseline: { X: { tokens: 10 } },
    runs: 1,
  });

  assert.equal(report.outcome, "rejected");
  assert.ok(report.decision.reasons.some((r) => /verificação/.test(r)));
  await rm(out, { recursive: true, force: true });
});

test("loop: pausa needs-human quando artefato pede rede", async () => {
  const out = await tempDir();
  let rollbackCalled = false;
  const loop = createEvolutionLoop({
    runEvals: async () => [{ passed: true, tokens: 10 }],
    workRoot: out,
    runVerification: async () => ({ ok: true, status: 0 }),
    staticGate: async () => ({ decision: "allow" }),
    rollback: async () => { rollbackCalled = true; return { ok: true }; },
  });

  const report = await loop.evolve({
    gap: { kind: "tool-missing", taskId: "N", capability: "cli" },
    request: {
      goal: "buscar na web", kind: "cli", taskId: "N",
      inputs: {}, outputs: {}, permissions: ["acessar rede"], forbidden: ["x"],
      tests: [{ name: "smoke", command: 'node -e "process.exit(0)"', expect: null }],
    },
  });

  assert.equal(report.outcome, "needs-human");
  assert.ok(report.reasons.some((r) => /rede|credencial/.test(r)));
  // needs-human não reverte (não gera poluição); só limpa efêmero
  assert.equal(rollbackCalled, false);
  await rm(out, { recursive: true, force: true });
});

test("loop: needs-human quando gate estático bloqueia rede no gerado", async () => {
  const out = await tempDir();
  const loop = createEvolutionLoop({
    runEvals: async () => [{ passed: true, tokens: 10 }],
    workRoot: out,
    runVerification: async () => ({ ok: true, status: 0 }),
    staticGate: async () => ({ decision: "block", blockingRules: ["network-access"] }),
  });

  const report = await loop.evolve({
    gap: { kind: "tool-missing", taskId: "M", capability: "cli" },
  });

  assert.equal(report.outcome, "needs-human");
  assert.ok(report.reasons.some((r) => /network-access|gate estático/.test(r)));
  await rm(out, { recursive: true, force: true });
});

test("loop: dry-run promove sem aplicar", async () => {
  const out = await tempDir();
  let promoteCalled = false;
  const loop = createEvolutionLoop({
    runEvals: async () => [{ passed: true, tokens: 10 }],
    workRoot: out,
    runVerification: async () => ({ ok: true, status: 0 }),
    staticGate: async () => ({ decision: "allow" }),
    promote: async () => { promoteCalled = true; return { ok: true }; },
  });

  const report = await loop.evolve({
    gap: { kind: "tool-missing", taskId: "Y", capability: "cli" },
    baseline: { Y: { tokens: 10 } },
    dryRun: true,
    runs: 1,
  });

  assert.equal(report.outcome, "promoted");
  assert.equal(promoteCalled, false, "dry-run não promove");
  await rm(out, { recursive: true, force: true });
});

test("loop: nenhuma lacuna detectada => rejected", async () => {
  const out = await tempDir();
  const loop = createEvolutionLoop({
    workRoot: out,
    runEvals: async () => [],
    detect: async () => ({ gaps: [] }),
  });
  const report = await loop.evolve({ ledger: [] });
  assert.equal(report.outcome, "rejected");
  assert.ok(report.reasons.some((r) => /nenhuma lacuna/.test(r)));
  await rm(out, { recursive: true, force: true });
});

test("loop: artefato e gerado em diretorio real e verify real roda", async () => {
  const out = await tempDir();
  // sem fake de verify: usa o verify.mjs gerado de verdade (node spawnSync)
  const loop = createEvolutionLoop({
    runEvals: async () => [{ passed: true, tokens: 10 }],
    workRoot: out,
    staticGate: async () => ({ decision: "allow" }),
  });

  const report = await loop.evolve({
    gap: { kind: "tool-missing", taskId: "Z", capability: "cli" },
    baseline: { Z: { tokens: 10 } },
    runs: 1,
  });

  // o verify.mjs gerado executou de verdade e passou
  assert.equal(report.verify.ok, true);
  // o diretório do artefato existiu e continha um artefato + verify
  assert.ok(report.files.includes("verify.mjs"), `files=${JSON.stringify(report.files)}`);
  assert.ok(report.files.some((f) => f.endsWith(".mjs")), "artefato executavel");
  // sem capabilities estruturadas, o kind vem do SpecWriter (ou do minimo): skill.
  // A lacuna em linguagem de gente nao e uma capability — era isso que fazia o
  // chooseKind cair no caso degenerado.
  assert.equal(report.kind, "skill", "sem capabilities estruturadas, o kind e skill");
  assert.equal(report.spec?.basis, "heuristic", "sem modelo, o SpecWriter cai no minimo");
  await rm(out, { recursive: true, force: true });
});

test("loop: kind sem gerador falha honestamente em vez de recair para cli", async () => {
  const out = await tempDir();
  const loop = createEvolutionLoop({
    runEvals: async () => [{ passed: true, tokens: 10 }],
    workRoot: out,
    staticGate: async () => ({ decision: "allow" }),
  });

  const report = await loop.evolve({
    gap: { kind: "tool-missing", taskId: "Y", capability: "mcp-server" },
    request: {
      goal: "servidor",
      kind: "mcp-server",
      inputs: {},
      outputs: {},
      forbidden: ["acessar rede"],
      tests: [{ name: "smoke", command: "node -e \"process.exit(0)\"" }],
    },
    baseline: { Y: { tokens: 10 } },
    runs: 1,
  });

  assert.equal(report.outcome, "error", "nao pode gerar o artefato errado");
  assert.match(report.reasons.join(" "), /sem gerador para kind "mcp-server"/);
  await rm(out, { recursive: true, force: true });
});