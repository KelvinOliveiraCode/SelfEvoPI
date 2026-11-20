#!/usr/bin/env node
/**
 * schedule.mjs — agenda a rotina diária do SelfEvoPI no Windows Task Scheduler.
 *
 * Uso:
 *   node scripts/schedule.mjs --install    # registra SelfEvoPI-Daily
 *   node scripts/schedule.mjs --uninstall  # remove SelfEvoPI-Daily
 *   node scripts/schedule.mjs --status     # mostra estado atual
 *
 * Idempotente: --install não duplica; --uninstall não falha se já ausente.
 * Usa schtasks via spawn com array de argumentos (nunca string de shell).
 * Nunca expõe caminho pessoal no output — usa caminho relativo ao repositório.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const TASK_NAME = "SelfEvoPI-Daily";
const DAILY_SCRIPT = path.join(ROOT, "scripts", "daily.mjs");
const NODE_EXE = process.execPath;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Roda schtasks com array de argumentos e devolve { ok, stdout, stderr, code }. */
function schtasks(args) {
  const res = spawnSync("schtasks", args, {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    ok: res.status === 0,
    code: res.status,
    stdout: String(res.stdout ?? "").trim(),
    stderr: String(res.stderr ?? "").trim(),
  };
}

/** Verifica se a tarefa existe. */
function taskExists() {
  const r = schtasks(["/query", "/tn", TASK_NAME, "/fo", "LIST"]);
  return r.ok;
}

/* ------------------------------------------------------------------ */
/* Modos                                                               */
/* ------------------------------------------------------------------ */

function install() {
  if (taskExists()) {
    process.stdout.write(`✓ "${TASK_NAME}" já está agendado (idempotente)\n`);
    return;
  }
  // schtasks /tr com caminho que tem espaco: aspas simples internas quebram.
  // O wrapper `cmd /c ""<exe>" "<script>""` (aspas internas dobradas) e a forma
  // documentada que sobrevive a "C:\Program Files\...".
  const action = `cmd /c ""${NODE_EXE}" "${DAILY_SCRIPT}""`;
  const r = schtasks([
    "/create",
    "/tn", TASK_NAME,
    "/tr", action,
    "/sc", "daily",
    "/st", "07:00",
    "/f",
  ]);
  if (r.ok) {
    process.stdout.write(`✓ "${TASK_NAME}" agendado para diariamente às 07:00\n`);
    process.stdout.write(`  ação: node scripts/daily.mjs\n`);
  } else {
    process.stderr.write(`✗ falhou ao agendar: ${r.stderr || r.stdout}\n`);
    process.exit(1);
  }
}

function uninstall() {
  if (!taskExists()) {
    process.stdout.write(`✓ "${TASK_NAME}" não está agendado (nada a remover)\n`);
    return;
  }
  const r = schtasks(["/delete", "/tn", TASK_NAME, "/f"]);
  if (r.ok) {
    process.stdout.write(`✓ "${TASK_NAME}" removido\n`);
  } else {
    process.stderr.write(`✗ falhou ao remover: ${r.stderr || r.stdout}\n`);
    process.exit(1);
  }
}

function status() {
  if (!taskExists()) {
    process.stdout.write(`"${TASK_NAME}": não agendado\n`);
    return;
  }
  const r = schtasks(["/query", "/tn", TASK_NAME, "/v", "/fo", "LIST"]);
  process.stdout.write(r.stdout + "\n");
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

const mode = process.argv[2];

if (mode === "--install") {
  install();
} else if (mode === "--uninstall") {
  uninstall();
} else if (mode === "--status") {
  status();
} else {
  process.stderr.write("uso: node scripts/schedule.mjs --install | --uninstall | --status\n");
  process.exit(1);
}