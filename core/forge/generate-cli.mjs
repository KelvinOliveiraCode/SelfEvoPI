/**
 * selfevopi-forge-generate-cli — gera um script/CLI local (nível 3).
 *
 * Sem dependencias externas (só node:fs, node:path). Dado um pedido de
 * artefato válido (createArtifactRequest) de kind "cli", escreve em outDir:
 *   - cli.mjs   (shebang; expõe os comandos de request.inputs como flags
 *                --nome valor; imprime JSON compacto numa linha conforme
 *                request.outputs; usa process.exitCode; sai 2 se faltar
 *                argumento obrigatório)
 *   - README.md (uso e exemplos curtos)
 *   - verify.mjs (executa request.tests e sai 0 só se todos passarem)
 *
 * Não inventa lógica de negócio: o CLI é um esqueleto honesto que valida
 * entradas e devolve as saídas declaradas (null quando não calculadas).
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

/* ------------------------------------------------------------------ */
/* cli.mjs                                                             */
/* ------------------------------------------------------------------ */

function renderCli(request) {
  const inputsJson = JSON.stringify(request.inputs ?? {}, null, 2);
  const outputsJson = JSON.stringify(request.outputs ?? {}, null, 2);
  const goal = JSON.stringify(request.goal);
  // O objetivo vai para um comentário de bloco: sem escape, um "*/" no texto
  // fecharia o comentário cedo e quebraria o arquivo gerado.
  const goalInComment = String(request.goal).replace(/\*\//g, "*\\/");

  // Sem template literals no arquivo gerado: só concatena ção, para evitar
  // aninhamento de backticks na geração.
  return `#!/usr/bin/env node
/**
 * cli.mjs — CLI autogerado pelo Forge.
 * Objetivo: ${goalInComment}
 *
 * Uso: node cli.mjs --<entrada> <valor> [--<entrada> <valor> ...]
 * Imprime JSON compacto (uma linha) com as saídas declaradas.
 * Sai 2 se faltar algum argumento obrigatório.
 */

const GOAL = ${goal};
const INPUTS = ${inputsJson};
const OUTPUTS = ${outputsJson};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a !== "string" || a.slice(0, 2) !== "--") continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && String(next).slice(0, 2) !== "--") {
      out[key] = String(next);
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function fail(message) {
  process.stderr.write(JSON.stringify({ ok: false, error: message }) + "\\n");
  process.exitCode = 2;
}

const args = parseArgs(process.argv.slice(2));

const missing = Object.keys(INPUTS).filter((k) => args[k] === undefined);
if (missing.length > 0) {
  fail("faltando argumentos obrigatorios: " + missing.join(", "));
} else {
  // Esqueleto honesto: devolve as saídas declaradas sem inventar cálculo.
  const outputs = {};
  for (const key of Object.keys(OUTPUTS)) outputs[key] = null;
  process.stdout.write(
    JSON.stringify({ ok: true, goal: GOAL, inputs: args, outputs: outputs }) + "\\n"
  );
}
`;
}

/* ------------------------------------------------------------------ */
/* verify.mjs                                                          */
/* ------------------------------------------------------------------ */

function renderVerify(request) {
  const testsJson = JSON.stringify(request.tests, null, 2);
  return `#!/usr/bin/env node
/**
 * verify.mjs — verificação autogerada pelo Forge.
 * Roda cada teste do pedido e sai 0 só se todos passarem.
 */
import { spawnSync } from "node:child_process";

const tests = ${testsJson};

let failed = 0;
for (const t of tests) {
  const r = spawnSync(t.command, { shell: true, encoding: "utf8" });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log((ok ? "PASS " : "FAIL ") + t.name + "  (" + t.command + ")");
  if (!ok) {
    if (r.stdout && r.stdout.trim()) console.log("  stdout: " + r.stdout.trim());
    if (r.stderr && r.stderr.trim()) console.log("  stderr: " + r.stderr.trim());
    if (t.expect) console.log("  esperado: " + t.expect);
  }
}

if (failed > 0) {
  console.error("\\n" + failed + " de " + tests.length + " teste(s) falharam");
  process.exit(1);
}
console.log("\\nTodos os " + tests.length + " teste(s) passaram");
`;
}

/* ------------------------------------------------------------------ */
/* README.md                                                           */
/* ------------------------------------------------------------------ */

function renderReadme(request) {
  const flags = Object.keys(request.inputs ?? {})
    .map((k) => `--${k}`)
    .join(" ");
  const example = flags
    ? `node cli.mjs ${flags} <valor>`
    : "node cli.mjs";
  return `# ${request.goal}

CLI local gerado pelo Forge (kind: \`cli\`).

## Uso

\`\`\`bash
${example}
\`\`\`

## Entradas

${Object.entries(request.inputs ?? {})
  .map(([k, v]) => `- \`--${k}\` — ${v}`)
  .join("\n") || "_nenhuma_"}

## Saídas (JSON, uma linha)

${Object.entries(request.outputs ?? {})
  .map(([k, v]) => `- \`${k}\` — ${v}`)
  .join("\n") || "_nenhuma_"}

## O que NÃO pode fazer

${(request.forbidden ?? []).map((f) => `- ${f}`).join("\n") || "_nada_"}

## Verificação

\`\`\`bash
node verify.mjs
\`\`\`

Sai 0 somente se todos os testes passarem.
`;
}

/* ------------------------------------------------------------------ */
/* generateCli                                                         */
/* ------------------------------------------------------------------ */

/**
 * Gera um CLI em outDir a partir de um request de kind "cli".
 *
 * @param {object} request  request de createArtifactRequest (kind "cli")
 * @param {string} outDir   diretório de saída (criado se não existir)
 * @returns {{ path: string, files: string[], verifyCommand: string, cliCommand: string }}
 */
export async function generateCli(request, outDir) {
  if (!request || typeof request !== "object") {
    throw new Error("forge-generate-cli: request inválido");
  }
  if (request.kind !== "cli") {
    throw new Error(`forge-generate-cli: kind deve ser "cli", veio "${request.kind}"`);
  }
  if (!outDir || typeof outDir !== "string") {
    throw new Error("forge-generate-cli: outDir é obrigatório");
  }

  const cliPath = join(outDir, "cli.mjs");
  if (await exists(cliPath)) {
    throw new Error(`forge-generate-cli: já existe cli.mjs em ${outDir} (recusa sobrescrever)`);
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(cliPath, renderCli(request), "utf8");
  await writeFile(join(outDir, "README.md"), renderReadme(request), "utf8");

  const verifyPath = join(outDir, "verify.mjs");
  await writeFile(verifyPath, renderVerify(request), "utf8");

  return {
    path: outDir,
    files: ["cli.mjs", "README.md", "verify.mjs"],
    verifyCommand: `node ${verifyPath}`,
    cliCommand: `node ${cliPath}`,
  };
}