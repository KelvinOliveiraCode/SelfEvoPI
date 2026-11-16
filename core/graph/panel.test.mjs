import test from "node:test";
import assert from "node:assert/strict";

import { createGraph } from "./model.mjs";
import { renderAscii, renderHtml, SYMBOLS } from "./panel.mjs";

function graph() {
  return createGraph({
    nodes: [
      { id: "t1", agent: "A1", kind: "task" },
      { id: "t2", agent: "A3", kind: "task", dependsOn: ["t1"] },
      { id: "r1", agent: "A2", kind: "review", dependsOn: ["t2"] },
    ],
    edges: [
      { from: "t1", to: "t2", kind: "handoff" },
      { from: "t2", to: "r1", kind: "handoff" },
    ],
  });
}

/* ------------------------------------------------------------------ */

test("renderAscii contém os ids e os símbolos certos por estado", () => {
  const g = graph();
  const state = {
    runId: "run-abc",
    nodes: [
      { id: "t1", status: "done" },
      { id: "t2", status: "failed" },
      { id: "r1", status: "pending" },
    ],
    waitingFor: null,
    checkpoints: 2,
  };

  const out = renderAscii(g, state);

  // ids presentes
  assert.match(out, /t1/);
  assert.match(out, /t2/);
  assert.match(out, /r1/);

  // símbolos por estado
  assert.ok(out.includes(`${SYMBOLS.done} t1`), "t1 done = ●");
  assert.ok(out.includes(`${SYMBOLS.failed} t2`), "t2 failed = ✗");
  assert.ok(out.includes(`${SYMBOLS.pending} r1`), "r1 pending = ○");

  // cabeçalho com run e checkpoints
  assert.match(out, /run=run-abc/);
  assert.match(out, /checkpoints=2/);
});

test("renderAscii mostra o nó human como waiting e o bloqueado como ⊘", () => {
  const g = createGraph({
    nodes: [
      { id: "t1", kind: "task" },
      { id: "h1", kind: "human", dependsOn: ["t1"] },
      { id: "t2", kind: "task", dependsOn: ["h1"] },
    ],
    edges: [],
  });
  const state = {
    nodes: [
      { id: "t1", status: "done" },
      { id: "h1", status: "waiting" },
      { id: "t2", status: "blocked" },
    ],
    waitingFor: "h1",
  };
  const out = renderAscii(g, state);
  assert.ok(out.includes(`${SYMBOLS.waiting} h1`), "h1 waiting = ⏸");
  assert.ok(out.includes(`${SYMBOLS.blocked} t2`), "t2 blocked = ⊘");
  assert.match(out, /aguardando h1/);
});

test("renderHtml devolve HTML válido com os nós", () => {
  const g = graph();
  const state = { runId: "run-xyz", nodes: [{ id: "t1", status: "done" }, { id: "t2", status: "pending" }, { id: "r1", status: "pending" }] };
  const html = renderHtml(g, state);

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<html/);
  assert.match(html, /<\/html>/);
  assert.match(html, /t1/);
  assert.match(html, /t2/);
  assert.match(html, /r1/);
  // autocontido: sem CDN/rede externa
  assert.ok(!/https?:\/\//.test(html.replace(/http:\/\/www\.w3\.org[^"]*/g, "")), "sem URLs externas");
  // polling configurável: sem pollUrl = estático
  assert.match(html, /estado estático/);
});

test("renderHtml com pollUrl injeta o fetch", () => {
  const html = renderHtml(graph(), {}, { pollUrl: "/state.json" });
  assert.ok(html.includes("/state.json"));
  assert.match(html, /setInterval/);
});

test("renderHtml com indexUrl injeta a lista de runs", () => {
  const html = renderHtml(graph(), {}, { indexUrl: "/index.json" });
  assert.ok(html.includes("/index.json"));
  // tem o container de runs e a função que o preenche
  assert.match(html, /id="runs"/);
  assert.match(html, /renderRuns/);
  assert.match(html, /setInterval/);
});

test("renderAscii não quebra com grafo vazio", () => {
  const out = renderAscii(createGraph({ nodes: [], edges: [] }), {});
  assert.equal(typeof out, "string");
});