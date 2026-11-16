#!/usr/bin/env node
/**
 * selfevopi-forge-generate-llm — gera código **real** a partir do contrato.
 *
 * Os geradores de template (`generate-cli`, `generate-skill`) produzem esqueleto
 * honesto: validam entrada e devolvem `null` nas saídas. Isso serve para provar o
 * encanamento, não para resolver a lacuna. Este módulo é o que transforma o
 * contrato em implementação:
 *
 *   contrato (goal, inputs, outputs, forbidden, tests)
 *      -> prompt compacto (sem o histórico da conversa)
 *      -> modelo (via `runModel` injetado)
 *      -> código extraído de um bloco ```…```
 *      -> `node --check` (recusa erro de sintaxe antes de escrever)
 *      -> cli.mjs + README.md + verify.mjs
 *
 * Falhas são explícitas e o chamador decide o fallback:
 *  - `ForgeGenerationError` com `code` ∈ { "no-model", "empty-response",
 *    "no-code-block", "syntax-error", "wrote-nothing" }.
 *
 * Segurança: o código gerado **não é executado** aqui. Quem roda é o `verify.mjs`
 * (fora do sandbox) contra o artefato (dentro). O `node --check` só faz parse.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { renderReadme, renderVerify } from "./generate-cli.mjs";

/* ------------------------------------------------------------------ */
/* Erro tipado                                                         */
/* ------------------------------------------------------------------ */

export class ForgeGenerationError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "ForgeGenerationError";
    this.code = code;
    Object.assign(this, extra);
  }
}

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

/**
 * Monta o prompt do gerador. Curto de propósito: o contrato já é a especificação,
 * e o prompt do harness tem orçamento (docs/fase1/decisoes.md §5).
 */
export function buildPrompt(request) {
  const inputs = Object.entries(request.inputs ?? {})
    .map(([k, v]) => `  --${k} <valor>   # ${v}`)
    .join("\n") || "  (nenhuma)";
  const outputs = Object.entries(request.outputs ?? {})
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n") || "  (nenhuma)";
  const forbidden = (request.forbidden ?? []).map((f) => `  - ${f}`).join("\n") || "  (nenhuma)";
  const tests = (request.tests ?? [])
    .map((t) => `  - ${t.name}: ${t.command}${t.expect ? `  # esperado: ${t.expect}` : ""}`)
    .join("\n") || "  (nenhum)";

  return [
    "Você gera UM arquivo JavaScript (ESM, Node >= 22, Windows nativo).",
    "Responda APENAS com um bloco de código delimitado por ``` fences. Sem explicação.",
    "",
    "OBJETIVO",
    request.goal,
    "",
    "ENTRADAS (flags de linha de comando)",
    inputs,
    "",
    "SAÍDAS (JSON compacto, uma linha, no stdout)",
    outputs,
    "",
    "PROIBIDO",
    forbidden,
    "",
    "TESTES QUE VÃO RODAR",
    tests,
    "",
    "REQUISITOS",
    "  - leia as flags com process.argv, como --flag valor",
    "  - use process.exitCode = 2 e escreva {\"ok\":false,\"erro\":\"...\"} quando faltar argumento",
    "  - imprima UM JSON de uma linha no stdout em caso de sucesso",
    "  - sem dependências externas: só builtins do Node",
    "  - sem comentários genéricos; só o que explica decisão não óbvia",
    "  - não use template literals aninhados",
    "",
    "CÓDIGO:",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Extração                                                            */
/* ------------------------------------------------------------------ */

/** Extrai o primeiro bloco de código com fences, ou o texto inteiro se não houver. */
export function extractCode(text) {
  const src = String(text ?? "");
  const withLang = src.match(/```(?:javascript|js|node|mjs)?\s*\n([\s\S]*?)```/i);
  if (withLang) return withLang[1].trim();
  const bare = src.match(/```\s*\n([\s\S]*?)```/i);
  if (bare) return bare[1].trim();
  return src.trim();
}

/**
 * Verificador de sintaxe padrão: `node --check <arquivo>`.
 * Confere o parse **sem executar** — é o que impede que um artefato quebrado
 * (por exemplo, um fim de comentário de bloco no meio do código) seja promovido.
 */
export function checkFile({ file, cwd = process.cwd() } = {}) {
  const res = spawnSync(process.execPath, ["--check", file], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: 20_000,
  });
  if (res.status === 0) return { ok: true };
  const stderr = String(res.stderr ?? "").trim();
  const detail = stderr || "exit " + String(res.status);
  return { ok: false, error: "node --check recusou: " + detail, stderr };
}

/* ------------------------------------------------------------------ */
/* generateWithModel                                                   */
/* ------------------------------------------------------------------ */

/**
 * Gera o artefato com o modelo.
 *
 * @param {object} opts
 * @param {object} opts.request     request de createArtifactRequest (kind "cli")
 * @param {string} opts.outDir      diretório de saída
 * @param {Function} opts.runModel  `async ({ prompt, cwd, model, timeoutMs }) => { text, tokens }`
 * @param {string} [opts.model]     id do modelo (passa adiante)
 * @param {number} [opts.timeoutMs]
 * @param {Function} [opts.check]   verificador de sintaxe (default: node --check em arquivo)
 * @returns {Promise<{path, files, verifyCommand, cliCommand, model, tokens, code}>}
 */
export async function generateWithModel({
  request,
  outDir,
  runModel,
  model = null,
  timeoutMs = 120_000,
  check = checkFile,
} = {}) {
  if (!request || typeof request !== "object") {
    throw new ForgeGenerationError("no-model", "request inválido");
  }
  if (request.kind !== "cli") {
    throw new ForgeGenerationError("no-model", `kind deve ser "cli", veio "${request.kind}"`);
  }
  if (typeof runModel !== "function") {
    throw new ForgeGenerationError("no-model", "informe runModel (função async)");
  }
  if (!outDir || typeof outDir !== "string") {
    throw new ForgeGenerationError("wrote-nothing", "informe outDir");
  }

  let out;
  try {
    out = await runModel({ prompt: buildPrompt(request), cwd: outDir, model, timeoutMs });
  } catch (err) {
    throw new ForgeGenerationError("no-model", `falha ao chamar o modelo: ${err?.message ?? err}`);
  }

  const text = typeof out === "string" ? out : out?.text;
  if (typeof text !== "string" || text.trim() === "") {
    throw new ForgeGenerationError("empty-response", "o modelo não devolveu texto", {
      tokens: out?.tokens ?? null,
    });
  }

  const code = extractCode(text);
  if (code.trim() === "") {
    throw new ForgeGenerationError("no-code-block", "resposta sem bloco de código", { tokens: out?.tokens ?? null });
  }

  // 1. sintaxe ANTES de escrever: um artefato que não faz parse não é artefato.
  // O arquivo de teste fica fora do caminho final, para que uma falha aqui não
  // deixe um cli.mjs pela metade que impeça o fallback do gerador de template.
  await mkdir(outDir, { recursive: true });
  const cliPath = join(outDir, "cli.mjs");
  const probePath = join(outDir, `.cli-probe-${process.pid}-${Date.now()}.mjs`);
  await writeFile(probePath, `${code}\n`, "utf8");

  if (typeof check === "function") {
    const verdict = await check({ code, file: probePath, cwd: outDir });
    await rm(probePath, { force: true }).catch(() => {});
    if (verdict && verdict.ok === false) {
      throw new ForgeGenerationError("syntax-error", verdict.error ?? "código não passa no node --check", {
        tokens: out?.tokens ?? null,
        stderr: verdict.stderr ?? null,
      });
    }
  } else {
    await rm(probePath, { force: true }).catch(() => {});
  }

  await writeFile(cliPath, `${code}\n`, "utf8");

  // 2. README e verify (mesmo formato dos geradores de template).
  await writeFile(join(outDir, "README.md"), renderReadme(request), "utf8");
  const verifyPath = join(outDir, "verify.mjs");
  await writeFile(verifyPath, renderVerify(request), "utf8");

  return {
    path: outDir,
    files: ["cli.mjs", "README.md", "verify.mjs"],
    verifyCommand: `node ${verifyPath}`,
    cliCommand: `node ${cliPath}`,
    model,
    tokens: out?.tokens ?? null,
    code,
  };
}

export default { generateWithModel, buildPrompt, extractCode, ForgeGenerationError };