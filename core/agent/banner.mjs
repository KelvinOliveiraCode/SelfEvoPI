/**
 * selfevopi-banner — wordmark em ASCII para o banner da CLI.
 *
 * Sem dependências. Determinístico. Não usa cor (legível em terminal monocromático).
 *
 * O desenho de referencia (assets/logo-dna.svg, assets/wordmark.svg):
 *  - um **anel aberto** (o ciclo evolutivo: detecta, gera, valida, promove);
 *  - uma **helice dupla** que forma o glifo PI abstrato e se molda a tarefa;
 *  - um **no** (circulo) na abertura do anel, a variacao promovida pelo gate.
 *
 * Aqui o desenho é **desenhado em ASCII**, não copiado do SVG. A wordmark "SelfEvoPI"
 * é renderizada em letras de bloco; a versão detalhada acrescenta o anel aberto e o nó.
 *
 * Largura máxima: 72 colunas (cabe no terminal padrão). Fica bom em 80 e 120.
 *
 * Duas artes:
 *  - `asciiWordmark()`         → compacta (default), só o wordmark em blocos;
 *  - `asciiWordmarkDetailed()` → detalhada, com o anel aberto + nó.
 */

/* ------------------------------------------------------------------ */
/* Fonte de bloco 5x5 (5 linhas, 5 colunas por letra)                  */
/* ------------------------------------------------------------------ */

const FONT = {
  S: ["█████", "█    ", "█████", "    █", "█████"],
  E: ["█████", "█    ", "████ ", "█    ", "█████"],
  L: ["█    ", "█    ", "█    ", "█    ", "█████"],
  F: ["█████", "█    ", "████ ", "█    ", "█    "],
  V: ["█   █", "█   █", "█   █", " █ █ ", "  █  "],
  O: ["█████", "█   █", "█   █", "█   █", "█████"],
  P: ["████ ", "█   █", "████ ", "█    ", "█    "],
  I: ["█████", "  █  ", "  █  ", "  █  ", "█████"],
};

const LETTER_W = 5; // largura de cada letra na fonte de bloco
const LETTER_GAP = " "; // separador entre letras
const WORD = "SELFEVOPI"; // "SelfEvoPI" em caixa alta (legível como a marca)

/** Largura em colunas de uma linha de texto (conta code points, não bytes). */
function lineWidth(line) {
  return [...String(line)].length;
}

/** Renderiza uma palavra na fonte de bloco. Devolve array de 5 linhas. */
function renderWord(word) {
  const letters = [...word.toUpperCase()].filter((ch) => FONT[ch]);
  const rows = ["", "", "", "", ""];
  letters.forEach((ch, i) => {
    const glyph = FONT[ch];
    for (let r = 0; r < 5; r++) {
      rows[r] += glyph[r] + (i < letters.length - 1 ? LETTER_GAP : "");
    }
  });
  return rows;
}

/** Centraliza uma linha numa largura alvo. */
function center(line, width) {
  const w = lineWidth(line);
  if (w >= width) return line;
  const left = Math.floor((width - w) / 2);
  const right = width - w - left;
  return " ".repeat(left) + line + " ".repeat(right);
}

/* ------------------------------------------------------------------ */
/* Arte compacta (default)                                             */
/* ------------------------------------------------------------------ */

/**
 * Wordmark em ASCII, versão compacta: só o texto em blocos.
 * @returns {string[]} 5 linhas
 */
export function asciiWordmark() {
  return renderWord(WORD);
}

/* ------------------------------------------------------------------ */
/* Arte detalhada (anel aberto + nó)                                   */
/* ------------------------------------------------------------------ */

/**
 * Wordmark em ASCII, versão detalhada: o texto em blocos dentro de um anel
 * aberto, com um nó (o) na abertura — ecoando o logo (ciclo que se fecha).
 * @returns {string[]} linhas
 */
export function asciiWordmarkDetailed() {
  const word = renderWord(WORD);
  const innerW = Math.max(...word.map(lineWidth)); // largura do wordmark
  const pad = 3; // respiro interno
  const boxW = innerW + pad * 2; // largura útil da caixa (conteúdo entre as bordas)

  const top = "┌" + "─".repeat(boxW) + "┐";
  const bottom = "└" + "─".repeat(boxW) + "┘";
  const empty = "│" + " ".repeat(boxW) + "│";
  const totalW = boxW + 2; // largura total da caixa (com as duas bordas)

  const lines = [];
  lines.push(center("· ciclo evolutivo ·", totalW));
  lines.push(top);
  lines.push(empty);
  for (const row of word) {
    lines.push("│" + " ".repeat(pad) + row + " ".repeat(pad) + "│");
  }
  lines.push(empty);
  // anel aberto: a base tem uma folga à direita, onde entra o nó
  const gap = Math.max(0, boxW - 6);
  lines.push("└" + "─".repeat(gap) + "   ┘");
  // nó promovido (o) + legenda, em linha própria para não estourar a largura
  const nodeLine = "   ┌─ o  (nó promovido: a variação que passou no gate e fecha o ciclo)";
  lines.push(center(nodeLine.trim(), totalW));
  return lines;
}

/* ------------------------------------------------------------------ */
/* Banner completo                                                     */
/* ------------------------------------------------------------------ */

/**
 * Monta o banner completo: wordmark + versão + régua, pronto para imprimir.
 *
 * @param {object} [opts]
 * @param {number} [opts.width=72]   largura alvo (o banner nunca passa de 72)
 * @param {string} [opts.version]    versão a exibir (ex.: "0.1.0")
 * @param {boolean} [opts.detailed]  usa a arte detalhada (default: compacta)
 * @returns {string[]} linhas do banner
 */
export function bannerLines({ width = 72, version = null, detailed = false } = {}) {
  const target = Math.max(40, Math.min(72, Math.floor(width) || 72));
  const art = detailed ? asciiWordmarkDetailed() : asciiWordmark();

  const lines = [];
  // régua superior
  lines.push("─".repeat(target));

  // wordmark centralizado
  for (const row of art) lines.push(center(row, target));

  // linha de versão
  const ver = version ? `SelfEvoPI v${version}` : "SelfEvoPI";
  lines.push(center(ver, target));

  // régua inferior
  lines.push("─".repeat(target));

  return lines;
}

export default { asciiWordmark, asciiWordmarkDetailed, bannerLines };