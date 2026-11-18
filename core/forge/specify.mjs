#!/usr/bin/env node
/**
 * selfevopi-forge-specify — o SpecWriter do plano (Fase 2, passo 2).
 *
 * "Especificar: gerar contrato curto antes de qualquer código — entradas,
 * saídas JSON compactas, casos de teste, permissões mínimas e restrições
 * explícitas (o que NÃO pode fazer)."
 *
 * O detector devolve uma lacuna em linguagem de gente ("ferramenta confiável
 * para D1-cria-soma"). Um gerador precisa de um **contrato**: kind, entradas,
 * saídas, proibições e testes. Este módulo é a ponte entre os dois.
 *
 * Estratégia, da mais confiável à mais modesta:
 *   1. modelo  — recebe a lacuna + o contexto e devolve o contrato em JSON
 *   2. heurística — quando não há modelo, ou o modelo devolve lixo, produz o
 *      artefato mais leve que sempre pode ser gerado: uma **skill**
 *
 * Uma skill é a escolha honesta para o fallback: ela não precisa de entradas
 * nem de saídas, então não há contrato falso. Prometer um CLI sem saber as
 * flags seria inventar interface.
 */

import { createArtifactRequest, ARTIFACT_KINDS } from "./contract.mjs";
import { ForgeGenerationError } from "./generate-llm.mjs";

/* ------------------------------------------------------------------ */
/* Fallback heurístico                                                 */
/* ------------------------------------------------------------------ */

/**
 * Contrato mínimo honesto: uma skill que descreve a capacidade pedida.
 * Sem inputs/outputs — e por isso sem risco de inventar uma interface.
 */
export function heuristicRequest(gap) {
  const goal = String(gap?.goal ?? gap?.capability ?? "").trim();
  if (goal === "") {
    throw new ForgeGenerationError("no-model", "lacuna sem goal nem capability");
  }
  return createArtifactRequest({
    goal,
    kind: "skill",
    inputs: {},
    outputs: {},
    forbidden: ["acessar rede", "escrever fora do workspace", "inventar dados"],
    tests: [
      {
        name: "a skill existe e descreve a capacidade",
        command: 'node -e "const fs=require(\'fs\');const t=fs.readFileSync(\'SKILL.md\',\'utf8\');if(t.length<40)process.exit(1)"',
        expect: null,
      },
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

/** Monta o prompt do SpecWriter. Curto: a lacuna é a entrada. */
export function buildSpecPrompt({ gap, context = null }) {
  const evidence = Array.isArray(gap?.evidence) ? gap.evidence.slice(0, 6) : [];
  const lines = [
    "Você escreve a especificação de um artefato de software.",
    "Responda APENAS um objeto JSON válido, sem fences e sem explicação.",
    "",
    "LACUNA",
    `tipo: ${gap?.kind ?? "desconhecido"}`,
    `tarefa: ${gap?.taskId ?? "?"}`,
    `capacidade pedida: ${gap?.capability ?? gap?.goal ?? "?"}`,
    `objetivo: ${gap?.goal ?? gap?.capability ?? "?"}`,
  ];
  if (evidence.length > 0) {
    lines.push("", "EVIDÊNCIA");
    for (const e of evidence) lines.push(`- ${e}`);
  }
  if (context) {
    lines.push("", "CONTEXTO");
    for (const [k, v] of Object.entries(context).slice(0, 10)) {
      lines.push(`- ${k}: ${typeof v === "string" ? v.slice(0, 200) : JSON.stringify(v)}`);
    }
  }
  lines.push(
    "",
    "FORMATO",
    "{",
    '  "goal": "uma frase do que o artefato faz",',
    `  "kind": "${ARTIFACT_KINDS.join("|")}",`,
    '  "inputs": {"nome_da_flag": "descricao curta"},',
    '  "outputs": {"chave_do_json": "descricao curta"},',
    '  "permissions": ["o que ele PODE fazer"],',
    '  "forbidden": ["o que ele NAO pode fazer"],',
    '  "tests": [{"name": "nome", "command": "comando que roda", "expect": "regex opcional"}]',
    "}",
    "",
    "REGRAS",
    "- prefira o kind mais leve que atenda: skill < cli < extension < mcp-server",
    "- inputs e outputs podem ser {} quando o artefato é um documento (skill)",
    "- forbidden NUNCA pode ser vazio: inclua ao menos \"acessar rede\"",
    "- tests precisa ter ao menos 1 caso, com comando executável de verdade",
    "- não invente capacidade que a lacuna não pede",
  );
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Extração                                                            */
/* ------------------------------------------------------------------ */

/** Extrai o objeto JSON da resposta (aceita fences e texto ao redor). */
export function extractJson(text) {
  const src = String(text ?? "").trim();
  const fenced = src.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : src;
  try {
    return JSON.parse(body);
  } catch {
    /* tenta achar o primeiro objeto balanceado */
  }
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(body.slice(start, end + 1));
    } catch {
      /* segue para o erro tipado */
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* specifyGap                                                          */
/* ------------------------------------------------------------------ */

/**
 * Transforma uma lacuna em pedido de artefato.
 *
 * @param {object} opts
 * @param {object} opts.gap        lacuna (de detect.mjs)
 * @param {object} [opts.context]  contexto extra (arquivos, tarefa, falhas)
 * @param {Function} [opts.runModel] `async ({ prompt }) => { text }`
 * @param {string} [opts.model]
 * @param {boolean} [opts.allowHeuristic=true]  permite o fallback para skill
 * @returns {Promise<{request, basis: "model"|"heuristic", notes: string[]}>}
 */
export async function specifyGap({
  gap,
  context = null,
  runModel = null,
  model = null,
  allowHeuristic = true,
} = {}) {
  const notes = [];

  if (typeof runModel !== "function") {
    if (!allowHeuristic) {
      throw new ForgeGenerationError("no-model", "sem runModel e sem fallback heurístico");
    }
    notes.push("sem modelo: contrato mínimo (skill)");
    return { request: heuristicRequest(gap), basis: "heuristic", notes };
  }

  let raw = null;
  try {
    const out = await runModel({ prompt: buildSpecPrompt({ gap, context }), model });
    raw = typeof out === "string" ? out : out?.text;
  } catch (err) {
    notes.push(`modelo falhou (${err?.message ?? err})`);
  }

  if (typeof raw !== "string" || raw.trim() === "") {
    if (!allowHeuristic) {
      throw new ForgeGenerationError("empty-response", "o modelo não devolveu especificação");
    }
    notes.push("resposta vazia: contrato mínimo (skill)");
    return { request: heuristicRequest(gap), basis: "heuristic", notes };
  }

  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== "object") {
    if (!allowHeuristic) {
      throw new ForgeGenerationError("no-code-block", "resposta não é um objeto JSON");
    }
    notes.push("JSON inválido: contrato mínimo (skill)");
    return { request: heuristicRequest(gap), basis: "heuristic", notes };
  }

  try {
    const request = createArtifactRequest({
      goal: parsed.goal,
      kind: parsed.kind,
      inputs: parsed.inputs,
      outputs: parsed.outputs,
      permissions: parsed.permissions,
      forbidden: parsed.forbidden,
      tests: parsed.tests,
    });
    notes.push(`contrato do modelo (kind ${request.kind})`);
    return { request, basis: "model", notes };
  } catch (err) {
    // contrato inválido do modelo: cair para o mínimo é melhor que reprovar o ciclo,
    // desde que o operador tenha permitido.
    if (!allowHeuristic) {
      throw new ForgeGenerationError("invalid-contract", `contrato inválido: ${err.message}`, {
        raw: parsed,
      });
    }
    notes.push(`contrato inválido (${err.message}): contrato mínimo (skill)`);
    return { request: heuristicRequest(gap), basis: "heuristic", notes };
  }
}

export default { specifyGap, heuristicRequest, buildSpecPrompt, extractJson };