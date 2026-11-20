/**
 * core/agent/worktree.mjs — opera os worktrees git do projeto por trás do
 * comando `/worktree` da CLI.
 *
 * Três operações, e nada além delas:
 *
 *   listWorktrees({ cwd })                 -> [{ path, branch, head }]
 *   createWorktree({ cwd, name, branch? }) -> { path, branch }
 *   removeWorktree({ cwd, path, force? })  -> { removed }
 *
 * Regras que valem para as três:
 *
 *   - **git nunca vai para um shell.** Toda chamada usa array de argumentos via
 *     `execFile`; `name`, `branch` e `path` entram como elementos de array,
 *     nunca interpolados numa linha de comando. Um nome começando com "-" não
 *     vira flag: ele é recusado antes de chegar ao git.
 *   - **Windows nativo, ESM puro, zero dependência.** Só `node:`.
 *   - **Erro tipado e curto.** `WorktreeError` carrega `code` e uma mensagem de
 *     uma linha. Nada de segredo: git não recebe credencial aqui.
 *
 * O path de um worktree novo é sempre `.worktrees/<name>` relativo a `cwd`.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileP = promisify(execFile);

/** Diretório-base dos worktrees, relativo à raiz do repositório. */
export const WORKTREES_DIR = ".worktrees";

/** Erro tipado do módulo: `code` é estável (usável em teste e no CLI). */
export class WorktreeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WorktreeError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Um token não pode começar com "-" (viraria flag) nem ser vazio. */
function assertNotFlag(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new WorktreeError("invalid", `${label} vazio`);
  }
  if (value.trim().startsWith("-")) {
    throw new WorktreeError("invalid", `${label} não pode começar com "-"`);
  }
  return value.trim();
}

/**
 * Roda git com array de argumentos (sem shell) e devolve o stdout.
 * `allowFail` transforma o erro num resultado em vez de exceção.
 */
async function git(cwd, args, { allowFail = false } = {}) {
  try {
    const { stdout } = await execFileP("git", args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout: String(stdout) };
  } catch (err) {
    const stderr = String(err?.stderr ?? "").trim();
    const code = typeof err?.code === "string" ? err.code : err?.code;
    if (allowFail) return { ok: false, stdout: "", stderr, code };
    const msg = stderr || err?.message || "falha";
    throw new WorktreeError("git", `git ${args.join(" ")} falhou: ${msg}`);
  }
}

/**
 * Parseia a saída `--porcelain` de `git worktree list` em registros.
 *
 * Formato (blocos separados por linha em branco):
 *   worktree <path>
 *   HEAD <sha>
 *   branch refs/heads/<nome>   (ou "detached")
 *   [bare] [locked ...] [prunable ...]
 */
function parsePorcelain(text) {
  const out = [];
  let current = null;

  const flush = () => {
    if (current && current.path) {
      out.push({
        path: current.path,
        branch: current.branch,
        head: current.head,
      });
    }
    current = null;
  };

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      flush();
      current = { path: line.slice("worktree ".length), head: null, branch: null };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length).trim();
    } else if (line.startsWith("branch ")) {
      const ref = line.slice("branch ".length).trim();
      current.branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
    } else if (line === "detached") {
      current.branch = null;
    }
  }
  flush();
  return out;
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Lista os worktrees do repositório que contém `cwd`.
 *
 * @param {{ cwd?: string }} [opts]
 * @returns {Promise<Array<{ path: string, branch: string|null, head: string|null }>>}
 */
export async function listWorktrees({ cwd = process.cwd() } = {}) {
  const res = await git(cwd, ["worktree", "list", "--porcelain"]);
  return parsePorcelain(res.stdout);
}

/**
 * Cria um worktree em `.worktrees/<name>`, com branch nova a partir do HEAD
 * (ou de `branch`, quando informado).
 *
 * @param {{ cwd?: string, name: string, branch?: string }} opts
 * @returns {Promise<{ path: string, branch: string }>}
 */
export async function createWorktree({ cwd = process.cwd(), name, branch = null } = {}) {
  const safeName = assertNotFlag(name, "name");
  // nome não pode conter separador de caminho (travessia de diretório)
  if (/[\\/]/.test(safeName)) {
    throw new WorktreeError("invalid", 'name não pode conter separador de caminho');
  }

  const base = await git(cwd, ["rev-parse", "--show-toplevel"], { allowFail: true });
  if (!base.ok) {
    throw new WorktreeError("not-a-repo", `cwd não é repositório git: ${cwd}`);
  }
  const root = base.stdout.trim();
  const wtPath = path.join(root, WORKTREES_DIR, safeName);

  // A branch nova leva o nome do worktree; nasce do HEAD, ou de `branch`
  // quando um start-point explícito é informado.
  const branchName = safeName;
  const args = ["worktree", "add", wtPath, "-b", branchName];
  if (branch) args.push(assertNotFlag(branch, "branch"));

  const res = await git(cwd, args, { allowFail: true });
  if (!res.ok) {
    // código estável por causa provável
    let code = "git";
    if (/already exists/i.test(res.stderr)) code = "exists";
    else if (/not a git repository/i.test(res.stderr)) code = "not-a-repo";
    else if (/invalid reference|unknown revision|bad revision/i.test(res.stderr)) code = "bad-ref";
    throw new WorktreeError(code, `git worktree add falhou: ${res.stderr || "erro"}`);
  }

  return { path: wtPath, branch: branchName };
}

/**
 * Remove um worktree. `--force` é repassado quando pedido (remove mesmo com
 * alterações não commitadas ou sujo).
 *
 * @param {{ cwd?: string, path: string, force?: boolean }} opts
 * @returns {Promise<{ removed: true }>}
 */
export async function removeWorktree({ cwd = process.cwd(), path: wtPath, force = false } = {}) {
  assertNotFlag(wtPath, "path");
  const args = ["worktree", "remove"];
  if (force) args.push("--force");
  args.push(wtPath);

  const res = await git(cwd, args, { allowFail: true });
  if (!res.ok) {
    let code = "git";
    if (/is not a working tree/i.test(res.stderr)) code = "not-found";
    else if (/contains modified or untracked files/i.test(res.stderr)) code = "dirty";
    throw new WorktreeError(code, `git worktree remove falhou: ${res.stderr || "erro"}`);
  }
  return { removed: true };
}

export default { listWorktrees, createWorktree, removeWorktree, WorktreeError, WORKTREES_DIR };