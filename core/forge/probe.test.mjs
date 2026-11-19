import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { renderProbe, probeTest, PRIMARY_FILE } from "./probe.mjs";
import { createArtifactRequest } from "./contract.mjs";
import { defaultGenerate } from "./loop.mjs";

function req(kind, overrides = {}) {
  return createArtifactRequest({
    goal: "validar um arquivo",
    kind,
    inputs: { arquivo: "caminho do arquivo" },
    outputs: { valido: "booleano" },
    forbidden: ["acessar rede"],
    tests: [{ name: "placeholder", command: "node -e \"process.exit(0)\"" }],
    ...overrides,
  });
}

function runProbe(dir) {
  const r = spawnSync(process.execPath, [join(dir, "probe.mjs")], { encoding: "utf8", timeout: 30_000 });
  return { status: r.status, stdout: String(r.stdout ?? "").trim(), stderr: String(r.stderr ?? "").trim() };
}

test("PRIMARY_FILE cobre os kinds que produzem codigo", () => {
  assert.equal(PRIMARY_FILE.cli, "cli.mjs");
  assert.equal(PRIMARY_FILE["mcp-server"], "server.mjs");
  assert.equal(PRIMARY_FILE.extension, "index.mjs");
});

test("probeTest aponta para a sonda, nao para o artefato", () => {
  const t = probeTest({ kind: "cli" });
  assert.equal(t.command, "node probe.mjs");
  assert.equal(t.name, "interface (cli)");
});

test("sonda de cli passa com um CLI que devolve as chaves", async () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-cli-"));
  try {
    await defaultGenerate(req("cli"), dir);
    writeFileSync(join(dir, "probe.mjs"), renderProbe(req("cli")), "utf8");
    const r = runProbe(dir);
    assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sonda de cli reprova quando falta uma chave declarada", async () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-cli-bad-"));
  try {
    // CLI que responde JSON sem a chave "valido"
    writeFileSync(join(dir, "cli.mjs"), 'console.log(JSON.stringify({ ok: true }))\n', "utf8");
    const r2 = req("cli", { outputs: { valido: "booleano" } });
    writeFileSync(join(dir, "probe.mjs"), renderProbe(r2), "utf8");
    const r = runProbe(dir);
    assert.equal(r.status, 1, "sem a chave, a sonda reprova");
    assert.match(r.stderr, /faltando chave/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sonda de mcp-server fala JSON-RPC, nao flags", async () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-mcp-"));
  try {
    await defaultGenerate(req("mcp-server"), dir);
    writeFileSync(join(dir, "probe.mjs"), renderProbe(req("mcp-server")), "utf8");
    const r = runProbe(dir);
    assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sonda de extension importa com pi falso e chama o handler", async () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-ext-"));
  try {
    await defaultGenerate(req("extension"), dir);
    writeFileSync(join(dir, "probe.mjs"), renderProbe(req("extension")), "utf8");
    const r = runProbe(dir);
    assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`);
    assert.match(r.stdout, /comando .* respondeu/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sonda de cli cria fixture para entrada que e caminho", async () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-fixture-"));
  try {
    // CLI que le o arquivo e diz quantas linhas viu
    writeFileSync(
      join(dir, "cli.mjs"),
      [
        "import { readFileSync } from 'node:fs';",
        "const i = process.argv.indexOf('--arquivo');",
        "const n = readFileSync(process.argv[i + 1], 'utf8').trim().split('\\n').length;",
        "console.log(JSON.stringify({ linhas: n }));",
        "",
      ].join("\n"),
      "utf8",
    );
    const r2 = req("cli", { outputs: { linhas: "numero de linhas" } });
    writeFileSync(join(dir, "probe.mjs"), renderProbe(r2), "utf8");
    const r = runProbe(dir);
    assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a sonda e um arquivo independente do diretorio de chamada", async () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-cwd-"));
  try {
    await defaultGenerate(req("cli"), dir);
    writeFileSync(join(dir, "probe.mjs"), renderProbe(req("cli")), "utf8");
    // roda de um cwd diferente: a sonda tem que se virar sozinha
    const r = spawnSync(process.execPath, [join(dir, "probe.mjs")], {
      encoding: "utf8",
      cwd: tmpdir(),
      timeout: 30_000,
    });
    assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});