#!/usr/bin/env node
/**
 * checkpoint.mjs — time-machine do SelfEvoPI.
 *
 * Cria pontos de restauração antes de qualquer mutação arriscada e devolve
 * o projeto ao último estado verde quando algo quebra.
 *
 * Uso:
 *   node scripts/checkpoint.mjs status
 *   node scripts/checkpoint.mjs create <label>
 *   node scripts/checkpoint.mjs restore <tag|sha> --force
 *   node scripts/checkpoint.mjs verify
 *
 * Regras:
 *  - `create` faz tag anotada ckpt/<label> e grava o SHA em last-known-good.json
 *  - `restore` exige --force: é uma operação destrutiva (reset --hard)
 *  - `verify` roda o gate de regressão e diz se o estado atual está verde
 */

import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const LKG = path.join(ROOT, ".pi", "harness", "last-known-good.json");

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    if (allowFail) return "";
    throw new Error(`git ${args.join(" ")} falhou: ${(err.stderr || err.message || "").toString().trim()}`);
  }
}

function currentSha() {
  return git(["rev-parse", "HEAD"]);
}

function shortSha() {
  return git(["rev-parse", "--short", "HEAD"]);
}

async function readLkg() {
  try {
    return JSON.parse(await readFile(LKG, "utf8"));
  } catch {
    return null;
  }
}

async function writeLkg(data) {
  await writeFile(LKG, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function status() {
  const lkg = await readLkg();
  const tags = git(["tag", "--list", "ckpt/*"], { allowFail: true })
    .split("\n")
    .filter(Boolean)
    .sort()
    .reverse();

  console.log(`HEAD atual      ${shortSha()}  (${git(["rev-parse", "--abbrev-ref", "HEAD"])})`);
  if (lkg) {
    console.log(`last-known-good ${lkg.sha}  (fase ${lkg.phase ?? "?"}, ${lkg.verifiedAt ?? "?"})`);
  } else {
    console.log("last-known-good ausente");
  }
  console.log("");
  if (tags.length === 0) {
    console.log("nenhum checkpoint criado");
  } else {
    console.log("checkpoints (mais recentes primeiro):");
    for (const t of tags.slice(0, 15)) {
      const sha = git(["rev-list", "-n", "1", t], { allowFail: true }).slice(0, 7);
      const when = git(["log", "-1", "--format=%ci", t], { allowFail: true });
      console.log(`  ${t.padEnd(34)} ${sha}  ${when}`);
    }
  }
}

async function create(label) {
  if (!label || !/^[a-z0-9._-]+$/i.test(label)) {
    throw new Error("label inválido: use letras, números, ponto, hífen ou sublinhado");
  }
  const dirty = git(["status", "--porcelain"]);
  if (dirty) {
    console.error("  ! há alterações não commitadas:");
    for (const line of dirty.split("\n")) console.error(`      ${line}`);
    console.error("  commit ou descarte antes de criar um checkpoint.\n");
  }

  const tag = `ckpt/${label}`;
  git(["tag", "-f", "-a", tag, "-m", `checkpoint ${label} (${new Date().toISOString()})`]);
  const sha = currentSha();
  const lkg = (await readLkg()) ?? { version: 1 };
  lkg.sha = sha.slice(0, 7);
  lkg.tag = tag;
  lkg.branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  lkg.verifiedAt = new Date().toISOString().slice(0, 10);
  await writeLkg(lkg);

  console.log(`✓ checkpoint ${tag} → ${sha.slice(0, 7)}`);
  console.log(`  last-known-good atualizado`);
}

async function restore(target, force) {
  if (!target) throw new Error("informe a tag ou o SHA de destino");
  if (!force) {
    console.error("✗ restore é destrutivo (git reset --hard). Reexecute com --force.");
    process.exit(2);
  }
  const exists = git(["rev-parse", "--verify", target], { allowFail: true });
  if (!exists) throw new Error(`referência não encontrada: ${target}`);

  const backupTag = `ckpt/pre-restore-${Date.now()}`;
  git(["tag", "-f", "-a", backupTag, "-m", "backup automático antes de restore"]);
  console.log(`  backup do estado atual: ${backupTag}`);

  git(["reset", "--hard", target]);
  console.log(`✓ projeto restaurado para ${target} (${shortSha()})`);
  console.log("  rode node evals/gate.mjs para confirmar");
}

async function verify() {
  console.log("rodando gate de regressão…\n");
  try {
    execFileSync(process.execPath, [path.join(ROOT, "evals", "gate.mjs")], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: "inherit",
    });
    console.log("\n✓ estado verde");
  } catch {
    console.error("\n✗ estado NÃO verde — considere restaurar um checkpoint");
    process.exit(1);
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const force = process.argv.includes("--force");

  switch (cmd) {
    case "status":
      return status();
    case "create":
      return create(rest[0]);
    case "restore":
      return restore(rest[0], force);
    case "verify":
      return verify();
    default:
      console.log("uso: node scripts/checkpoint.mjs <status|create <label>|restore <tag|sha> --force|verify>");
      process.exit(2);
  }
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});