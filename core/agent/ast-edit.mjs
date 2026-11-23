/**
 * core/agent/ast-edit.mjs — edição estrutural com preview e âncoras por hash.
 *
 * Padrão "hashline": localiza um bloco por símbolo ou por intervalo de linhas,
 * confere hashes das linhas antes de planejar, mostra o diff curto e só aplica
 * depois. Nada de I/O: texto entra, texto sai.
 *
 * O scanner de chaves é DELIBERADAMENTE simples, não é um AST:
 *  - respeita aspas simples, duplas e crases, comentários de linha e de bloco
 *    e interpolação de template;
 *  - conta chaves e parênteses para achar o corpo da declaração;
 *  - NÃO entende regex literals, JSX, Python por indentação, nem TypeScript
 *    avançado (decorators, overloads). Quando não consegue, falha com motivo
 *    explícito em vez de devolver um intervalo chutado.
 *
 * API:
 *   hashTexto(texto) -> hex de 8 caracteres (FNV-1a 32 bits sobre bytes UTF-8)
 *   localizarBloco(texto, { path, simbolo, hashes, startLine, endLine })
 *       -> { ok, inicio, fim, trecho, motivo }
 *   planejarEdicao(texto, opcoes) -> { ok, preview, edicoes, motivo? }
 *   aplicarEdicao(texto, plano)   -> { ok, texto, motivo? }
 *   resumoEdicao(plano, arquivo)  -> string curta para a TUI
 */

import { basename } from "node:path";

const LARGURA = 72;

/* ------------------------------------------------------------------ */
/* Hash                                                                */
/* ------------------------------------------------------------------ */

/** FNV-1a 32 bits sobre bytes UTF-8. Estável e curto (8 hex). */
export function hashTexto(texto) {
  let h = 0x811c9dc5;
  const bytes = Buffer.from(String(texto ?? ""), "utf8");
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/* ------------------------------------------------------------------ */
/* Linhas e formatação                                                 */
/* ------------------------------------------------------------------ */

/** Linhas 1-based com offsets de caractere. Quebras CRLF são preservadas. */
function dividirLinhas(texto) {
  const t = String(texto ?? "");
  const linhas = [];
  let inicio = 0;
  for (let i = 0; i <= t.length; i += 1) {
    if (i !== t.length && t[i] !== "\n") continue;
    let fim = i;
    if (fim > inicio && t[fim - 1] === "\r") fim -= 1;
    linhas.push({ numero: linhas.length + 1, inicio, fim, conteudo: t.slice(inicio, fim) });
    inicio = i + 1;
  }
  return linhas;
}

function linhaDeOffset(linhas, offset) {
  for (const linha of linhas) {
    if (offset >= linha.inicio && offset <= linha.fim) return linha;
  }
  return linhas[linhas.length - 1] || null;
}

function contarLinhas(texto) {
  if (texto === "") return 0;
  const partes = String(texto).split(/\r?\n/);
  return partes[partes.length - 1] === "" ? partes.length - 1 : partes.length;
}

/** Quebra em palavras e, se preciso, em pedaços duros. Sem reticências. */
function quebrar(texto, largura = LARGURA) {
  const linhas = [];
  let atual = "";
  for (const palavra of String(texto).split(/\s+/).filter(Boolean)) {
    if (!atual) atual = palavra;
    else if (`${atual} ${palavra}`.length <= largura) atual += ` ${palavra}`;
    else {
      linhas.push(atual);
      atual = palavra;
    }
  }
  if (atual) linhas.push(atual);
  const saida = [];
  for (const linha of linhas) {
    if (linha.length <= largura) {
      saida.push(linha);
      continue;
    }
    for (let i = 0; i < linha.length; i += largura) saida.push(linha.slice(i, i + largura));
  }
  return saida.join("\n") || "nada";
}

/* ------------------------------------------------------------------ */
/* Scanner de chaves                                                   */
/* ------------------------------------------------------------------ */

function tokensPorPath(path) {
  const p = String(path || "").toLowerCase();
  if (/\.(py|rb|sh|bash|zsh|ya?ml|toml)$/.test(p)) return { line: ["#"] };
  if (/\.(sql|lua)$/.test(p)) return { line: ["--"] };
  return { line: ["//"] };
}

function pularString(texto, inicio, aspas) {
  let i = inicio + 1;
  while (i < texto.length) {
    const ch = texto[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === aspas) return i + 1;
    i += 1;
  }
  return texto.length;
}

/** Pula um template literal inteiro, incluindo expressões ${ ... }. */
function pularTemplate(texto, inicio) {
  let i = inicio + 1;
  let expr = 0;
  while (i < texto.length) {
    const ch = texto[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (expr === 0) {
      if (ch === "`") return i + 1;
      if (ch === "$" && texto[i + 1] === "{") {
        expr = 1;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (ch === "{") expr += 1;
    else if (ch === "}") expr -= 1;
    else if (ch === "'" || ch === '"') i = pularString(texto, i, ch);
    else if (ch === "`") i = pularTemplate(texto, i);
    else if (ch === "/" && texto[i + 1] === "/") {
      const fim = texto.indexOf("\n", i);
      i = fim < 0 ? texto.length : fim + 1;
      continue;
    } else if (ch === "/" && texto[i + 1] === "*") {
      const fim = texto.indexOf("*/", i + 2);
      i = fim < 0 ? texto.length : fim + 2;
      continue;
    }
    i += 1;
  }
  return texto.length;
}

/**
 * Próximo caractere estrutural (){} em código, ignorando strings/comentários.
 * Chaves dentro de templates (inclusive ${}) são ignoradas de propósito: elas
 * pertencem à expressão interna e não ao bloco que está sendo recortado.
 */
function proximoStructural(texto, de, tokens) {
  let i = Math.max(0, de);
  while (i < texto.length) {
    const ch = texto[i];
    const prox = texto[i + 1];
    if (ch === "/" && prox === "/") {
      const fim = texto.indexOf("\n", i);
      i = fim < 0 ? texto.length : fim + 1;
      continue;
    }
    if (ch === "/" && prox === "*") {
      const fim = texto.indexOf("*/", i + 2);
      i = fim < 0 ? texto.length : fim + 2;
      continue;
    }
    if (tokens.line.some((marca) => texto.startsWith(marca, i))) {
      const fim = texto.indexOf("\n", i);
      i = fim < 0 ? texto.length : fim;
      continue;
    }
    if (ch === "'" || ch === '"') {
      i = pularString(texto, i, ch);
      continue;
    }
    if (ch === "`") {
      i = pularTemplate(texto, i);
      continue;
    }
    if (ch === "{" || ch === "}" || ch === "(" || ch === ")") return { i, ch };
    i += 1;
  }
  return null;
}

/** Acha a chave de abertura do corpo ignorando default params entre parênteses. */
function encontrarAbertura(texto, de, tokens) {
  let paren = 0;
  let atual = de;
  for (;;) {
    const item = proximoStructural(texto, atual, tokens);
    if (!item) return null;
    if (item.ch === "(") paren += 1;
    else if (item.ch === ")") paren = Math.max(0, paren - 1);
    else if (item.ch === "{" && paren === 0) return item.i;
    else if (item.ch === "}" && paren === 0) return null;
    atual = item.i + 1;
  }
}

/** Acha a chave de fechamento que casa com `abertura`. */
function encontrarFechamento(texto, abertura, tokens) {
  let profundidade = 0;
  let atual = abertura;
  for (;;) {
    const item = proximoStructural(texto, atual, tokens);
    if (!item) return null;
    if (item.ch === "{") profundidade += 1;
    else if (item.ch === "}") {
      profundidade -= 1;
      if (profundidade === 0) return item.i;
    }
    atual = item.i + 1;
  }
}

function escaparRegistro(valor) {
  return String(valor).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function regexSimbolo(nome) {
  const n = escaparRegistro(nome);
  return new RegExp(
    `(?:^|[\\s;])(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?` +
      `(?:function\\s*\\*?\\s*${n}\\b|class\\s+${n}\\b|(?:const|let|var)\\s+${n}\\s*=)`,
    "g",
  );
}

/* ------------------------------------------------------------------ */
/* Localização                                                         */
/* ------------------------------------------------------------------ */

function falha(motivo) {
  return { ok: false, inicio: null, fim: null, trecho: "", motivo };
}

function hashesDoIntervalo(linhas, inicioLinha, fimLinha) {
  const trecho = linhas.slice(inicioLinha - 1, fimLinha);
  return trecho.map((linha) => hashTexto(linha.conteudo));
}

function mesmoConteudo(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Localiza um bloco por símbolo, hashes ou intervalo de linhas.
 * As hashes ancoram o conteúdo exato: divergência é "stale", nunca um chute.
 */
export function localizarBloco(texto, opcoes = {}) {
  const t = String(texto ?? "");
  const opts = opcoes && typeof opcoes === "object" ? opcoes : {};
  const linhas = dividirLinhas(t);
  const tokens = tokensPorPath(opts.path);
  const hashesPedidas = Array.isArray(opts.hashes) && opts.hashes.length
    ? opts.hashes.map((h) => String(h))
    : null;

  let inicio;
  let fim;
  let inicioLinha;
  let fimLinha;

  if (opts.startLine != null || opts.endLine != null) {
    const a = Number(opts.startLine ?? 1);
    const b = Number(opts.endLine ?? opts.startLine ?? 1);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < a || b > linhas.length) {
      return falha("intervalo-invalido");
    }
    inicioLinha = a;
    fimLinha = b;
    inicio = linhas[a - 1].inicio;
    fim = linhas[b - 1].fim;
  } else if (opts.simbolo != null && String(opts.simbolo).trim() !== "") {
    const nome = String(opts.simbolo).trim();
    const re = regexSimbolo(nome);
    let encontrada = null;
    let m;
    while ((m = re.exec(t)) !== null) {
      const linha = linhaDeOffset(linhas, m.index);
      if (linha && (!opts.startLine || linha.numero >= Number(opts.startLine))) {
        encontrada = m;
        break;
      }
    }
    if (!encontrada) return falha("simbolo-nao-encontrado");
    // O regex inclui o espaço/newline que antecede a declaração; descarta para
    // não ancorar a linha anterior.
    const espacoInicial = /^\s+/.exec(encontrada[0]);
    const inicioDeclaracao = encontrada.index + (espacoInicial ? espacoInicial[0].length : 0);
    const abertura = encontrarAbertura(t, encontrada.index + encontrada[0].length, tokens);
    if (abertura == null) return falha("sem-abertura");
    const fechamento = encontrarFechamento(t, abertura, tokens);
    if (fechamento == null) return falha("bloco-nao-fechado");
    const primeira = linhaDeOffset(linhas, inicioDeclaracao);
    const ultima = linhaDeOffset(linhas, fechamento);
    if (!primeira || !ultima) return falha("intervalo-invalido");
    inicioLinha = primeira.numero;
    fimLinha = ultima.numero;
    inicio = primeira.inicio;
    fim = ultima.fim;
  } else if (hashesPedidas) {
    let encontrado = false;
    for (let i = 0; i + hashesPedidas.length <= linhas.length; i += 1) {
      const janela = linhas.slice(i, i + hashesPedidas.length).map((l) => hashTexto(l.conteudo));
      if (mesmoConteudo(janela, hashesPedidas)) {
        inicioLinha = i + 1;
        fimLinha = i + hashesPedidas.length;
        inicio = linhas[i].inicio;
        fim = linhas[i + hashesPedidas.length - 1].fim;
        encontrado = true;
        break;
      }
    }
    if (!encontrado) return falha("stale");
  } else {
    return falha("sem-ancora");
  }

  if (hashesPedidas) {
    const atuais = hashesDoIntervalo(linhas, inicioLinha, fimLinha);
    if (!mesmoConteudo(atuais, hashesPedidas)) return falha("stale");
  }

  return {
    ok: true,
    inicio,
    fim,
    trecho: t.slice(inicio, fim),
    motivo: null,
    linhaInicio: inicioLinha,
    linhaFim: fimLinha,
  };
}

/* ------------------------------------------------------------------ */
/* Planejamento e aplicação                                            */
/* ------------------------------------------------------------------ */

function textoDepois(spec) {
  const valor = spec.depois ?? spec.novoTexto ?? spec.substituir ?? spec.texto ?? "";
  return String(valor);
}

function sobrepostas(edicoes) {
  const ordenadas = [...edicoes].sort((a, b) => a.inicio - b.inicio);
  for (let i = 1; i < ordenadas.length; i += 1) {
    if (ordenadas[i].inicio < ordenadas[i - 1].fim) return true;
  }
  return false;
}

/** Monta o plano sem tocar no texto. Aceita uma edição ou `opcoes.edicoes`. */
export function planejarEdicao(texto, opcoes = {}) {
  const t = String(texto ?? "");
  const opts = opcoes && typeof opcoes === "object" ? opcoes : {};
  const especificacoes = Array.isArray(opts.edicoes) ? opts.edicoes : [opts];
  if (especificacoes.length === 0) return { ok: false, preview: "", edicoes: [], motivo: "sem-edicao" };

  const edicoes = [];
  for (const spec of especificacoes) {
    const encontrado = localizarBloco(t, spec && typeof spec === "object" ? spec : {});
    if (!encontrado.ok) return { ok: false, preview: "", edicoes: [], motivo: encontrado.motivo };
    edicoes.push({
      inicio: encontrado.inicio,
      fim: encontrado.fim,
      antes: t.slice(encontrado.inicio, encontrado.fim),
      depois: textoDepois(spec),
      linhaInicio: encontrado.linhaInicio,
      linhaFim: encontrado.linhaFim,
    });
  }
  if (sobrepostas(edicoes)) return { ok: false, preview: "", edicoes: [], motivo: "sobreposicao" };

  const linhasMudadas = edicoes.reduce((total, e) => total + contarLinhas(e.antes), 0);
  const quantidade = edicoes.length;
  const cabecalho = `Plano: ${quantidade} edi${quantidade === 1 ? "ção" : "ções"} em ${linhasMudadas} linha${linhasMudadas === 1 ? "" : "s"}.`;
  const detalhes = edicoes.map((e) => {
    const antes = contarLinhas(e.antes);
    const depois = contarLinhas(e.depois);
    return `- linhas ${e.linhaInicio}-${e.linhaFim}: ${antes} -> ${depois} linhas`;
  });
  const preview = [cabecalho, ...detalhes].map((linha) => quebrar(linha)).join("\n");

  return { ok: true, preview, edicoes };
}

/** Aplica de trás para frente. Qualquer divergência aborta tudo. */
export function aplicarEdicao(texto, plano) {
  const original = String(texto ?? "");
  if (!plano || plano.ok !== true || !Array.isArray(plano.edicoes) || plano.edicoes.length === 0) {
    return { ok: false, texto: original, motivo: "plano-invalido" };
  }

  for (const edicao of plano.edicoes) {
    const { inicio, fim, antes, depois } = edicao || {};
    if (
      !Number.isInteger(inicio) ||
      !Number.isInteger(fim) ||
      inicio < 0 ||
      fim < inicio ||
      fim > original.length ||
      typeof antes !== "string" ||
      typeof depois !== "string"
    ) {
      return { ok: false, texto: original, motivo: "plano-invalido" };
    }
    if (original.slice(inicio, fim) !== antes) {
      return { ok: false, texto: original, motivo: "stale" };
    }
  }
  if (sobrepostas(plano.edicoes)) return { ok: false, texto: original, motivo: "plano-invalido" };

  let resultado = original;
  const ordemReversa = [...plano.edicoes].sort((a, b) => b.inicio - a.inicio);
  for (const edicao of ordemReversa) {
    resultado = resultado.slice(0, edicao.inicio) + edicao.depois + resultado.slice(edicao.fim);
  }
  return { ok: true, texto: resultado };
}

/** Resumo de uma linha para a TUI. Só o nome do arquivo, nunca o caminho. */
export function resumoEdicao(plano, arquivo) {
  const alvo = arquivo ? basename(String(arquivo)) : "arquivo";
  if (!plano || plano.ok !== true || !Array.isArray(plano.edicoes)) {
    return quebrar(`ast-edit: nada aplicado em ${alvo}.`);
  }
  const quantidade = plano.edicoes.length;
  const linhas = plano.edicoes.reduce((total, e) => total + contarLinhas(e.antes), 0);
  return quebrar(
    `ast-edit: ${quantidade} edi${quantidade === 1 ? "ção" : "ções"} em ${alvo}, ${linhas} linhas.`,
  );
}

export default { hashTexto, localizarBloco, planejarEdicao, aplicarEdicao, resumoEdicao };
