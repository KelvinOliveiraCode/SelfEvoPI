#!/usr/bin/env node
/**
 * forge-probe — a sonda de interface de cada kind.
 *
 * Um teste de interface precisa exercitar o artefato **do jeito que ele é
 * chamado**, não do jeito que um CLI é chamado:
 *
 *   cli         -> roda com flags e lê o JSON do stdout
 *   mcp-server  -> fala JSON-RPC 2.0 pelo stdin (flags não significam nada)
 *   extension   -> importa o módulo com um `pi` falso e chama o handler
 *
 * O loop grava o `probe.mjs` no diretório do artefato e o verify o executa.
 * Assim o teste não depende de aspas encaixadas num comando de shell — a sonda
 * é um arquivo de verdade, lida e auditável.
 */

export const PRIMARY_FILE = Object.freeze({
  cli: "cli.mjs",
  "mcp-server": "server.mjs",
  extension: "index.mjs",
});

const FILEISH = /(arquivo|file|path|csv|html|json|input|entrada|dir|pasta)/i;

/** Entradas que são caminho recebem um fixture; as outras recebem 1. */
function fixturePrelude(inputs) {
  const lines = [];
  for (const k of inputs) {
    if (!FILEISH.test(k)) continue;
    const name = `fixture-${k.replace(/[^a-z0-9_-]/gi, "")}.txt`;
    // caminho absoluto: a sonda pode ser chamada de qualquer diretorio
    lines.push(`  writeFileSync(join(AQUI, ${JSON.stringify(name)}), "a,b,c\\n1,2,3\\n");`);
  }
  return lines;
}

/** Entradas que são caminho recebem um fixture; as outras recebem 1. */
function sampleFlags(inputs) {
  const flags = [];
  for (const k of inputs) {
    if (FILEISH.test(k)) {
      // cada elemento e uma expressao JS: a sonda e o artefato podem rodar de
      // diretorios diferentes, entao o caminho e absoluto
      flags.push(
        JSON.stringify("--" + k),
        "join(AQUI, " + JSON.stringify("fixture-" + k.replace(/[^a-z0-9_-]/gi, "") + ".txt") + ")",
      );
    } else {
      flags.push(JSON.stringify("--" + k), JSON.stringify("1"));
    }
  }
  return flags;
}

/** Script de sonda para um kind. */
export function renderProbe(request, opts = {}) {
  const kind = request?.kind ?? "cli";
  const sandboxUrl = typeof opts.sandboxUrl === "string" && opts.sandboxUrl !== "" ? opts.sandboxUrl : null;
  const inputs = Object.keys(request?.inputs ?? {});
  const outputs = Object.keys(request?.outputs ?? {});
  const target = PRIMARY_FILE[kind] ?? "cli.mjs";

  if (kind === "mcp-server") {
    // Servidor stdio: manda initialize + tools/list e valida o array de tools.
    // Com entradas, exige que a 1ª esteja nomeada no tools/list; sem entradas,
    // basta o tools/list responder um array (evita falso-negativo de server vazio).
    const tool = inputs[0] ?? null;
    const toolCheck = tool !== null
      ? `
if (ok) {
  const nomes = list.result.tools.map((t) => t && t.name);
  if (!nomes.includes(${JSON.stringify(tool)})) {
    console.error("  tools/list não devolveu a ferramenta " + ${JSON.stringify(tool)});
    ok = false;
  }
}`
      : "";

    return `#!/usr/bin/env node
// Sonda do artefato MCP (gerada pelo Forge).
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));

const mensagens = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
]
  .map((m) => JSON.stringify(m))
  .join("\\n");

const r = spawnSync(process.execPath, [${JSON.stringify(target)}], {
  input: mensagens + "\\n",
  cwd: AQUI,
  encoding: "utf8",
  timeout: 20000,
});

const saida = String(r.stdout ?? "");
const msgs = saida
  .split("\\n")
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((m) => m && m.jsonrpc === "2.0");

const list = msgs.find((m) => m.id === 2 && m.result && Array.isArray(m.result.tools));

let ok = r.status === 0;
if (ok && msgs.length === 0) {
  console.error("  resposta não é JSON-RPC");
  ok = false;
}
if (ok && !list) {
  console.error("  tools/list não respondeu um array de tools");
  ok = false;
}
${toolCheck}
process.exit(ok ? 0 : 1);
`;
  }

  if (kind === "extension") {
    // Extensão do PI: importa com um pi falso e chama o handler.
    return `#!/usr/bin/env node
// Sonda do artefato de extensão (gerada pelo Forge).
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));

const registrados = [];
const pi = {
  on() {},
  registerFlag() {},
  registerCommand(nome, def) {
    registrados.push({ nome, def });
  },
};

const mod = await import(pathToFileURL(join(AQUI, ${JSON.stringify(target)})).href);
const factory = mod.default;
if (typeof factory !== "function") {
  console.error("  index.mjs não exporta uma função de extensão");
  process.exit(1);
}
factory(pi);

if (registrados.length === 0) {
  console.error("  nenhum comando registrado");
  process.exit(1);
}

const cmd = registrados[0];
if (typeof cmd.def?.handler !== "function") {
  console.error("  comando sem handler");
  process.exit(1);
}
// O handler de verdade usa ctx.ui: um ctx minimo evita que uma extensao honesta
// falhe so porque a sonda nao tem interface.
const avisos = [];
const ctx = {
  ui: {
    notify: (m) => avisos.push(String(m)),
    prompt: async () => "",
    confirm: async () => true,
    select: async () => null,
  },
  cwd: AQUI,
};
await cmd.def.handler("", ctx);
console.log("  comando " + cmd.nome + " respondeu " + avisos.length + " aviso(s)");
`;
  }

  // cli (default): roda com flags e exige as chaves de saída no JSON.
  if (sandboxUrl) return renderSandboxedCliProbe(request, sandboxUrl);
  const flags = sampleFlags(inputs);
  const checkKeys = outputs.length > 0
    ? `// As chaves podem estar no topo ou dentro de "outputs" (convenicao do gerador de template).
const alvo = json && typeof json === "object" && json.outputs && typeof json.outputs === "object" ? json.outputs : json;
const faltando = ${JSON.stringify(outputs)}.filter((k) => !(k in alvo));
     if (faltando.length > 0) {
       console.error("  faltando chave(s): " + faltando.join(", "));
       process.exit(1);
     }`
    : "";

  return `#!/usr/bin/env node
// Sonda do artefato CLI (gerada pelo Forge).
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));

${fixturePrelude(inputs).join("\n")}

const r = spawnSync(process.execPath, [${JSON.stringify(target)}${flags.length ? ", " + flags.join(", ") : ""}], {
  cwd: AQUI,
  encoding: "utf8",
  timeout: 20000,
});

let json = null;
try {
  json = JSON.parse(String(r.stdout ?? "").trim().split("\\n").pop());
} catch {
  json = null;
}

if (r.status !== 0 || json === null) {
  console.error("  saida nao e JSON com exit 0 (exit " + r.status + ")");
  if (r.stderr) console.error("  " + String(r.stderr).trim().split("\\n")[0]);
  process.exit(1);
}

${checkKeys}
`;
}

/**
 * Sonda de CLI que roda o artefato DENTRO do sandbox (runSandboxed).
 *
 * O artefato e codigo escrito por modelo: nunca executa solto. O verificador
 * (esta sonda) roda fora; quem invoca o artefato e o runSandboxed, com
 * Permission Model (fs restrito ao workdir) e preload de rede.
 */
function renderSandboxedCliProbe(request, sandboxUrl) {
  const inputs = Object.keys(request?.inputs ?? {});
  const outputs = Object.keys(request?.outputs ?? {});
  const flags = sampleFlags(inputs);
  const checkKeys = outputs.length > 0
    ? `// As chaves podem estar no topo ou dentro de "outputs" (convencao do gerador).
const alvo = json && typeof json === "object" && json.outputs && typeof json.outputs === "object" ? json.outputs : json;
const faltando = ${JSON.stringify(outputs)}.filter((k) => !(k in alvo));
     if (faltando.length > 0) {
       console.error("  faltando chave(s): " + faltando.join(", "));
       process.exit(1);
     }`
    : "";

  return `#!/usr/bin/env node
// Sonda do artefato CLI (gerada pelo Forge) — roda o artefato no sandbox.
import { runSandboxed } from ${JSON.stringify(sandboxUrl)};
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));

${fixturePrelude(inputs).join("\n")}

const r = await runSandboxed({
  script: "cli.mjs",
  args: [${flags.length ? flags.join(", ") : ""}],
  workdir: AQUI,
  allowWrite: false,
  timeoutMs: 20000,
});

const saida = String(r.stdout ?? "");
let json = null;
try {
  json = JSON.parse(saida.trim().split("\\n").pop());
} catch {
  json = null;
}

if (!r.ok || r.blocked || json === null) {
  console.error("  saida nao e JSON com exit 0 (exit " + r.exitCode + ")" + (r.blocked ? " [bloqueado pelo sandbox]" : ""));
  if (r.stderr) console.error("  " + String(r.stderr).trim().split("\\n")[0]);
  process.exit(1);
}

${checkKeys}
`;
}

/**
 * Teste de interface que roda a sonda. Usado quando o pedido não traz testes.
 */
export function probeTest(request) {
  const kind = request?.kind ?? "cli";
  return {
    name: `interface (${kind})`,
    command: "node probe.mjs",
    expect: null,
  };
}

export default { renderProbe, probeTest };