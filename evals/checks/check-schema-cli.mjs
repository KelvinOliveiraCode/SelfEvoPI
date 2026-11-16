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
 *
 * Além dos fixtures, o checker gera arquivos surpresa em runtime (não vistos
 * pelo modelo) para derrotar lookup table.
 */
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
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

// Entradas surpresa: geradas em runtime, o modelo nunca as viu.
await writeFile(path.join(workdir, "surpresa_valido.json"), '{"nome":"Carlos","idade":45}', "utf8");
await writeFile(path.join(workdir, "surpresa_faixa.json"), '{"nome":"Bea","idade":200}', "utf8");
await writeFile(path.join(workdir, "surpresa_tipo.json"), '{"nome":false,"idade":10}', "utf8");

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

async function expectValid(arquivo) {
  const r = await runCli(arquivo);
  if (r.code !== 0) {
    const d = r.out.trim().split("\n")[0].slice(0, 160);
    problemas.push(`${arquivo}: exit ${r.code}, esperado 0 | ${d}`);
  }
}

async function expectInvalid(arquivo, terms, label) {
  const r = await runCli(arquivo);
  const low = r.out.toLowerCase();
  if (r.code === 0) {
    problemas.push(`${arquivo}: exit 0, esperado != 0`);
    return;
  }
  if (!has(low, terms)) {
    problemas.push(`${arquivo}: mensagem não identifica ${label} => ${r.out.trim().slice(0, 160)}`);
  }
}

// 1. válido: exit 0
await expectValid("valido.json");

// 2. faltando obrigatório
await expectInvalid("faltando.json", ["nome", "obrigat", "required", "missing", "ausente", "faltando"], 'o campo "nome"');

// 3. tipo errado
await expectInvalid("tipo_errado.json", ["nome", "tipo", "string", "texto", "deve ser"], 'o tipo do campo "nome"');

// 4. fora da faixa
await expectInvalid("fora_faixa.json", ["idade", "faixa", "range", "entre", "0", "120", "máx", "max"], 'a faixa de "idade"');

// 5. surpresa válida (runtime): exit 0
await expectValid("surpresa_valido.json");

// 6. surpresa fora de faixa (runtime)
await expectInvalid("surpresa_faixa.json", ["idade", "faixa", "range", "entre", "0", "120", "máx", "max"], 'a faixa de "idade"');

// 7. surpresa tipo errado (runtime)
await expectInvalid("surpresa_tipo.json", ["nome", "tipo", "string", "texto", "deve ser"], 'o tipo do campo "nome"');

if (problemas.length > 0) {
  console.error(`cli.mjs inválido: ${problemas[0]}`);
  for (let i = 1; i < problemas.length; i++) console.error("  - " + problemas[i]);
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { casos: 7 } }));
console.error("ok: cli.mjs valida o schema (inclusive entradas surpresa) e explica cada erro");