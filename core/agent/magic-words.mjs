/**
 * core/agent/magic-words.mjs — palavras de controle no texto do usuário.
 *
 * O usuário escreve prosa comum e, às vezes, uma palavra de controle no meio
 * dela ("orchestrate a migração", "ultrathink sobre o bug"). Este módulo separa
 * essas diretivas do texto, sem tocar em nada que não seja prosa:
 *
 *   - nunca detecta dentro de código (bloco cercado por ``` ou ~~~, ou crase);
 *   - nunca detecta dentro de URL, caminho de arquivo ou identificador;
 *   - a palavra precisa ser uma palavra inteira, delimitada por espaço ou
 *     pontuação de sentença, não colada a letras, barras ou pontos.
 *
 * Não usa regex frágil "pegando tudo": cada candidata é validada contra a
 * vizinhança (caractere anterior e posterior) e contra os trechos de código.
 *
 * Contrato:
 *   parseMagicWords(texto) -> { textoLimpo, diretivas: [{ nome, alvo }] }
 *
 * Determinístico, sem rede, sem dependência. `textoLimpo` é o texto com as
 * palavras de controle removidas (o resto, inclusive código, fica intacto).
 */

/** Palavras de controle reconhecidas (tudo minúsculo, comparação sem caixa). */
export const MAGIC_WORDS = Object.freeze(["ultrathink", "chillax", "orchestrate", "workflowz"]);

const PALAVRA_RE = /\b(ultrathink|chillax|orchestrate|workflowz)\b/gi;

/** Caracteres que colam à palavra e denunciam identificador/caminho/URL. */
const ESQUERDA_BLOQUEIO = new Set(["/", "\\", "@", "#", "-", "_", "="]);
const DIREITA_BLOQUEIO = new Set(["/", "\\", "@", "#", "-", "_", "="]);

/** É caractere de palavra (letra, dígito ou sublinhado)? */
function ehPalavra(ch) {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

/**
 * Marca os intervalos de código do texto (blocos cercados + crases inline).
 * Devolve os intervalos [inicio, fim) em coordenadas absolutas; sobrepostos e
 * ordenados não importam para a checagem de "está dentro de código".
 *
 * @param {string} text
 * @returns {Array<[number, number]>}
 */
export function findCodeRanges(text) {
  const ranges = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    if (ch !== "`" && ch !== "~") {
      i++;
      continue;
    }
    // Conta a sequência do mesmo caractere.
    let j = i;
    while (j < n && text[j] === ch) j++;
    const run = j - i;

    if (ch === "~" && run < 3) {
      i = j; // tils curtos são texto normal
      continue;
    }

    if (run >= 3) {
      // Bloco cercado: procura a cerca de fechamento (início de linha, >= run).
      let k = j;
      let closeStart = -1;
      let closeEnd = -1;
      while (k < n) {
        if (k === 0 || text[k - 1] === "\n") {
          let m = k;
          while (m < n && text[m] === ch) m++;
          if (m - k >= run) {
            closeStart = k;
            closeEnd = m;
            break;
          }
        }
        k++;
      }
      if (closeStart !== -1) {
        ranges.push([i, closeEnd]);
        i = closeEnd;
      } else {
        // Cerca sem fechamento: trata o resto como código (seguro por padrão).
        ranges.push([i, n]);
        i = n;
      }
      continue;
    }

    // Crase inline (1 ou 2 acentos): procura sequência de mesmo tamanho.
    let k = j;
    let closeStart = -1;
    let closeEnd = -1;
    while (k < n) {
      if (text[k] === ch) {
        let m = k;
        while (m < n && text[m] === ch) m++;
        if (m - k === run) {
          closeStart = k;
          closeEnd = m;
          break;
        }
        k = m;
      } else {
        k++;
      }
    }
    if (closeStart !== -1) {
      ranges.push([i, closeEnd]);
      i = closeEnd;
    } else {
      i = j; // crase sem par: caractere literal
    }
  }
  return ranges;
}

/** A posição está dentro de algum intervalo de código? */
function dentroDeCodigo(pos, ranges) {
  for (const [a, b] of ranges) {
    if (pos >= a && pos < b) return true;
  }
  return false;
}

/**
 * Valida se uma candidata do regex é uma palavra de controle de verdade,
 * considerando a vizinhança e os trechos de código.
 *
 * @returns {"sim" | "nao"}
 */
function validarVizinhança(text, start, end, codeRanges) {
  // Não pode encostar em código.
  if (dentroDeCodigo(start, codeRanges) || dentroDeCodigo(end - 1, codeRanges)) {
    return false;
  }
  const antes = start > 0 ? text[start - 1] : "";
  const depois = end < text.length ? text[end] : "";

  if (antes && ESQUERDA_BLOQUEIO.has(antes)) return false;
  // Ponto antes: "arquivo.orchestrate" é identificador; ". palavra" é pontuação.
  if (antes === "." && ehPalavra(text[start - 2])) return false;

  if (depois && DIREITA_BLOQUEIO.has(depois)) return false;
  // Ponto depois: "orchestrate.com"/"orchestrate.js" é domínio/extensão.
  if (depois === "." && ehPalavra(text[end + 1])) return false;

  return true;
}

/** Fim da linha a partir de uma posição (índice do '\n' ou fim do texto). */
function fimDaLinha(text, from) {
  const nl = text.indexOf("\n", from);
  return nl === -1 ? text.length : nl;
}

/**
 * Extrai as palavras de controle do texto do usuário.
 *
 * @param {string} texto
 * @returns {{ textoLimpo: string, diretivas: Array<{ nome: string, alvo: string|null }> }}
 */
export function parseMagicWords(texto) {
  if (typeof texto !== "string" || texto.length === 0) {
    return { textoLimpo: typeof texto === "string" ? texto : "", diretivas: [] };
  }

  const codeRanges = findCodeRanges(texto);
  const diretivas = [];
  const removidos = []; // [inicio, fim) no texto original

  PALAVRA_RE.lastIndex = 0;
  let m;
  while ((m = PALAVRA_RE.exec(texto)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (!validarVizinhança(texto, start, end, codeRanges)) continue;

    const nome = m[0].toLowerCase();
    // Alvo: o resto da linha após a palavra, sem pontuação/sem separador inicial.
    let alvoBruto = texto.slice(end, fimDaLinha(texto, end)).replace(/^[\s.,;:!?)\]}'"»…]+/, "").trim();
    const alvo = alvoBruto.length > 0 ? alvoBruto : null;
    diretivas.push({ nome, alvo });
    removidos.push([start, end]);
  }

  if (diretivas.length === 0) {
    return { textoLimpo: texto, diretivas: [] };
  }

  return { textoLimpo: limparTexto(texto, codeRanges, removidos), diretivas };
}

/**
 * Remove os intervalos de palavras de controle e colapsa espaços redundantes
 * apenas em prosa (trechos de código ficam byte a byte intactos).
 */
function limparTexto(text, codeRanges, removidos) {
  const remover = new Uint8Array(text.length);
  for (const [a, b] of removidos) {
    for (let i = a; i < b; i++) remover[i] = 1;
  }
  const emCodigo = new Uint8Array(text.length);
  for (const [a, b] of codeRanges) {
    for (let i = a; i < b; i++) emCodigo[i] = 1;
  }

  let out = "";
  let ultimoEspaco = false;
  for (let i = 0; i < text.length; i++) {
    if (emCodigo[i]) {
      out += text[i];
      ultimoEspaco = false; // código nunca é "espaço colapsável"
      continue;
    }
    if (remover[i]) continue;
    const ch = text[i];
    if (ch === " " || ch === "\t") {
      if (ultimoEspaco) continue;
      ultimoEspaco = true;
      out += ch;
    } else {
      ultimoEspaco = false;
      out += ch;
    }
  }
  return out.trim();
}

export default { parseMagicWords, findCodeRanges, MAGIC_WORDS };