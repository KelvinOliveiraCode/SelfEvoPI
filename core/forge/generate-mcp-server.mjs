/**
 * selfevopi-forge-generate-mcp-server — gera um servidor MCP real (kind "mcp-server").
 *
 * Sem dependencias externas: o server.mjs gerado usa APENAS builtins do Node,
 * porque o artefato tem que rodar sem `npm install`. Fala JSON-RPC 2.0 sobre
 * stdio (initialize, tools/list, tools/call), que é o que o PI e outros
 * clientes MCP esperam.
 *
 * Cada entrada de request.inputs vira uma ferramenta; cada saída de
 * request.outputs é um campo do resultado.
 *
 * Cuidados do arquivo gerado (nunca esquecer):
 *  - nunca a sequencia fim-de-comentario de bloco dentro de comentario;
 *  - sem template literal aninhado (quebra a geracao).
 * O resultado passa por node --check antes de ser considerado pronto.
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

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

/** Escapa um texto para caber num comentário de bloco sem quebrá-lo. */
function safeComment(text) {
  return String(text).replace(/\*\//g, "*\\/");
}

/* ------------------------------------------------------------------ */
/* server.mjs                                                          */
/* ------------------------------------------------------------------ */

export function renderServer(request) {
  const goal = safeComment(request.goal);
  const inputsJson = JSON.stringify(request.inputs ?? {}, null, 2);
  const outputsJson = JSON.stringify(request.outputs ?? {}, null, 2);

  // O corpo do servidor é montado por concatenação (sem template literal
  // aninhado). Cada entrada vira uma ferramenta; a saída é o campo do resultado.
  return [
    "#!/usr/bin/env node",
    "/**",
    " * server.mjs — servidor MCP autogerado pelo Forge (JSON-RPC 2.0 sobre stdio).",
    " * Objetivo: " + goal,
    " *",
    " * Metodos: initialize, tools/list, tools/call.",
    " * Sem dependencias externas: apenas builtins do Node.",
    " */",
    "",
    "import { createInterface } from \"node:readline\";",
    "",
    "const INPUTS = " + inputsJson + ";",
    "const OUTPUTS = " + outputsJson + ";",
    "",
    "// Uma ferramenta por entrada declarada. O schema e minimo e honesto.",
    "const TOOLS = Object.keys(INPUTS).map(function (name) {",
    "  return {",
    "    name: name,",
    "    description: INPUTS[name],",
    "    inputSchema: { type: \"object\", properties: {} }",
    "  };",
    "});",
    "",
    "function send(msg) {",
    "  process.stdout.write(JSON.stringify(msg) + \"\\n\");",
    "}",
    "",
    "function ok(id, result) {",
    "  send({ jsonrpc: \"2.0\", id: id, result: result });",
    "}",
    "",
    "function fail(id, code, message) {",
    "  send({ jsonrpc: \"2.0\", id: id, error: { code: code, message: message } });",
    "}",
    "",
    "function handle(msg) {",
    "  if (!msg || msg.jsonrpc !== \"2.0\" || typeof msg.method !== \"string\") {",
    "    fail(msg && msg.id, -32600, \"Requisição inválida\");",
    "    return;",
    "  }",
    "  const id = msg.id;",
    "  const method = msg.method;",
    "",
    "  if (method === \"initialize\") {",
    "    ok(id, {",
    "      protocolVersion: \"2024-11-05\",",
    "      capabilities: { tools: {} },",
    "      serverInfo: { name: \"forge-mcp-server\", version: \"0.0.0\" }",
    "    });",
    "    return;",
    "  }",
    "",
    "  if (method === \"tools/list\") {",
    "    ok(id, { tools: TOOLS });",
    "    return;",
    "  }",
    "",
    "  if (method === \"tools/call\") {",
    "    const params = msg.params || {};",
    "    const name = params.name;",
    "    const tool = TOOLS.find(function (t) { return t.name === name; });",
    "    if (!tool) {",
    "      fail(id, -32602, \"Ferramenta desconhecida: \" + name);",
    "      return;",
    "    }",
    "    // Esqueleto honesto: devolve as saídas declaradas sem inventar cálculo.",
    "    const out = {};",
    "    Object.keys(OUTPUTS).forEach(function (k) { out[k] = null; });",
    "    ok(id, { content: [{ type: \"text\", text: JSON.stringify(out) }] });",
    "    return;",
    "  }",
    "",
    "  fail(id, -32601, \"Método não suportado: \" + method);",
    "}",
    "",
    "const rl = createInterface({ input: process.stdin });",
    "rl.on(\"line\", function (line) {",
    "  const text = String(line || \"\").trim();",
    "  if (text === \"\") return;",
    "  let msg = null;",
    "  try {",
    "    msg = JSON.parse(text);",
    "  } catch (e) {",
    "    fail(null, -32700, \"Parse error\");",
    "    return;",
    "  }",
    "  handle(msg);",
    "});",
    "",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* verify.mjs                                                          */
/* ------------------------------------------------------------------ */

export function renderVerify(request) {
  const inputs = Object.keys(request.inputs ?? {});
  const firstName = inputs.length > 0 ? inputs[0] : null;
  const firstJson = JSON.stringify(firstName);
  const toolsJson = JSON.stringify(inputs);

  // O verify sobe o server.mjs, manda initialize + tools/list pelo stdin e
  // confere que voltou JSON válido com a ferramenta esperada.
  return [
    "#!/usr/bin/env node",
    "/**",
    " * verify.mjs — sobe o server.mjs, fala initialize + tools/list e confere o JSON.",
    " */",
    "import { spawn } from \"node:child_process\";",
    "import { dirname } from \"node:path\";",
    "import { fileURLToPath } from \"node:url\";",
    "",
    "const AQUI = dirname(fileURLToPath(import.meta.url));",
    "const ESPERADO = " + toolsJson + ";",
    "const PRIMEIRO = " + firstJson + ";",
    "",
    "function rpc(method, id, params) {",
    "  return JSON.stringify({ jsonrpc: \"2.0\", id: id, method: method, params: params || {} });",
    "}",
    "",
    "const child = spawn(process.execPath, [\"server.mjs\"], { cwd: AQUI, stdio: [\"pipe\", \"pipe\", \"pipe\"] });",
    "",
    "let out = \"\";",
    "let err = \"\";",
    "child.stdout.on(\"data\", function (d) { out += d.toString(\"utf8\"); });",
    "child.stderr.on(\"data\", function (d) { err += d.toString(\"utf8\"); });",
    "",
    "child.stdin.write(rpc(\"initialize\", 1, {}) + \"\\n\");",
    "child.stdin.write(rpc(\"tools/list\", 2, {}) + \"\\n\");",
    "child.stdin.end();",
    "",
    "function linhas(json) {",
    "  return String(json)",
    "    .split(\"\\n\")",
    "    .map(function (l) { return l.trim(); })",
    "    .filter(function (l) { return l !== \"\"; })",
    "    .map(function (l) { try { return JSON.parse(l); } catch (e) { return null; } })",
    "    .filter(function (m) { return m !== null; });",
    "}",
    "",
    "child.on(\"close\", function () {",
    "  const msgs = linhas(out);",
    "  const init = msgs.find(function (m) { return m.id === 1 && m.result; });",
    "  const list = msgs.find(function (m) { return m.id === 2 && m.result; });",
    "  let bad = 0;",
    "  if (!init) { console.error(\"FAIL initialize nao respondeu\"); bad++; }",
    "  if (!list || !Array.isArray(list.result.tools)) {",
    "    console.error(\"FAIL tools/list nao respondeu com tools\");",
    "    bad++;",
    "  } else if (PRIMEIRO !== null) {",
    "    const names = list.result.tools.map(function (t) { return t.name; });",
    "    const faltando = ESPERADO.filter(function (n) { return names.indexOf(n) === -1; });",
    "    if (faltando.length > 0) {",
    "      console.error(\"FAIL faltando ferramentas: \" + faltando.join(\", \"));",
    "      bad++;",
    "    }",
    "  }",
    "  if (bad > 0) {",
    "    if (err.trim()) console.error(\"  stderr: \" + err.trim().split(\"\\n\").slice(0, 6).join(\"\\n\"));",
    "    process.exit(1);",
    "  }",
    "  console.log(\"PASS MCP server: initialize + tools/list (\" + list.result.tools.length + \" ferramenta(s))\");",
    "});",
    "",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* generateMcpServer                                                   */
/* ------------------------------------------------------------------ */

/**
 * Gera o servidor MCP em outDir. Escreve server.mjs, README.md e verify.mjs.
 * Roda `node --check` no server.mjs antes de dar por pronto.
 *
 * @param {object} request  request de createArtifactRequest (kind "mcp-server")
 * @param {string} outDir   diretório de saída (criado se não existir)
 * @returns {{ path: string, files: string[], verifyCommand: string, serverCommand: string }}
 */
export async function generateMcpServer(request, outDir) {
  if (!request || typeof request !== "object") {
    throw new Error("forge-generate-mcp-server: request inválido");
  }
  if (request.kind !== "mcp-server") {
    throw new Error(`forge-generate-mcp-server: kind deve ser "mcp-server", veio "${request.kind}"`);
  }
  if (!outDir || typeof outDir !== "string") {
    throw new Error("forge-generate-mcp-server: outDir é obrigatório");
  }

  const serverPath = join(outDir, "server.mjs");
  if (await exists(serverPath)) {
    throw new Error(`forge-generate-mcp-server: já existe server.mjs em ${outDir} (recusa sobrescrever)`);
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(serverPath, renderServer(request), "utf8");

  // node --check antes de escrever o resto: um server.mjs que não faz parse
  // não é artefato (pega o bug do "*/" em comentário de bloco).
  const check = spawnSync(process.execPath, ["--check", serverPath], { encoding: "utf8", windowsHide: true, timeout: 20_000 });
  if (check.status !== 0) {
    const detail = String(check.stderr || "").trim().split("\n")[0] || "exit " + String(check.status);
    throw new Error(`forge-generate-mcp-server: node --check recusou o server.mjs: ${detail}`);
  }

  await writeFile(join(outDir, "README.md"), renderReadme(request), "utf8");
  const verifyPath = join(outDir, "verify.mjs");
  await writeFile(verifyPath, renderVerify(request), "utf8");

  return {
    path: outDir,
    files: ["server.mjs", "README.md", "verify.mjs"],
    verifyCommand: `node ${verifyPath}`,
    serverCommand: `node ${serverPath}`,
  };
}

/* ------------------------------------------------------------------ */
/* README.md                                                           */
/* ------------------------------------------------------------------ */

function renderReadme(request) {
  const tools = Object.keys(request.inputs ?? {});
  return [
    "# " + request.goal,
    "",
    "Servidor MCP autogerado pelo Forge (kind: `mcp-server`), sem dependências.",
    "",
    "## Uso",
    "",
    "```bash",
    "node server.mjs",
    "```",
    "",
    "Fala JSON-RPC 2.0 sobre stdio: `initialize`, `tools/list`, `tools/call`.",
    "",
    "## Ferramentas",
    "",
    tools.length > 0
      ? tools.map((t) => "- `" + t + "` — " + request.inputs[t]).join("\n")
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