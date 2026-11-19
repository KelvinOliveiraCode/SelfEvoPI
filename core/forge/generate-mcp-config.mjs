/**
 * selfevopi-forge-generate-mcp-config — gera a configuração MCP (kind mais leve).
 *
 * Sem dependencias externas. Dado um pedido de kind "mcp-config", escreve em
 * outDir um `.mcp.json` no formato que o PI espera para servidores MCP:
 *
 *   { "mcpServers": { "<nome>": { "command": "node", "args": ["server.mjs"], "env": {} } } }
 *
 * Recusa sobrescrever `.mcp.json` existente (mesma disciplina do generate-cli).
 * O verify.mjs gerado faz parse do JSON e confere as chaves.
 */

import { mkdir, writeFile, access } from "node:fs/promises";
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

/** "Configurar servidor MCP" -> "configurar-servidor-mcp" (slug ASCII estável). */
export function slugify(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/* ------------------------------------------------------------------ */
/* .mcp.json                                                           */
/* ------------------------------------------------------------------ */

export function renderMcpConfig(request) {
  const name = slugify(request.goal) || "artefato";
  const doc = {
    mcpServers: {
      [name]: {
        command: "node",
        args: ["server.mjs"],
        env: {},
      },
    },
  };
  return JSON.stringify(doc, null, 2) + "\n";
}

/* ------------------------------------------------------------------ */
/* verify.mjs                                                          */
/* ------------------------------------------------------------------ */

export function renderVerify(request) {
  const name = JSON.stringify(slugify(request.goal) || "artefato");
  return [
    "#!/usr/bin/env node",
    "/**",
    " * verify.mjs — confere que o .mcp.json e um JSON valido com o servidor esperado.",
    " */",
    'import { readFile } from "node:fs/promises";',
    'import { dirname } from "node:path";',
    'import { fileURLToPath } from "node:url";',
    "",
    "const AQUI = dirname(fileURLToPath(import.meta.url));",
    "const NOME = " + name + ";",
    "",
    "const raw = await readFile(AQUI + \"/.mcp.json\", \"utf8\");",
    "let doc = null;",
    "try {",
    "  doc = JSON.parse(raw);",
    "} catch (e) {",
    "  console.error(\"FAIL .mcp.json nao e JSON valido: \" + e.message);",
    "  process.exit(1);",
    "}",
    "",
    "const servers = doc && doc.mcpServers;",
    "if (!servers || typeof servers !== \"object\") {",
    "  console.error(\"FAIL falta mcpServers\");",
    "  process.exit(1);",
    "}",
    "const entry = servers[NOME];",
    "if (!entry) {",
    "  console.error(\"FAIL falta o servidor \" + NOME);",
    "  process.exit(1);",
    "}",
    "if (typeof entry.command !== \"string\" || entry.command === \"\") {",
    "  console.error(\"FAIL command ausente\");",
    "  process.exit(1);",
    "}",
    "if (!Array.isArray(entry.args)) {",
    "  console.error(\"FAIL args deve ser array\");",
    "  process.exit(1);",
    "}",
    "if (!entry.env || typeof entry.env !== 'object') {",
    "  console.error(\"FAIL env deve ser objeto\");",
    "  process.exit(1);",
    "}",
    "console.log(\"PASS .mcp.json: \" + NOME + \" (\" + entry.command + \" \" + entry.args.join(\" \") + \")\");",
    "",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* generateMcpConfig                                                   */
/* ------------------------------------------------------------------ */

/**
 * Gera a configuração MCP em outDir.
 *
 * @param {object} request  request de createArtifactRequest (kind "mcp-config")
 * @param {string} outDir   diretório de saída (criado se não existir)
 * @returns {{ path: string, files: string[], verifyCommand: string }}
 */
export async function generateMcpConfig(request, outDir) {
  if (!request || typeof request !== "object") {
    throw new Error("forge-generate-mcp-config: request inválido");
  }
  if (request.kind !== "mcp-config") {
    throw new Error(`forge-generate-mcp-config: kind deve ser "mcp-config", veio "${request.kind}"`);
  }
  if (!outDir || typeof outDir !== "string") {
    throw new Error("forge-generate-mcp-config: outDir é obrigatório");
  }

  const cfgPath = join(outDir, ".mcp.json");
  if (await exists(cfgPath)) {
    throw new Error(`forge-generate-mcp-config: já existe .mcp.json em ${outDir} (recusa sobrescrever)`);
  }

  await mkdir(outDir, { recursive: true });
  // JSON não passa no node --check; a validação é o parse do próprio verify.mjs.
  await writeFile(cfgPath, renderMcpConfig(request), "utf8");

  const verifyPath = join(outDir, "verify.mjs");
  await writeFile(verifyPath, renderVerify(request), "utf8");

  return {
    path: outDir,
    files: [".mcp.json", "verify.mjs"],
    verifyCommand: `node ${verifyPath}`,
  };
}