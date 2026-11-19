import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEvolutionLoop, defaultGenerate } from "./loop.mjs";
import { createArtifactRequest } from "./contract.mjs";
import { renderProbe } from "./probe.mjs";

/**
 * Estes testes usam o sandbox REAL (core/sandbox/run-sandboxed.mjs) e o gate
 * estático REAL — nada de fakes para o caminho de contenção. O objetivo é
 * provar que o artefato gerado (código de modelo) não executa solto.
 */

async function tempDir() {
  return mkdtemp(join(tmpdir(), "forge-sbx-test-"));
}

/** Loop com promote fake (não toca no repositório), mas sandbox/gate reais. */
function makeLoop(overrides = {}) {
  return createEvolutionLoop({
    workRoot: overrides.workRoot,
    runEvals: async () => [{ passed: true, tokens: 10 }],
    promote: async () => ({ ok: true, promoted: true }),
    rollback: async () => ({ ok: true, rolledBack: true }),
    ...overrides,
  });
}

const CLI_REQ = {
  goal: "validar um arquivo",
  kind: "cli",
  inputs: { arquivo: "caminho do arquivo" },
  outputs: { valido: "booleano" },
  permissions: [],
  forbidden: ["acessar rede"],
  tests: [{ name: "interface", command: "node probe.mjs", expect: null }],
};

/* ------------------------------------------------------------------ */
/* 1. artefato que lê ~/.pi/settings.json → bloqueado antes de executar */
/* ------------------------------------------------------------------ */

test("artefato que lê ~/.pi/settings.json é bloqueado (needs-human)", async () => {
  const work = await tempDir();
  try {
    // generate que produz um cli.mjs que lê o arquivo sensível
    const generate = async (request, outDir) => {
      const code = [
        'import { readFileSync } from "node:fs";',
        'const home = process.env.USERPROFILE || process.env.HOME;',
        'const s = readFileSync(home + "/.pi/settings.json", "utf8");',
        'console.log(JSON.stringify({ ok: true, len: s.length, valido: true }));',
        "",
      ].join("\n");
      await writeFile(join(outDir, "cli.mjs"), code, "utf8");
      await writeFile(join(outDir, "probe.mjs"), renderProbe(request), "utf8");
      await writeFile(join(outDir, "verify.mjs"), 'process.exit(0);\n', "utf8");
      return { path: outDir, files: ["cli.mjs"], verifyCommand: `node ${join(outDir, "probe.mjs")}` };
    };
    const loop = makeLoop({ workRoot: work, generate });

    const report = await loop.evolve({
      gap: { kind: "tool-missing", taskId: "le-settings", capability: "ler settings", goal: "ler settings" },
      request: createArtifactRequest(CLI_REQ),
      baseline: { "le-settings": { tokens: 10 } },
      runs: 1,
    });

    assert.equal(report.outcome, "needs-human", `esperava needs-human, veio ${report.outcome}`);
    assert.ok(report.reasons.some((r) => /gate|settings|sandbox|rede|protegid/i.test(r)));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* 2. artefato que escreve fora do temp → bloqueado                    */
/* ------------------------------------------------------------------ */

test("artefato que escreve fora do temp é bloqueado (não promove)", async () => {
  const work = await tempDir();
  const alvoFora = join(tmpdir(), `fuga-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  try {
    const generate = async (request, outDir) => {
      const alvoJson = JSON.stringify(alvoFora);
      const code = [
        'import { writeFileSync } from "node:fs";',
        'const alvo = ' + alvoJson + ';',
        'writeFileSync(alvo, "vazou");',
        'console.log(JSON.stringify({ ok: true, valido: true }));',
        "",
      ].join("\n");
      await writeFile(join(outDir, "cli.mjs"), code, "utf8");
      await writeFile(join(outDir, "probe.mjs"), renderProbe(request), "utf8");
      await writeFile(join(outDir, "verify.mjs"), 'process.exit(0);\n', "utf8");
      return { path: outDir, files: ["cli.mjs"], verifyCommand: `node ${join(outDir, "probe.mjs")}` };
    };
    const loop = makeLoop({ workRoot: work, generate });

    const report = await loop.evolve({
      gap: { kind: "tool-missing", taskId: "escreve-fora", capability: "escrever", goal: "escrever fora" },
      request: createArtifactRequest(CLI_REQ),
      baseline: { "escreve-fora": { tokens: 10 } },
      runs: 1,
    });

    // Não pode promover; e o arquivo fora do temp NÃO pode existir.
    assert.notEqual(report.outcome, "promoted", "não deve promover artefato que escreve fora do temp");
    let vazou = true;
    try {
      await access(alvoFora);
    } catch {
      vazou = false;
    }
    assert.equal(vazou, false, "o arquivo fora do temp não deve ter sido criado");
  } finally {
    await rm(alvoFora, { force: true }).catch(() => {});
    await rm(work, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* 3. evaluateFile lançando → needs-human, e não execução              */
/* ------------------------------------------------------------------ */

test("evaluateFile lançando vira needs-human (fail-closed), não execução", async () => {
  const work = await tempDir();
  try {
    let ranVerify = false;
    const loop = makeLoop({
      workRoot: work,
      staticGate: async () => {
        throw new Error("boom no verificador");
      },
      runVerification: async () => {
        ranVerify = true;
        return { ok: true, status: 0 };
      },
    });

    const report = await loop.evolve({
      gap: { kind: "tool-missing", taskId: "gate-throws", capability: "cap", goal: "g" },
      request: createArtifactRequest(CLI_REQ),
      baseline: { "gate-throws": { tokens: 10 } },
      runs: 1,
    });

    assert.equal(report.outcome, "needs-human", "gate que lança = needs-human");
    assert.equal(ranVerify, false, "não deve executar o verificador quando o gate lança");
    assert.ok(report.reasons.some((r) => /fail-closed|gate/i.test(r)));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* 4. artefato com dois arquivos, o secundário perigoso → bloqueado    */
/* ------------------------------------------------------------------ */

test("artefato com dois arquivos, o secundário perigoso é bloqueado", async () => {
  const work = await tempDir();
  try {
    const generate = async (request, outDir) => {
      // primário limpo
      await writeFile(join(outDir, "cli.mjs"), 'console.log(JSON.stringify({ ok: true, valido: true }))\n', "utf8");
      // secundário perigoso: sobe processo filho
      await writeFile(
        join(outDir, "helper.mjs"),
        'import { spawnSync } from "node:child_process";\nexport const x = spawnSync("cmd", ["/c", "echo", "oi"]);\n',
        "utf8",
      );
      await writeFile(join(outDir, "probe.mjs"), renderProbe(request), "utf8");
      await writeFile(join(outDir, "verify.mjs"), 'process.exit(0);\n', "utf8");
      return { path: outDir, files: ["cli.mjs", "helper.mjs"], verifyCommand: `node ${join(outDir, "probe.mjs")}` };
    };
    const loop = makeLoop({ workRoot: work, generate });

    const report = await loop.evolve({
      gap: { kind: "tool-missing", taskId: "dois-arquivos", capability: "cap", goal: "g" },
      request: createArtifactRequest(CLI_REQ),
      baseline: { "dois-arquivos": { tokens: 10 } },
      runs: 1,
    });

    assert.equal(report.outcome, "needs-human", "arquivo secundário perigoso bloqueia o artefato inteiro");
    assert.ok(report.reasons.some((r) => /gate|child-process|processo filho/i.test(r)));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* 5. caminho feliz ainda promove                                      */
/* ------------------------------------------------------------------ */

test("caminho feliz ainda promove (não ficou impossível usar)", async () => {
  const work = await tempDir();
  try {
    const loop = makeLoop({ workRoot: work });
    const report = await loop.evolve({
      gap: { kind: "tool-missing", taskId: "feliz", capability: "cli confiável", goal: "validar um arquivo" },
      request: createArtifactRequest(CLI_REQ),
      baseline: { feliz: { tokens: 10 } },
      runs: 1,
    });

    assert.equal(report.outcome, "promoted", "artefato limpo deve promover");
    assert.equal(report.verify.ok, true, "a verificação (sandboxed) deve passar");
    assert.deepEqual(report.files, ["cli.mjs", "README.md", "verify.mjs"]);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});