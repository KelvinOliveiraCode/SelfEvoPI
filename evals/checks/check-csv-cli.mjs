/**
 * Grupo B (ferramenta) — o artefato `cli.mjs` tem de ler CSV e devolver JSON.
 * O checker EXECUTA o artefato (não confere se o arquivo existe): roda
 * `node cli.mjs <fixture>` e compara o JSON de saída com o esperado, campo a
 * campo. Cobre vírgula entre aspas, aspa escapada (""), CRLF e linha em branco.
 *
 * Tolerâncias (variação de implementação, não de correção):
 *  - aceita um array JSON, um array pretty-printed, ou JSONL (um objeto por linha);
 *  - compara valores normalizados por String() e trim (remove \r de CRLF).
 * Determinístico, offline, sem rede.
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

// Entrada surpresa: gerada em runtime, o modelo nunca a viu. Derrota lookup table.
const SURPRESA = 'cor,tamanho\n"Azul, Marinho",M\n"Preto",G\n';
const SURPRESA_ESPERADO = [
  { cor: "Azul, Marinho", tamanho: "M" },
  { cor: "Preto", tamanho: "G" },
];
await writeFile(path.join(workdir, "surpresa.csv"), SURPRESA, "utf8");

/** Extrai um array JSON do stdout: array, array pretty-printed, ou JSONL. */
function extractJsonArray(text) {
  const t = String(text ?? "").trim();
  if (!t) return undefined;
  const asArray = (v) => (Array.isArray(v) ? v : undefined);
  try {
    const v = asArray(JSON.parse(t));
    if (v) return v;
  } catch {}
  // array dentro de texto extra: do primeiro [ ao último ]
  const s = t.indexOf("[");
  const e = t.lastIndexOf("]");
  if (s >= 0 && e > s) {
    try {
      const v = asArray(JSON.parse(t.slice(s, e + 1)));
      if (v) return v;
    } catch {}
  }
  // JSONL: coleta linhas que fazem parse sozinhas
  const lines = t.split(/\r?\n/).filter((l) => l.trim() !== "");
  const objs = [];
  let parsed = 0;
  for (const l of lines) {
    try {
      objs.push(JSON.parse(l));
      parsed++;
    } catch {}
  }
  if (parsed > 0 && objs.every((o) => o && typeof o === "object" && !Array.isArray(o))) return objs;
  return undefined;
}

const norm = (v) => String(v ?? "").trim();
const same = (a, b) => norm(a) === norm(b);
const problemas = [];

const casos = [
  {
    nome: "dados.csv (aspas, vírgula entre aspas, CRLF, linha em branco)",
    arquivo: "dados.csv",
    esperado: [
      { nome: "Hello, World", descricao: 'a "quoted" word' },
      { nome: "linha com, virgula", descricao: "fim" },
    ],
  },
  {
    nome: "tabela.csv (simples)",
    arquivo: "tabela.csv",
    esperado: [
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ],
  },
  {
    nome: "surpresa.csv (gerado em runtime, não visto pelo modelo)",
    arquivo: "surpresa.csv",
    esperado: SURPRESA_ESPERADO,
  },
];

for (const caso of casos) {
  let out;
  try {
    const r = await execFileAsync(process.execPath, [cli, caso.arquivo], {
      cwd: workdir,
      timeout: 20000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    out = r.stdout;
  } catch (err) {
    const detail = (err.stderr?.toString() || err.message || "").split("\n")[0].slice(0, 200);
    problemas.push(`${caso.nome}: cli.mjs falhou (exit ${err.code}): ${detail}`);
    continue;
  }

  const got = extractJsonArray(out);
  if (got === undefined) {
    problemas.push(`${caso.nome}: saída não é um array JSON válido => ${JSON.stringify(out).slice(0, 200)}`);
    continue;
  }
  if (got.length !== caso.esperado.length) {
    problemas.push(`${caso.nome}: ${got.length} objetos, esperado ${caso.esperado.length} => ${JSON.stringify(got)}`);
    continue;
  }

  for (let i = 0; i < caso.esperado.length; i++) {
    const obj = got[i];
    const esp = caso.esperado[i];
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
      problemas.push(`${caso.nome}: item ${i} não é objeto => ${JSON.stringify(obj)}`);
      continue;
    }
    const objNorm = {};
    for (const [k, v] of Object.entries(obj)) objNorm[String(k).trim()] = v;
    const chavesEsp = Object.keys(esp);
    const chavesGot = Object.keys(objNorm);
    if (chavesGot.length !== chavesEsp.length || !chavesEsp.every((k) => chavesGot.includes(k))) {
      problemas.push(`${caso.nome}: item ${i} chaves ${JSON.stringify(Object.keys(obj))}, esperado ${JSON.stringify(chavesEsp)}`);
      continue;
    }
    for (const k of chavesEsp) {
      if (!same(objNorm[k], esp[k])) {
        problemas.push(`${caso.nome}: item ${i} campo "${k}" = ${JSON.stringify(objNorm[k])}, esperado ${JSON.stringify(esp[k])}`);
      }
    }
  }
}

if (problemas.length > 0) {
  console.error(`cli.mjs inválido: ${problemas[0]}`);
  for (let i = 1; i < problemas.length; i++) console.error("  - " + problemas[i]);
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { casos: casos.length } }));
console.error("ok: cli.mjs lê CSV (aspas, CRLF, linha em branco) e devolve o JSON esperado");