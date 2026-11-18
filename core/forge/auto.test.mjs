import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, readdir, stat, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path, { join } from "node:path";

import {
  runAutoPass,
  runWatch,
  isProtectedPath,
  PROTECTED_AREAS,
  readLedgerRows,
  loadEvalTaskIds,
} from "./auto.mjs";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function tempDir() {
  return mkdtemp(join(tmpdir(), "forge-auto-"));
}

/** Hash determinístico de uma árvore: caminho + conteúdo de cada arquivo. */
async function treeHash(dir) {
  const h = createHash("sha256");
  async function walk(d) {
    const entries = (await readdir(d, { withFileTypes: true }))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) {
        h.update(`D:${e.name}\n`);
        await walk(full);
      } else {
        const buf = await readFile(full);
        h.update(`F:${e.name}:${buf.toString("base64")}\n`);
      }
    }
  }
  await walk(dir);
  return h.digest("hex");
}

/** Ledger sintético: uma task que falhou 3x (threshold padrão). */
function failingLedger() {
  return [
    { at: "t1", taskId: "D1", group: "D", passed: false, tokens: 0 },
    { at: "t2", taskId: "D1", group: "D", passed: false, tokens: 0 },
    { at: "t3", taskId: "D1", group: "D", passed: false, tokens: 0 },
  ];
}

/** detect fake: devolve um gap fixo, sem ler ledger real. */
function fakeDetect(gaps) {
  return async () => ({ gaps, scanned: gaps.length });
}

/* ------------------------------------------------------------------ */
/* isProtectedPath / áreas protegidas                                  */
/* ------------------------------------------------------------------ */

test("áreas protegidas: reconhece evals/, core/governance/, verify-urls", () => {
  assert.ok(isProtectedPath("evals/run.mjs"));
  assert.ok(isProtectedPath("evals/tasks/D1.json"));
  assert.ok(isProtectedPath("core/governance/rollback.mjs"));
  assert.ok(isProtectedPath("scripts/verify-urls.mjs"));
  assert.ok(isProtectedPath("  EVALS\\run.mjs  ")); // normaliza barra e caixa
});

test("áreas protegidas: caminhos legítimos passam", () => {
  assert.ok(!isProtectedPath("core/forge/cli.mjs"));
  assert.ok(!isProtectedPath("core/memory/store.mjs"));
  assert.ok(!isProtectedPath("src/index.js"));
  assert.equal(PROTECTED_AREAS.length, 3);
});

/* ------------------------------------------------------------------ */
/* 1. dry-run não muda absolutamente nada                              */
/* ------------------------------------------------------------------ */

test("dry-run não altera a árvore (hash antes == depois)", async () => {
  const work = await tempDir();
  const artifacts = join(work, "artifacts");
  const ledgerFile = join(work, "ledger.jsonl");
  await writeFile(ledgerFile, failingLedger().map((r) => JSON.stringify(r)).join("\n") + "\n");
  // uma árvore "de produção" que não pode mudar
  await mkdir(artifacts, { recursive: true });
  await writeFile(join(artifacts, "keep.txt"), "conteúdo intocado", "utf8");

  const before = await treeHash(work);

  const out = await runAutoPass({
    ledger: ledgerFile,
    auto: false, // dry-run
    // detect fake para não depender do ledger real do projeto
    detect: fakeDetect([
      { kind: "tool-failing", taskId: "D1", capability: "ferramenta confiável", goal: "tornar D1 confiável" },
    ]),
    // runEvolve/writeLedger não devem ser chamados em dry-run
    runEvolve: async () => {
      throw new Error("runEvolve NÃO deve ser chamado em dry-run");
    },
    writeLedger: async () => {
      throw new Error("writeLedger NÃO deve ser chamado em dry-run");
    },
  });

  const after = await treeHash(work);
  assert.equal(before, after, "árvore deve permanecer idêntica");
  assert.equal(out.dryRun, true);
  assert.equal(out.actions.length, 1);
  // o artefato intocado continua lá
  assert.equal(await readFile(join(artifacts, "keep.txt"), "utf8"), "conteúdo intocado");

  await rm(work, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/* 2. --auto sem gate verde não promove nem faz rollback               */
/* ------------------------------------------------------------------ */

test("--auto com gate vermelho: não promove (promote não chamado)", async () => {
  const work = await tempDir();
  let promoteCalled = false;
  let rollbackCalled = false;

  const out = await runAutoPass({
    auto: true,
    detect: fakeDetect([
      { kind: "tool-failing", taskId: "D1", capability: "cap", goal: "tornar D1 confiável" },
    ]),
    // loop que reprova no gate (outcome rejected)
    runEvolve: async () => {
      return { outcome: "rejected", taskId: "D1", reasons: ["regressão detectada"] };
    },
    // ledger fake: só registra, não toca em disco
    writeLedger: async (entry) => {
      assert.equal(entry.origin, "auto");
      assert.equal(entry.outcome, "rejected");
    },
  });

  // promote/rollback não são responsabilidade do runAutoPass — quem decide é o
  // loop. Aqui garantimos que o runAutoPass NÃO contornou o gate: só registra.
  assert.equal(out.dryRun, false);
  assert.equal(out.results[0].outcome, "rejected");
  assert.equal(promoteCalled, false);
  assert.equal(rollbackCalled, false);

  await rm(work, { recursive: true, force: true });
});

test("--auto com gate verde: registra origin auto e reporta promote", async () => {
  let ledgerEntry = null;
  const out = await runAutoPass({
    auto: true,
    detect: fakeDetect([
      { kind: "tool-failing", taskId: "D1", capability: "cap", goal: "tornar D1 confiável" },
    ]),
    runEvolve: async () => ({ outcome: "promoted", taskId: "D1", promoted: { path: "/tmp/art" } }),
    writeLedger: async (entry) => { ledgerEntry = entry; },
  });

  assert.equal(out.dryRun, false);
  assert.equal(out.results[0].outcome, "promoted");
  assert.ok(ledgerEntry, "ledger deve ser escrito em modo auto");
  assert.equal(ledgerEntry.origin, "auto");
  assert.equal(ledgerEntry.promoted, "/tmp/art");
});

test("writeLedger não é chamado em dry-run", async () => {
  let wrote = false;
  await runAutoPass({
    auto: false,
    detect: fakeDetect([{ kind: "tool-failing", taskId: "D1", capability: "cap", goal: "g" }]),
    writeLedger: async () => { wrote = true; },
  });
  assert.equal(wrote, false);
});

/* ------------------------------------------------------------------ */
/* 3. lacuna em área protegida é recusada com mensagem                 */
/* ------------------------------------------------------------------ */

test("lacuna em área protegida é recusada, não contornada", async () => {
  let ran = false;
  const out = await runAutoPass({
    auto: true,
    detect: fakeDetect([
      { kind: "tool-missing", taskId: "evals/run.mjs", capability: "editar evals/run.mjs", goal: "mexer no runner" },
      { kind: "tool-missing", taskId: "core/governance/rollback.mjs", capability: "editar governance", goal: "mexer no rollback" },
      { kind: "tool-missing", taskId: "scripts/verify-urls.mjs", capability: "editar verify-urls", goal: "mexer nas urls" },
    ]),
    runEvolve: async () => { ran = true; return { outcome: "promoted" }; },
    writeLedger: async () => {},
  });

  assert.equal(ran, false, "runEvolve NÃO deve ser chamado para lacuna protegida");
  assert.equal(out.actions, 0);
  assert.equal(out.skipped.length, 3);
  assert.ok(out.skipped.every((s) => /área protegida/.test(s.reason)));
});

test("lacuna protegida em dry-run também é recusada", async () => {
  const out = await runAutoPass({
    auto: false,
    detect: fakeDetect([
      { kind: "tool-missing", taskId: "evals/gate.mjs", capability: "editar gate", goal: "mexer no gate" },
    ]),
  });
  assert.equal(out.dryRun, true);
  assert.equal(out.actions.length, 0);
  assert.equal(out.skipped.length, 1);
  assert.match(out.skipped[0].reason, /área protegida/);
});

/* ------------------------------------------------------------------ */
/* 4. --once converge (termina) e não entra em laço infinito            */
/* ------------------------------------------------------------------ */

test("runWatch --once converge: shouldStop interrompe após 1 passada", async () => {
  let calls = 0;
  const out = await runWatch({
    intervalMs: 1,
    pass: async () => { calls += 1; },
    shouldStop: () => calls >= 1, // para depois da 1ª passada
  });
  assert.equal(out.ok, true);
  assert.equal(out.passes, 1);
  assert.ok(calls <= 2, "não deve passar de 2 chamadas");
});

test("runWatch com erro faz backoff e ainda converge (não infinito)", async () => {
  let calls = 0;
  const events = [];
  const out = await runWatch({
    intervalMs: 1,
    maxBackoffMs: 4,
    pass: async () => {
      calls += 1;
      if (calls < 2) throw new Error("falha transitória");
      // 2ª passada sucede
    },
    shouldStop: () => calls >= 2,
    onEvent: (e) => events.push(e),
  });
  assert.equal(out.passes, 1); // só a 2ª contou como sucesso
  assert.ok(events.some((e) => e.event === "watch-error"));
  assert.ok(calls <= 3, "não deve entrar em laço infinito");
});

test("runAutoPass --once termina (não é watch)", async () => {
  const out = await runAutoPass({
    detect: fakeDetect([]),
    auto: false,
  });
  assert.equal(out.dryRun, true);
  assert.equal(out.actions.length, 0);
});

/* ------------------------------------------------------------------ */
/* readLedgerRows                                                      */
/* ------------------------------------------------------------------ */

test("readLedgerRows ignora linhas corrompidas", async () => {
  const dir = await tempDir();
  const f = join(dir, "l.jsonl");
  await writeFile(f, '{"taskId":"A","passed":true}\nlixo\n{"taskId":"B","passed":false}\n', "utf8");
  const rows = await readLedgerRows(f);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].taskId, "A");
  assert.equal(rows[1].taskId, "B");
  await rm(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/* --auto sem gate verde: o loop (que o auto usa) não promove          */
/* ------------------------------------------------------------------ */

import { createEvolutionLoop } from "./loop.mjs";

test("--auto sem gate verde: promote NÃO é chamado, rollback é", async () => {
  const work = await tempDir();
  let promoteCalled = false;
  let rollbackCalled = false;

  // Loop com gate vermelho: runEvals reprova (regressão de tokens).
  const loop = createEvolutionLoop({
    workRoot: work,
    runEvals: async () => [{ passed: true, tokens: 900 }], // acima do baseline
    runVerification: async () => ({ ok: true, status: 0, stdout: "PASS", stderr: "" }),
    staticGate: async () => ({ decision: "allow" }),
    promote: async () => { promoteCalled = true; return { ok: true }; },
    rollback: async () => { rollbackCalled = true; return { ok: true, rolledBack: true }; },
  });

  const report = await loop.evolve({
    gap: { kind: "tool-failing", taskId: "D9", capability: "cap", goal: "tornar D9 confiável" },
    baseline: { D9: { tokens: 100 } },
    toleranceTokens: 0,
    runs: 1,
  });

  assert.equal(report.outcome, "rejected", "gate vermelho reprova");
  assert.equal(report.decision.promote, false);
  assert.equal(promoteCalled, false, "promote NÃO deve ser chamado sem gate verde");
  assert.equal(rollbackCalled, true, "rollback deve ser chamado");

  await rm(work, { recursive: true, force: true });
});

test("--auto com gate verde: promote é chamado", async () => {
  const work = await tempDir();
  let promoteCalled = false;

  const loop = createEvolutionLoop({
    workRoot: work,
    runEvals: async () => [{ passed: true, tokens: 10 }],
    runVerification: async () => ({ ok: true, status: 0 }),
    staticGate: async () => ({ decision: "allow" }),
    promote: async () => { promoteCalled = true; return { ok: true }; },
  });

  const report = await loop.evolve({
    gap: { kind: "tool-failing", taskId: "D9", capability: "cap", goal: "tornar D9 confiável" },
    baseline: { D9: { tokens: 10 } },
    toleranceTokens: 0,
    runs: 1,
  });

  assert.equal(report.outcome, "promoted");
  assert.equal(promoteCalled, true, "promote deve ser chamado com gate verde");

  await rm(work, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/* Filtro de tarefa de eval (mede o modelo, não o harness)             */
/* ------------------------------------------------------------------ */

test("loadEvalTaskIds lê ids de evals/tasks/*.json", async () => {
  const dir = await tempDir();
  await writeFile(join(dir, "D1-cria-soma.json"), JSON.stringify({ id: "D1-cria-soma", group: "D" }));
  await writeFile(join(dir, "A1-router.json"), JSON.stringify([{ id: "A1-router" }, { id: "A2-backoff" }]));
  await writeFile(join(dir, "lixo.json"), "não é json");
  const ids = await loadEvalTaskIds(dir);
  assert.ok(ids.has("D1-cria-soma"));
  assert.ok(ids.has("A1-router"));
  assert.ok(ids.has("A2-backoff"));
  assert.equal(ids.has("lixo"), false);
  await rm(dir, { recursive: true, force: true });
});

test("loadEvalTaskIds devolve vazio quando o diretório não existe", async () => {
  const ids = await loadEvalTaskIds(join(tmpdir(), "nao-existe-" + Date.now()));
  assert.equal(ids.size, 0);
});

test("tool-failing de tarefa de eval é ignorado (visível, com motivo)", async () => {
  let ran = false;
  const out = await runAutoPass({
    auto: true,
    evalTaskIds: new Set(["D1-cria-soma"]),
    detect: fakeDetect([
      { kind: "tool-failing", taskId: "D1-cria-soma", capability: "ferramenta confiável", goal: "tornar D1 confiável" },
    ]),
    runEvolve: async () => { ran = true; return { outcome: "promoted" }; },
    writeLedger: async () => {},
  });

  assert.equal(ran, false, "runEvolve NÃO deve ser chamado para tarefa de eval");
  assert.equal(out.actions, 0);
  assert.equal(out.considered, 0);
  assert.equal(out.ignored.length, 1);
  assert.equal(out.ignored[0].taskId, "D1-cria-soma");
  assert.match(out.ignored[0].reason, /tarefa de eval/);
});

test("tool-failing de ferramenta real (não eval) continua acionável", async () => {
  const out = await runAutoPass({
    auto: false,
    evalTaskIds: new Set(["D1-cria-soma"]), // D1 é eval, mas a lacuna é de outra task
    detect: fakeDetect([
      { kind: "tool-failing", taskId: "ferramenta-real", capability: "cli confiável", goal: "consertar ferramenta real" },
    ]),
  });

  assert.equal(out.actions.length, 1);
  assert.equal(out.ignored.length, 0);
  assert.equal(out.actions[0].taskId, "ferramenta-real");
});

test("tool-missing de tarefa de eval NÃO é filtrado (sinal legítimo)", async () => {
  // tool-missing com erro "no such tool" pode indicar ferramenta realmente ausente:
  // o filtro é só para tool-failing, como pedido. Prova que não extrapolamos.
  const out = await runAutoPass({
    auto: false,
    evalTaskIds: new Set(["D1-cria-soma"]),
    detect: fakeDetect([
      { kind: "tool-missing", taskId: "D1-cria-soma", capability: "capacidade ausente", goal: "cobrir capacidade" },
    ]),
  });

  assert.equal(out.ignored.length, 0, "tool-missing não é filtrado");
  assert.equal(out.actions.length, 1);
  assert.equal(out.actions[0].gapKind, "tool-missing");
});

test("evalTaskIds como array também funciona", async () => {
  const out = await runAutoPass({
    auto: false,
    evalTaskIds: ["D1-cria-soma", "D2-corrige-contador"],
    detect: fakeDetect([
      { kind: "tool-failing", taskId: "D2-corrige-contador", capability: "cap", goal: "g" },
    ]),
  });
  assert.equal(out.ignored.length, 1);
  assert.equal(out.actions.length, 0);
});

/* ------------------------------------------------------------------ */
/* Falso positivo de projeto: ledger real                              */
/* ------------------------------------------------------------------ */

test("ledger real: D1 aparece como ignorada e zero acionável", async () => {
  // Usa o ledger e o tasksDir reais do projeto (via caminhos relativos ao worktree).
  const { fileURLToPath } = await import("node:url");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, "..", "..");
  const ledger = path.join(root, ".pi", "harness", "ledger", "evals.jsonl");
  const tasksDir = path.join(root, "evals", "tasks");

  const out = await runAutoPass({ ledger, tasksDir, auto: false, threshold: 3 });

  // D1-cria-soma falhou >= 3x no ledger e é tarefa de eval: deve estar ignorada.
  const d1 = out.ignored.find((i) => i.taskId === "D1-cria-soma");
  assert.ok(d1, "D1-cria-soma deve aparecer como ignorada");
  assert.match(d1.reason, /tarefa de eval/);
  // Nenhuma lacuna acionável pode sobrar (a única era D1).
  assert.equal(out.actions.length, 0, "zero lacuna acionável após filtrar tarefas de eval");
});

test("--include-eval (evalTaskIds vazio) faz D1 voltar a ser acionável", async () => {
  const { fileURLToPath } = await import("node:url");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, "..", "..");
  const ledger = path.join(root, ".pi", "harness", "ledger", "evals.jsonl");

  const out = await runAutoPass({ ledger, tasksDir: null, evalTaskIds: new Set(), auto: false, threshold: 3 });
  // Sem o filtro, a falha de D1 aparece como lacuna acionável (comportamento cru).
  assert.ok(out.actions.some((a) => a.taskId === "D1-cria-soma"), "sem filtro, D1 é acionável");
});
