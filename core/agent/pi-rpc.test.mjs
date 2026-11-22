#!/usr/bin/env node
/**
 * core/agent/pi-rpc.test.mjs — o mapeamento evento → callback, com um DUBLÊ
 * de RPC. Não precisa do motor instalado: roda no CI.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { createPiClient, normalizeEvent, findEngine, buildEngineArgs } from "./pi-rpc.mjs";

/** Dublê de RpcClient: registra chamadas e deixa o teste emitir eventos. */
function makeFakeRpc() {
  const listeners = [];
  const calls = [];
  return {
    calls,
    onEvent(fn) {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    start: async () => void calls.push(["start"]),
    stop: async () => void calls.push(["stop"]),
    prompt: async (m) => (calls.push(["prompt", m]), "started"),
    abort: async () => void calls.push(["abort"]),
    newSession: async () => (calls.push(["newSession"]), { cancelled: false }),
    setModel: async (p, id) => (calls.push(["setModel", p, id]), { provider: p, id }),
    getAvailableModels: async () => (calls.push(["getAvailableModels"]), []),
    cycleModel: async () => (calls.push(["cycleModel"]), null),
    getState: async () => (calls.push(["getState"]), {}),
    /** Emite um evento cru para todos os inscritos (como o processo real faria). */
    emit(ev) {
      for (const fn of [...listeners]) fn(ev);
    },
    listenerCount: () => listeners.length,
  };
}

test("normalizeEvent: text_delta vira { kind: text }", () => {
  const n = normalizeEvent({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Olá " },
  });
  assert.deepEqual(n, { kind: "text", delta: "Olá " });
});

test("normalizeEvent: tool start/end viram { kind: tool }", () => {
  const start = normalizeEvent({
    type: "tool_execution_start",
    toolCallId: "c1",
    toolName: "read",
    args: { path: "a.txt" },
  });
  assert.equal(start.kind, "tool");
  assert.equal(start.phase, "start");
  assert.equal(start.name, "read");
  const end = normalizeEvent({
    type: "tool_execution_end",
    toolCallId: "c1",
    toolName: "read",
    isError: false,
    durationMs: 12,
  });
  assert.equal(end.phase, "end");
  assert.equal(end.isError, false);
});

test("normalizeEvent: agent_settled e eventos irrelevantes", () => {
  assert.deepEqual(normalizeEvent({ type: "agent_settled", aborted: true }), {
    kind: "settled",
    aborted: true,
  });
  assert.equal(normalizeEvent({ type: "agent_start" }), null);
  assert.equal(normalizeEvent(null), null);
  assert.equal(normalizeEvent({ type: "message_update", assistantMessageEvent: { type: "text_start" } }), null);
});

test("normalizeEvent: message_end de assistente com erro vira { kind: error }", () => {
  const n = normalizeEvent({
    type: "message_end",
    message: { role: "assistant", stopReason: "error", errorMessage: '401 {"error":"Invalid bearer token"}' },
  });
  assert.equal(n.kind, "error");
  assert.match(n.message, /401/);
  // mensagem assistente normal (stopReason "stop") não vira erro
  assert.equal(
    normalizeEvent({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [] } }),
    null,
  );
});

test("createPiClient: text_delta chega ao callback 'text' como string", async () => {
  const fake = makeFakeRpc();
  const pi = await createPiClient({ client: fake });
  const deltas = [];
  pi.on("text", (d) => deltas.push(d));
  fake.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hel" } });
  fake.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "lo" } });
  assert.deepEqual(deltas, ["Hel", "lo"]);
});

test("createPiClient: tool vira callback 'tool' com name/args/phase", async () => {
  const fake = makeFakeRpc();
  const pi = await createPiClient({ client: fake });
  const tools = [];
  pi.on("tool", (t) => tools.push(t));
  fake.emit({ type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: { command: "ls" } });
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "bash");
  assert.equal(tools[0].phase, "start");
  assert.deepEqual(tools[0].args, { command: "ls" });
});

test("createPiClient: agent_settled dispara 'settled' uma vez", async () => {
  const fake = makeFakeRpc();
  const pi = await createPiClient({ client: fake });
  let settled = 0;
  pi.on("settled", () => (settled += 1));
  fake.emit({ type: "agent_settled", aborted: false });
  fake.emit({ type: "agent_start" }); // irrelevante: não dispara nada
  assert.equal(settled, 1);
});

test("createPiClient: erro do modelo chega ao callback 'error' com o texto cru", async () => {
  const fake = makeFakeRpc();
  const pi = await createPiClient({ client: fake });
  const errs = [];
  pi.on("error", (m) => errs.push(m));
  fake.emit({
    type: "message_end",
    message: { role: "assistant", stopReason: "error", errorMessage: "401 Invalid bearer token" },
  });
  assert.equal(errs.length, 1);
  assert.match(errs[0], /401/);
});

test("createPiClient: prompt encaminha a mensagem ao rpc", async () => {
  const fake = makeFakeRpc();
  const pi = await createPiClient({ client: fake });
  await pi.prompt("explique este repositório");
  assert.deepEqual(fake.calls.at(-1), ["prompt", "explique este repositório"]);
});

test("createPiClient: abort e close chamam rpc.abort e rpc.stop", async () => {
  const fake = makeFakeRpc();
  const pi = await createPiClient({ client: fake });
  await pi.abort();
  await pi.close();
  assert.ok(fake.calls.some((c) => c[0] === "abort"));
  assert.ok(fake.calls.some((c) => c[0] === "stop"));
});

test("createPiClient: on() devolve cancelador que remove o callback", async () => {
  const fake = makeFakeRpc();
  const pi = await createPiClient({ client: fake });
  let n = 0;
  const off = pi.on("text", () => (n += 1));
  fake.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "a" } });
  off();
  fake.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "b" } });
  assert.equal(n, 1);
});

test("promptAndWait: texto vem completo (nao le cedo demais)", async () => {
  const fake = makeFakeRpc();
  const pi = await createPiClient({ client: fake });

  const wait = pi.promptAndWait("responda", 5000);
  // O motor responde "started" no prompt() e só depois emite os deltas.
  // Emula esse atraso: dispara os deltas no próximo tick.
  await Promise.resolve();
  fake.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Ola " } });
  fake.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "mundo" } });
  fake.emit({ type: "agent_settled", aborted: false });

  assert.equal(await wait, "Ola mundo");
});

test("promptAndWait: o caso 'li cedo demais' — leitura imediata da vazio, promptAndWait devolve texto", async () => {
  const fake = makeFakeRpc();
  const pi = await createPiClient({ client: fake });

  // script ingênuo: lê o texto logo após prompt() resolver (antes dos deltas).
  await pi.prompt("responda");
  let naive = "";
  pi.on("text", (d) => (naive += d));
  assert.equal(naive, ""); // ainda não chegou nenhum delta — texto vazio

  // ...mas os deltas chegam depois, e o promptAndWait os captura:
  const wait = pi.promptAndWait("responda", 5000);
  await Promise.resolve();
  fake.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "tarde " } });
  fake.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "demais" } });
  fake.emit({ type: "agent_settled", aborted: false });

  assert.equal(naive, "tarde demais"); // o listener ingênuo também vê os deltas — mas só depois
  assert.equal(await wait, "tarde demais");
});

test("promptAndWait: rejeita se o motor emitir erro antes do settled", async () => {
  const fake = makeFakeRpc();
  const pi = await createPiClient({ client: fake });

  const wait = pi.promptAndWait("x", 5000);
  await Promise.resolve();
  fake.emit({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "401 Invalid bearer token" } });

  await assert.rejects(wait, /401/);
});

test("promptAndWait: disposicao 'handled' resolve de imediato (sem pendurar)", async () => {
  const fake = makeFakeRpc();
  fake.prompt = async (m) => (fake.calls.push(["prompt", m]), "handled"); // comando de extensão
  const pi = await createPiClient({ client: fake });

  const text = await pi.promptAndWait("qualquer", 5000);
  assert.equal(text, ""); // nenhum run começou, nenhum settled viria
});

test("promptAndWait: timeout rejeita", async () => {
  const fake = makeFakeRpc();
  const pi = await createPiClient({ client: fake });

  // prompt dispara, mas nenhum settled chega dentro do timeout curto
  await assert.rejects(pi.promptAndWait("x", 30), /tempo esgotado/);
});

test("buildEngineArgs: nova sessão por padrão, retomada explícita e efêmera", () => {
  const novo = buildEngineArgs();
  assert.equal(novo[0], "--session-id");
  assert.match(novo[1], /^[0-9a-f-]{36}$/);
  assert.notEqual(buildEngineArgs()[1], novo[1], "cada abertura gera um id novo");
  assert.deepEqual(buildEngineArgs({ session: "resume", resumeId: "abc123" }), ["--session", "abc123"]);
  assert.deepEqual(buildEngineArgs({ session: "ephemeral" }), ["--no-session"]);
  assert.deepEqual(buildEngineArgs({ session: "new", sessionId: "fixo" }), ["--session-id", "fixo"]);
  assert.throws(() => buildEngineArgs({ session: "resume" }), /resumeId/);
});

test("findEngine: forceAbsent / SELFEOPI_FORCE_NO_ENGINE diz ausente", () => {
  assert.equal(findEngine({ forceAbsent: true }).available, false);
  const prev = process.env.SELFEOPI_FORCE_NO_ENGINE;
  process.env.SELFEOPI_FORCE_NO_ENGINE = "1";
  try {
    assert.equal(findEngine({}).available, false);
  } finally {
    if (prev === undefined) delete process.env.SELFEOPI_FORCE_NO_ENGINE;
    else process.env.SELFEOPI_FORCE_NO_ENGINE = prev;
  }
});

test("findEngine: caminho inexistente não é aceito como disponível", () => {
  const r = findEngine({ globalRoot: "C:\\nao-existe\\node_modules" });
  // Pode ou não achar o motor global real; o que importa é não inventar:
  // se disser disponível, aponta para um index.js que existe.
  if (r.available) assert.ok(typeof r.modulePath === "string" && r.modulePath.endsWith("index.js"));
  else assert.equal(typeof r.reason, "string");
});