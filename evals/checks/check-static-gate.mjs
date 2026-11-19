#!/usr/bin/env node
/**
 * Grupo B (ferramenta) — gate estático (core/sandbox/static-gate.mjs).
 * É o analisador que a suíte usa para barrar código perigoso antes de rodar.
 * Verifica que: código limpo passa, e que segredo embutido, child_process,
 * rede e eval são bloqueados; que um override `allow` desliga a regra; e que
 * leitura de env comum vira aviso (não bloqueio).
 * Determinístico, sem chamadas de modelo.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { evaluate } = await import(pathToFileURL(path.join(ROOT, "core", "sandbox", "static-gate.mjs")).href);

const failures = [];
const ws = process.env.EVAL_WORKDIR || process.cwd();

function expectBlock(label, code, rule) {
  const r = evaluate(code, { workspace: ws });
  if (r.decision !== "block") failures.push(`${label}: decisão "${r.decision}", esperado "block"`);
  if (!r.blockingRules.includes(rule)) failures.push(`${label}: blockingRules ${r.blockingRules.join(",")}, esperado conter "${rule}"`);
}

// 1. código limpo passa
{
  const r = evaluate("const soma = (a, b) => a + b;\nmodule.exports = { soma };", { workspace: ws });
  if (r.decision !== "allow") failures.push(`código limpo: decisão "${r.decision}", esperado "allow"`);
}

// 2-5. padrões perigosos bloqueiam
expectBlock("segredo embutido", 'const apiKey = "sk-abcdefghijklmnop1234";', "embedded-secret");
expectBlock("child_process", 'const cp = require("child_process");', "child-process");
expectBlock("rede", 'const r = await fetch("https://exemplo.com");', "network-access");
expectBlock("eval", 'const x = eval("1 + 1");', "dynamic-eval");

// 6. override allow desliga a regra: fetch deixa de bloquear
{
  const r = evaluate('const r = await fetch("https://exemplo.com");', { workspace: ws, allow: { "network-access": "off" } });
  if (r.decision !== "allow") failures.push(`override allow network-access: decisão "${r.decision}", esperado "allow"`);
}

// 7. leitura de env comum é aviso, não bloqueio
{
  const r = evaluate("const home = process.env.HOME;", { workspace: ws });
  if (r.decision !== "warn") failures.push(`process.env: decisão "${r.decision}", esperado "warn"`);
  if (!r.warningRules.includes("process-env-read")) failures.push(`process.env: warningRules ${r.warningRules.join(",")}, esperado "process-env-read"`);
}

if (failures.length > 0) {
  console.error("falhou:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { casos: 7 } }));
console.error("ok: gate estático bloqueia segredo/child_process/rede/eval e respeita allow");