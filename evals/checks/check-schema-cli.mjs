/**
 * Grupo B (ferramenta) — o artefato `cli.mjs` tem de validar JSON contra um
 * schema fixo. O checker EXECUTA o artefato e confere o código de saída E a
 * mensagem de erro de cada caso (válido, faltando obrigatório, tipo errado,
 * fora da faixa). Determinístico, offline, sem rede.
 *
 * Schema fixo (declarado no enunciado):
 *   nome  : string, obrigatório
 *   idade : número inteiro, obrigatório, entre 0 e 120
 *   email : string, opcional
 */
import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const workdir = process.env.EVAL_WORKDIR;
if (!workdir) {
  console.error("EVAL_WORKDIR ausente");
  process.exit(1);
}

const cli = path.join(workdir, "cli.mjs");
const problemas = [];

async function runCli(arquivo) {
  try {
    const r = await execFileAsync(process.execPath, [cli, arquivo], {
      cwd: workdir,
      timeout: 20000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return { code: 0, out: (r.stdout || "") + "\n" + (r.stderr || "") };
  } catch (err) {
    return {
      code: typeof err.code === "number" ? err.code : 1,
      out: (err.stdout?.toString() || "") + "\n" + (err.stderr?.toString() || ""),
    };
  }
}

const has = (text, terms) => terms.some((t) => text.includes(t));

// 1. válido: exit 0
{
  const r = await runCli("valido.json");
  if (r.code !== 0) {
    const d = r.out.trim().split("\n")[0].slice(0, 160);
    problemas.push(`valido.json: exit ${r.code}, esperado 0 | ${d}`);
  }
}

// 2. faltando obrigatório: exit != 0 e cita "nome" (ou obrigatório/ausente)
{
  const r = await runCli("faltando.json");
  const low = r.out.toLowerCase();
  if (r.code === 0) problemas.push("faltando.json: exit 0, esperado != 0");
  else if (!has(low, ["nome", "obrigat", "required", "missing", "ausente", "faltando"])) {
    problemas.push(`faltando.json: mensagem não identifica o campo "nome" => ${r.out.trim().slice(0, 160)}`);
  }
}

// 3. tipo errado: exit != 0 e cita "nome" ou tipo/string
{
  const r = await runCli("tipo_errado.json");
  const low = r.out.toLowerCase();
  if (r.code === 0) problemas.push("tipo_errado.json: exit 0, esperado != 0");
  else if (!has(low, ["nome", "tipo", "string", "texto", "deve ser"])) {
    problemas.push(`tipo_errado.json: mensagem não identifica o tipo do campo "nome" => ${r.out.trim().slice(0, 160)}`);
  }
}

// 4. fora da faixa: exit != 0 e cita "idade" ou faixa/0-120
{
  const r = await runCli("fora_faixa.json");
  const low = r.out.toLowerCase();
  if (r.code === 0) problemas.push("fora_faixa.json: exit 0, esperado != 0");
  else if (!has(low, ["idade", "faixa", "range", "entre", "0", "120", "máx", "max"])) {
    problemas.push(`fora_faixa.json: mensagem não identifica a faixa de "idade" => ${r.out.trim().slice(0, 160)}`);
  }
}

if (problemas.length > 0) {
  console.error("cli.mjs inválido:");
  for (const p of problemas) console.error("  - " + p);
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { casos: 4 } }));
console.error("ok: cli.mjs valida o schema e explica cada erro (obrigatório, tipo, faixa)");