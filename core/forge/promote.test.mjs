import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { promoteArtifact } from "./promote.mjs";
import { git } from "../governance/rollback.mjs";

/** Cria um repositório git real com um commit inicial. */
function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "selfevopi-promote-"));
  git(dir, ["init", "-q"], { allowFail: true });
  git(dir, ["config", "user.email", "teste@selfevopi.local"], { allowFail: true });
  git(dir, ["config", "user.name", "SelfEvoPI Teste"], { allowFail: true });
  writeFileSync(join(dir, "README.md"), "# repo de teste\n", "utf8");
  git(dir, ["add", "-A"], { allowFail: true });
  git(dir, ["commit", "-q", "-m", "commit inicial"], { allowFail: true });
  return dir;
}

/** Cria um diretório de artefato com um arquivo dentro. */
function tempArtifact(files = { "cli.mjs": "process.exit(0)\n" }) {
  const dir = mkdtempSync(join(tmpdir(), "selfevopi-artifact-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf8");
  }
  return dir;
}

test("promove copia o artefato e cria o commit", async () => {
  const repo = tempRepo();
  const artifact = tempArtifact();
  try {
    const res = await promoteArtifact({ artifactDir: artifact, taskId: "D1-cria-soma", repoRoot: repo, commit: true });
    assert.equal(res.ok, true, JSON.stringify(res.reasons));
    assert.ok(res.path, "deve devolver o caminho de destino");
    assert.ok(existsSync(join(res.path, "cli.mjs")), "arquivo copiado");
    assert.ok(res.commit, "deve devolver o sha do commit");

    const log = git(repo, ["log", "--oneline"], { allowFail: true }).stdout;
    assert.match(log, /evo\(D1-cria-soma\)/, "assunto do commit cita a tarefa");
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(artifact, { recursive: true, force: true });
  }
});

test("sem verify() promove mas NAO grava last-known-good", async () => {
  const repo = tempRepo();
  const artifact = tempArtifact();
  try {
    const res = await promoteArtifact({
      artifactDir: artifact,
      taskId: "D2-corrige-contador",
      repoRoot: repo,
      commit: true,
      checkpoint: true,
      // sem verify
    });
    assert.equal(res.ok, true);
    assert.equal(res.checkpointed, false, "não pode gravar estado verde sem evidência");
    assert.ok(
      res.reasons?.some((r) => r.includes("sem verify")),
      `deve explicar por que não gravou: ${JSON.stringify(res.reasons)}`,
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(artifact, { recursive: true, force: true });
  }
});

test("verify() vermelho promove o arquivo mas nao grava last-known-good", async () => {
  const repo = tempRepo();
  const artifact = tempArtifact();
  const lkg = join(repo, ".pi", "harness", "last-known-good.json");
  try {
    const res = await promoteArtifact({
      artifactDir: artifact,
      taskId: "B1-providers-present",
      repoRoot: repo,
      commit: true,
      verify: async () => ({ ok: false, error: "evals reprovaram" }),
    });
    assert.equal(res.ok, true, "o artefato em si foi copiado");
    assert.equal(res.checkpointed, false);
    assert.ok(res.reasons?.some((r) => r.includes("checkpoint falhou")), JSON.stringify(res.reasons));
    assert.equal(existsSync(lkg), false, "last-known-good nao pode existir");
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(artifact, { recursive: true, force: true });
  }
});

test("verify() verde grava last-known-good com o sha do commit", async () => {
  const repo = tempRepo();
  const artifact = tempArtifact();
  try {
    const res = await promoteArtifact({
      artifactDir: artifact,
      taskId: "C1-gitignore-secrets",
      repoRoot: repo,
      commit: true,
      verify: async () => true,
    });
    assert.equal(res.checkpointed, true, JSON.stringify(res.reasons));
    const lkg = JSON.parse(readFileSync(join(repo, ".pi", "harness", "last-known-good.json"), "utf8"));
    assert.equal(lkg.sha, res.commit, "o checkpoint aponta para o commit do artefato");
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(artifact, { recursive: true, force: true });
  }
});

test("diretorio vazio nao e promovido", async () => {
  const repo = tempRepo();
  const artifact = mkdtempSync(join(tmpdir(), "selfevopi-vazio-"));
  try {
    const res = await promoteArtifact({ artifactDir: artifact, taskId: "X", repoRoot: repo });
    assert.equal(res.ok, false);
    assert.match(res.reasons[0], /vazio/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(artifact, { recursive: true, force: true });
  }
});

test("taskId comecando com '-' nao vira flag nem nome de arquivo", async () => {
  const repo = tempRepo();
  const artifact = tempArtifact();
  try {
    const res = await promoteArtifact({ artifactDir: artifact, taskId: "--ambicioso", repoRoot: repo, commit: false });
    assert.equal(res.ok, true, JSON.stringify(res.reasons));
    assert.ok(!res.path.includes("--ambicioso"), "nao pode usar o taskId cru como nome");
    assert.ok(res.path.includes("sem-tarefa"), `deve cair no nome seguro: ${res.path}`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(artifact, { recursive: true, force: true });
  }
});

test("promove e registra o artefato na memoria (nivel skills)", async () => {
  const repo = tempRepo();
  const artifact = tempArtifact();
  const memoryDir = mkdtempSync(join(tmpdir(), "selfevopi-mem-"));
  try {
    const res = await promoteArtifact({
      artifactDir: artifact,
      taskId: "D1-cria-soma",
      repoRoot: repo,
      commit: false,
      checkpoint: false,
      memoryRoot: memoryDir,
      request: { goal: "criar um somador", kind: "cli" },
    });
    assert.equal(res.ok, true, JSON.stringify(res.reasons));
    assert.equal(res.registered?.registered, true, JSON.stringify(res.registered));

    const { openStore } = await import("../memory/store.mjs");
    const store = openStore({ root: memoryDir });
    const skills = store.query({ level: "skills" });
    assert.equal(skills.length, 1);
    assert.match(skills[0].text, /criar um somador/);
    assert.ok(skills[0].tags.includes("artefato"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(artifact, { recursive: true, force: true });
    rmSync(memoryDir, { recursive: true, force: true });
  }
});

test("registrar duas vezes nao duplica (idempotente)", async () => {
  const repo = tempRepo();
  const memoryDir = mkdtempSync(join(tmpdir(), "selfevopi-mem-"));
  try {
    for (let i = 0; i < 2; i++) {
      const artifact = tempArtifact();
      const res = await promoteArtifact({
        artifactDir: artifact,
        taskId: "B1-providers-present",
        repoRoot: repo,
        commit: false,
        checkpoint: false,
        memoryRoot: memoryDir,
      });
      assert.equal(res.ok, true, JSON.stringify(res.reasons));
      rmSync(artifact, { recursive: true, force: true });
    }
    const { openStore } = await import("../memory/store.mjs");
    const skills = openStore({ root: memoryDir }).query({ level: "skills" });
    assert.equal(skills.length, 1, "segunda promocao nao pode duplicar a entrada");
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(memoryDir, { recursive: true, force: true });
  }
});

test("sem registro a promocao continua funcionando (register:false)", async () => {
  const repo = tempRepo();
  const artifact = tempArtifact();
  try {
    const res = await promoteArtifact({
      artifactDir: artifact,
      taskId: "A1-router-reviewer",
      repoRoot: repo,
      commit: false,
      checkpoint: false,
      register: false,
    });
    assert.equal(res.ok, true, JSON.stringify(res.reasons));
    assert.equal(res.registered, null);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(artifact, { recursive: true, force: true });
  }
});

test("artefato com subdiretorios e copiado inteiro", async () => {
  const repo = tempRepo();
  const artifact = tempArtifact();
  mkdirSync(join(artifact, "lib"), { recursive: true });
  writeFileSync(join(artifact, "lib", "helper.mjs"), "export const x = 1\n", "utf8");
  try {
    const res = await promoteArtifact({ artifactDir: artifact, taskId: "A1-router-reviewer", repoRoot: repo, commit: false });
    assert.equal(res.ok, true, JSON.stringify(res.reasons));
    assert.ok(existsSync(join(res.path, "lib", "helper.mjs")), "subdiretorio copiado");
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(artifact, { recursive: true, force: true });
  }
});

test("segunda promocao do mesmo conteudo nao falha: registra 'nada a registrar'", async () => {
  const repo = tempRepo();
  const artifact = tempArtifact({ "cli.mjs": "// conteudo\n" });
  try {
    const first = await promoteArtifact({ artifactDir: artifact, taskId: "D2", repoRoot: repo, commit: true, checkpoint: false });
    assert.equal(first.ok, true);

    // copia o conteudo promovido de volta para um novo artifacto identico
    const again = tempArtifact({ "cli.mjs": "// conteudo\n" });
    const second = await promoteArtifact({
      artifactDir: again,
      taskId: "D2",
      repoRoot: repo,
      commit: true,
      checkpoint: false,
      artifactsRoot: first.path.replace(/-[^-]+$/, ""), // mesmo destino-base, nome novo
    });
    assert.equal(second.ok, true, "repetir nao pode derrubar o loop");
    rmSync(again, { recursive: true, force: true });
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(artifact, { recursive: true, force: true });
  }
});

test("re-promover a mesma tarefa atualiza o destino na memoria (nao duplica)", async () => {
  const repo = tempRepo();
  const memoryDir = mkdtempSync(join(tmpdir(), "selfevopi-mem-"));
  try {
    const a1 = tempArtifact({ "cli.mjs": "// v1\n" });
    const r1 = await promoteArtifact({
      artifactDir: a1, taskId: "B2-atualiza", repoRoot: repo,
      commit: false, checkpoint: false, memoryRoot: memoryDir,
    });
    assert.equal(r1.ok, true, JSON.stringify(r1.reasons));
    rmSync(a1, { recursive: true, force: true });

    const a2 = tempArtifact({ "cli.mjs": "// v2\n" });
    const r2 = await promoteArtifact({
      artifactDir: a2, taskId: "B2-atualiza", repoRoot: repo,
      commit: false, checkpoint: false, memoryRoot: memoryDir,
    });
    assert.equal(r2.ok, true, JSON.stringify(r2.reasons));
    rmSync(a2, { recursive: true, force: true });

    const { openStore } = await import("../memory/store.mjs");
    const skills = openStore({ root: memoryDir }).query({ level: "skills" });
    assert.equal(skills.length, 1, "uma entrada por tarefa (nao duplica)");
    const destSeg = String(r2.path).split(/[\\/]/).pop();
    assert.ok(destSeg && skills[0].text.includes(destSeg), "memoria deve apontar para o artefato mais recente");
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(memoryDir, { recursive: true, force: true });
  }
});