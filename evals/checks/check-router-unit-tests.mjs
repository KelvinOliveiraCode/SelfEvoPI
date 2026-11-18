#!/usr/bin/env node
/**
 * Grupo C (regressao) — a suíte de testes unitários do roteador precisa passar.
 *
 * Executa `node --test core/router/router.test.mjs` e exige exit code 0.
 * Determinístico: não chama modelo, não toca em rede.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const FILE = path.join(ROOT, "core", "router", "router.test.mjs");
const TIMEOUT_MS = 15_000;

const started = Date.now();
const run = spawnSync(process.execPath, ["--test", FILE], {
  cwd: ROOT,
  encoding: "utf8",
  timeout: TIMEOUT_MS,
  windowsHide: true,
  maxBuffer: 8 * 1024 * 1024,
});
const durationMs = Date.now() - started;

if (run.error) {
  console.error(`nao foi possivel executar os testes: ${run.error.message}`);
  process.exit(1);
}

if (run.status !== 0) {
  const raw = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  const lines = raw
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  // Linhas que carregam o veredito do node:test e as falhas em si.
  const interesting = lines.filter((l) => /^not ok|^# (fail|pass|tests)|✖|AssertionError|Error:/.test(l));
  const summary = (interesting.length > 0 ? interesting : lines).slice(-20);

  console.error(`testes do roteador falharam (exit ${run.status}, ${durationMs} ms):`);
  for (const l of summary) console.error("  " + l.slice(0, 300));
  process.exit(1);
}

const out = `${run.stdout ?? ""}`;
const count = (label) => {
  const m = out.match(new RegExp(`^(?:#\\s*|\\u2139\\s*)${label} (\\d+)`, "m"));
  return m ? Number(m[1]) : 0;
};

console.log(
  JSON.stringify({
    tokens: 0,
    metrics: {
      tests: count("tests"),
      passed: count("pass"),
      failures: count("fail"),
      durationMs,
    },
  })
);
console.error(`ok: ${count("pass")}/${count("tests")} testes passaram em ${durationMs} ms`);