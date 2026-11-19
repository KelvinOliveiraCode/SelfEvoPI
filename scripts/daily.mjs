#!/usr/bin/env node
/**
 * daily.mjs — rotina periódica do SelfEvoPI (Fase 5).
 *
 * O plano pede "rotina periódica de /refine + relatório semanal automático".
 * Os dois scripts existiam; faltava alguém para chamá-los na ordem certa e
 * registrar o resultado. É isso:
 *
 *   1. refine --dry-run   → mostra o que mudaria (não escreve)
 *   2. refine --apply     → aplica e **desfaz sozinho** se o gate regredir
 *   3. weekly-report      → relatório de métricas
 *
 * Uso:
 *   node scripts/daily.mjs                 # completo
 *   node scripts/daily.mjs --dry-run       # só o diagnóstico, sem aplicar nada
 *   node scripts/daily.mjs --json          # saída de uma linha (para automação)
 *
 * Agendamento (Windows, sem dependências):
 *   schtasks /create /tn SelfEvoPI-Daily /tr "node C:\\...\\scripts\\daily.mjs" /sc daily /st 07:00
 *
 * O script **nunca** falha em silêncio: se um passo der errado, o resultado
 * carrega `ok:false` e o motivo, e o exit code é 1.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const REPORTS = path.join(ROOT, ".pi", "harness", "reports");

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const asJson = process.argv.includes("--json");
const dryRun = process.argv.includes("--dry-run");
const refineScript = path.join(ROOT, "scripts", "refine-loop.mjs");
const weeklyScript = path.join(ROOT, "scripts", "weekly-report.mjs");

/** Roda um script do projeto e devolve { ok, code, stdout, stderr }. */
function step(label, args) {
  const started = Date.now();
  const res = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
    timeout: 30 * 60_000,
  });
  const stderr = String(res.stderr ?? "").trim();
  const stdout = String(res.stdout ?? "").trim();
  const ok = res.status === 0;
  if (!ok && !asJson) {
    process.stderr.write(`  ${label}: falhou (exit ${res.status})\n`);
    if (stderr) process.stderr.write(`    ${stderr.split("\n").slice(0, 4).join("\n    ")}\n`);
  }
  return { label, ok, code: res.status, ms: Date.now() - started, stdout, stderr };
}

/* ------------------------------------------------------------------ */

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportFile = path.join(REPORTS, `daily-${stamp}.md`);
const steps = [];

if (!asJson) {
  process.stdout.write(`Rotina diária SelfEvoPI — ${new Date().toISOString()}\n`);
  process.stdout.write(`modo: ${dryRun ? "diagnóstico (nada aplicado)" : "completo"}\n\n`);
}

// 1. diagnóstico: o que o refine mudaria
const diag = step("refine (diagnóstico)", [refineScript, "--dry-run", "--json"]);
steps.push(diag);

// 2. aplicação: só quando o modo é completo
let applied = null;
if (!dryRun) {
  applied = step("refine (aplicar)", [refineScript, "--apply", "--json"]);
  steps.push(applied);
}

// 3. relatório semanal
const weekly = step("relatório semanal", [weeklyScript, "--out", path.join(REPORTS, `weekly-${stamp}.md`), "--json"]);
steps.push(weekly);

/* ------------------------------------------------------------------ */
/* Resultado                                                           */
/* ------------------------------------------------------------------ */

const allOk = steps.every((s) => s.ok);
const lines = [];
lines.push("# Rotina diária — SelfEvoPI");
lines.push("");
lines.push(`- executada em: ${new Date().toISOString()}`);
lines.push(`- modo: ${dryRun ? "diagnóstico" : "completo"}`);
lines.push("");
lines.push("| passo | resultado | tempo |");
lines.push("|:---|:---|:---|");
for (const s of steps) {
  lines.push(`| ${s.label} | ${s.ok ? "ok" : `falhou (exit ${s.code})`} | ${(s.ms / 1000).toFixed(1)} s |`);
}
lines.push("");
if (applied) {
  let parsed = null;
  try {
    parsed = JSON.parse(applied.stdout);
  } catch {
    /* saída não-JSON: segue */
  }
  if (parsed) {
    lines.push("## Refine");
    lines.push("");
    lines.push(`- entradas analisadas: ${parsed.entries ?? "?"}`);
    lines.push(`- deltas acionáveis: ${parsed.actionable ?? "?"}`);
    lines.push(`- aplicado: ${parsed.applied ? "sim" : "não"}`);
    lines.push(`- gate: ${parsed.gateOk ? "verde" : "vermelho"}`);
    lines.push(`- revertido: ${parsed.reverted ? "**sim**" : "não"}`);
  }
}
lines.push("");
lines.push(`**Veredito:** ${allOk ? "✓ rotina concluída" : "✗ houve falha — ver acima"}`);

const md = lines.join("\n") + "\n";
mkdirSync(REPORTS, { recursive: true });
try {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(reportFile, md, "utf8");
} catch (err) {
  process.stderr.write(`não foi possível gravar o relatório: ${err?.message ?? err}\n`);
}

if (asJson) {
  process.stdout.write(
    JSON.stringify({
      ok: allOk,
      dryRun,
      report: path.relative(ROOT, reportFile),
      steps: steps.map((s) => ({ label: s.label, ok: s.ok, code: s.code, ms: s.ms })),
    }) + "\n",
  );
} else {
  process.stdout.write("\n" + md);
  process.stdout.write(`relatório: ${path.relative(ROOT, reportFile)}\n`);
}

process.exit(allOk ? 0 : 1);