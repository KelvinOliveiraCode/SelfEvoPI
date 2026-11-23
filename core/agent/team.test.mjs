import test, { after } from "node:test";
import assert from "node:assert/strict";

import { mkdtemp, readFile, rm, writeFile, mkdir, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createTeam,
  postMessage,
  inbox,
  markRead,
  assignTask,
  advanceTask,
  board,
  runTeamStep,
  slugifyTeamName,
  teamsDir,
  TASK_STATES,
  TASK_TRANSITIONS,
  TEAM_VERSION,
} from "./team.mjs";

/* ------------------------------------------------------------------ */
/* Diretórios descartáveis                                             */
/* ------------------------------------------------------------------ */

const roots = [];

/** Cria uma raiz temporária (workspace descartável) e registra para limpeza. */
async function makeRoot() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "selfevopi-team-"));
  roots.push(dir);
  return dir;
}

/** Relógio falso determinístico: cada chamada avança `step` ms a partir de `t0`. */
function fakeClock(t0 = 0, step = 1000) {
  let t = t0;
  const fn = () => new Date(t);
  fn.advance = (ms) => { t += ms; };
  fn.set = (ms) => { t = ms; };
  fn.now = () => t;
  return fn;
}

after(async () => {
  for (const dir of roots) await rm(dir, { recursive: true, force: true });
});

/** Lê o documento cru de uma equipe do disco. */
async function readRaw(root, id) {
  const file = path.join(teamsDir(root), `${id}.json`);
  return JSON.parse(await readFile(file, "utf8"));
}

/* ------------------------------------------------------------------ */
/* slugifyTeamName                                                     */
/* ------------------------------------------------------------------ */

test("slugifyTeamName: normaliza acento, caixa e espaços", () => {
  assert.equal(slugifyTeamName("Equipe Ação 01"), "equipe-acao-01");
  assert.equal(slugifyTeamName("  Forge!!  "), "forge");
  assert.equal(slugifyTeamName("Ação & Reação"), "acao-reacao");
});

test("slugifyTeamName: nome só com símbolos vira vazio", () => {
  assert.equal(slugifyTeamName("!!!"), "");
});

/* ------------------------------------------------------------------ */
/* createTeam                                                          */
/* ------------------------------------------------------------------ */

test("createTeam: cria o arquivo em .pi/harness/teams/<id>.json", async () => {
  const root = await makeRoot();
  const res = await createTeam({ name: "Equipe Alpha", members: ["a1", "a2"], root, now: fakeClock(1000) });
  assert.equal(res.ok, true);
  assert.equal(res.team.id, "equipe-alpha");
  assert.equal(res.team.version, TEAM_VERSION);
  assert.equal(res.team.name, "Equipe Alpha");
  assert.equal(res.team.members.length, 2);
  assert.equal(res.team.members[0].id, "a1");

  const file = path.join(teamsDir(root), "equipe-alpha.json");
  assert.equal(res.file, file);
  const raw = await readRaw(root, "equipe-alpha");
  assert.equal(raw.id, "equipe-alpha");
  assert.deepEqual(raw.tasks, []);
  assert.deepEqual(raw.messages, []);
});

test("createTeam: persiste instante via relógio injetado", async () => {
  const root = await makeRoot();
  const clock = fakeClock(5_000);
  const res = await createTeam({ name: "Relogio", root, now: clock });
  assert.equal(res.ok, true);
  assert.equal(res.team.createdAt, new Date(5_000).toISOString());
});

test("createTeam: aceita membros como objetos { id, role }", async () => {
  const root = await makeRoot();
  const res = await createTeam({
    name: "Membros",
    members: [{ id: "dev", role: "builder" }, { name: "rev" }, "qa"],
    root,
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.team.members, [
    { id: "dev", role: "builder" },
    { id: "rev", role: "member" },
    { id: "qa", role: "member" },
  ]);
});

test("createTeam: recusa recriar equipe existente (não sobrescreve)", async () => {
  const root = await makeRoot();
  const first = await createTeam({ name: "Duplicada", root });
  assert.equal(first.ok, true);
  const second = await createTeam({ name: "Duplicada", root });
  assert.equal(second.ok, false);
  assert.equal(second.code, "exists");
});

test("createTeam: nome vazio é recusado", async () => {
  const root = await makeRoot();
  const res = await createTeam({ name: "!!!", root });
  assert.equal(res.ok, false);
  assert.equal(res.code, "invalid");
});

test("createTeam: não deixa arquivo temporário para trás", async () => {
  const root = await makeRoot();
  await createTeam({ name: "Atomo", root });
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(teamsDir(root));
  assert.deepEqual(files, ["atomo.json"]);
});

/* ------------------------------------------------------------------ */
/* Arquivo corrompido / ausente                                        */
/* ------------------------------------------------------------------ */

test("inbox: equipe inexistente devolve erro explícito (não lança)", async () => {
  const root = await makeRoot();
  const res = await inbox("fantasma", "a1", { root });
  assert.equal(res.ok, false);
  assert.match(res.error, /não encontrada/);
});

test("board: arquivo corrompido devolve erro, nunca lança", async () => {
  const root = await makeRoot();
  const dir = teamsDir(root);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "quebrada.json"), "{ isto não é json ", "utf8");

  const res = await board("quebrada", { root });
  assert.equal(res.ok, false);
  assert.equal(res.code, "corrupt");
  assert.match(res.error, /corrompido/);
});

test("board: arquivo vazio devolve erro explícito", async () => {
  const root = await makeRoot();
  const dir = teamsDir(root);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "vazia.json"), "   \n", "utf8");

  const res = await board("vazia", { root });
  assert.equal(res.ok, false);
  assert.equal(res.code, "corrupt");
});

test("id de equipe inválido é recusado antes de tocar disco", async () => {
  const root = await makeRoot();
  const res = await inbox("../etc/passwd", "a1", { root });
  assert.equal(res.ok, false);
  assert.match(res.error, /inválido/);
});

/* ------------------------------------------------------------------ */
/* Mensagens                                                           */
/* ------------------------------------------------------------------ */

test("postMessage: grava mensagem com timestamp e destinatário", async () => {
  const root = await makeRoot();
  await createTeam({ name: "Msg", members: ["a1", "a2"], root });

  const clock = fakeClock(10_000);
  const res = await postMessage("msg", { from: "a1", to: "a2", text: "olá" }, { root, now: clock });
  assert.equal(res.ok, true);
  assert.equal(res.message.from, "a1");
  assert.equal(res.message.to, "a2");
  assert.equal(res.message.text, "olá");
  assert.equal(res.message.read, false);
  assert.equal(res.message.at, new Date(10_000).toISOString());
  assert.equal(res.message.id, "m1");
});

test("postMessage: exige from, to e text", async () => {
  const root = await makeRoot();
  await createTeam({ name: "Valid", root });
  assert.equal((await postMessage("valid", { to: "a2", text: "x" }, { root })).ok, false);
  assert.equal((await postMessage("valid", { from: "a1", text: "x" }, { root })).ok, false);
  assert.equal((await postMessage("valid", { from: "a1", to: "a2", text: "  " }, { root })).ok, false);
});

test("inbox: devolve só mensagens não lidas do agente", async () => {
  const root = await makeRoot();
  await createTeam({ name: "Caixa", root });
  await postMessage("caixa", { from: "x", to: "a1", text: "oi a1" }, { root });
  await postMessage("caixa", { from: "x", to: "a2", text: "oi a2" }, { root });
  await postMessage("caixa", { from: "y", to: "a1", text: "de novo a1" }, { root });

  const res = await inbox("caixa", "a1", { root });
  assert.equal(res.ok, true);
  assert.equal(res.messages.length, 2);
  assert.ok(res.messages.every((m) => m.to === "a1"));
});

test("markRead: marca todas as do agente e esvazia a caixa", async () => {
  const root = await makeRoot();
  await createTeam({ name: "Lidas", root });
  await postMessage("lidas", { from: "x", to: "a1", text: "1" }, { root });
  await postMessage("lidas", { from: "x", to: "a1", text: "2" }, { root });
  await postMessage("lidas", { from: "x", to: "a2", text: "3" }, { root });

  const marked = await markRead("lidas", "a1", { root, now: fakeClock(20_000) });
  assert.equal(marked.ok, true);
  assert.equal(marked.marked, 2);

  assert.equal((await inbox("lidas", "a1", { root })).messages.length, 0);
  // a2 continua com a sua
  assert.equal((await inbox("lidas", "a2", { root })).messages.length, 1);
});

test("markRead: com ids marca apenas as indicadas", async () => {
  const root = await makeRoot();
  await createTeam({ name: "Ids", root });
  await postMessage("ids", { from: "x", to: "a1", text: "1" }, { root });
  await postMessage("ids", { from: "x", to: "a1", text: "2" }, { root });

  const marked = await markRead("ids", "a1", { root, ids: ["m1"] });
  assert.equal(marked.marked, 1);
  const rest = await inbox("ids", "a1", { root });
  assert.equal(rest.messages.length, 1);
  assert.equal(rest.messages[0].id, "m2");
});

test("mensagens persistem entre chamadas (reload do disco)", async () => {
  const root = await makeRoot();
  await createTeam({ name: "Persist", root });
  await postMessage("persist", { from: "a", to: "b", text: "atravessa" }, { root });

  // Nova leitura (simula processo novo) enxerga a mensagem gravada.
  const raw = await readRaw(root, "persist");
  assert.equal(raw.messages.length, 1);
  assert.equal(raw.messages[0].text, "atravessa");
});

/* ------------------------------------------------------------------ */
/* Tarefas                                                             */
/* ------------------------------------------------------------------ */

test("assignTask: cria tarefa pending com id sequencial", async () => {
  const root = await makeRoot();
  await createTeam({ name: "Tasks", root });

  const t1 = await assignTask("tasks", { agentId: "a1", goal: "fazer X", context: "ctx" }, { root });
  assert.equal(t1.ok, true);
  assert.equal(t1.task.id, "t1");
  assert.equal(t1.task.status, "pending");
  assert.equal(t1.task.agentId, "a1");
  assert.equal(t1.task.goal, "fazer X");
  assert.equal(t1.task.context, "ctx");

  const t2 = await assignTask("tasks", { agentId: "a2", goal: "fazer Y" }, { root });
  assert.equal(t2.task.id, "t2");
});

test("assignTask: exige agentId e goal", async () => {
  const root = await makeRoot();
  await createTeam({ name: "TaskVal", root });
  assert.equal((await assignTask("taskval", { goal: "x" }, { root })).ok, false);
  assert.equal((await assignTask("taskval", { agentId: "a1" }, { root })).ok, false);
});

test("advanceTask: respeita a máquina de estados", async () => {
  const root = await makeRoot();
  await createTeam({ name: "Fsm", root });
  await assignTask("fsm", { agentId: "a1", goal: "g" }, { root });

  // pending -> active
  const toActive = await advanceTask("fsm", "t1", "active", { root });
  assert.equal(toActive.ok, true);
  assert.equal(toActive.task.status, "active");

  // active -> done
  const toDone = await advanceTask("fsm", "t1", "done", { root });
  assert.equal(toDone.ok, true);
  assert.equal(toDone.task.status, "done");

  // done -> qualquer coisa é recusado (terminal)
  const illegal = await advanceTask("fsm", "t1", "active", { root });
  assert.equal(illegal.ok, false);
  assert.match(illegal.error, /transição inválida/);
});

test("advanceTask: pending -> done é transição inválida", async () => {
  const root = await makeRoot();
  await createTeam({ name: "Skip", root });
  await assignTask("skip", { agentId: "a1", goal: "g" }, { root });

  const res = await advanceTask("skip", "t1", "done", { root });
  assert.equal(res.ok, false);
  assert.match(res.error, /transição inválida/);
});

test("advanceTask: estado inválido é recusado", async () => {
  const root = await makeRoot();
  await createTeam({ name: "BadState", root });
  await assignTask("badstate", { agentId: "a1", goal: "g" }, { root });
  const res = await advanceTask("badstate", "t1", "voando", { root });
  assert.equal(res.ok, false);
  assert.match(res.error, /estado inválido/);
});

test("advanceTask: mesmo estado é no-op idempotente", async () => {
  const root = await makeRoot();
  await createTeam({ name: "Noop", root });
  await assignTask("noop", { agentId: "a1", goal: "g" }, { root });
  const res = await advanceTask("noop", "t1", "pending", { root });
  assert.equal(res.ok, true);
  assert.equal(res.changed, false);
});

test("advanceTask: tarefa inexistente devolve erro", async () => {
  const root = await makeRoot();
  await createTeam({ name: "NoTask", root });
  const res = await advanceTask("notask", "t99", "active", { root });
  assert.equal(res.ok, false);
  assert.match(res.error, /não encontrada/);
});

test("TASK_TRANSITIONS: done é terminal e bloqueado reabre", () => {
  assert.deepEqual(TASK_TRANSITIONS.done, []);
  assert.ok(TASK_TRANSITIONS.blocked.includes("active"));
  assert.ok(TASK_TRANSITIONS.blocked.includes("pending"));
  assert.deepEqual([...TASK_STATES], ["pending", "active", "blocked", "done"]);
});

/* ------------------------------------------------------------------ */
/* Quadro                                                              */
/* ------------------------------------------------------------------ */

test("board: agrupa tarefas por estado e soma contagens", async () => {
  const root = await makeRoot();
  await createTeam({ name: "Quadro", members: ["a1", "a2"], root });

  await assignTask("quadro", { agentId: "a1", goal: "t1" }, { root });
  await assignTask("quadro", { agentId: "a1", goal: "t2" }, { root });
  await assignTask("quadro", { agentId: "a2", goal: "t3" }, { root });
  await advanceTask("quadro", "t1", "active", { root });
  await advanceTask("quadro", "t2", "active", { root });
  await advanceTask("quadro", "t2", "done", { root });

  const res = await board("quadro", { root });
  assert.equal(res.ok, true);
  assert.equal(res.board.id, "quadro");
  assert.deepEqual(res.board.counts, { pending: 1, active: 1, blocked: 0, done: 1 });
  assert.equal(res.board.columns.pending.length, 1);
  assert.equal(res.board.columns.active[0].id, "t1");
  assert.equal(res.board.columns.done[0].id, "t2");
  assert.equal(res.board.members.length, 2);
});

test("board: devolve cópias (mexer no resultado não afeta disco)", async () => {
  const root = await makeRoot();
  await createTeam({ name: "Copy", root });
  await assignTask("copy", { agentId: "a1", goal: "g" }, { root });

  const res = await board("copy", { root });
  res.board.columns.pending[0].goal = "alterado";
  const raw = await readRaw(root, "copy");
  assert.equal(raw.tasks[0].goal, "g");
});

/* ------------------------------------------------------------------ */
/* runTeamStep (determinístico)                                        */
/* ------------------------------------------------------------------ */

test("runTeamStep: ativa a 1ª pending e avisa o agente", async () => {
  const root = await makeRoot();
  await createTeam({ name: "Passo", root });
  await assignTask("passo", { agentId: "dev", goal: "construir" }, { root });

  const res = await runTeamStep("passo", { root, now: fakeClock(30_000) });
  assert.equal(res.ok, true);
  assert.equal(res.step.taskId, "t1");
  assert.equal(res.step.from, "pending");
  assert.equal(res.step.to, "active");
  assert.equal(res.step.message.to, "dev");
  assert.match(res.step.message.text, /started/);

  // A mensagem está na caixa do dev.
  const box = await inbox("passo", "dev", { root });
  assert.equal(box.messages.length, 1);
  assert.equal(box.messages[0].from, "team");
});

test("runTeamStep: conclui uma active quando não há pending", async () => {
  const root = await makeRoot();
  await createTeam({ name: "Passo2", root });
  await assignTask("passo2", { agentId: "dev", goal: "g" }, { root });
  await advanceTask("passo2", "t1", "active", { root });

  const res = await runTeamStep("passo2", { root });
  assert.equal(res.ok, true);
  assert.equal(res.step.from, "active");
  assert.equal(res.step.to, "done");
  assert.match(res.step.message.text, /done/);
});

test("runTeamStep: prioriza pending sobre active", async () => {
  const root = await makeRoot();
  await createTeam({ name: "Prio", root });
  await assignTask("prio", { agentId: "a", goal: "primeira" }, { root }); // t1
  await assignTask("prio", { agentId: "b", goal: "segunda" }, { root });  // t2
  await advanceTask("prio", "t1", "active", { root });

  const res = await runTeamStep("prio", { root });
  assert.equal(res.step.taskId, "t2"); // a pending, não a active
  assert.equal(res.step.to, "active");
});

test("runTeamStep: sem tarefas pendentes/ativas não avança", async () => {
  const root = await makeRoot();
  await createTeam({ name: "Vazio", root });
  const res = await runTeamStep("vazio", { root });
  assert.equal(res.ok, true);
  assert.equal(res.step.taskId, null);
  assert.equal(res.step.message, null);
});

test("runTeamStep: taskId força a tarefa alvo", async () => {
  const root = await makeRoot();
  await createTeam({ name: "Forcado", root });
  await assignTask("forcado", { agentId: "a", goal: "1" }, { root });
  await assignTask("forcado", { agentId: "b", goal: "2" }, { root });

  const res = await runTeamStep("forcado", { root, taskId: "t2" });
  assert.equal(res.step.taskId, "t2");
});

test("runTeamStep: determinístico (mesmo estado inicial, mesmo passo)", async () => {
  // Duas raízes idênticas produzem a mesma transição.
  const r1 = await makeRoot();
  const r2 = await makeRoot();
  for (const r of [r1, r2]) {
    await createTeam({ name: "Det", root: r });
    await assignTask("det", { agentId: "a", goal: "g1" }, { root: r });
    await assignTask("det", { agentId: "b", goal: "g2" }, { root: r });
  }
  const clock1 = fakeClock(40_000);
  const clock2 = fakeClock(40_000);
  const s1 = await runTeamStep("det", { root: r1, now: clock1 });
  const s2 = await runTeamStep("det", { root: r2, now: clock2 });
  assert.deepEqual(s1.step, s2.step);
});

test("runTeamStep: avança o cursor a cada passo", async () => {
  const root = await makeRoot();
  await createTeam({ name: "Cursor", root });
  await assignTask("cursor", { agentId: "a", goal: "1" }, { root });
  await assignTask("cursor", { agentId: "b", goal: "2" }, { root });

  await runTeamStep("cursor", { root });
  const second = await runTeamStep("cursor", { root });
  assert.equal(second.step.step, 2);
});

test("runTeamStep: sequência completa leva as tarefas ao fim", async () => {
  const root = await makeRoot();
  await createTeam({ name: "Ciclo", root });
  await assignTask("ciclo", { agentId: "a", goal: "1" }, { root }); // t1
  await assignTask("ciclo", { agentId: "b", goal: "2" }, { root }); // t2

  // t1: pending->active, depois active->done; t2 idem.
  await runTeamStep("ciclo", { root }); // t1 active
  await runTeamStep("ciclo", { root }); // t1 done
  await runTeamStep("ciclo", { root }); // t2 active
  await runTeamStep("ciclo", { root }); // t2 done

  const b = await board("ciclo", { root });
  assert.equal(b.board.counts.done, 2);
  assert.equal(b.board.counts.pending, 0);
  assert.equal(b.board.counts.active, 0);
});

/* ------------------------------------------------------------------ */
/* Escrita atómica                                                     */
/* ------------------------------------------------------------------ */

test("escrita é atómica: nenhum .tmp sobrevive a mutações", async () => {
  const root = await makeRoot();
  await createTeam({ name: "Tmp", root });
  await assignTask("tmp", { agentId: "a", goal: "g" }, { root });
  await postMessage("tmp", { from: "a", to: "a", text: "x" }, { root });
  await advanceTask("tmp", "t1", "active", { root });

  const { readdir } = await import("node:fs/promises");
  const files = await readdir(teamsDir(root));
  assert.deepEqual(files, ["tmp.json"]);
});

test("createTeam respeita root custom (não usa cwd)", async () => {
  const root = await makeRoot();
  const res = await createTeam({ name: "RootCheck", root });
  assert.equal(res.ok, true);
  // O arquivo existe dentro da raiz temporária.
  await access(path.join(teamsDir(root), "rootcheck.json"));
  // E NÃO no cwd do processo de teste.
  await assert.rejects(access(path.join(process.cwd(), ".pi", "harness", "teams", "rootcheck.json")));
});