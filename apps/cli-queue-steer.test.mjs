#!/usr/bin/env node
/** Fila, steer e interrupção por Esc durante um turno ativo. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { repl, stripAnsi } from "./cli.mjs";

function fakeEngine() {
  const chamadas = [];
  const listeners = new Map();
  const pi = {
    chamadas,
    on(kind, cb) {
      if (!listeners.has(kind)) listeners.set(kind, new Set());
      listeners.get(kind).add(cb);
      return () => listeners.get(kind)?.delete(cb);
    },
    emit(kind, arg) {
      for (const cb of [...(listeners.get(kind) || [])]) cb(arg);
    },
    prompt: async (m) => (chamadas.push(["prompt", m]), "started"),
    abort: async () => {
      chamadas.push(["abort"]);
      pi.emit("settled", { aborted: true });
    },
    getState: async () => ({ model: { provider: "p", id: "m" }, mode: "build" }),
    getAvailableModels: async () => [],
    _rpc: {
      steer: async (m) => (chamadas.push(["steer", m]), "queued"),
      followUp: async (m) => (chamadas.push(["followUp", m]), "queued"),
      clearQueue: async () => (chamadas.push(["clearQueue"]), { steering: [], followUp: [] }),
    },
  };
  return pi;
}

function open(pi) {
  const input = new EventEmitter();
  input.setEncoding = () => {};
  input.isTTY = true;
  let all = "";
  const done = repl({ pi, write: (s) => (all += s), input, setRaw: () => {}, data: {} });
  return {
    input,
    done,
    press: async (d, ms = 50) => {
      input.emit("data", d);
      await new Promise((r) => setTimeout(r, ms));
    },
    take: () => {
      const t = stripAnsi(all);
      all = "";
      return t;
    },
    close: async () => {
      if (pi.chamadas.some((c) => c[0] === "prompt") && !pi.chamadas.some((c) => c[0] === "abort")) {
        await pi.abort();
      }
      input.emit("data", "\u0004");
      await done;
    },
  };
}

const ENTER = "\r";
const ESC = "\x1b";

test("REPL: dois Esc seguidos abortam o turno", async () => {
  const pi = fakeEngine();
  const h = open(pi);
  await h.press("pergunta\r", 80);
  assert.equal(pi.chamadas.filter((c) => c[0] === "abort").length, 0);
  h.take();
  await h.press(ESC, 30);
  await h.press(ESC, 80);
  assert.equal(pi.chamadas.filter((c) => c[0] === "abort").length, 1);
  await h.close();
});

test("REPL: comando com barra durante o turno executa sem entrar na fila", async () => {
  const pi = fakeEngine();
  const h = open(pi);
  await h.press("pergunta\r", 80);
  h.take();
  await h.press("/help" + ENTER, 140);
  const t = h.take();
  assert.match(t, /COMMANDS/);
  assert.doesNotMatch(t, /queued:|fila:/);
  await h.close();
});

test("REPL: /quit durante o turno aborta sem entrar na fila", async () => {
  const pi = fakeEngine();
  const h = open(pi);
  await h.press("pergunta\r", 80);
  h.take();
  await h.press("/quit" + ENTER, 100);
  assert.equal(pi.chamadas.filter((c) => c[0] === "abort").length, 1);
  assert.doesNotMatch(h.take(), /queued:|fila:/);
  await h.done;
});

test("REPL: clique em mensagem enfileirada envia steer e limpa a fila", async () => {
  const pi = fakeEngine();
  const h = open(pi);
  await h.press("pergunta\r", 80);
  h.take();
  await h.press("mude para azul" + ENTER, 80);
  assert.match(h.take(), /queued: 1|fila: 1/);
  await h.press("\x1b[10;1R", 30); // posição do prompt
  h.take();
  await h.press("\x1b[<0;5;11M", 90); // clique na primeira linha abaixo
  assert.deepEqual(pi.chamadas.filter((c) => c[0] === "steer"), [["steer", "mude para azul"]]);
  assert.doesNotMatch(h.take(), /queued: 1|fila: 1/);
  await h.close();
});
