/**
 * core/agent/rewind.mjs — recorte puro de sessões JSONL (checkpoint/rewind).
 *
 * O formato real do motor é o descrito em core/agent/sessions.mjs e visto nos
 * JSONL de sessão: cada linha é um evento com `type`. O cabeçalho tem
 * `type:"session"`; mensagens vêm como `{ type:"message", message:{ role, ... } }`
 * e podem trazer `message.stopReason` "error"/"aborted". Eventos de contexto
 * (`context_edit`, `model_change`, `thinking_level_change`) formam uma cadeia
 * por `id`/`parentId`. Algumas sessões começam com um evento `title`.
 *
 * Este módulo é puro: recebe texto, devolve texto. Sem I/O, sem rede, sem
 * dependências. Nunca reescreve uma linha — só remove linhas inteiras.
 *
 * API:
 *   rewindSession(texto, opcoes) -> { ok, jsonl, removidas, motivo }
 *   rewindReport(removidas, motivo) -> string (≤ 72 colunas por linha)
 *   summarizeSession(texto) -> { mensagens, erros, ultimoUsuario }
 *
 * Modos de corte (precedência: dropErrors > beforeMessageId > keepLast):
 *   dropErrors: true   remove assistant error/aborted + contexto ligado
 *   beforeMessageId    remove eventos antes do id informado
 *   keepLast: N        mantém as últimas N mensagens de usuário
 */

const TIPO_CABECALHO = "session";
const TIPO_TITULO = "title";
const TIPOS_CONTEXTO = new Set(["context_edit", "model_change", "thinking_level_change"]);
const RAZOES_ERRO = new Set(["error", "aborted"]);
const LARGURA_RELATORIO = 72;
const LIMITE_ULTIMO_USUARIO = 120;

/* ------------------------------------------------------------------ */
/* Leitura do JSONL                                                    */
/* ------------------------------------------------------------------ */

/**
 * Separa linhas sem perder o original. Linhas em branco e linhas que não são
 * JSON são preservadas (segurança de dados): nunca são contadas nem removidas.
 */
function lerJsonl(texto) {
  const bruto = texto == null ? "" : String(texto);
  const eol = bruto.includes("\r\n") ? "\r\n" : "\n";
  const temTrailing = bruto.length > 0 && /\r?\n$/.test(bruto);
  const partes = bruto.split(/\r?\n/);
  if (temTrailing) partes.pop();

  const entradas = partes.map((linha) => {
    if (linha.trim() === "") return { linha, valida: false, branca: true, ev: null };
    try {
      const ev = JSON.parse(linha);
      const valida = Boolean(ev && typeof ev === "object" && !Array.isArray(ev));
      return { linha, valida, branca: false, ev: valida ? ev : null };
    } catch {
      return { linha, valida: false, branca: false, ev: null };
    }
  });

  return { entradas, eol, trailing: temTrailing ? eol : "" };
}

function tipoDe(entrada) {
  return entrada?.valida ? entrada.ev.type : null;
}

function ehCabecalho(entrada) {
  return tipoDe(entrada) === TIPO_CABECALHO;
}

function ehContexto(entrada) {
  return Boolean(entrada?.valida && TIPOS_CONTEXTO.has(entrada.ev.type));
}

/** Aceita o formato real ({type:"message", message:{...}}) e mensagem crua. */
function mensagemDe(entrada) {
  if (!entrada?.valida) return null;
  const ev = entrada.ev;
  if (ev.type === "message" && ev.message && typeof ev.message === "object") return ev.message;
  if (typeof ev.role === "string") return ev;
  return null;
}

function ehErro(msg) {
  return Boolean(
    msg &&
      msg.role === "assistant" &&
      RAZOES_ERRO.has(typeof msg.stopReason === "string" ? msg.stopReason.toLowerCase() : ""),
  );
}

function idDe(entrada) {
  if (!entrada?.valida) return null;
  const bruto = entrada.ev.id ?? entrada.ev.message?.id;
  return typeof bruto === "string" || typeof bruto === "number" ? String(bruto) : null;
}

function parentDe(entrada) {
  if (!entrada?.valida) return null;
  const bruto = entrada.ev.parentId ?? entrada.ev.message?.parentId;
  return typeof bruto === "string" || typeof bruto === "number" ? String(bruto) : null;
}

function textoDaMensagem(msg) {
  const content = msg?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter((bloco) => bloco && typeof bloco.text === "string")
      .map((bloco) => bloco.text)
      .join(" ")
      .trim();
  }
  return "";
}

/** Corta em espaço, sem reticências: a saída nunca termina com "..." */
function curto(texto, limite) {
  const limpo = String(texto ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (limpo.length <= limite) return limpo;
  const corte = limpo.lastIndexOf(" ", limite);
  return corte > 0 ? limpo.slice(0, corte) : limpo.slice(0, limite);
}

/* ------------------------------------------------------------------ */
/* Núcleo do recorte                                                   */
/* ------------------------------------------------------------------ */

/**
 * Remove eventos antes de `indice`. Cabeçalho, título, linhas em branco e
 * linhas corrompidas ficam onde estão — só eventos válidos são contados.
 */
function marcarAntes(entradas, remover, indice) {
  for (let i = 0; i < indice; i += 1) {
    const entrada = entradas[i];
    if (entrada.branca || !entrada.valida || ehCabecalho(entrada) || tipoDe(entrada) === TIPO_TITULO) continue;
    remover[i] = true;
  }
}

/**
 * Remove assistant com stopReason error/aborted e os eventos de contexto
 * ligados a eles. A ligação é por `parentId`; só eventos de contexto entram na
 * cadeia — mensagens de usuário e respostas válidas nunca são removidas.
 */
function aplicarDropErrors(entradas, remover) {
  const ids = new Set();

  for (let i = 0; i < entradas.length; i += 1) {
    if (!ehErro(mensagemDe(entradas[i]))) continue;
    remover[i] = true;
    const id = idDe(entradas[i]);
    if (id) ids.add(id);
  }

  let mudou = true;
  while (mudou) {
    mudou = false;
    for (let i = 0; i < entradas.length; i += 1) {
      if (remover[i] || !ehContexto(entradas[i])) continue;
      const pai = parentDe(entradas[i]);
      if (!pai || !ids.has(pai)) continue;
      remover[i] = true;
      const id = idDe(entradas[i]);
      if (id && !ids.has(id)) {
        ids.add(id);
        mudou = true;
      }
    }
  }

  // Sessões simplificadas podem não ter id/parentId: pega o contexto logo
  // depois do erro, antes da próxima mensagem.
  for (let i = 0; i < entradas.length; i += 1) {
    if (!remover[i] || !ehErro(mensagemDe(entradas[i])) || idDe(entradas[i])) continue;
    for (let j = i + 1; j < entradas.length; j += 1) {
      if (mensagemDe(entradas[j])) break;
      if (ehContexto(entradas[j]) && !parentDe(entradas[j])) remover[j] = true;
    }
  }
}

/** Conta mensagens, erros e guarda a última fala do usuário para a TUI. */
export function summarizeSession(textoJsonl) {
  const { entradas } = lerJsonl(textoJsonl);
  let mensagens = 0;
  let erros = 0;
  let ultimoUsuario = null;

  for (const entrada of entradas) {
    const msg = mensagemDe(entrada);
    if (!msg) continue;
    mensagens += 1;
    if (ehErro(msg)) erros += 1;
    if (msg.role === "user") {
      const texto = textoDaMensagem(msg);
      if (texto) ultimoUsuario = curto(texto, LIMITE_ULTIMO_USUARIO);
    }
  }

  return { mensagens, erros, ultimoUsuario };
}

/**
 * Recorta um JSONL de sessão. Nunca trunca no meio de um JSON: só linhas
 * completas são removidas. Sem mudança, devolve o texto original intacto.
 *
 * @param {string} textoJsonl
 * @param {{ keepLast?: number, beforeMessageId?: string, dropErrors?: boolean }} [opcoes]
 * @returns {{ ok: boolean, jsonl: string, removidas: number, motivo: string }}
 */
export function rewindSession(textoJsonl, opcoes = {}) {
  const original = textoJsonl == null ? "" : String(textoJsonl);
  const { entradas, eol, trailing } = lerJsonl(original);
  const opts = opcoes && typeof opcoes === "object" ? opcoes : {};
  const remover = new Array(entradas.length).fill(false);
  let motivo;

  if (opts.dropErrors === true) {
    aplicarDropErrors(entradas, remover);
    motivo = "erros";
  } else if (opts.beforeMessageId != null && String(opts.beforeMessageId) !== "") {
    const alvo = String(opts.beforeMessageId);
    const indice = entradas.findIndex((entrada) => entrada.valida && idDe(entrada) === alvo);
    if (indice < 0) return { ok: false, jsonl: original, removidas: 0, motivo: "id-ausente" };
    marcarAntes(entradas, remover, indice);
    motivo = "antes-de";
  } else if (opts.keepLast != null) {
    const n = Number(opts.keepLast);
    if (!Number.isInteger(n) || n < 0) {
      return { ok: false, jsonl: original, removidas: 0, motivo: "sem-opcao" };
    }
    const usuarios = [];
    entradas.forEach((entrada, i) => {
      if (mensagemDe(entrada)?.role === "user") usuarios.push(i);
    });
    // n igual ou maior que o total não é corte: nada de metadados é perdido.
    const indice =
      n === 0 ? entradas.length : n >= usuarios.length ? null : usuarios[usuarios.length - n];
    if (indice != null) marcarAntes(entradas, remover, indice);
    motivo = "manter-ultimos";
  } else {
    return { ok: false, jsonl: original, removidas: 0, motivo: "sem-opcao" };
  }

  const removidas = entradas.reduce((total, entrada, i) => total + (remover[i] && entrada.valida ? 1 : 0), 0);
  if (removidas === 0) return { ok: true, jsonl: original, removidas: 0, motivo: "sem-mudanca" };

  const jsonl =
    entradas
      .filter((_, i) => !remover[i])
      .map((entrada) => entrada.linha)
      .join(eol) + trailing;
  return { ok: true, jsonl, removidas, motivo };
}

/* ------------------------------------------------------------------ */
/* Relatório para a TUI                                                */
/* ------------------------------------------------------------------ */

/** Quebra em palavras e, se preciso, em pedaços duros. Sem reticências. */
function quebrar(texto, largura) {
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
  return saida.join("\n");
}

/** Texto curto em português, no máximo 72 colunas por linha. */
export function rewindReport(removidas, motivo) {
  const numero = Number(removidas);
  const n = Number.isFinite(numero) && numero > 0 ? Math.floor(numero) : 0;
  const item = `${n} evento${n === 1 ? "" : "s"}`;
  const sufixo = n === 1 ? "" : "s";
  const codigo = String(motivo ?? "sem-mudanca")
    .replace(/\.\.\.|…/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (n === 0) return "Rewind: nada a remover.";

  let texto;
  switch (codigo) {
    case "erros":
      texto = `Rewind: ${item} removido${sufixo} por erros.`;
      break;
    case "manter-ultimos":
      texto = `Rewind: ${item} removido${sufixo} para manter os últimos.`;
      break;
    case "antes-de":
      texto = `Rewind: ${item} removido${sufixo} antes do ponto.`;
      break;
    case "id-ausente":
      texto = "Rewind: id de mensagem não encontrado.";
      break;
    case "sem-opcao":
      texto = "Rewind: nenhuma opção de corte informada.";
      break;
    case "sem-mudanca":
      texto = "Rewind: nada a remover.";
      break;
    default:
      texto = `Rewind: ${item} removido${sufixo} (${codigo}).`;
  }

  return quebrar(texto, LARGURA_RELATORIO);
}

export default { rewindSession, rewindReport, summarizeSession };
