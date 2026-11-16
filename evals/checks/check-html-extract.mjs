/**
 * Grupo B (ferramenta) — o artefato `cli.mjs` tem de extrair dados de um HTML
 * local (sem rede). O checker EXECUTA o artefato e compara o JSON extraído:
 * tabela -> array de objetos (th = chave), lista -> array de strings, e tags
 * internas são removidas (só o texto). Determinístico, offline, sem rede.
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

function extractJson(text) {
  const t = String(text ?? "").trim();
  if (!t) return undefined;
  try {
    return JSON.parse(t);
  } catch {}
  const lines = t.split(/\r?\n/).filter((l) => l.trim() !== "");
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch {}
  }
  const start = t.search(/[[{]/);
  if (start >= 0) {
    const sub = t.slice(start);
    try {
      return JSON.parse(sub);
    } catch {}
    for (let end = sub.length - 1; end > 0; end--) {
      try {
        return JSON.parse(sub.slice(0, end));
      } catch {}
    }
  }
  return undefined;
}

const same = (a, b) => a === b || (a != null && b != null && String(a).trim() === String(b).trim());
const problemas = [];

async function runCli(arquivo) {
  try {
    const r = await execFileAsync(process.execPath, [cli, arquivo], {
      cwd: workdir,
      timeout: 20000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return r.stdout;
  } catch (err) {
    return { __err: true, detail: (err.stderr?.toString() || err.message || "").split("\n")[0].slice(0, 160) };
  }
}

function checkArrayOfObjects(nome, got, esperado) {
  if (!Array.isArray(got)) {
    problemas.push(`${nome}: saída não é array (veio ${typeof got})`);
    return;
  }
  if (got.length !== esperado.length) {
    problemas.push(`${nome}: ${got.length} itens, esperado ${esperado.length} => ${JSON.stringify(got)}`);
    return;
  }
  for (let i = 0; i < esperado.length; i++) {
    const obj = got[i];
    const esp = esperado[i];
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
      problemas.push(`${nome}: item ${i} não é objeto => ${JSON.stringify(obj)}`);
      continue;
    }
    const objNorm = {};
    for (const [k, v] of Object.entries(obj)) objNorm[String(k).trim()] = v;
    const keys = Object.keys(esp);
    const gotKeys = Object.keys(objNorm);
    if (gotKeys.length !== keys.length || !keys.every((k) => gotKeys.includes(k))) {
      problemas.push(`${nome}: item ${i} chaves ${JSON.stringify(Object.keys(obj))}, esperado ${JSON.stringify(keys)}`);
      continue;
    }
    for (const k of keys) {
      if (!same(objNorm[k], esp[k])) problemas.push(`${nome}: item ${i} campo "${k}" = ${JSON.stringify(objNorm[k])}, esperado ${JSON.stringify(esp[k])}`);
    }
  }
}

function checkArrayOfStrings(nome, got, esperado) {
  if (!Array.isArray(got)) {
    problemas.push(`${nome}: saída não é array (veio ${typeof got})`);
    return;
  }
  if (got.length !== esperado.length) {
    problemas.push(`${nome}: ${got.length} itens, esperado ${esperado.length} => ${JSON.stringify(got)}`);
    return;
  }
  for (let i = 0; i < esperado.length; i++) {
    if (!same(got[i], esperado[i])) problemas.push(`${nome}: item ${i} = ${JSON.stringify(got[i])}, esperado ${JSON.stringify(esperado[i])}`);
  }
}

const casos = [
  {
    nome: "tabela.html",
    arquivo: "tabela.html",
    tipo: "objetos",
    esperado: [
      { nome: "Ana", idade: "30" },
      { nome: "Bruno", idade: "25" },
    ],
  },
  {
    nome: "lista.html",
    arquivo: "lista.html",
    tipo: "strings",
    esperado: ["primeiro", "segundo", "terceiro"],
  },
  {
    nome: "aninhado.html (tags internas removidas)",
    arquivo: "aninhado.html",
    tipo: "objetos",
    esperado: [
      { produto: "Teclado", valor: "R$ 100" },
      { produto: "Mouse", valor: "R$ 50" },
    ],
  },
];

for (const caso of casos) {
  const out = await runCli(caso.arquivo);
  if (out && out.__err) {
    problemas.push(`${caso.nome}: cli.mjs falhou: ${out.detail}`);
    continue;
  }
  const got = extractJson(out);
  if (got === undefined) {
    problemas.push(`${caso.nome}: saída não é JSON válido => ${JSON.stringify(out).slice(0, 200)}`);
    continue;
  }
  if (caso.tipo === "objetos") checkArrayOfObjects(caso.nome, got, caso.esperado);
  else checkArrayOfStrings(caso.nome, got, caso.esperado);
}

if (problemas.length > 0) {
  console.error("cli.mjs inválido:");
  for (const p of problemas) console.error("  - " + p);
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { casos: casos.length } }));
console.error("ok: cli.mjs extrai tabela/lista de HTML local e remove tags internas");