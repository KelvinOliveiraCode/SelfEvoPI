/**
 * Grupo D (modelo real) — verifica o parser CSV que o PI deveria ter criado.
 * Importa parseCsv.mjs do workspace e cobre: campo com vírgula entre aspas,
 * aspas escapadas (""), e múltiplos campos entre aspas. Não confia na
 * aparência: executa o código e compara a estrutura.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const workdir = process.env.EVAL_WORKDIR;
if (!workdir) {
  console.error("EVAL_WORKDIR ausente");
  process.exit(1);
}

let mod;
try {
  mod = await import(pathToFileURL(path.join(workdir, "parseCsv.mjs")).href);
} catch (err) {
  console.error(`não foi possível importar parseCsv.mjs: ${err.message}`);
  process.exit(1);
}

const parseCsv = typeof mod.parseCsv === "function" ? mod.parseCsv : mod.default;
const problems = [];

if (typeof parseCsv !== "function") {
  console.error("parseCsv.mjs não exporta função parseCsv (nem default)");
  process.exit(1);
}

// Cada caso: [entrada, esperado] — esperado é array de linhas (array de strings).
const casos = [
  {
    nome: "virgula entre aspas",
    entrada: 'nome,valor\n"Hello, World",42',
    esperado: [["nome", "valor"], ["Hello, World", "42"]],
  },
  {
    nome: "aspas escapadas",
    entrada: 'a,b\n"say ""hi""",z',
    esperado: [["a", "b"], ['say "hi"', "z"]],
  },
  {
    nome: "multiplos campos entre aspas",
    entrada: 'x,y,z\n"1,2",3,"4,5"',
    esperado: [["x", "y", "z"], ["1,2", "3", "4,5"]],
  },
];

for (const caso of casos) {
  let got;
  try {
    got = parseCsv(caso.entrada);
  } catch (err) {
    problems.push(`${caso.nome}: parseCsv lançou: ${err.message}`);
    continue;
  }
  if (!Array.isArray(got)) {
    problems.push(`${caso.nome}: resultado não é array (veio ${typeof got})`);
    continue;
  }
  if (got.length !== caso.esperado.length) {
    problems.push(`${caso.nome}: ${got.length} linhas, esperado ${caso.esperado.length} => ${JSON.stringify(got)}`);
    continue;
  }
  for (let i = 0; i < caso.esperado.length; i++) {
    const linha = got[i];
    const esp = caso.esperado[i];
    if (!Array.isArray(linha) || linha.length !== esp.length) {
      problems.push(`${caso.nome}: linha ${i} tem ${Array.isArray(linha) ? linha.length : typeof linha} campos, esperado ${esp.length}`);
      continue;
    }
    for (let j = 0; j < esp.length; j++) {
      const cell = String(linha[j]);
      if (cell !== esp[j]) {
        problems.push(`${caso.nome}: linha ${i} campo ${j} = ${JSON.stringify(cell)}, esperado ${JSON.stringify(esp[j])}`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error("parseCsv.mjs inválido:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { casos: casos.length } }));
console.error("ok: parseCsv trata vírgula entre aspas, aspas escapadas e múltiplos campos");