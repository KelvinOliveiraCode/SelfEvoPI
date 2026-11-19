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

/* ------------------------------------------------------------------ */
/* Alvos por kind                                                      */
/* ------------------------------------------------------------------ */

/**
 * Onde cada kind coloca o código, e qual gerador de template serve de
 * referência (para o prompt e para o fallback).
 *
 * `mcp-config` e `skill` não têm "código": são um JSON e um Markdown. Para
 * esses, o gerador de template é a implementação correta — não há o que o
 * modelo possa melhorar sem inventar.
 */
export const TARGETS = {
  cli: {
    file: "cli.mjs",
    label: "CLI Node (ESM)",
    hints: [
      "leia as flags com process.argv, como --flag valor",
      "imprima UM JSON de uma linha no stdout em caso de sucesso",
      "use process.exitCode = 2 quando faltar argumento obrigatório",
    ],
  },
  "mcp-server": {
    file: "server.mjs",
    label: "servidor MCP em JSON-RPC 2.0 sobre stdio",
    hints: [
      "implemente initialize, tools/list e tools/call",
      "leia linhas do stdin com node:readline e responda uma linha JSON por pedido",
      "cada entrada declarada vira uma ferramenta com inputSchema",
      "sem dependências externas: só builtins",
    ],
  },
  extension: {
    file: "index.mjs",
    label: "extensão do PI Coding Agent",
    hints: [
      "exporte default function (pi) { ... }",
      "registre um comando com pi.registerCommand(nome, { description, handler })",
      "o handler recebe (args, ctx) e pode usar ctx.ui.notify",
      "não importe nada do pacote do PI no top-level",
    ],
  },
};

/** Tipos de prompt para cada kind. */
function buildKindPrompt(request) {
  const t = TARGETS[request.kind];
  const inputs = Object.entries(request.inputs ?? {})
    .map(([k, v]) => `  --${k} <valor>   # ${v}`)
    .join("\n") || "  (nenhuma)";
  const outputs = Object.entries(request.outputs ?? {})
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n") || "  (nenhuma)";
  const forbidden = (request.forbidden ?? []).map((f) => `  - ${f}`).join("\n") || "  (nenhuma)";
  const tests = (request.tests ?? [])
    .map((x) => `  - ${x.name}: ${x.command}${x.expect ? `  # esperado: ${x.expect}` : ""}`)
    .join("\n") || "  (nenhum)";

  return [
    `Você gera UM arquivo ${t.file} — ${t.label} (Node >= 22, ESM, Windows nativo).`,
    "Responda APENAS com um bloco de código delimitado por ``` fences. Sem explicação.",
    "",
    "OBJETIVO",
    request.goal,
    "",
    "ENTRADAS",
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
    ...t.hints.map((h) => `  - ${h}`),
    "  - sem dependências externas: só builtins do Node",
    "  - sem comentários genéricos; só o que explica decisão não óbvia",
    "  - não use template literals aninhados",
    "",
    "CÓDIGO:",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* generateArtifactWithModel                                           */
/* ------------------------------------------------------------------ */

/**
 * Gera o artefato de qualquer kind com código (cli, mcp-server, extension).
 * Para `mcp-config` e `skill` não há código a gerar: devolve `null` e quem
 * chama usa o gerador de template.
 *
 * @returns {Promise<null|{path, files, verifyCommand, cliCommand, model, tokens, code}>}
 */
export async function generateArtifactWithModel({
  request,
  outDir,
  runModel,
  model = null,
  timeoutMs = 180_000,
  check = checkFile,
} = {}) {
  const target = TARGETS[request?.kind];
  if (!target) return null; // kind documental: template

  if (typeof runModel !== "function") {
    throw new ForgeGenerationError("no-model", "informe runModel (função async)");
  }
  if (!outDir || typeof outDir !== "string") {
    throw new ForgeGenerationError("wrote-nothing", "informe outDir");
  }

  let out;
  try {
    out = await runModel({ prompt: buildKindPrompt(request), cwd: outDir, model, timeoutMs });
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

  await mkdir(outDir, { recursive: true });
  const cliPath = join(outDir, target.file);
  const probePath = join(outDir, `.probe-${process.pid}-${Date.now()}.mjs`);
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

  // README e verify: o verify.mjs de cada kind é o que o gerador de template
  // produz, para que a evidência não dependa de quem gerou o código.
  const { renderVerify, renderReadme } = await import("./generate-cli.mjs");
  await writeFile(join(outDir, "README.md"), renderReadme(request), "utf8");
  const verifyPath = join(outDir, "verify.mjs");
  await writeFile(verifyPath, renderVerify(request), "utf8");

  return {
    path: outDir,
    files: [target.file, "README.md", "verify.mjs"],
    verifyCommand: `node ${verifyPath}`,
    cliCommand: `node ${join(outDir, target.file)}`,
    model,
    tokens: out?.tokens ?? null,
    code,
  };
}

export default {
  generateWithModel,
  generateArtifactWithModel,
  buildPrompt,
  buildKindPrompt,
  extractCode,
  TARGETS,
  ForgeGenerationError,
};