#!/usr/bin/env node
/**
 * agents-status.mjs — painel de auditoria dos worktrees dos subagentes.
 *
 * Para cada .worktrees/A*, mostra: branch, commits à frente/atras da main,
 * arquivos modificados, arquivos novos e se há trabalho pendente.
 *
 * Uso:
 *   node scripts/agents-status.mjs
 *   node scripts/agents-status.mjs --porcelain
 */

import { execFileSync } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const WT_DIR = path.join(ROOT, ".worktrees");
const PORCELAIN = process.argv.includes("--porcelain");

function git(args, cwd = ROOT) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function readStatus(cwd) {
  const raw = git(["status", "--porcelain"], cwd);
  const modified = [];
  const untracked = [];
  for (const line of raw.split("\n").filter(Boolean)) {
    const code = line.slice(0, 2);
    const file = line.slice(3);
    if (code.includes("?")) untracked.push(file);
    else modified.push(file);
  }
  return { modified, untracked };
}

const entries = await readdir(WT_DIR, { withFileTypes: true }).catch(() => []);
const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();

if (dirs.length === 0) {
  console.error("nenhum worktree em .worktrees/");
  process.exit(1);
}

const rows = [];
for (const name of dirs) {
  const cwd = path.join(WT_DIR, name);
  if (!(await stat(cwd).catch(() => null))) continue;

  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd) || "?";
  const head = git(["rev-parse", "--short", "HEAD"], cwd) || "?";
  const behind = Number(git(["rev-list", "--count", `HEAD..main`], cwd) || 0);
  const ahead = Number(git(["rev-list", "--count", `main..HEAD`], cwd) || 0);
  const status = readStatus(cwd);
  const dirty = status.modified.length + status.untracked.length;

  rows.push({
    name,
    branch,
    head,
    behind,
    ahead,
    dirty,
    modified: status.modified,
    untracked: status.untracked,
  });
}

if (PORCELAIN) {
  console.log(JSON.stringify(rows, null, 2));
  process.exit(rows.some((r) => r.dirty > 0 || r.ahead > 0) ? 1 : 0);
}

console.log("worktree  branch                 head    atras  frente  pendentes");
for (const r of rows) {
  const pend = r.dirty === 0 ? "limpo" : `${r.dirty} arquivo(s)`;
  console.log(
    `  ${r.name.padEnd(8)} ${r.branch.padEnd(22)} ${r.head.padEnd(7)} ${String(r.behind).padStart(5)} ${String(r.ahead).padStart(7)}  ${pend}`,
  );
  for (const f of r.modified) console.log(`      M  ${f}`);
  for (const f of r.untracked) console.log(`      ?  ${f}`);
}

const withWork = rows.filter((r) => r.dirty > 0 || r.ahead > 0);
const stale = rows.filter((r) => r.behind > 0);
console.log("");
console.log(`  ${withWork.length} worktree(s) com trabalho; ${stale.length} desatualizado(s) em relação à main`);

process.exit(0);