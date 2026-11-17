import test from "node:test";
import assert from "node:assert/strict";

import {
  setGoal,
  clearGoal,
  evaluateGoal,
  goalIndicator,
} from "./goal.mjs";

/* ------------------------------ setGoal / clearGoal --------------------- */

test("setGoal grava a condição e devolve novo estado", () => {
  const state = setGoal({}, "deixar o servidor no ar");
  assert.equal(state.goal.condition, "deixar o servidor no ar");
  assert.ok(state.goal.setAt, "setAt preenchido");
});

test("setGoal não muta o estado anterior (imutável)", () => {
  const before = { goal: null };
  const after = setGoal(before, "condição X");
  assert.equal(before.goal, null, "estado original intacto");
  assert.equal(after.goal.condition, "condição X");
});

test("setGoal recusa condição vazia", () => {
  assert.throws(() => setGoal({}, "   "), /condição não pode ser vazia/);
});

test("clearGoal remove a condição", () => {
  const state = setGoal({}, "algo");
  const cleared = clearGoal(state);
  assert.equal(cleared.goal, null);
  assert.equal(state.goal.condition, "algo", "estado original intacto");
});

test("clearGoal em estado sem goal não quebra", () => {
  assert.equal(clearGoal({}).goal, null);
});

/* ------------------------------ goalIndicator --------------------------- */

test("goalIndicator mostra '◎ /goal active' quando há goal", () => {
  const state = setGoal({}, "algo");
  assert.equal(goalIndicator(state), "◎ /goal active");
});

test("goalIndicator devolve null sem goal", () => {
  assert.equal(goalIndicator({}), null);
  assert.equal(goalIndicator({ goal: null }), null);
});

/* ------------------------------ evaluateGoal: satisfeita ------------------ */

test("condição satisfeita quando o turno cobre a condição", () => {
  const state = setGoal({}, "adicionar testes de integração e rodar a suíte");
  const lastTurn = "Pronto: adicionei os testes de integração e rodei a suíte, tudo verde.";
  const r = evaluateGoal(state, { lastTurn });
  assert.equal(r.done, true);
  assert.equal(r.impossible, false);
  // o turno traz "pronto" (marcador), então a regra é "conclusão sinalizada".
  assert.match(r.reason, /conclusão sinalizada|satisfeita/);
});

/* ------------------------------ evaluateGoal: impossível ------------------ */

test("condição impossível quando o turno declara impossibilidade", () => {
  const state = setGoal({}, "fazer o servidor subir na porta 80");
  const r = evaluateGoal(state, { lastTurn: "Isso é impossível sem privilégios de root." });
  assert.equal(r.done, false);
  assert.equal(r.impossible, true);
  assert.match(r.reason, /impossível/);
});

/* ------------------------------ evaluateGoal: falha de turno -------------- */

test("turno que falhou marca impossível (erro que o usuário precisa corrigir)", () => {
  const state = setGoal({}, "configurar o deploy");
  const r = evaluateGoal(state, { lastTurn: "Erro: não foi possível conectar ao servidor de deploy." });
  assert.equal(r.done, false);
  assert.equal(r.impossible, true);
  assert.match(r.reason, /falha|erro/i);
});

/* ------------------------------ evaluateGoal: pendente -------------------- */

test("condição pendente quando o turno não cobre a condição", () => {
  const state = setGoal({}, "escrever a documentação completa da API");
  const r = evaluateGoal(state, { lastTurn: "Vou começar analisando o código." });
  assert.equal(r.done, false);
  assert.equal(r.impossible, false);
  assert.match(r.reason, /pendente/);
});

test("sem goal, evaluateGoal devolve done", () => {
  const r = evaluateGoal({}, { lastTurn: "qualquer coisa" });
  assert.equal(r.done, true);
  assert.equal(r.impossible, false);
  assert.match(r.reason, /sem goal/);
});

/* ------------------------------ deps.judge (ponto de extensão) ------------ */

test("deps.judge tem a palavra final quando passado", () => {
  const state = setGoal({}, "qualquer condição");
  const judge = () => ({ done: true, impossible: false, reason: "decisão do juiz" });
  const r = evaluateGoal(state, { lastTurn: "texto qualquer" }, { judge });
  assert.equal(r.done, true);
  assert.equal(r.reason, "decisão do juiz");
});

test("deps.judge pode marcar impossível", () => {
  const state = setGoal({}, "condição");
  const judge = () => ({ done: false, impossible: true, reason: "juiz decidiu" });
  const r = evaluateGoal(state, { lastTurn: "x" }, { judge });
  assert.equal(r.impossible, true);
});

/* ------------------------------ ciclo completo ---------------------------- */

test("ciclo completo set → eval → clear", () => {
  let state = {};
  // 1. define
  state = setGoal(state, "resolver o bug de login");
  assert.equal(goalIndicator(state), "◎ /goal active");

  // 2. avalia pendente
  let r = evaluateGoal(state, { lastTurn: "Investigando o fluxo de autenticação." });
  assert.equal(r.done, false);

  // 3. avalia satisfeito
  r = evaluateGoal(state, { lastTurn: "Bug de login resolvido: ajustei a validação e os testes passam." });
  assert.equal(r.done, true);

  // 4. limpa
  state = clearGoal(state);
  assert.equal(goalIndicator(state), null);
  assert.equal(evaluateGoal(state, { lastTurn: "x" }).done, true);
});

/* ------------------------------ determinismo ------------------------------ */

test("evaluateGoal é determinístico (mesma entrada, mesma saída)", () => {
  const state = setGoal({}, "rodar a suíte de testes");
  const a = evaluateGoal(state, { lastTurn: "Suíte de testes rodando." });
  const b = evaluateGoal(state, { lastTurn: "Suíte de testes rodando." });
  assert.deepEqual(a, b);
});

test("avaliação não chama modelo (é pura)", () => {
  // se chamasse modelo, precisaria de rede/credencial; aqui roda offline.
  const state = setGoal({}, "condição");
  const r = evaluateGoal(state, { lastTurn: "texto" });
  assert.equal(typeof r.done, "boolean");
});

/* -------------------- marcador de conclusão + cobertura ------------------- */

test("caso do revisor: 'pronto, extraí os dados do HTML' fecha (marcador + 33%)", () => {
  const state = setGoal({}, "extrair dados de um HTML local");
  const r = evaluateGoal(state, { lastTurn: "pronto, extraí os dados do HTML" });
  assert.equal(r.done, true, JSON.stringify(r));
  assert.equal(r.impossible, false);
  assert.match(r.reason, /conclusão sinalizada/i);
});

test("conclusão com marcador e cobertura baixa fecha (done)", () => {
  // cobertura ~50% (>=0.3, <0.8) com marcador "pronto"
  const state = setGoal({}, "extrair os dados de uma tabela HTML");
  const r = evaluateGoal(state, { lastTurn: "pronto, extraí os dados do HTML" });
  assert.equal(r.done, true, JSON.stringify(r));
  assert.match(r.reason, /conclusão sinalizada/);
});

test("conclusão sem marcador e cobertura alta fecha (done)", () => {
  // turno repete quase toda a condição, sem palavra de conclusão
  const state = setGoal({}, "corrigir o bug do parser de JSON");
  const r = evaluateGoal(state, { lastTurn: "corrigi o bug do parser de JSON" });
  assert.equal(r.done, true, JSON.stringify(r));
});

test("marcador de conclusão mas cobertura zero não fecha (pending)", () => {
  const state = setGoal({}, "extrair dados de um HTML local");
  // "pronto" mas não fala do tema da condição
  const r = evaluateGoal(state, { lastTurn: "pronto, vou almoçar agora" });
  assert.equal(r.done, false, JSON.stringify(r));
  assert.equal(r.impossible, false);
  assert.match(r.reason, /cobertura/i);
});

test("frase de continuação sem marcador e cobertura baixa não fecha", () => {
  const state = setGoal({}, "extrair dados de um HTML local");
  const r = evaluateGoal(state, { lastTurn: "continuo trabalhando nisso" });
  assert.equal(r.done, false, JSON.stringify(r));
  assert.equal(r.impossible, false);
});

test("limiares nomeados e documentados (0.3 e 0.8)", async () => {
  const { DONE_COVERAGE_MIN, DONE_COVERAGE_STRONG } = await import("./goal.mjs");
  assert.equal(DONE_COVERAGE_MIN, 0.3);
  assert.equal(DONE_COVERAGE_STRONG, 0.8);
});