import test from "node:test";
import assert from "node:assert/strict";

import {
  asciiWordmark,
  asciiWordmarkDetailed,
  bannerLines,
} from "./banner.mjs";

const w = (line) => [...line].length;
const maxW = (lines) => Math.max(...lines.map(w));

/* --------------------------- largura <= 72 / 80 ------------------------- */

test("asciiWordmark (compacta) tem largura <= 72", () => {
  assert.ok(maxW(asciiWordmark()) <= 72, `largura ${maxW(asciiWordmark())}`);
});

test("asciiWordmarkDetailed tem largura <= 72", () => {
  assert.ok(maxW(asciiWordmarkDetailed()) <= 72, `largura ${maxW(asciiWordmarkDetailed())}`);
});

test("bannerLines (compacta e detalhada) tem largura <= 72", () => {
  assert.ok(maxW(bannerLines({ width: 72, version: "0.1.0" })) <= 72);
  assert.ok(maxW(bannerLines({ width: 72, version: "0.1.0", detailed: true })) <= 72);
});

test("banner cabe em 80 colunas sem quebrar (<= 80)", () => {
  const b = bannerLines({ width: 80, version: "0.1.0" });
  assert.ok(maxW(b) <= 80, `largura ${maxW(b)}`);
  // e nenhuma linha passa de 80 mesmo com a régua respeitando o alvo
  for (const line of b) assert.ok(w(line) <= 80);
});

test("banner cabe em 120 colunas (<= 120)", () => {
  const b = bannerLines({ width: 120, version: "0.1.0" });
  for (const line of b) assert.ok(w(line) <= 120);
});

/* ------------------------------- versão --------------------------------- */

test("bannerLines mostra a versão quando fornecida", () => {
  const b = bannerLines({ width: 72, version: "1.2.3" });
  const text = b.join("\n");
  assert.match(text, /v1\.2\.3/);
});

test("bannerLines sem versão mostra 'SelfEvoPI'", () => {
  const b = bannerLines({ width: 72 });
  assert.ok(b.join("\n").includes("SelfEvoPI"));
});

/* --------------------------- arte estável ------------------------------- */

test("asciiWordmark é determinístico (mesma entrada, mesma saída)", () => {
  assert.deepEqual(asciiWordmark(), asciiWordmark());
});

test("asciiWordmarkDetailed é determinístico", () => {
  assert.deepEqual(asciiWordmarkDetailed(), asciiWordmarkDetailed());
});

test("bannerLines é determinístico", () => {
  assert.deepEqual(
    bannerLines({ width: 72, version: "0.1.0", detailed: true }),
    bannerLines({ width: 72, version: "0.1.0", detailed: true }),
  );
});

/* ---------------------- não contém 'pi' isolada ------------------------- */

test("banner não contém a palavra 'pi' isolada", () => {
  const variants = [
    asciiWordmark(),
    asciiWordmarkDetailed(),
    bannerLines({ width: 72, version: "0.1.0" }),
    bannerLines({ width: 72, version: "0.1.0", detailed: true }),
  ];
  for (const art of variants) {
    const text = art.join("\n");
    // "pi" como palavra isolada (não precedida/seguida de letra)
    assert.ok(!/(^|[^a-z])pi([^a-z]|$)/i.test(text), `achou "pi" isolada em:\n${text}`);
  }
});

/* ------------------------- legibilidade / conteúdo ---------------------- */

test("wordmark contém os blocos do nome (S, E, L, F, V, O, P, I)", () => {
  const art = asciiWordmark().join("\n");
  assert.match(art, /█/); // usa caracteres de bloco
  // 5 linhas, largura consistente
  const lines = asciiWordmark();
  assert.equal(lines.length, 5);
  const widths = new Set(lines.map(w));
  assert.equal(widths.size, 1, "todas as linhas do wordmark têm a mesma largura");
});

test("arte detalhada tem o nó promovido e o ciclo evolutivo", () => {
  const text = asciiWordmarkDetailed().join("\n");
  assert.match(text, /ciclo evolutivo/);
  assert.match(text, /nó promovido/);
});

test("bannerLines respeita o piso de largura (nunca < 40)", () => {
  const b = bannerLines({ width: 10, version: "0.0.1" });
  assert.ok(maxW(b) <= 72);
  assert.ok(maxW(b) >= 40, "não deve ficar mais estreito que o piso");
});