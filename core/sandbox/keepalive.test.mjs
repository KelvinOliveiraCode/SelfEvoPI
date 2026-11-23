import test from "node:test";
import assert from "node:assert/strict";

import { KeepAlive, DEFAULT_TTL_MS } from "./keepalive.mjs";

function fake(opts = {}) {
  let now = 1000;
  const killed = [];
  const ka = new KeepAlive({
    now: () => now,
    ttlMs: 100,
    kill: (pid, d) => killed.push({ pid, id: d.id }),
    ...opts,
  });
  return { ka, killed, advance: (ms) => { now += ms; }, set: (ms) => { now = ms; }, time: () => now };
}

test("register: devolve registro, marca lastAlive com relógio falso e expõe meta", () => {
  const { ka } = fake();
  const entry = ka.register("server", 4242, { kind: "shell", server: true });
  assert.deepEqual(entry, {
    id: "server", pid: 4242, meta: { kind: "shell", server: true }, lastAlive: 1000, registeredAt: 1000,
  });
  const report = ka.report();
  assert.equal(report.now, 1000);
  assert.equal(report.ttlMs, 100);
  assert.deepEqual(report.entries, [{
    id: "server", pid: 4242, meta: { kind: "shell", server: true }, alive: true, ageMs: 0, lastAlive: 1000,
  }]);
});

test("register: id vazio ou pid inválido não entra no registro", () => {
  const { ka } = fake();
  assert.equal(ka.register("", 1), null);
  assert.equal(ka.register("ok", 0), null);
  assert.equal(ka.register("ok", 1.5), null);
  assert.equal(ka.register("ok", -1), null);
  assert.equal(ka.size, 0);
  assert.equal(ka.markAlive("ausente"), false);
});

test("markAlive renova a janela; id inexistente devolve false", () => {
  const { ka, advance } = fake();
  ka.register("srv", 11);
  advance(90);
  assert.equal(ka.markAlive("srv"), true);
  advance(90);
  assert.equal(ka.report().entries[0].ageMs, 90, "idade conta desde o último sinal");
  assert.equal(ka.report().entries[0].alive, true);
  assert.equal(ka.markAlive("inexistente"), false);
});

test("sweep: remove só expirados; fronteira exata é mantida", () => {
  const { ka, set } = fake();
  set(999);
  ka.register("expirado", 3);
  set(1000);
  ka.register("fronteira", 2);
  ka.register("renovado", 1);
  set(1050);
  assert.equal(ka.markAlive("renovado"), true);
  const r = ka.sweep(1100);
  assert.deepEqual(r.removed, ["expirado"], "1100 - 999 > ttl: sai");
  assert.deepEqual(r.kept.sort(), ["fronteira", "renovado"].sort());
  assert.equal(ka.report(1100).entries.find((e) => e.id === "fronteira").ageMs, 100, "fronteira inclusiva não remove");
  assert.equal(ka.size, 2);
  assert.equal(ka.report(1100).entries.some((e) => e.id === "expirado"), false);
});

test("sweep: sem sinal dentro da janela, o expirado sai e o vivo fica", () => {
  const { ka, advance } = fake();
  ka.register("a", 1);
  advance(101);
  const r = ka.sweep();
  assert.deepEqual(r.removed, ["a"]);
  assert.deepEqual(r.kept, []);
  assert.equal(ka.size, 0);
});

test("shutdown padrão: mantém vivo, pede kill só do expirado e não executa sem callback", () => {
  let now = 999;
  const ka = new KeepAlive({ now: () => now, ttlMs: 100 });
  ka.register("expirado", 2);
  now = 1000;
  ka.register("vivo", 1, { server: true });
  now = 1100;

  const d = ka.shutdown("cli-exit");
  assert.equal(d.policy, "keep-alive");
  assert.equal(d.reason, "cli-exit");
  assert.deepEqual(d.kept, ["vivo"], "política padrão mantém processo com servidor vivo");
  assert.deepEqual(d.killRequested, ["expirado"]);
  assert.deepEqual(d.killed, []);
  assert.equal(d.executed, false, "sem executor injetado nada é morto");
  assert.equal(d.decisions.find((x) => x.id === "vivo").action, "keep");
  assert.equal(d.decisions.find((x) => x.id === "expirado").action, "kill");
  assert.equal(ka.size, 2, "sem executor nada é removido do registro");
});

test("shutdown com executor: mata só o expirado, remove-o e mantém o vivo", () => {
  const { ka, killed, set } = fake();
  set(999);
  ka.register("expirado", 2);
  set(1000);
  ka.register("vivo", 1, { server: true });
  set(1100);

  const d = ka.shutdown("sair");
  assert.equal(d.executed, true);
  assert.deepEqual(d.killed, ["expirado"]);
  assert.deepEqual(d.failed, []);
  assert.deepEqual(killed, [{ pid: 2, id: "expirado" }]);
  assert.deepEqual(d.kept, ["vivo"]);
  assert.equal(ka.size, 1);
  assert.equal(ka.report().entries[0].id, "vivo");
});

test("shutdown kill-all: pede kill inclusive para processos vivos", () => {
  const { ka, killed } = fake({ policy: "kill-all" });
  ka.register("a", 1);
  ka.register("b", 2);
  const d = ka.shutdown("limpeza explícita");
  assert.deepEqual(d.killRequested.sort(), ["a", "b"]);
  assert.deepEqual(d.kept, []);
  assert.deepEqual(killed.map((x) => x.pid).sort(), [1, 2]);
  assert.equal(ka.size, 0);
});

test("shutdown: falha do executor é registrada e não remove a entrada", () => {
  const ka = new KeepAlive({
    now: () => 1000,
    ttlMs: 0,
    kill: () => { throw new Error("taskkill indisponível"); },
  });
  ka.register("x", 7);
  const d = ka.shutdown("teste", 1001);
  assert.deepEqual(d.failed, ["x"]);
  assert.deepEqual(d.killed, []);
  assert.equal(ka.size, 1);
});

test("report: ordenado por id e com política padrão de cinco minutos", () => {
  const ka = new KeepAlive({ now: () => 0 });
  assert.equal(ka.ttlMs, DEFAULT_TTL_MS);
  ka.register("z", 2);
  ka.register("a", 1, { rotulo: "ok" });
  const r = ka.report(0);
  assert.deepEqual(r.entries.map((e) => e.id), ["a", "z"]);
  assert.deepEqual(r.entries[0].meta, { rotulo: "ok" });
  assert.equal(r.policy, "keep-alive");
});
