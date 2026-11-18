import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { createArtifactRequest } from "./contract.mjs";
import { generateCli } from "./generate-cli.mjs";

async function tempDir() {
  return mkdtemp(join(tmpdir(), "forge-cli-"));
}

function node(args) {
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

const CLI_REQ = {
  goal: "detectar mudancas de arquivos",
  kind: "cli",
  inputs: { path: "arquivo ou pasta a observar" },
  outputs: { changed: "true se houve mudanca", count: "numero de mudancas" },
  permissions: ["ler arquivos"],
  forbidden: ["acessar rede", "escrever fora do diretório"],
  tests: [{ name: "smoke", command: 'node -e "process.exit(0)"' }],
};

test("gera cli.mjs, README.md e verify.mjs em tmp", async () => {
  const out = await tempDir();
  try {
    const req = createArtifactRequest(CLI_REQ);
    const res = await generateCli(req, out);
    assert.equal(res.path, out);
    assert.deepEqual(res.files, ["cli.mjs", "README.md", "verify.mjs"]);
    assert.ok(res.verifyCommand.includes("verify.mjs"));
    assert.ok(res.cliCommand.includes("cli.mjs"));

    const cli = await readFile(join(out, "cli.mjs"), "utf8");
    const readme = await readFile(join(out, "README.md"), "utf8");
    const verify = await readFile(join(out, "verify.mjs"), "utf8");
    assert.ok(cli.startsWith("#!/usr/bin/env node"));
    assert.ok(readme.includes("## Uso"));
    assert.ok(verify.includes("spawnSync"));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("CLI gerado executa e responde JSON válido", async () => {
  const out = await tempDir();
  try {
    const req = createArtifactRequest(CLI_REQ);
    const res = await generateCli(req, out);
    const cliPath = join(out, "cli.mjs");

    const r = node([cliPath, "--path", "arquivo.txt"]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const json = JSON.parse(r.stdout.trim());
    assert.equal(json.ok, true);
    assert.equal(json.inputs.path, "arquivo.txt");
    // saídas declaradas presentes (null: esqueleto honesto, sem inventar cálculo)
    assert.ok("changed" in json.outputs);
    assert.ok("count" in json.outputs);
    // JSON compacto: uma linha
    assert.equal(r.stdout.trim().split("\n").length, 1);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("CLI gerado sai 2 quando falta argumento obrigatório", async () => {
  const out = await tempDir();
  try {
    const req = createArtifactRequest(CLI_REQ);
    await generateCli(req, out);
    const cliPath = join(out, "cli.mjs");

    const r = node([cliPath]); // sem --path
    assert.equal(r.status, 2, "deve sair 2 com argumento faltando");
    const err = JSON.parse(r.stderr.trim());
    assert.equal(err.ok, false);
    assert.match(err.error, /faltando argumentos obrigatorios: path/);
    // stdout vazio (nada de JSON de sucesso)
    assert.equal(r.stdout.trim(), "");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("verify.mjs gerado reprova quando um teste falha", async () => {
  const out = await tempDir();
  try {
    const req = createArtifactRequest({
      ...CLI_REQ,
      tests: [{ name: "falha", command: 'node -e "process.exit(1)"' }],
    });
    const res = await generateCli(req, out);
    const r = spawnSync(res.verifyCommand, { shell: true, encoding: "utf8" });
    assert.notEqual(r.status, 0, "verify deve sair != 0 quando um teste falha");
    assert.match(r.stdout + (r.stderr ?? ""), /FAIL falha/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("verify.mjs gerado passa quando todos os testes passam", async () => {
  const out = await tempDir();
  try {
    const req = createArtifactRequest({
      ...CLI_REQ,
      tests: [
        { name: "ok1", command: 'node -e "process.exit(0)"' },
        { name: "ok2", command: 'node -e "process.exit(0)"' },
      ],
    });
    const res = await generateCli(req, out);
    const r = spawnSync(res.verifyCommand, { shell: true, encoding: "utf8" });
    assert.equal(r.status, 0, "verify deve sair 0 quando todos passam");
    assert.match(r.stdout, /Todos os 2 teste\(s\) passaram/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("recusa kind errado", async () => {
  const out = await tempDir();
  try {
    const req = createArtifactRequest({ ...CLI_REQ, kind: "skill" });
    await assert.rejects(generateCli(req, out), /kind deve ser "cli"/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("recusa sobrescrever cli.mjs existente", async () => {
  const out = await tempDir();
  try {
    const req = createArtifactRequest(CLI_REQ);
    await generateCli(req, out);
    await assert.rejects(generateCli(req, out), /já existe cli\.mjs/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
test("objetivo com */ nao quebra o comentario do cli gerado", async () => {
  const dir = await tempDir();
  try {
    const req = createArtifactRequest({
      goal: "detectar */ alteracoes */ suspeitas",
      kind: "cli",
      inputs: { path: "arquivo" },
      outputs: { changed: "booleano" },
      forbidden: ["acessar rede"],
      tests: [{ name: "smoke", command: "node -e \"process.exit(0)\"" }],
    });
    await generateCli(req, dir);
    // Se o comentario tivesse fechado cedo, o arquivo seria JavaScript invalido.
    const check = node(["--check", join(dir, "cli.mjs")]);
    assert.equal(check.status, 0, `cli.mjs invalido: ${check.stderr}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
