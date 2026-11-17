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
  assert.equal(modeList(), "plan, build, manual, ask, goal");
  assert.equal(Object.hasOwn(MODES, "yolo"), false);
  assert.equal(Object.hasOwn(MODES, "bypass"), false);
});

/* ------------------------------------------------------------------ */
/* describePermissions — o que a TUI mostra                            */
/* ------------------------------------------------------------------ */

import { describePermissions, permissionLabel, describeAllPermissions } from "./modes.mjs";

test("os três modos devolvem rótulo, resumo e asks corretos", () => {
  const plan = describePermissions({ mode: "plan" });
  assert.equal(plan.mode, "plan");
  assert.equal(plan.label, "Leitura apenas");
  assert.equal(plan.canRead, true);
  assert.equal(plan.canWrite, false);
  assert.equal(plan.canExec, true);
  assert.equal(plan.execScope, "readonly");
  assert.ok(plan.summary.length > 20, "resumo tem de dizer o que o modo faz");
  assert.ok(!/\?$/.test(plan.summary), "resumo é afirmação, não pergunta");
  assert.deepEqual(plan.asks.map((a) => a.trigger), ["write", "exec"]);

  const build = describePermissions({ mode: "build" });
  assert.equal(build.mode, "build");
  assert.equal(build.label, "Aceita edições");
  assert.equal(build.canWrite, true);
  assert.deepEqual(build.asks.map((a) => a.trigger), ["outside-workspace", "approval"]);

  const ask = describePermissions({ mode: "ask" });
  assert.equal(ask.mode, "ask");
  assert.equal(ask.label, "Consulta apenas");
  assert.equal(ask.canWrite, false);
  assert.equal(ask.canExec, false);
  assert.equal(ask.execScope, "none");
  assert.deepEqual(ask.asks.map((a) => a.trigger), ["write", "exec"]);
});

test("label é curto o bastante para a linha de status", () => {
  for (const nome of MODE_NAMES) {
    const d = describePermissions({ mode: nome });
    assert.ok(d.label.length > 0, `${nome} tem rótulo`);
    assert.ok(d.label.length <= 24, `rótulo de ${nome} tem ${d.label.length} chars: "${d.label}"`);
  }
});

test("modo inválido não quebra e falha fechado", () => {
  for (const ruim of ["yolo", "bypassPermissions", "turbo", "", null, undefined, 42]) {
    const d = describePermissions({ mode: ruim });
    assert.equal(d.label, "Modo desconhecido");
    assert.equal(d.canRead, false, "modo desconhecido não lê");
    assert.equal(d.canWrite, false);
    assert.equal(d.canExec, false);
    assert.equal(d.execScope, "none");
    assert.deepEqual(d.asks, []);
  }
  // sem argumento nenhum também não lança
  assert.equal(describePermissions().label, "Modo desconhecido");
});

test("as perguntas do tipo de permissão batem com as perguntas do guard", () => {
  // plan: o guard recusa a escrita e pergunta; o tipo de permissão anuncia isso
  const plano = describePermissions({ mode: "plan" });
  const escritaPlan = guard({ mode: "plan", action: "write", path: DENTRO, workspace: WS });
  assert.equal(escritaPlan.decision, "block");
  assert.ok(escritaPlan.questions.length > 0, "guard já pergunta ao recusar");
  assert.ok(plano.asks.some((a) => a.trigger === "write"));

  // build: o guard faz ask fora do workspace, e o tipo de permissão anuncia
  const build = describePermissions({ mode: "build" });
  const foraBuild = guard({ mode: "build", action: "write", path: FORA, workspace: WS });
  assert.equal(foraBuild.decision, "ask");
  assert.ok(build.asks.some((a) => a.trigger === "outside-workspace"));

  // ask: o guard bloqueia execução, e o tipo de permissão anuncia
  const ask = describePermissions({ mode: "ask" });
  assert.equal(guard({ mode: "ask", action: "exec", command: "ls" }).decision, "block");
  assert.ok(ask.asks.some((a) => a.trigger === "exec"));
});

test("todo texto de pergunta é curto e objetivo", () => {
  for (const d of describeAllPermissions()) {
    for (const a of d.asks) {
      assert.ok(a.question.endsWith("?"), `pergunta de ${d.mode}/${a.trigger} tem de terminar com ?`);
      assert.ok(a.question.length <= 90, `pergunta longa demais (${a.question.length}): ${a.question}`);
      assert.ok(!/tem certeza/i.test(a.question), "nada de 'você tem certeza?'");
    }
  }
});

test("as permissões do tipo batem com resolveMode", () => {
  for (const nome of MODE_NAMES) {
    const m = resolveMode(nome);
    const d = describePermissions({ mode: nome });
    assert.equal(d.canRead, m.canRead, nome);
    assert.equal(d.canWrite, m.canWrite, nome);
    assert.equal(d.canExec, m.canExec, nome);
    assert.equal(d.execScope, m.execScope, nome);
  }
});

test("goal recebe o rótulo da base, sem caso especial", () => {
  assert.equal(describePermissions({ mode: "goal" }).label, describePermissions({ mode: "build" }).label);
  assert.equal(
    describePermissions({ mode: "goal", base: "plan" }).label,
    describePermissions({ mode: "plan" }).label
  );
});

test("permissionLabel e describeAllPermissions são consistentes", () => {
  assert.equal(permissionLabel("plan"), "Leitura apenas");
  assert.equal(permissionLabel("yolo"), "Modo desconhecido");

  const todos = describeAllPermissions();
  assert.deepEqual(
    todos.map((d) => d.mode),
    MODE_NAMES
  );
  for (const d of todos) assert.equal(d.label, permissionLabel(d.mode));
});

/* ------------------------------------------------------------------ */
/* manual — o meio-termo entre plan e build                            */
/* ------------------------------------------------------------------ */

test("manual tem as permissões do build, mas confirma cada escrita", () => {
  const manual = resolveMode("manual");
  const build = resolveMode("build");

  assert.equal(manual.canRead, true);
  assert.equal(manual.canWrite, true);
  assert.equal(manual.canExec, true);
  assert.equal(manual.execScope, "workspace");

  // as permissões são as mesmas do build; a diferença está no que dispara a pergunta
  assert.deepEqual(
    { canRead: manual.canRead, canWrite: manual.canWrite, canExec: manual.canExec, execScope: manual.execScope },
    { canRead: build.canRead, canWrite: build.canWrite, canExec: build.canExec, execScope: build.execScope }
  );
  assert.notEqual(manual.ask, build.ask, "manual pergunta na escrita; build só fora do workspace");
});

test("em manual uma escrita DENTRO do workspace gera ask (não allow)", () => {
  let executou = false;
  const r = avaliar({
    mode: "manual",
    action: "write",
    path: DENTRO,
    workspace: WS,
    runner: () => {
      executou = true;
    },
  });

  assert.equal(r.guard.decision, "ask");
  assert.equal(r.guard.mode, "manual");
  assert.equal(r.executou, false, "ask não executa: espera o humano");
  assert.match(r.guard.reason, /confirma cada escrita/);
  assert.deepEqual(r.guard.questions, ["Confirmar esta escrita dentro do workspace?"]);
});

test("a MESMA escrita em build continua allow (a diferença existe)", () => {
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

  assert.equal(r.guard.decision, "allow");
  assert.equal(r.executou, true);
});

test("manual e build concordam fora do workspace, e discordam dentro", () => {
  const dentroManual = guardWrite({ mode: "manual", path: DENTRO, workspace: WS });
  const dentroBuild = guardWrite({ mode: "build", path: DENTRO, workspace: WS });
  assert.equal(dentroManual.decision, "ask");
  assert.equal(dentroBuild.decision, "allow");

  const foraManual = guardWrite({ mode: "manual", path: FORA, workspace: WS });
  const foraBuild = guardWrite({ mode: "build", path: FORA, workspace: WS });
  assert.equal(foraManual.decision, "ask");
  assert.equal(foraBuild.decision, "ask");
  assert.ok(foraManual.questions.some((q) => /fora do workspace/.test(q)));
});

test("em manual a leitura continua allow e a execução também", () => {
  assert.equal(guard({ mode: "manual", action: "read" }).decision, "allow");
  assert.equal(guard({ mode: "manual", action: "exec", command: "ls" }).decision, "allow");
  assert.equal(guard({ mode: "manual", action: "exec", command: "npm install" }).decision, "allow");
});

test("manual aparece na linha de status com rótulo próprio e curto", () => {
  const d = describePermissions({ mode: "manual" });
  assert.equal(d.label, "Confirma cada escrita");
  assert.ok(d.label.length <= 24, `${d.label.length} chars`);
  assert.match(d.summary, /confirma cada escrita/);
  assert.deepEqual(d.asks.map((a) => a.trigger), ["write", "approval"]);
  assert.notEqual(d.label, describePermissions({ mode: "build" }).label, "rótulos não podem colidir");
});

test("manual não enfraquece plan nem ask", () => {
  assert.equal(resolveMode("plan").canWrite, false);
  assert.equal(resolveMode("ask").canWrite, false);
  assert.equal(resolveMode("manual").canWrite, true);
  assert.equal(guard({ mode: "plan", action: "write", path: DENTRO, workspace: WS }).decision, "block");
  assert.equal(guard({ mode: "ask", action: "write", path: DENTRO, workspace: WS }).decision, "block");
});