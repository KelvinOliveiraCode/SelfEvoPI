import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { createArtifactRequest } from "./contract.mjs";
import { generateSkill } from "./generate-skill.mjs";

async function tempDir() {
  return mkdtemp(join(tmpdir(), "forge-skill-"));
}

const SKILL_REQ = {
  goal: "detectar mudanças de arquivos",
  kind: "skill",
  inputs: { path: "arquivo ou pasta a observar" },
  outputs: { changed: "true se houve mudança" },
  permissions: ["ler arquivos"],
  forbidden: ["acessar rede", "escrever fora do diretório"],
  tests: [
    { name: "smoke", command: "node -e \"process.exit(0)\"" },
  ],
};

test("gera SKILL.md e verify.mjs em diretório temporário", async () => {
  const out = await tempDir();
  try {
    const req = createArtifactRequest(SKILL_REQ);
    const res = await generateSkill(req, out);
    assert.equal(res.path, out);
    assert.deepEqual(res.files, ["SKILL.md", "verify.mjs"]);
    assert.ok(res.verifyCommand.includes("verify.mjs"));

    const skill = await readFile(join(out, "SKILL.md"), "utf8");
    const verify = await readFile(join(out, "verify.mjs"), "utf8");
    assert.ok(skill.length > 0);
    assert.ok(verify.length > 0);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("conteúdo obrigatório está presente no SKILL.md", async () => {
  const out = await tempDir();
  try {
    const req = createArtifactRequest(SKILL_REQ);
    await generateSkill(req, out);
    const skill = await readFile(join(out, "SKILL.md"), "utf8");

    // frontmatter
    assert.match(skill, /^---\n/);
    assert.match(skill, /name: detectar-mudancas-de-arquivos/);
    assert.match(skill, /description: /);
    // objetivo
    assert.match(skill, /## Objetivo/);
    assert.ok(skill.includes(SKILL_REQ.goal));
    // entradas e saidas
    assert.match(skill, /## Entradas/);
    assert.match(skill, /## Saídas/);
    assert.ok(skill.includes("path"));
    assert.ok(skill.includes("changed"));
    // o que NAO pode fazer (forbidden, nao-vazio)
    assert.match(skill, /## O que NÃO pode fazer/);
    assert.ok(skill.includes("acessar rede"));
    assert.ok(skill.includes("escrever fora do diretório"));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("recusa kind errado", async () => {
  const out = await tempDir();
  try {
    const req = createArtifactRequest({ ...SKILL_REQ, kind: "cli" });
    await assert.rejects(generateSkill(req, out), /kind deve ser "skill"/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("recusa sobrescrever SKILL.md existente", async () => {
  const out = await tempDir();
  try {
    const req = createArtifactRequest(SKILL_REQ);
    await generateSkill(req, out);
    await assert.rejects(generateSkill(req, out), /já existe SKILL\.md/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("verify.mjs gerado executa e reprova quando um teste falha", async () => {
  const out = await tempDir();
  try {
    // teste que falha de propósito (exit 1)
    const req = createArtifactRequest({
      ...SKILL_REQ,
      tests: [{ name: "falha", command: "node -e \"process.exit(1)\"" }],
    });
    const res = await generateSkill(req, out);

    const r = spawnSync(res.verifyCommand, { shell: true, encoding: "utf8" });
    assert.notEqual(r.status, 0, "verify deve sair != 0 quando um teste falha");
    assert.match(r.stdout + (r.stderr ?? ""), /FAIL falha/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("verify.mjs gerado executa e passa quando todos os testes passam", async () => {
  const out = await tempDir();
  try {
    const req = createArtifactRequest({
      ...SKILL_REQ,
      tests: [
        { name: "ok1", command: "node -e \"process.exit(0)\"" },
        { name: "ok2", command: "node -e \"process.exit(0)\"" },
      ],
    });
    const res = await generateSkill(req, out);
    const r = spawnSync(res.verifyCommand, { shell: true, encoding: "utf8" });
    assert.equal(r.status, 0, "verify deve sair 0 quando todos passam");
    assert.match(r.stdout, /Todos os 2 teste\(s\) passaram/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});