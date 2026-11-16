/**
 * Grupo D (modelo real) — verifica a refatoração que preserva comportamento.
 * O modelo recebe slugify.mjs funcionando e deve extrair a remoção de acentos
 * para uma função exportada `semAcentos`, sem mudar o que `slugify` devolve.
 * O checker prova as duas coisas: semAcentos existe e remove acentos, e slugify
 * mantém exatamente as mesmas saídas em vários casos, incluindo entradas
 * surpresa que o modelo não viu (derrota lookup table).
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
  mod = await import(pathToFileURL(path.join(workdir, "slugify.mjs")).href);
} catch (err) {
  console.error(`não foi possível importar slugify.mjs: ${err.message}`);
  process.exit(1);
}

const problems = [];

if (typeof mod.slugify !== "function") problems.push("exportação 'slugify' ausente ou não é função");
if (typeof mod.semAcentos !== "function") {
  problems.push("refatoração não extraiu 'semAcentos' como função exportada");
} else {
  // semAcentos precisa remover acentos (não é função vazia)
  const s = String(mod.semAcentos("ação"));
  if (s !== "acao") problems.push(`semAcentos("ação") = ${JSON.stringify(s)}, esperado "acao"`);
}

// slugify deve manter EXATAMENTE o comportamento original
const casos = [
  ["Olá, Mundo!", "ola-mundo"],
  ["Café com Leite", "cafe-com-leite"],
  ["  Teste  123  ", "teste-123"],
  ["ação e reação", "acao-e-reacao"],
  ["Çedilha", "cedilha"],
  ["", ""],
  // surpresa: entradas que o modelo não viu (derrota lookup table)
  ["Texto Qualquer", "texto-qualquer"],
  ["São Paulo", "sao-paulo"],
  ["C++ & C#", "c-c"],
];

if (typeof mod.slugify === "function") {
  for (const [entrada, esperado] of casos) {
    let got;
    try {
      got = mod.slugify(entrada);
    } catch (err) {
      problems.push(`slugify(${JSON.stringify(entrada)}) lançou: ${err.message}`);
      continue;
    }
    if (got !== esperado) problems.push(`slugify(${JSON.stringify(entrada)}) = ${JSON.stringify(got)}, esperado ${JSON.stringify(esperado)}`);
  }
}

if (problems.length > 0) {
  console.error(`slugify.mjs inválido: ${problems[0]}`);
  for (let i = 1; i < problems.length; i++) console.error("  - " + problems[i]);
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { casos: casos.length } }));
console.error("ok: refatoração extrai semAcentos e preserva o comportamento de slugify (incl. surpresa)");