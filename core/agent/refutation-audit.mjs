/**
 * core/agent/refutation-audit.mjs — classificador de afirmações por evidência.
 *
 * Um "auditor de refutação" recebe afirmações e achados e responde uma pergunta
 * só: para cada afirmação, a evidência apresentada a sustenta, a refuta, ou não
 * prova nada? A inspiração é o método, não o jargão: uma afirmação só é
 * "sustentada" quando existe prova que a confirma e nenhuma que a derruba;
 * "refutada" quando existe prova que a contradiz; "sem prova" quando só há
 * achados inconclusivos (ou nenhum).
 *
 * Contrato:
 *   audit(assertions, findings) -> {
 *     total, sustentadas, refutadas, semProva,
 *     resultados: [{ id, status, evidencias, motivo }],
 *     lacunas: [ ... ]            // afirmações sem prova sustentada
 *   }
 *
 * Regras:
 *   - Nunca lê, escreve ou remove arquivo. Objeto puro: entrada → saída.
 *   - Não lança com entrada inválida: devolve lacuna em vez de estourar.
 *   - Achado sem status reconhecido entra como "inconclusivo".
 */

const STATUS_VALIDOS = new Set(["sustenta", "refuta", "inconclusivo"]);

function normalizarStatus(bruto) {
  return STATUS_VALIDOS.has(bruto) ? bruto : "inconclusivo";
}

function textoDoAchado(txt) {
  if (txt == null) return "";
  const s = String(txt).replace(/\s+/g, " ").trim();
  return s.length > 200 ? s.slice(0, 199) + "…" : s;
}

/**
 * @param {Array<{id?:string, texto?:string}>} assertions
 * @param {Array<{afirmacao?:string, id?:string, status?:string, fonte?:string, detalhe?:string}>} findings
 */
export function audit(assertions, findings) {
  const listaAf = Array.isArray(assertions) ? assertions : [];
  const listaFi = Array.isArray(findings) ? findings : [];

  // Índice de achados por afirmação (casa por id exato ou por texto exato).
  const porId = new Map();
  const porTexto = new Map();
  for (const f of listaFi) {
    if (!f || typeof f !== "object") continue;
    const chave = f.id != null ? String(f.id) : null;
    const alvo = f.afirmacao != null ? String(f.afirmacao).trim() : "";
    if (chave != null) {
      if (!porId.has(chave)) porId.set(chave, []);
      porId.get(chave).push(f);
    } else if (alvo) {
      if (!porTexto.has(alvo)) porTexto.set(alvo, []);
      porTexto.get(alvo).push(f);
    }
  }

  const resultados = [];
  const lacunas = [];
  const idsVistos = new Set();
  const textosVistos = new Set();

  for (const af of listaAf) {
    const id = af && af.id != null ? String(af.id) : null;
    const texto = af && af.texto != null ? String(af.texto) : "";
    const achados = [];
    if (id != null && porId.has(id)) achados.push(...porId.get(id));
    if (texto && porTexto.has(texto.trim())) achados.push(...porTexto.get(texto.trim()));
    if (id != null) idsVistos.add(id);
    if (texto) textosVistos.add(texto.trim());

    let sustenta = 0;
    let refuta = 0;
    let inconclusivo = 0;
    for (const f of achados) {
      const st = normalizarStatus(f && f.status);
      if (st === "sustenta") sustenta += 1;
      else if (st === "refuta") refuta += 1;
      else inconclusivo += 1;
    }

    let status;
    if (refuta > 0) status = "refutada";
    else if (sustenta > 0) status = "sustentada";
    else status = "sem prova";

    const evidencias = achados.map((f) => ({
      status: normalizarStatus(f && f.status),
      fonte: f && f.fonte != null ? String(f.fonte) : null,
      detalhe: textoDoAchado(f && f.detalhe),
    }));

    resultados.push({
      id: id != null ? id : texto,
      status,
      evidencias,
      motivo: motivoDo(status, sustenta, refuta, inconclusivo),
    });

    if (status !== "sustentada") {
      lacunas.push({
        id: id != null ? id : texto,
        status,
        motivo: motivoDo(status, sustenta, refuta, inconclusivo),
      });
    }
  }

  // Achados que apontam para afirmação desconhecida são lacuna de rastreio.
  for (const f of listaFi) {
    if (!f || typeof f !== "object") continue;
    const id = f.id != null ? String(f.id) : null;
    const alvo = f.afirmacao != null ? String(f.afirmacao).trim() : "";
    const casa = (id != null && idsVistos.has(id)) || (alvo && textosVistos.has(alvo));
    if (!casa) {
      lacunas.push({
        id: id != null ? id : alvo,
        status: "sem prova",
        motivo: "achado aponta para afirmação que não está na lista",
      });
    }
  }

  let sustentadas = 0;
  let refutadas = 0;
  let semProva = 0;
  for (const r of resultados) {
    if (r.status === "sustentada") sustentadas += 1;
    else if (r.status === "refutada") refutadas += 1;
    else semProva += 1;
  }

  return {
    total: resultados.length,
    sustentadas,
    refutadas,
    semProva,
    resultados,
    lacunas,
  };
}

function motivoDo(status, sustenta, refuta, inconclusivo) {
  if (status === "refutada") {
    return `afirmação contrariada por ${refuta} achado(s)${sustenta ? `; ${sustenta} a sustentam` : ""}`;
  }
  if (status === "sustentada") {
    const extra = inconclusivo ? `; ${inconclusivo} inconclusivo(s) ignorado(s)` : "";
    return `sustentada por ${sustenta} achado(s)${extra}`;
  }
  return inconclusivo
    ? `nenhuma prova conclusiva (${inconclusivo} achado(s) inconclusivo(s))`
    : "nenhum achado apresentado";
}

export default { audit };