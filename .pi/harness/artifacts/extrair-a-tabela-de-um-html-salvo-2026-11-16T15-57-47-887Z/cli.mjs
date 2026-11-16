#!/usr/bin/env node
/**
 * cli.mjs — CLI autogerado pelo Forge.
 * Objetivo: extrair a tabela de um HTML salvo
 *
 * Uso: node cli.mjs --<entrada> <valor> [--<entrada> <valor> ...]
 * Imprime JSON compacto (uma linha) com as saídas declaradas.
 * Sai 2 se faltar algum argumento obrigatório.
 */

const GOAL = "extrair a tabela de um HTML salvo";
const INPUTS = {
  "arquivo": "arquivo"
};
const OUTPUTS = {
  "linhas": "linhas"
};

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
  process.stderr.write(JSON.stringify({ ok: false, error: message }) + "\n");
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
    JSON.stringify({ ok: true, goal: GOAL, inputs: args, outputs: outputs }) + "\n"
  );
}
