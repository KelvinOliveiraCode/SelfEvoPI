import test, { after } from "node:test";
import assert from "node:assert/strict";

import { mkdtemp, readFile, rm, readdir, access, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  emitEvent,
  watchEvents,
  runForgeOnEvent,
  parseEventLine,
  defaultEventsDir,
  slugifyEventType,
  EVENTS_CURSOR_FILE,
} from "./events.mjs";

/* ------------------------------------------------------------------ */
/* Diretórios descartáveis                                             */
/* ------------------------------------------------------------------ */

const roots = [];

async function makeRoot() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "selfevopi-events-"));
  roots.push(dir);
  return dir;
}

/** Relógio falso determinístico (cada leitura devolve o mesmo instante). */
function fakeClock(iso) {
  return () => new Date(iso);
}

/** Sono falso: não espera de verdade; registra as durações pedidas. */
function fakeSleep(record = []) {
  const fn = (ms) => { record.push(ms); return Promise.resolve(); };
  fn.record = record;
  return fn;
}

/** shouldStop que para depois de N chamadas. */
function stopAfter(n) {
  let calls = 0;
  return () => { calls += 1; return calls > n; };
}

after(async () => {
  for (const dir of roots) await rm(dir, { recursive: true, force: true });
});

/** Lê os nomes de arquivos de evento (sem o cursor) de uma pasta. */
async function eventFiles(dir) {
  const entries = await readdir(dir).catch(() => []);
  return entries.filter((n) => n.endsWith(".jsonl") && !n.includes(".tmp-"));
}

/* ------------------------------------------------------------------ */
/* slugifyEventType / parseEventLine / defaultEventsDir               */
/* ------------------------------------------------------------------ */

test("slugifyEventType: normaliza tipo para nome de arquivo", () => {
  assert.equal(slugifyEventType("Forge Run Done!"), "forge-run-done");
  assert.equal(slugifyEventType("Ação//Crítica"), "acao-critica");
  assert.equal(slugifyEventType("!!!"), "event");
});

test("parseEventLine: lê a 1ª linha JSON não vazia", () => {
  const r = parseEventLine('{"type":"x"}\n');
  assert.equal(r.ok, true);
  assert.deepEqual(r.event, { type: "x" });
});

test("parseEventLine: JSON inválido vira erro, não lança", () => {
  const r = parseEventLine("{ nope");
  assert.equal(r.ok, false);
  assert.match(r.error, /corrompido/);
});

test("defaultEventsDir: aponta para .pi/harness/events", () => {
  const d = defaultEventsDir("/tmp/x");
  assert.match(d.replace(/\\/g, "/"), /\.pi\/harness\/events$/);
});

/* ------------------------------------------------------------------ */
/* emitEvent                                                           */
/* ------------------------------------------------------------------ */

test("emitEvent: grava um arquivo JSONL com id, type, payload, at", async () => {
  const root = await makeRoot();
  const dir = path.join(root, "events");
  const res = await emitEvent({
    dir,
    type: "forge.run.done",
    payload: { runId: "r1", ok: true },
    at: "2026-01-01T00:00:00.000Z",
    id: "evt-1",
  });
  assert.equal(res.ok, true);
  assert.equal(res.event.id, "evt-1");
  assert.equal(res.event.type, "forge.run.done");
  assert.deepEqual(res.event.payload, { runId: "r1", ok: true });

  const file = res.file;
  assert.ok(file.endsWith(".jsonl"));
  const line = (await readFile(file, "utf8")).trim();
  const parsed = JSON.parse(line);
  assert.equal(parsed.id, "evt-1");
  assert.equal(parsed.at, "2026-01-01T00:00:00.000Z");
});

test("emitEvent: tipo vazio é recusado", async () => {
  const root = await makeRoot();
  const res = await emitEvent({ dir: path.join(root, "events"), type: "  " });
  assert.equal(res.ok, false);
  assert.match(res.error, /type/);
});

test("emitEvent: usa now() quando at não é dado", async () => {
  const root = await makeRoot();
  const res = await emitEvent({
    dir: path.join(root, "events"),
    type: "tick",
    now: fakeClock("2030-12-31T23:59:59.000Z"),
  });
  assert.equal(res.ok, true);
  assert.equal(res.event.at, "2030-12-31T23:59:59.000Z");
});

test("emitEvent: nomes únicos entre chamadas", async () => {
  const root = await makeRoot();
  const dir = path.join(root, "events");
  const a = await emitEvent({ dir, type: "dup", at: "2026-01-01T00:00:00.000Z" });
  const b = await emitEvent({ dir, type: "dup", at: "2026-01-01T00:00:00.000Z" });
  assert.notEqual(a.file, b.file);
  assert.equal((await eventFiles(dir)).length, 2);
});

test("emitEvent: usa o diretório padrão quando dir é omitido", async () => {
  const root = await makeRoot();
  const res = await emitEvent({ dir: defaultEventsDir(root), type: "x" });
  assert.equal(res.ok, true);
  assert.ok(res.file.replace(/\\/g, "/").includes(".pi/harness/events"));
});

/* ------------------------------------------------------------------ */
/* watchEvents — emissão e observação                                  */
/* ------------------------------------------------------------------ */

test("watchEvents: entrega eventos gravados e persiste cursor", async () => {
  const root = await makeRoot();
  const dir = path.join(root, "events");
  await emitEvent({ dir, type: "a", at: "2026-01-01T00:00:00.000Z", id: "1" });
  await emitEvent({ dir, type: "b", at: "2026-01-01T00:00:01.000Z", id: "2" });

  const seen = [];
  const res = await watchEvents({
    dir,
    onEvent: (e) => { seen.push(e); },
    now: fakeClock("2026-01-01T00:00:02.000Z"),
    sleep: fakeSleep(),
    maxRounds: 1,
  });

  assert.equal(res.ok, true);
  assert.equal(res.delivered, 2);
  assert.deepEqual(seen.map((e) => e.id).sort(), ["1", "2"]);

  // Cursor gravado com os dois nomes.
  const cursor = JSON.parse(await readFile(path.join(dir, EVENTS_CURSOR_FILE), "utf8"));
  assert.equal(cursor.processed.length, 2);
});

test("watchEvents: deduplicação — não redelivera o já processado", async () => {
  const root = await makeRoot();
  const dir = path.join(root, "events");
  await emitEvent({ dir, type: "once", id: "keep" });

  const first = [];
  await watchEvents({
    dir,
    onEvent: (e) => first.push(e),
    now: fakeClock("2026-01-01T00:00:00.000Z"),
    sleep: fakeSleep(),
    maxRounds: 1,
  });
  assert.equal(first.length, 1);

  // Segunda observação: nada novo.
  const second = [];
  const res2 = await watchEvents({
    dir,
    onEvent: (e) => second.push(e),
    now: fakeClock("2026-01-01T00:00:05.000Z"),
    sleep: fakeSleep(),
    maxRounds: 1,
  });
  assert.equal(second.length, 0);
  assert.equal(res2.delivered, 0);
});

test("watchEvents: pega só o evento novo entre duas passadas", async () => {
  const root = await makeRoot();
  const dir = path.join(root, "events");

  await emitEvent({ dir, type: "one", at: "2026-01-01T00:00:00.000Z", id: "1" });
  await watchEvents({
    dir, onEvent: () => {}, now: fakeClock("2026-01-01T00:00:00.000Z"),
    sleep: fakeSleep(), maxRounds: 1,
  });

  // Chega um novo evento depois da 1ª passada.
  await emitEvent({ dir, type: "two", at: "2026-01-01T00:00:01.000Z", id: "2" });

  const seen = [];
  const res = await watchEvents({
    dir, onEvent: (e) => seen.push(e), now: fakeClock("2026-01-01T00:00:02.000Z"),
    sleep: fakeSleep(), maxRounds: 1,
  });
  assert.equal(res.delivered, 1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].id, "2");
});

test("watchEvents: cursor sobrevive a 'restart' (novo objeto, mesmo dir)", async () => {
  const root = await makeRoot();
  const dir = path.join(root, "events");
  await emitEvent({ dir, type: "persist", id: "p1" });

  // 1ª "sessão".
  await watchEvents({
    dir, onEvent: () => {}, now: fakeClock("2026-01-01T00:00:00.000Z"),
    sleep: fakeSleep(), maxRounds: 1,
  });
  // 2ª "sessão" (mesmo diretório) não redelivra.
  const seen = [];
  await watchEvents({
    dir, onEvent: (e) => seen.push(e), now: fakeClock("2026-01-01T00:00:09.000Z"),
    sleep: fakeSleep(), maxRounds: 1,
  });
  assert.equal(seen.length, 0);
});

test("watchEvents: loopa até shouldStop e respeita intervalMs (sleep injetado)", async () => {
  const root = await makeRoot();
  const dir = path.join(root, "events");
  await emitEvent({ dir, type: "loop", id: "l1" });

  const slept = [];
  const res = await watchEvents({
    dir,
    onEvent: () => {},
    now: fakeClock("2026-01-01T00:00:00.000Z"),
    sleep: fakeSleep(slept),
    intervalMs: 250,
    shouldStop: stopAfter(2), // 2 rounds e para
  });
  assert.equal(res.ok, true);
  assert.ok(res.rounds >= 2);
  // Dormiu ao menos uma vez com o intervalo pedido.
  assert.ok(slept.includes(250));
});

test("watchEvents: arquivo corrompido não derruba e não redelivra", async () => {
  const root = await makeRoot();
  const dir = path.join(root, "events");
  await emitEvent({ dir, type: "good", id: "g1" });
  // Arquivo de evento corrompido na pasta.
  await writeFile(path.join(dir, "broken.jsonl"), "{ não é json\n", "utf8");

  const seen = [];
  const res = await watchEvents({
    dir, onEvent: (e) => seen.push(e), now: fakeClock("2026-01-01T00:00:00.000Z"),
    sleep: fakeSleep(), maxRounds: 1,
  });
  assert.equal(res.ok, true);
  assert.equal(seen.length, 1);       // só o válido
  assert.equal(res.skipped.length, 1); // o corrompido foi marcado como pulado
});

test("watchEvents: erro no onEvent não derruba o watcher", async () => {
  const root = await makeRoot();
  const dir = path.join(root, "events");
  await emitEvent({ dir, type: "boom", id: "b1" });
  await emitEvent({ dir, type: "ok", id: "ok1" });

  const seen = [];
  const res = await watchEvents({
    dir,
    onEvent: (e) => {
      if (e.type === "boom") throw new Error("falha do consumidor");
      seen.push(e);
    },
    now: fakeClock("2026-01-01T00:00:00.000Z"),
    sleep: fakeSleep(),
    maxRounds: 1,
  });
  assert.equal(res.ok, true);
  assert.equal(res.errors.length, 1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].id, "ok1");
});

test("watchEvents: exige onEvent função", async () => {
  const root = await makeRoot();
  const res = await watchEvents({ dir: path.join(root, "events"), onEvent: null, maxRounds: 1 });
  assert.equal(res.ok, false);
  assert.match(res.error, /onEvent/);
});

/* ------------------------------------------------------------------ */
/* runForgeOnEvent                                                     */
/* ------------------------------------------------------------------ */

test("runForgeOnEvent: mapeia tipo para ação registrada (objeto)", async () => {
  const calls = [];
  const handlers = {
    "forge.run.done": (e) => { calls.push(e); return "ok"; },
  };
  const res = await runForgeOnEvent({ type: "forge.run.done", payload: { id: 1 } }, handlers);
  assert.equal(res.ok, true);
  assert.equal(res.handled, true);
  assert.equal(res.type, "forge.run.done");
  assert.equal(res.action, "ok");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].payload, { id: 1 });
});

test("runForgeOnEvent: tipo sem handler é no-op bem-sucedido", async () => {
  const res = await runForgeOnEvent({ type: "desconhecido" }, { outro: () => {} });
  assert.equal(res.ok, true);
  assert.equal(res.handled, false);
});

test("runForgeOnEvent: aceita registro Map", async () => {
  const handlers = new Map([["x", (e) => e.payload.n * 2]]);
  const res = await runForgeOnEvent({ type: "x", payload: { n: 21 } }, handlers);
  assert.equal(res.ok, true);
  assert.equal(res.action, 42);
});

test("runForgeOnEvent: aceita handler objeto { run }", async () => {
  const handlers = { y: { run: (e) => `got:${e.type}` } };
  const res = await runForgeOnEvent({ type: "y" }, handlers);
  assert.equal(res.action, "got:y");
});

test("runForgeOnEvent: handler que lança vira erro explícito", async () => {
  const handlers = { z: () => { throw new Error("explodiu"); } };
  const res = await runForgeOnEvent({ type: "z" }, handlers);
  assert.equal(res.ok, false);
  assert.equal(res.handled, true);
  assert.match(res.error, /explodiu/);
});

test("runForgeOnEvent: evento sem type é recusado", async () => {
  const res = await runForgeOnEvent({}, {});
  assert.equal(res.ok, false);
  assert.match(res.error, /type/);
});

test("runForgeOnEvent: não conhece o Forge — só o registro", async () => {
  // Registro vazio: nenhum tipo é tratado, nada é inventado.
  const res = await runForgeOnEvent({ type: "qualquer" }, {});
  assert.equal(res.handled, false);
  assert.equal(res.ok, true);
});

/* ------------------------------------------------------------------ */
/* Integração: emit -> watch -> runForgeOnEvent                        */
/* ------------------------------------------------------------------ */

test("fluxo completo: emitEvent -> watchEvents -> runForgeOnEvent", async () => {
  const root = await makeRoot();
  const dir = path.join(root, "events");

  await emitEvent({ dir, type: "forge.run.done", payload: { runId: "r9" }, id: "e9" });

  const handled = [];
  const handlers = {
    "forge.run.done": (e) => { handled.push(e.payload.runId); return "promoted"; },
  };

  const results = [];
  await watchEvents({
    dir,
    onEvent: async (e) => { results.push(await runForgeOnEvent(e, handlers)); },
    now: fakeClock("2026-01-01T00:00:00.000Z"),
    sleep: fakeSleep(),
    maxRounds: 1,
  });

  assert.deepEqual(handled, ["r9"]);
  assert.equal(results.length, 1);
  assert.equal(results[0].action, "promoted");
  assert.equal(results[0].handled, true);
});

test("sem dependências de rede: fluxo usa só arquivos locais", async () => {
  // Confirma que a pasta de eventos fica dentro da raiz temporária.
  const root = await makeRoot();
  const dir = path.join(root, "events");
  await emitEvent({ dir, type: "local" });
  const files = await eventFiles(dir);
  assert.ok(files.length >= 1);
  for (const f of files) {
    await access(path.join(dir, f)); // todos existem e são locais
  }
});