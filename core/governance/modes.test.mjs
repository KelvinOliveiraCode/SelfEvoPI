import test from "node:test";
import assert from "node:assert/strict";

import {
  MODE_NAMES,
  MODES,
  resolveMode,
  guard,
  guardWrite,
  isMode,
  isReadOnlyCommand,
  describeModes,
  modeList,
} from "./modes.mjs";

const WS = "C:\\work\\proj";
const DENTRO = "C:\\work proj\\src\\index.mjs".replace("C:\\work proj", "C:\\work\\proj");
const FORA = "C:\\Users\\alguem\\.ssh\\id_rsa";

/* ------------------------------------------------------------------ */
/* resolveMode — o contrato                                            */
/* ------------------------------------------------------------------ */

test("resolveMode devolve exatamente o contrato pedido", () => {
  for (const nome of MODE_NAMES) {
    const m = resolveMode(nome);
    assert.deepEqual(Object.keys(m).sort(), [
      "ask",
      "base",
      "canExec",
      "canRead",
      "canWrite",
      "execScope",
      "name",
    ]);
    assert.equal(typeof m.canRead, "boolean");
    assert.equal(typeof m.canWrite, "boolean");
    assert.equal(typeof m.canExec, "boolean");
    assert.equal(typeof m.execScope, "string");
    assert.ok(m.ask === null || typeof m.ask === "string");
  }
});

test("a tabela do briefing está implementada linha por linha", () => {
  const plan = resolveMode("plan");
  assert.equal(plan.canRead, true);
  assert.equal(plan.canWrite, false);
  assert.equal(plan.canExec, true);
  assert.equal(plan.execScope, "readonly");
  assert.equal(plan.ask, "write");

  const build = resolveMode("build");
  assert.equal(build.canRead, true);
  assert.equal(build.canWrite, true);
  assert.equal(build.canExec, true);
  assert.equal(build.execScope, "workspace");
  assert.equal(build.ask, "outside-workspace");

  const ask = resolveMode("ask");
  assert.equal(ask.canRead, true);
  assert.equal(ask.canWrite, false);
  assert.equal(ask.canExec, false);
  assert.equal(ask.execScope, "none");
  assert.equal(ask.ask, null);

  const goal = resolveMode("goal");
  assert.equal(goal.name, "goal");
  assert.equal(goal.base, "build", "goal sem base declarada herda build");
});

test("goal herda a permissão da base, não inventa a sua", () => {
  assert.deepEqual(
    { ...resolveMode("goal", { base: "plan" }) },
    { ...resolveMode("plan"), name: "goal", base: "plan" }
  );
  assert.deepEqual(
    { ...resolveMode("goal", { base: "ask" }) },
    { ...resolveMode("ask"), name: "goal", base: "ask" }
  );
});

test("modo desconhecido é erro, e yolo é recusado com explicação", () => {
  assert.throws(() => resolveMode("turbo"), /modo desconhecido/);
  assert.throws(() => resolveMode("yolo"), /modo desconhecido[\s\S]*yolo/);
  assert.throws(() => resolveMode("bypassPermissions"), /modo desconhecido/);
  assert.throws(() => resolveMode("goal", { base: "plan2" }), /modo desconhecido/);
  assert.equal(isMode("plan"), true);
  assert.equal(isMode("yolo"), false);
});

/* ------------------------------------------------------------------ */
/* O teste que o briefing pediu: mesma escrita, dois modos             */
/* ------------------------------------------------------------------ */

/** Adaptador que imita a ordem da CLI: consulta o modo e só então executa. */
function avaliar({ mode, action, path, workspace, runner }) {
  const g = guard({ mode, action, path, workspace });
  if (g.decision !== "allow") return { guard: g, executou: false };
  runner();
  return { guard: g, executou: true };
}

test("em plan uma escrita é recusada e NÃO chega a executar", () => {
  let executou = false;
  const r = avaliar({
    mode: "plan",
    action: "write",
    path: DENTRO,
    workspace: WS,
    runner: () => {
      executou = true;
    },
  });

  assert.equal(r.guard.decision, "block");
  assert.equal(r.guard.mode, "plan");
  assert.equal(r.executou, false, "não pode ter executado: a barreira é antes");
  assert.match(r.guard.reason, /plan não escreve/);
  assert.ok(r.guard.questions.length > 0, "a recusa tem de dizer o que destrava");
});

test("em build a MESMA escrita passa e executa", () => {
  let executou = false;
  const r = avaliar({
    mode: "build",
    action: "write",
    path: DENTRO,
    workspace: WS,
    runner: () => {
      executou = true;
    },
  });

  assert.equal(r.guard.decision, "allow", r.guard.reason);
  assert.equal(r.executou, true, "a mesma escrita tem de passar em build");
  assert.equal(r.guard.mode, "build");
});

test("plan recusa escrita mesmo quando o caminho é nulo ou desconhecido", () => {
  assert.equal(guardWrite({ mode: "plan", path: DENTRO, workspace: WS }).decision, "block");
  assert.equal(guardWrite({ mode: "plan", workspace: WS }).decision, "block");
  assert.equal(guardWrite({ mode: "ask", path: DENTRO, workspace: WS }).decision, "block");
});

/* ------------------------------------------------------------------ */
/* Escrita: dentro, fora, desconhecido                                 */
/* ------------------------------------------------------------------ */

test("build escreve dentro do workspace sem perguntar", () => {
  const r = guardWrite({ mode: "build", path: DENTRO, workspace: WS });
  assert.equal(r.decision, "allow");
  assert.match(r.reason, /dentro do workspace/);
});

test("build escreve fora do workspace e devolve ask com perguntas", () => {
  const r = guardWrite({ mode: "build", path: FORA, workspace: WS });
  assert.equal(r.decision, "ask");
  assert.match(r.reason, /fora do workspace/);
  assert.equal(r.questions.length, 2);
  assert.ok(r.questions.some((q) => /fora do workspace/.test(q)));
});

test("caminho que não dá para provar também pausa, em vez de deixar passar", () => {
  const r = guardWrite({ mode: "build", path: "$env:TEMP\\x.txt", workspace: WS });
  assert.equal(r.decision, "ask");
  assert.match(r.reason, /não deu para provar/);
});

/* ------------------------------------------------------------------ */
/* Execução                                                            */
/* ------------------------------------------------------------------ */

test("ask não executa nada", () => {
  assert.equal(guard({ mode: "ask", action: "exec", command: "ls" }).decision, "block");
  assert.equal(guard({ mode: "ask", action: "read" }).decision, "allow");
});

test("plan executa o que dá para provar que é leitura", () => {
  for (const cmd of ["git status", "ls -la", "cat package.json", "git diff --stat"]) {
    const r = guard({ mode: "plan", action: "exec", command: cmd });
    assert.equal(r.decision, "allow", `${cmd} deveria passar: ${r.reason}`);
  }
});

test("plan pausa diante de comando que não é leitura", () => {
  for (const cmd of ["rm -rf build", "npm install", "node script.mjs", "git push"]) {
    const r = guard({ mode: "plan", action: "exec", command: cmd });
    assert.equal(r.decision, "ask", `${cmd} deveria parar: ${r.reason}`);
    assert.match(r.reason, /só executa leitura/);
  }
});

test("classificador de leitura é conservador", () => {
  assert.equal(isReadOnlyCommand("git status"), true);
  assert.equal(isReadOnlyCommand("git push"), false);
  assert.equal(isReadOnlyCommand("git"), false, "git sozinho pode fazer qualquer coisa");
  assert.equal(isReadOnlyCommand("ls > saida.txt"), false, "redirecionar escreve");
  assert.equal(isReadOnlyCommand("rm -rf x"), false);
  assert.equal(isReadOnlyCommand(""), false);
  assert.equal(isReadOnlyCommand(null), false);
});

/* ------------------------------------------------------------------ */
/* Composição com approval.mjs                                         */
/* ------------------------------------------------------------------ */

test("scan com fetch vira ask mesmo em build (a aprovação entra junto)", () => {
  const scan = {
    decision: "block",
    blocked: 1,
    warned: 0,
    blockingRules: ["network-access"],
    warningRules: [],
    violations: [{ rule: "network-access", severity: "block", line: 1, excerpt: "fetch(" }],
  };

  const r = guard({ mode: "build", action: "write", path: DENTRO, workspace: WS, scan });
  assert.equal(r.decision, "ask", "modo permite, mas a aprovação pede humano");
  assert.ok(r.questions.length > 0);
  assert.match(r.reason, /network/);
});

test("block do modo não é transformado em ask pela aprovação", () => {
  const scan = {
    decision: "block",
    blocked: 1,
    warned: 0,
    blockingRules: ["network-access"],
    warningRules: [],
    violations: [{ rule: "network-access", severity: "block", line: 1, excerpt: "fetch(" }],
  };
  const r = guard({ mode: "plan", action: "write", path: DENTRO, workspace: WS, scan });
  assert.equal(r.decision, "block", "proibição do modo não é negociável");
  assert.match(r.reason, /plan não escreve/);
});

test("ação desconhecida é recusada com o nome no motivo", () => {
  const r = guard({ mode: "build", action: "teleportar" });
  assert.equal(r.decision, "block");
  assert.match(r.reason, /ação desconhecida/);
});

/* ------------------------------------------------------------------ */
/* A regra de ouro                                                     */
/* ------------------------------------------------------------------ */

test("nenhum modo é decorativo", () => {
  const desc = describeModes();
  assert.equal(desc.length, MODE_NAMES.length);

  for (const modo of desc) {
    const temBase = modo.base !== null || modo.execScope === "inherit";
    const difere = desc.some(
      (o) =>
        o.name !== modo.name &&
        (o.canRead !== modo.canRead ||
          o.canWrite !== modo.canWrite ||
          o.canExec !== modo.canExec ||
          o.execScope !== modo.execScope ||
          o.ask !== modo.ask)
    );
    assert.ok(temBase || difere, `"${modo.name}" não muda nada em relação a nenhum outro`);
  }
});

test("as diferenças que importam existem de fato", () => {
  assert.notEqual(resolveMode("plan").canWrite, resolveMode("build").canWrite, "plan x build: escrever");
  assert.notEqual(resolveMode("plan").canExec, resolveMode("ask").canExec, "plan x ask: executar");
  assert.notEqual(resolveMode("plan").execScope, resolveMode("build").execScope, "plan x build: alcance");
  assert.equal(MODES.goal.base, "build", "goal declara base: muda escopo, não permissão");
});

test("modeList e o registro não expõem yolo", () => {
  assert.equal(modeList(), "plan, build, ask, goal");
  assert.equal(Object.hasOwn(MODES, "yolo"), false);
  assert.equal(Object.hasOwn(MODES, "bypass"), false);
});