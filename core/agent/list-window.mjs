/**
 * core/agent/list-window.mjs — matemática de janela de rolagem para pickers.
 *
 * Um menu de setas que mostra mais itens que a tela precisa decidir qual
 * fatia da lista fica visível, mantendo o item selecionado sempre à vista e
 * o mais centralizado possível (encostando nas bordas quando chega perto do
 * fim ou do começo). Este módulo é essa decisão, pura e testável.
 *
 *   visibleWindow(total, sel, maxRows) -> { start, end }   (0-based, end exclusivo)
 *   moveSel(sel, delta, total)         -> índice com wrap
 *   windowSlice(arr, win)              -> arr.slice(win.start, win.end)
 *
 * ESM puro, zero dependência (só o runtime), Windows nativo.
 */

/**
 * Maior janela contígua de tamanho ≤ `maxRows` dentro de [0, total] que contém
 * `sel`, centralizando o selecionado quando possível.
 *
 * Casos:
 *   - total ≤ 0            → { start: 0, end: 0 }
 *   - maxRows ≥ total      → { start: 0, end: total }
 *   - sel fora de [0,total)→ clamp para a borda válida
 *   - maxRows ≤ 0          → tratado como 1
 *
 * @param {number} total    total de itens (≥ 0)
 * @param {number} sel      índice selecionado
 * @param {number} maxRows  máximo de linhas visíveis (≥ 1)
 * @returns {{ start: number, end: number }}
 */
export function visibleWindow(total, sel, maxRows) {
  const n = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
  if (n === 0) return { start: 0, end: 0 };

  const rows = Number.isFinite(maxRows) ? Math.max(1, Math.trunc(maxRows)) : 1;

  // seleção clampada para dentro de [0, n-1]
  let s = Number.isFinite(sel) ? Math.trunc(sel) : 0;
  if (s < 0) s = 0;
  if (s > n - 1) s = n - 1;

  // a janela inteira cabe: mostra tudo
  if (rows >= n) return { start: 0, end: n };

  // tamanho efetivo da janela
  const size = Math.min(rows, n);

  // centraliza o selecionado (quando par, o item extra fica abaixo dele);
  // depois encosta nas bordas.
  let start = s - Math.floor((size - 1) / 2);
  if (start < 0) start = 0;
  if (start > n - size) start = n - size;

  return { start, end: start + size };
}

/**
 * Move o índice selecionado com wrap: ↑ a partir de 0 volta para total-1,
 * ↓ a partir de total-1 volta para 0. `delta` pode ser negativo ou > 1.
 *
 * total ≤ 0 → 0.
 *
 * @param {number} sel    índice atual
 * @param {number} delta  deslocamento (passos)
 * @param {number} total  total de itens
 * @returns {number} novo índice em [0, total-1] (ou 0 se total ≤ 0)
 */
export function moveSel(sel, delta, total) {
  const n = Number.isFinite(total) ? Math.trunc(total) : 0;
  if (n <= 0) return 0;

  let s = Number.isFinite(sel) ? Math.trunc(sel) : 0;
  let d = Number.isFinite(delta) ? Math.trunc(delta) : 0;

  // normaliza o passo para o menor equivalente (evita overflow em listas grandes)
  d = ((d % n) + n) % n;

  s = (((s + d) % n) + n) % n;
  return s;
}

/**
 * Fatia o array pela janela: `arr.slice(win.start, win.end)`.
 *
 * @param {Array} arr
 * @param {{ start: number, end: number }} win
 * @returns {Array}
 */
export function windowSlice(arr, win) {
  if (!Array.isArray(arr)) return [];
  const start = Number.isFinite(win?.start) ? win.start : 0;
  const end = Number.isFinite(win?.end) ? win.end : arr.length;
  return arr.slice(start, end);
}

export default { visibleWindow, moveSel, windowSlice };