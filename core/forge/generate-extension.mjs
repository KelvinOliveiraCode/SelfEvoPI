/**
 * selfevopi-forge-generate-extension — gera uma extensão do PI (kind "extension").
 *
 * Sem dependencias externas. Dado um pedido de kind "extension", escreve em
 * outDir um `index.mjs` no formato de extensão do PI:
 *
 *   export default function (pi) {
 *     pi.registerCommand("nome", { ... }, handler);
 *   }
 *
 * Cada entrada de request.inputs vira uma flag do comando; o handler responde
 * com um JSON compacto contendo as saídas declaradas.
 *
 * O verify.mjs próprio importa o módulo com um `pi` falso (mock com on,
 * registerCommand, registerFlag) e confere que o comando foi registrado e que
 * o handler responde.
 *
 * Cuidados do arquivo gerado: sem a sequencia fim-de-comentario de bloco
 * dentro de comentario, e sem template literal aninhado. Passa por node --check.
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { slugify } from "./generate-mcp-config.mjs";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function safeComment(text) {
  return String(text).replace(/\*\//g, "*\\/");
}

/* ------------------------------------------------------------------ */
/* index.mjs                                                           */
/* ------------------------------------------------------------------ */

export function renderIndex(request) {
  const goal = safeComment(request.goal);
  const inputsJson = JSON.stringify(request.inputs ?? {}, null, 2);
  const outputsJson = JSON.stringify(request.outputs ?? {}, null, 2);
  const commandName = JSON.stringify(slugify(request.goal) || "artefato");

  // Corpo montado por concatenacao (sem template literal aninhado).
  return [
    "/**",
    " * index.mjs — extensão do PI autogerada pelo Forge.",
    " * Objetivo: " + goal,
    " *",
    " * Registra um comando que expõe a capacidade do artefato.",
    " */",
    "",
    "const INPUTS = " + inputsJson + ";",
    "const OUTPUTS = " + outputsJson + ";",
    "const NOME = " + commandName + ";",
    "",
    "export default function (pi) {",
    "  if (!pi || typeof pi.registerCommand !== \"function\") {",
    "    throw new Error(\"forge-extension: pi.registerCommand ausente\");",
    "  }",
    "",
    "  // Cada entrada declarada vira uma flag do comando.",
    "  const flags = {};",
    "  Object.keys(INPUTS).forEach(function (name) {",
    "    flags[name] = { type: \"string\", description: INPUTS[name] };",
    "    if (typeof pi.registerFlag === \"function\") {",
    "      pi.registerFlag(name, { type: \"string\", description: INPUTS[name] });",
    "    }",
    "  });",
    "",
    "  const handler = function (args) {",
    "    const out = {};",
    "    Object.keys(OUTPUTS).forEach(function (k) { out[k] = null; });",
    "    return { ok: true, command: NOME, inputs: args || {}, outputs: out };",
    "  };",
    "",
    "  pi.registerCommand(NOME, {",
    "    description: " + JSON.stringify(request.goal) + ",",
    "    flags: flags",
    "  }, handler);",
    "",
    "  return { command: NOME, handler: handler };",
    "}",
    "",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* verify.mjs                                                          */
/* ------------------------------------------------------------------ */

export function renderVerify(request) {
  const commandName = JSON.stringify(slugify(request.goal) || "artefato");
  const inputKeys = Object.keys(request.inputs ?? {});
  const outputKeys = Object.keys(request.outputs ?? {});

  // Importa o modulo com um pi falso (mock) e confere registro + resposta.
  return [
    "#!/usr/bin/env node",
    "/**",
    " * verify.mjs — importa index.mjs com um pi falso e confere registro + handler.",
    " */",
    "import { pathToFileURL } from \"node:url\";",
    "import { dirname } from \"node:path\";",
    "import { fileURLToPath } from \"node:url\";",
    "",
    "const AQUI = dirname(fileURLToPath(import.meta.url));",
    "const ESPERADO = " + commandName + ";",
    "const INPUTS = " + JSON.stringify(inputKeys) + ";",
    "const OUTPUTS = " + JSON.stringify(outputKeys) + ";",
    "",
    "// pi falso: registra comandos e flags em memoria, sem o PI real.",
    "function makeFakePi() {",
    "  const commands = {};",
    "  const flags = {};",
    "  const handlers = {};",
    "  return {",
    "    commands: commands,",
    "    flags: flags,",
    "    handlers: handlers,",
    "    on: function () {},",
    "    registerFlag: function (name, def) { flags[name] = def; },",
    "    registerCommand: function (name, def, handler) {",
    "      commands[name] = def;",
    "      handlers[name] = handler;",
    "    }",
    "  };",
    "}",
    "",
    "const mod = await import(pathToFileURL(AQUI + \"/index.mjs\").href);",
    "const factory = mod.default;",
    "if (typeof factory !== \"function\") {",
    "  console.error(\"FAIL index.mjs nao exporta default function\");",
    "  process.exit(1);",
    "}",
    "",
    "const pi = makeFakePi();",
    "let ret = null;",
    "try {",
    "  ret = factory(pi);",
    "} catch (e) {",
    "  console.error(\"FAIL factory lancou: \" + e.message);",
    "  process.exit(1);",
    "}",
    "",
    "let bad = 0;",
    "const cmd = pi.commands[ESPERADO];",
    "if (!cmd) {",
    "  console.error(\"FAIL comando nao registrado: \" + ESPERADO);",
    "  bad++;",
    "}",
    "const handler = pi.handlers[ESPERADO];",
    "if (typeof handler !== \"function\") {",
    "  console.error(\"FAIL handler ausente\");",
    "  bad++;",
    "} else {",
    "  const out = handler({});",
    "  if (!out || out.ok !== true) {",
    "    console.error(\"FAIL handler nao respondeu ok:true\");",
    "    bad++;",
    "  } else {",
    "    const keys = Object.keys(out.outputs || {});",
    "    const faltando = OUTPUTS.filter(function (k) { return keys.indexOf(k) === -1; });",
    "    if (faltando.length > 0) {",
    "      console.error(\"FAIL faltando saidas: \" + faltando.join(\", \"));",
    "      bad++;",
    "    }",
    "  }",
    "}",
    "",
    "if (bad > 0) process.exit(1);",
    "console.log(\"PASS extension: comando \\\"\" + ESPERADO + \"\\\" registrado (\" + INPUTS.length + \" flag(s))\");",
    "",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* generateExtension                                                   */
/* ------------------------------------------------------------------ */

/**
 * Gera a extensão do PI em outDir. Escreve index.mjs, README.md e verify.mjs.
 * Roda `node --check` no index.mjs antes de dar por pronto.
 *
 * @param {object} request  request de createArtifactRequest (kind "extension")
 * @param {string} outDir   diretório de saída (criado se não existir)
 * @returns {{ path: string, files: string[], verifyCommand: string }}
 */
export async function generateExtension(request, outDir) {
  if (!request || typeof request !== "object") {
    throw new Error("forge-generate-extension: request inválido");
  }
  if (request.kind !== "extension") {
    throw new Error(`forge-generate-extension: kind deve ser "extension", veio "${request.kind}"`);
  }
  if (!outDir || typeof outDir !== "string") {
    throw new Error("forge-generate-extension: outDir é obrigatório");
  }

  const indexPath = join(outDir, "index.mjs");
  if (await exists(indexPath)) {
    throw new Error(`forge-generate-extension: já existe index.mjs em ${outDir} (recusa sobrescrever)`);
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(indexPath, renderIndex(request), "utf8");

  const check = spawnSync(process.execPath, ["--check", indexPath], { encoding: "utf8", windowsHide: true, timeout: 20_000 });
  if (check.status !== 0) {
    const detail = String(check.stderr || "").trim().split("\n")[0] || "exit " + String(check.status);
    throw new Error(`forge-generate-extension: node --check recusou o index.mjs: ${detail}`);
  }

  await writeFile(join(outDir, "README.md"), renderReadme(request), "utf8");
  const verifyPath = join(outDir, "verify.mjs");
  await writeFile(verifyPath, renderVerify(request), "utf8");

  return {
    path: outDir,
    files: ["index.mjs", "README.md", "verify.mjs"],
    verifyCommand: `node ${verifyPath}`,
  };
}

/* ------------------------------------------------------------------ */
/* README.md                                                           */
/* ------------------------------------------------------------------ */

function renderReadme(request) {
  return [
    "# " + request.goal,
    "",
    "Extensão do PI autogerada pelo Forge (kind: `extension`), sem dependências.",
    "",
    "## Uso",
    "",
    "```js",
    "// no PI, carregue a extensão e o comando fica disponível:",
    "import ext from \"./index.mjs\";",
    "ext(pi);",
    "```",
    "",
    "## Comando",
    "",
    "- `" + slugify(request.goal) + "`",
    "",
    "## Flags (entradas)",
    "",
    Object.keys(request.inputs ?? {}).length > 0
      ? Object.entries(request.inputs).map(([k, v]) => "- `" + k + "` — " + v).join("\n")
      : "_nenhuma_",
    "",
    "## Saídas",
    "",
    Object.keys(request.outputs ?? {}).length > 0
      ? Object.entries(request.outputs).map(([k, v]) => "- `" + k + "` — " + v).join("\n")
      : "_nenhuma_",
    "",
    "## O que NÃO pode fazer",
    "",
    (request.forbidden ?? []).map((f) => "- " + f).join("\n") || "_nada_",
    "",
    "## Verificação",
    "",
    "```bash",
    "node verify.mjs",
    "```",
    "",
    "",
  ].join("\n");
}