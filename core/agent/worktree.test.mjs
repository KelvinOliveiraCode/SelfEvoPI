import test from "node:test";
import assert from "node:assert/strict";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import {
  listWorktrees,
  createWorktree,
  removeWorktree,
  WorktreeError,
  WORKTREES_DIR,
} from "./worktree.mjs";

/* ------------------------------------------------------------------ */
/* Fixture: repo git real no tmp                                       */
/* ------------------------------------------------------------------ */

const repos = [];

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  }).trim();
}

/** Cria um repo com um commit e devolve a raiz. */
async function novoRepo() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "selfevopi-worktree-"));
  repos.push(dir);
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "teste@selfevopi"]);
  git(dir, ["config", "user.name", "Teste"]);
  await writeFile(path.join(dir, "README.md"), "# teste\n", "utf8");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "commit inicial"]);
  return dir;
}

test.after(() => {
  for (const d of repos) rm(d, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/* listWorktrees                                                       */
/* ------------------------------------------------------------------ */

test("listWorktrees devolve o worktree principal com branch e head", async () => {
  const repo = await novoRepo();
  const lista = await listWorktrees({ cwd: repo });

  assert.ok(Array.isArray(lista));
  assert.equal(lista.length, 1);
  const [wt] = lista;
  // git --porcelain normaliza o path para barra normal, independente do SO
  assert.equal(wt.path.replace(/\//g, "\\"), repo);
  assert.ok(typeof wt.head === "string" && wt.head.length >= 7);
  // branch pode ser "main" ou "master" dependendo do git default
  assert.ok(wt.branch === "main" || wt.branch === "master", `branch=${wt.branch}`);
});

/* ------------------------------------------------------------------ */
/* createWorktree                                                      */
/* ------------------------------------------------------------------ */

test("createWorktree cria em .worktrees/<name>, com branch nova", async () => {
  const repo = await novoRepo();
  const { path: wtPath, branch } = await createWorktree({ cwd: repo, name: "f0-test" });

  assert.equal(branch, "f0-test");
  assert.ok(wtPath.endsWith(path.join(WORKTREES_DIR, "f0-test")));
  assert.ok(existsSync(wtPath), "diretório do worktree existe");

  // aparece na listagem
  const lista = await listWorktrees({ cwd: repo });
  assert.ok(lista.some((w) => w.branch === "f0-test"), "branch nova listada");
});

test("createWorktree recusa nome que começa com '-' (não vira flag)", async () => {
  const repo = await novoRepo();
  await assert.rejects(
    () => createWorktree({ cwd: repo, name: "-dangerous" }),
    (err) => err instanceof WorktreeError && err.code === "invalid",
  );
});

test("createWorktree recusa nome com separador de caminho", async () => {
  const repo = await novoRepo();
  await assert.rejects(
    () => createWorktree({ cwd: repo, name: "a/b" }),
    (err) => err instanceof WorktreeError && err.code === "invalid",
  );
});

test("createWorktree fora de um repositório dá not-a-repo", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "selfevopi-worktree-naorepo-"));
  repos.push(dir);
  await assert.rejects(
    () => createWorktree({ cwd: dir, name: "x" }),
    (err) => err instanceof WorktreeError && err.code === "not-a-repo",
  );
});

/* ------------------------------------------------------------------ */
/* removeWorktree                                                      */
/* ------------------------------------------------------------------ */

test("removeWorktree remove o worktree criado", async () => {
  const repo = await novoRepo();
  const { path: wtPath } = await createWorktree({ cwd: repo, name: "rm-me" });
  assert.ok(existsSync(wtPath));

  const res = await removeWorktree({ cwd: repo, path: wtPath });
  assert.equal(res.removed, true);
  assert.equal(existsSync(wtPath), false, "diretório removido");

  const lista = await listWorktrees({ cwd: repo });
  assert.ok(!lista.some((w) => w.branch === "rm-me"), "branch não listada depois de remover");
});

test("removeWorktree com --force remove worktree sujo", async () => {
  const repo = await novoRepo();
  const { path: wtPath } = await createWorktree({ cwd: repo, name: "sujo" });
  // cria arquivo não rastreado para sujar
  await writeFile(path.join(wtPath, "lixo.txt"), "sujo\n", "utf8");

  const res = await removeWorktree({ cwd: repo, path: wtPath, force: true });
  assert.equal(res.removed, true);
  assert.equal(existsSync(wtPath), false);
});

test("removeWorktree em worktree inexistente dá erro tipado", async () => {
  const repo = await novoRepo();
  const fake = path.join(repo, WORKTREES_DIR, "nao-existe");
  await assert.rejects(
    () => removeWorktree({ cwd: repo, path: fake }),
    (err) => err instanceof WorktreeError,
  );
});