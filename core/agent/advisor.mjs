/**
 * core/agent/advisor.mjs — segundo modelo observando o turno + regras de stream.
 *
 * Dois recursos inspirados em Oh My Pi, mas sem runtime externo:
 *  1. Advisor: um revisor assíncrono injetado lê cada turno e devolve notas
 *     classificadas (note / concern / blocker). O módulo não chama modelo, não
 *     lê config e não escreve na tela — só normaliza e formata.
 *  2. StreamRules: regras que reconhecem um padrão no texto encore-as-ele
 *     (delta a delta) e pedem abort + injeção de regra, sem pagar contexto em
 *     toda mensagem. O chamador decide abortar e reinjetar.
 */

const SEVERIDADES = Object.freeze(["note", "concern", "blocker"]);
const LARGURA = 72;

function texto(v) {
  return String(v ?? "").trim();
}

/** Normaliza a saída livre do revisor em notas estruturadas. */
export function parseNotes(saida) {
  const notas = [];
  for (const linha of String(saida ?? "").split(/\r?\n/)) {
    const m = linha.match(/^\s*(NOTE|CONCERN|BLOCKER|NOTA|ATENCAO|BLOQUEIO)\s*:\s*(.+)$/i);
    if (!m) continue;
    const bruta = m[1].toUpperCase();
    const severidade = bruta.startsWith("BLOCK") || bruta === "BLOQUEIO"
      ? "blocker"
      : bruta.startsWith("CONCERN") || bruta === "ATENCAO"
        ? "concern"
        : "note";
    const mensagem = texto(m[2]);
    if (mensagem) notas.push({ severity: severidade, text: mensagem });
  }
  return notas;
}

/** Quebra em palavras, sem reticências, dentro da largura da TUI. */
function quebrar(mensagem, largura = LARGURA) {
  const palavras = texto(mensagem).split(/\s+/).filter(Boolean);
  const linhas = [];
  let atual = "";
  for (const palavra of palavras) {
    if (!atual) atual = palavra;
    else if (`${atual} ${palavra}`.length <= largura) atual += ` ${palavra}`;
    else { linhas.push(atual); atual = palavra; }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

/** Formata uma nota para a TUI. Nunca passa de 72 colunas por linha. */
export function formatNote(nota, { prefixo = "advisor" } = {}) {
  const rotulo = SEVERIDADES.includes(nota?.severity) ? nota.severity : "note";
  const cabecalho = `${prefixo} · ${rotulo}:`;
  const primeiro = `${cabecalho} ${texto(nota?.text)}`;
  if (primeiro.length <= LARGURA) return primeiro;
  const linhas = quebrar(nota?.text, LARGURA - cabecalho.length - 1);
  return [cabecalho, ...linhas.map((l) => " ".repeat(cabecalho.length + 1) + l)].join("\n");
}

/**
 * Um turno pode seguir ou ser interrompido. Blocker interrompe; concern apenas
 * aparece; note é silencioso no modo minimal.
 */
export function shouldInterrupt(notas, { allowBlock = true } = {}) {
  if (!allowBlock) return false;
  return (Array.isArray(notas) ? notas : []).some((n) => n?.severity === "blocker");
}

/** Observa um turno com um revisor injetado. Nunca lança. */
export async function observeTurn(turno, revisor, { timeoutMs = 15_000 } = {}) {
  if (typeof revisor !== "function") return [];
  const payload = {
    mode: texto(turno?.mode) || "build",
    user: texto(turno?.user).slice(0, 4000),
    assistant: texto(turno?.assistant).slice(0, 12_000),
    tools: Array.isArray(turno?.tools) ? turno.tools.slice(0, 40) : [],
  };
  let timer = null;
  try {
    const promessa = Promise.resolve(revisor(payload));
    const expira = new Promise((_r, rejeita) => {
      timer = setTimeout(() => rejeita(new Error("advisor timeout")), Math.max(100, timeoutMs));
      if (timer.unref) timer.unref();
    });
    const saida = await Promise.race([promessa, expira]);
    return parseNotes(saida);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Regras de stream                                                    */
/* ------------------------------------------------------------------ */

/**
 * Compila regras `{ name, pattern, note, action }`. `pattern` pode ser regex ou
 * string (escapada). Regras inválidas são descartadas.
 */
export function compilarRegras(regras = []) {
  const out = [];
  for (const r of Array.isArray(regras) ? regras : []) {
    if (!r || typeof r.pattern === "undefined") continue;
    let re;
    try {
      re = r.pattern instanceof RegExp ? r.pattern : new RegExp(String(r.pattern), "i");
    } catch { continue; }
    out.push({
      name: texto(r.name) || "regra",
      re,
      note: texto(r.note),
      action: r.action === "warn" ? "warn" : "abort",
    });
  }
  return out;
}

/**
 * Verifica o delta acumulado do stream. Para não perder um padrão que cruza
 * deltas, mantém uma cauda de `janela` caracteres e devolve o novo carry.
 * @returns {{ rule:object|null, carry:string }}
 */
export function verificarStream(regras, delta, carry = "", { janela = 400 } = {}) {
  const buffer = (texto(carry) + String(delta ?? "")).slice(-Math.max(32, janela));
  // Aceita regras cruas ({ pattern }) ou já compiladas ({ re }) — o chamador
  // normalmente compila uma vez e reusa a cada delta do stream.
  const compiladas = (Array.isArray(regras) ? regras : []).flatMap((r) =>
    r && r.re instanceof RegExp ? [r] : compilarRegras([r]),
  );
  for (const regra of compiladas) {
    regra.re.lastIndex = 0;
    if (regra.re.test(buffer)) return { rule: regra, carry: buffer };
  }
  return { rule: null, carry: buffer };
}

export default {
  parseNotes, formatNote, shouldInterrupt, observeTurn, compilarRegras, verificarStream,
};
