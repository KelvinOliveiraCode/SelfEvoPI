#!/usr/bin/env node
/**
 * selfevopi-rollback — rollback verificado e checkpoint do último estado verde.
 *
 * Duas peças, mesma disciplina: **nada é declarado verde sem passar por `verify()`**,
 * e `last-known-good.json` só é escrito depois que a verificação passa.
 *
 *   rollbackAndVerify({ repoRoot, ref, verify, createTag })
 *     git revert --no-edit <ref>  →  verify()  →  (só então) last-known-good
 *
 *   checkpointGood({ repoRoot, verify, label, checks })
 *     verify()  →  grava .pi/harness/last-known-good.json
 *
 * Segurança:
 *  - git é chamado com execFileSync e **array de argumentos**. Nunca shell,
 *    nunca string interpolada: `ref` vem de dentro do loop evolutivo.
 *  - `verify` roda com cwd = repoRoot, para que o verificador do projeto
 *    encontre a árvore que acabou de mudar.
 *  - revert que falha é abortado (`git revert --abort`), para não deixar a
 *    árvore meio-revertida.
 */

import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_TIMEOUT_MS = 120_000;
const LKG_REL = path.join(".pi", "harness", "last-known-good.json");

/* ------------------------------------------------------------------ */
/* Git                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Executa git com argumentos em array (sem shell) e devolve `{ ok, stdout, stderr }`.
 * `allowFail` transforma o erro em resultado em vez de exceção.
 */
export function git(repoRoot, args, { allowFail = false, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  try {
    const stdout = execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      windowsHide: true,
    });
    return { ok: true, stdout: String(stdout).trim(), stderr: "" };
  } catch (err) {
    const stderr = String(err?.stderr ?? err?.message ?? "").trim();
    if (allowFail) return { ok: false, stdout: "", stderr };
    throw new Error(`git ${args.join(" ")} falhou: ${stderr || err?.code || "erro"}`);
  }
}

/** Raiz do repositório que contém `start` (ou o cwd). */
export function resolveRepoRoot(start = process.cwd()) {
  const r = git(start, ["rev-parse", "--show-toplevel"], { allowFail: true, timeoutMs: 10_000 });
  return r.ok ? r.stdout : null;
}

export function isGitRepo(repoRoot) {
  return git(repoRoot, ["rev-parse", "--git-dir"], { allowFail: true, timeoutMs: 10_000 }).ok;
}

export function headSha(repoRoot) {
  return git(repoRoot, ["rev-parse", "HEAD"], { allowFail: true, timeoutMs: 10_000 }).stdout;
}

export function headBranch(repoRoot) {
  return git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"], { allowFail: true, timeoutMs: 10_000 }).stdout;
}

/* ------------------------------------------------------------------ */
/* verify() — normalização                                               */
/* ------------------------------------------------------------------ */

/**
 * Aceita verify síncrono ou assíncrono, e três formatos de resposta:
 *   true | false
 *   { ok: boolean } | { pass: boolean } | { success: boolean }
 *   throw  → falha com a mensagem
 * Qualquer outra coisa que não seja explicitamente sucesso conta como falha:
 * verificação ambígua não é verificação.
 */
export async function runVerify(verify, { timeoutMs = null } = {}) {
  let raw;
  try {
    raw = await verify();
  } catch (err) {
    return { ok: false, error: `verify() lançou: ${err?.message ?? String(err)}` };
  }

  if (raw === true || raw === undefined || raw === null) return { ok: true };
  if (raw === false) return { ok: false, error: "verify() devolveu false" };

  if (typeof raw === "object") {
    const flag = raw.ok ?? raw.pass ?? raw.success;
    if (flag === true) return { ok: true, detail: raw.detail ?? null };
    if (flag === false) {
      return { ok: false, error: raw.error ?? raw.detail ?? "verify() devolveu falha" };
    }
    if (Array.isArray(raw.errors) && raw.errors.length > 0) {
      return { ok: false, error: raw.errors.join("; ") };
    }
  }

  return { ok: false, error: `verify() devolveu algo que não é sucesso: ${JSON.stringify(raw)}` };
}

/* ------------------------------------------------------------------ */
/* last-known-good                                                     */
/* ------------------------------------------------------------------ */

function lkgPath(repoRoot, lkgFile) {
  return lkgFile ? path.resolve(lkgFile) : path.join(repoRoot, LKG_REL);
}

export async function readLkg({ repoRoot = process.cwd(), file = null } = {}) {
  try {
    return JSON.parse(await readFile(lkgPath(repoRoot, file), "utf8"));
  } catch {
    return null;
  }
}

/** Gravação atômica: arquivo temporário no mesmo diretório + rename. */
export async function writeLkg(data, { repoRoot = process.cwd(), file = null } = {}) {
  const target = lkgPath(repoRoot, file);
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmp, target);
  return target;
}

/* ------------------------------------------------------------------ */
/* checkpointGood                                                      */
/* ------------------------------------------------------------------ */

/**
 * Roda `verify()` e, **só se passar**, grava o last-known-good.
 *
 * @param {object} opts
 * @param {string} [opts.repoRoot]   raiz do repositório (default: cwd)
 * @param {Function} opts.verify     verificação; síncrona ou async
 * @param {string} [opts.label]      rótulo do checkpoint
 * @param {Array}  [opts.checks]     checks no formato do arquivo atual
 * @param {string} [opts.phase]      fase (default: preserva a existente, senão "2")
 * @param {string} [opts.tag]        tag do checkpoint
 * @param {string} [opts.notes]      nota livre
 * @param {string|null} [opts.file]  caminho alternativo do last-known-good
 */
export async function checkpointGood({
  repoRoot = process.cwd(),
  verify,
  label = "checkpoint",
  checks = [],
  phase = null,
  tag = null,
  notes = null,
  file = null,
} = {}) {
  const sha = headSha(repoRoot);
  const branch = headBranch(repoRoot);
  const target = lkgPath(repoRoot, file);

  if (typeof verify !== "function") {
    return { ok: false, verified: false, sha: sha.slice(0, 7), file: target, error: "informe verify()" };
  }

  const result = await runVerify(verify);
  if (!result.ok) {
    // falha honesta: o arquivo antigo continua valendo
    return { ok: false, verified: false, sha: sha.slice(0, 7), file: target, error: result.error };
  }

  const previous = await readLkg({ repoRoot, file });
  const entry =
    checks.length > 0
      ? checks
      : [
          {
            name: "verify",
            command: label,
            result: "pass",
            detail: result.detail ?? "verify() passou",
          },
        ];

  const data = {
    version: previous?.version ?? 1,
    sha: sha.slice(0, 7),
    branch,
    verifiedAt: new Date().toISOString().slice(0, 10),
    phase: phase ?? previous?.phase ?? "2",
    checks: entry,
    notes: notes ?? previous?.notes ?? `checkpoint ${label}`,
    label,
  };
  if (tag) data.tag = tag;
  else if (previous?.tag) data.tag = previous.tag;

  const written = await writeLkg(data, { repoRoot, file });
  return { ok: true, verified: true, sha: data.sha, branch, file: written, data };
}

/* ------------------------------------------------------------------ */
/* rollbackAndVerify                                                   */
/* ------------------------------------------------------------------ */

/**
 * Reverte um commit e só confirma sucesso se a verificação passar.
 *
 * @param {object} opts
 * @param {string} [opts.repoRoot]  raiz do repositório (default: cwd)
 * @param {string} opts.ref         commit-ish a reverter (sha, tag, branch)
 * @param {Function} opts.verify    verificação; roda depois do revert
 * @param {boolean} [opts.createTag=true]  cria tag de backup antes de reverter
 * @param {boolean} [opts.checkpoint=true] grava last-known-good se passar
 * @param {string|null} [opts.file] caminho alternativo do last-known-good
 * @param {number} [opts.timeoutMs]
 * @returns {{ok:boolean, reverted:boolean, verified:boolean, tag:string|null}}
 */
export async function rollbackAndVerify({
  repoRoot = process.cwd(),
  ref,
  verify,
  createTag = true,
  checkpoint = true,
  file = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const out = { ok: false, reverted: false, verified: false, tag: null };

  if (typeof ref !== "string" || ref.trim() === "") {
    return { ...out, error: "informe ref (sha, tag ou branch) a reverter" };
  }
  // `ref` vai para a linha de comando do git: um valor começando com "-" seria
  // interpretado como flag. O loop evolutivo não dita flags.
  if (ref.trim().startsWith("-")) {
    return { ...out, error: `ref inválido (começa com "-"): ${ref}` };
  }
  if (typeof verify !== "function") {
    return { ...out, error: "informe verify()" };
  }
  if (!isGitRepo(repoRoot)) {
    return { ...out, error: `não é repositório git: ${repoRoot}` };
  }

  const target = git(repoRoot, ["rev-parse", "--verify", `${ref}^{commit}`], { allowFail: true, timeoutMs });
  if (!target.ok) {
    return { ...out, error: `referência não encontrada: ${ref}` };
  }

  const beforeSha = headSha(repoRoot);

  // backup antes de tocar na árvore: revert é reversível, mas o estado atual não
  if (createTag) {
    out.tag = `ckpt/pre-revert-${Date.now()}`;
    git(repoRoot, ["tag", "-f", "-a", out.tag, "-m", `backup antes de reverter ${ref} (HEAD ${beforeSha.slice(0, 7)})`], {
      timeoutMs,
    });
  }

  const rev = git(repoRoot, ["revert", "--no-edit", ref], { allowFail: true, timeoutMs });
  if (!rev.ok) {
    // não deixa a árvore meio-revertida
    git(repoRoot, ["revert", "--abort"], { allowFail: true, timeoutMs });
    return {
      ...out,
      sha: headSha(repoRoot).slice(0, 7),
      error: `git revert falhou: ${rev.stderr || "conflito"}`,
    };
  }
  out.reverted = true;

  const afterSha = headSha(repoRoot);
  out.sha = afterSha.slice(0, 7);

  const result = await runVerify(verify);
  out.verified = result.ok;

  if (!result.ok) {
    // caminho central da governança: reverteu, mas não está verde.
    // last-known-good NÃO é tocado.
    return { ...out, error: result.error };
  }

  if (checkpoint) {
    const previous = await readLkg({ repoRoot, file });
    const data = {
      version: previous?.version ?? 1,
      sha: out.sha,
      branch: headBranch(repoRoot),
      verifiedAt: new Date().toISOString().slice(0, 10),
      phase: previous?.phase ?? "2",
      checks: [
        {
          name: "rollback-verified",
          command: `git revert --no-edit ${ref}`,
          result: "pass",
          detail: `HEAD ${out.sha}, verify() passou depois do revert`,
        },
      ],
      notes: previous?.notes ?? `rollback verificado de ${ref}`,
      label: `revert ${ref}`,
    };
    if (out.tag) data.tag = out.tag;
    await writeLkg(data, { repoRoot, file });
    out.checkpointed = true;
  }

  out.ok = true;
  return out;
}