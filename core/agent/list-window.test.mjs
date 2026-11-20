import test from "node:test";
import assert from "node:assert/strict";

import { visibleWindow, moveSel, windowSlice } from "./list-window.mjs";
import padrao from "./list-window.mjs";

/* ------------------------------------------------------------------ */
/* visibleWindow                                                       */
/* ------------------------------------------------------------------ */

test("total 0 dá janela vazia", () => {
  assert.deepEqual(visibleWindow(0, 0, 10), { start: 0, end: 0 });
});

test("total < maxRows mostra tudo", () => {
  assert.deepEqual(visibleWindow(3, 1, 10), { start: 0, end: 3 });
});

test("maxRows == total mostra tudo", () => {
  assert.deepEqual(visibleWindow(5, 2, 5), { start: 0, end: 5 });
});

test("sel no meio centraliza (total≫maxRows)", () => {
  // total 50, sel 30, maxRows 10 -> {26,36}
  const w = visibleWindow(50, 30, 10);
  assert.deepEqual(w, { start: 26, end: 36 });
  // o selecionado está dentro; com janela par, sobra 1 item abaixo
  assert.ok(w.start <= 30 && 30 < w.end);
  assert.equal(30 - w.start, 4);
  assert.equal(w.end - 1 - 30, 5);
});

test("sel no início encosta em 0", () => {
  const w = visibleWindow(50, 0, 10);
  assert.deepEqual(w, { start: 0, end: 10 });
});

test("sel no fim encosta em total-maxRows", () => {
  const w = visibleWindow(50, 49, 10);
  assert.deepEqual(w, { start: 40, end: 50 });
});

test("sel fora de [0,total) é clampado", () => {
  // sel negativo
  assert.deepEqual(visibleWindow(50, -5, 10), { start: 0, end: 10 });
  // sel acima do teto
  assert.deepEqual(visibleWindow(50, 999, 10), { start: 40, end: 50 });
});

test("maxRows <= 0 é tratado como 1", () => {
  assert.deepEqual(visibleWindow(50, 7, 0), { start: 7, end: 8 });
  assert.deepEqual(visibleWindow(50, 7, -3), { start: 7, end: 8 });
});

test("a janela sempre tem tamanho <= maxRows e contém o sel", () => {
  for (let total = 1; total <= 30; total += 1) {
    for (let sel = 0; sel < total; sel += 1) {
      for (let maxRows = 1; maxRows <= 12; maxRows += 1) {
        const w = visibleWindow(total, sel, maxRows);
        assert.ok(w.start >= 0, `start>=0 total=${total} sel=${sel} max=${maxRows}`);
        assert.ok(w.end <= total, `end<=total total=${total} sel=${sel} max=${maxRows}`);
        assert.ok(w.end - w.start <= maxRows, `size<=max total=${total} sel=${sel} max=${maxRows}`);
        assert.ok(w.start <= sel && sel < w.end, `contém sel total=${total} sel=${sel} max=${maxRows}`);
      }
    }
  }
});

/* ------------------------------------------------------------------ */
/* moveSel                                                             */
/* ------------------------------------------------------------------ */

test("moveSel wrap: desce do último para o primeiro", () => {
  assert.equal(moveSel(49, +1, 50), 0);
});

test("moveSel wrap: sobe do primeiro para o último", () => {
  assert.equal(moveSel(0, -1, 50), 49);
});

test("moveSel sem wrap no meio", () => {
  assert.equal(moveSel(10, +1, 50), 11);
  assert.equal(moveSel(10, -1, 50), 9);
});

test("moveSel delta > 1", () => {
  assert.equal(moveSel(5, +3, 50), 8);
  assert.equal(moveSel(2, -5, 50), 47);
});

test("moveSel delta maior que o total normaliza", () => {
  assert.equal(moveSel(0, +50, 50), 0); // volta ao mesmo
  assert.equal(moveSel(0, +53, 50), 3);
});

test("moveSel total 0 dá 0", () => {
  assert.equal(moveSel(5, +1, 0), 0);
  assert.equal(moveSel(0, -1, 0), 0);
});

test("moveSel com um único item sempre 0", () => {
  assert.equal(moveSel(0, +1, 1), 0);
  assert.equal(moveSel(0, -1, 1), 0);
});

/* ------------------------------------------------------------------ */
/* windowSlice                                                         */
/* ------------------------------------------------------------------ */

test("windowSlice fatia pela janela", () => {
  const arr = Array.from({ length: 50 }, (_, i) => i);
  const w = visibleWindow(50, 30, 10);
  const slice = windowSlice(arr, w);
  assert.equal(slice.length, 10);
  assert.equal(slice[0], 26);
  assert.equal(slice[9], 35);
  assert.ok(slice.includes(30), "o selecionado está na fatia");
});

test("windowSlice com array não-array dá []", () => {
  assert.deepEqual(windowSlice(null, { start: 0, end: 3 }), []);
});

/* ------------------------------------------------------------------ */
/* default export                                                      */
/* ------------------------------------------------------------------ */

test("default export expõe as três funções", () => {
  assert.equal(typeof padrao.visibleWindow, "function");
  assert.equal(typeof padrao.moveSel, "function");
  assert.equal(typeof padrao.windowSlice, "function");
});