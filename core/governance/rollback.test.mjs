import test, { after } from "node:test";
import assert from "node:assert/strict";

import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { rollbackAndVerify, checkpointGood, readLkg, git, headSha } from "./rollback.mjs";

/* ------------------------------------------------------------------ */
/* Repositórios descartáveis                                           */
/* ------------------------------------------------------------------ */

const repos = [];

/** Cria repo git real com identidade local (não depende da config global). */
async function makeRepo() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "selfevopi-gov-"));
  repos.push(dir);
  const g = (args, opts) => git(dir, args, { allowFail: true, ...opts });
  g(["init", "-q"]);
  g(["config", "user.email", "gov@selfevopi.local"]);
  g(["config", "user.name", "SelfEvoPI Governance"]);
  g(["config", "commit.gpgsign", "false"]);
  // determinismo: sem normalização de fim de linha, o que foi escrito é o que volta
  g(["config", "core.autocrlf", "false"]);
  g(["config", "core.eol", "lf"]);
  return { dir, g };
}

async function commit(g, dir, message, files) {
  for (const [name, body] of Object.entries(files)) {
    await writeFile(path.join(dir, name), body, "utf8");
  }
  const add = g(["add", "-A"]);
  assert.equal(add.ok, true, `git add falhou: ${add.stderr}`);
  const c = g(["commit", "-q", "-m", message]);
  assert.equal(c.ok, true, `git commit falhou: ${c.stderr}`);
  return g(["rev-parse", "HEAD"]).stdout;
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

after(async () => {
  for (const dir of repos) await rm(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/* Caminho feliz                                                       */
/* ------------------------------------------------------------------ */

test("revert remove só o segundo commit e confirma com verify", async () => {
  const { dir, g } = await makeRepo();
  await commit(g, dir, "primeiro", { "arquivo.txt": "conteudo 1\n" });
  const sha2 = await commit(g, dir, "segundo", {
    "arquivo.txt": "conteudo 2\n",
    "novo.txt": "arquivo novo\n",
  });

  const r = await rollbackAndVerify({
    repoRoot: dir,
    ref: sha2,
    verify: () => true,
    createTag: true,
  });

  assert.equal(r.ok, true, `ok=${r.ok} erro=${r.error}`);
  assert.equal(r.reverted, true);
  assert.equal(r.verified, true);
  assert.ok(r.tag && r.tag.startsWith("ckpt/pre-revert-"), `tag=${r.tag}`);

  // só o segundo commit foi desfeito
  assert.equal(await readFile(path.join(dir, "arquivo.txt"), "utf8"), "conteudo 1\n");
  assert.equal(await exists(path.join(dir, "novo.txt")), false, "novo.txt deveria ter sumido");

  const log = g(["log", "--oneline"]).stdout.split("\n");
  assert.equal(log.length, 3, `esperava 3 commits (1, 2, revert), veio ${log.length}`);
  assert.match(log[0], /^[0-9a-f]+ Revert/i, `esperava um commit de reversão, veio: ${log[0]}`);

  // a tag de backup aponta para o HEAD de antes do revert
  const tagSha = g(["rev-list", "-n", "1", r.tag]).stdout;
  assert.equal(tagSha, sha2, "a tag de backup tem de apontar para o commit revertido");
});

test("rollback com verify verde grava o last-known-good", async () => {
  const { dir, g } = await makeRepo();
  await commit(g, dir, "primeiro", { "arquivo.txt": "1\n" });
  const sha2 = await commit(g, dir, "segundo", { "arquivo.txt": "2\n" });

  const r = await rollbackAndVerify({ repoRoot: dir, ref: sha2, verify: () => true, createTag: false });

  const lkg = await readLkg({ repoRoot: dir });
  assert.equal(r.ok, true, r.error);
  assert.ok(lkg, "last-known-good deveria existir");
  assert.equal(lkg.sha, r.sha);
  assert.equal(lkg.label, `revert ${sha2}`);
  assert.equal(lkg.checks[0].name, "rollback-verified");
});

/* ------------------------------------------------------------------ */
/* Caminho negativo: verify falha                                      */
/* ------------------------------------------------------------------ */

test("verify que falha devolve ok:false e NÃO sobrescreve o last-known-good", async () => {
  const { dir, g } = await makeRepo();
  await commit(g, dir, "primeiro", { "arquivo.txt": "1\n" });
  const sha2 = await commit(g, dir, "segundo", { "arquivo.txt": "2\n" });

  // estado verde conhecido, gravado por um checkpoint que passa
  const ck = await checkpointGood({ repoRoot: dir, verify: () => true, label: "estado-green" });
  assert.equal(ck.ok, true, ck.error);
  const antes = await readFile(path.join(dir, ".pi", "harness", "last-known-good.json"), "utf8");

  const r = await rollbackAndVerify({
    repoRoot: dir,
    ref: sha2,
    verify: () => ({ ok: false, error: "suíte vermelha depois do revert" }),
    createTag: false,
  });

  assert.equal(r.ok, false);
  assert.equal(r.reverted, true, "o revert aconteceu");
  assert.equal(r.verified, false);
  assert.match(r.error, /suíte vermelha/);

  const depois = await readFile(path.join(dir, ".pi", "harness", "last-known-good.json"), "utf8");
  assert.equal(depois, antes, "last-known-good não pode ser tocado quando verify falha");
});

test("verify que lança também conta como falha", async () => {
  const { dir, g } = await makeRepo();
  await commit(g, dir, "primeiro", { "arquivo.txt": "1\n" });
  const sha2 = await commit(g, dir, "segundo", { "arquivo.txt": "2\n" });

  const r = await rollbackAndVerify({
    repoRoot: dir,
    ref: sha2,
    verify: () => {
      throw new Error("boom");
    },
    createTag: false,
    checkpoint: false,
  });

  assert.equal(r.ok, false);
  assert.equal(r.verified, false);
  assert.match(r.error, /boom/);
});

/* ------------------------------------------------------------------ */
/* Caminho negativo: revert não acontece                               */
/* ------------------------------------------------------------------ */

test("referência inexistente falha sem tocar na árvore", async () => {
  const { dir, g } = await makeRepo();
  await commit(g, dir, "primeiro", { "arquivo.txt": "1\n" });
  const head = g(["rev-parse", "HEAD"]).stdout;

  const r = await rollbackAndVerify({ repoRoot: dir, ref: "nao-existe-123", verify: () => true });

  assert.equal(r.ok, false);
  assert.equal(r.reverted, false);
  assert.match(r.error, /referência não encontrada/);
  assert.equal(g(["rev-parse", "HEAD"]).stdout, head, "HEAD não mudou");
});

test("ref que começa com '-' é recusado antes de virar flag", async () => {
  const { dir } = await makeRepo();
  const r = await rollbackAndVerify({ repoRoot: dir, ref: "--hard", verify: () => true });
  assert.equal(r.ok, false);
  assert.match(r.error, /inválido/);
});

test("revert com conflito é abortado e deixa a árvore limpa", async () => {
  const { dir, g } = await makeRepo();
  await commit(g, dir, "primeiro", { "arquivo.txt": "linha 1\n" });
  const sha2 = await commit(g, dir, "segundo", { "arquivo.txt": "linha 2\n" });
  await commit(g, dir, "terceiro", { "arquivo.txt": "linha 3\n" }); // toca na mesma linha

  const r = await rollbackAndVerify({ repoRoot: dir, ref: sha2, verify: () => true, createTag: false });

  assert.equal(r.ok, false);
  assert.equal(r.reverted, false, "revert com conflito não é revert");
  assert.match(r.error, /git revert falhou/);
  assert.equal(g(["status", "--porcelain"]).stdout, "", "árvore tem de estar limpa (revert abortado)");
});

test("fora de um repositório git devolve erro honesto", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "selfevopi-naogit-"));
  repos.push(dir);
  const r = await rollbackAndVerify({ repoRoot: dir, ref: "HEAD", verify: () => true });
  assert.equal(r.ok, false);
  assert.match(r.error, /não é repositório git/);
});

/* ------------------------------------------------------------------ */
/* checkpointGood                                                      */
/* ------------------------------------------------------------------ */

test("checkpointGood só grava quando verify passa", async () => {
  const { dir, g } = await makeRepo();
  const sha = await commit(g, dir, "primeiro", { "arquivo.txt": "1\n" });

  const ruim = await checkpointGood({ repoRoot: dir, verify: () => false, label: "vermelho" });
  assert.equal(ruim.ok, false);
  assert.equal(ruim.verified, false);
  assert.equal(await exists(path.join(dir, ".pi", "harness", "last-known-good.json")), false);

  const bom = await checkpointGood({
    repoRoot: dir,
    verify: () => true,
    label: "verde",
    checks: [{ name: "unit-tests", command: "node --test", result: "pass", detail: "1 teste" }],
  });
  assert.equal(bom.ok, true);
  assert.equal(bom.sha, sha.slice(0, 7));
  assert.equal(bom.file, path.join(dir, ".pi", "harness", "last-known-good.json"));

  const lkg = JSON.parse(await readFile(bom.file, "utf8"));
  assert.equal(lkg.version, 1);
  assert.equal(lkg.sha, sha.slice(0, 7));
  assert.equal(lkg.branch, g(["rev-parse", "--abbrev-ref", "HEAD"]).stdout);
  assert.match(lkg.verifiedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(lkg.label, "verde");
  assert.equal(lkg.checks[0].name, "unit-tests");
});

test("checkpointGood aceita verify assíncrono", async () => {
  const { dir, g } = await makeRepo();
  await commit(g, dir, "primeiro", { "arquivo.txt": "1\n" });
  const r = await checkpointGood({ repoRoot: dir, verify: async () => ({ ok: true }), label: "async" });
  assert.equal(r.ok, true);
  assert.equal(r.verified, true);
});

test("checkpointGood não inventa sucesso para resposta ambígua", async () => {
  const { dir, g } = await makeRepo();
  await commit(g, dir, "primeiro", { "arquivo.txt": "1\n" });
  const r = await checkpointGood({ repoRoot: dir, verify: () => ({ status: "ok" }), label: "ambiguo" });
  assert.equal(r.ok, false, "objeto sem ok/pass/success não é sucesso");
});

test("headSha e git devolvem o que o repositório aponta", async () => {
  const { dir, g } = await makeRepo();
  const sha = await commit(g, dir, "primeiro", { "arquivo.txt": "1\n" });
  assert.equal(headSha(dir), sha);
  assert.equal(git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]).ok, true);
});