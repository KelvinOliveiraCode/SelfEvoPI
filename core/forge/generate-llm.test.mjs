import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateWithModel, buildPrompt, extractCode, checkFile, ForgeGenerationError } from "./generate-llm.mjs";
import { createArtifactRequest } from "./contract.mjs";

function req(overrides = {}) {
  return createArtifactRequest({
    goal: "somar dois numeros",
    kind: "cli",
    inputs: { a: "primeiro numero", b: "segundo numero" },
    outputs: { soma: "a + b" },
    forbidden: ["acessar rede"],
    tests: [{ name: "soma 2+2", command: 'node cli.mjs --a 2 --b 2' }],
    ...overrides,
  });
}

function tmpDir() {
  return mkdtempSync(join(tmpdir(), "selfevopi-llmgen-"));
}

const CODE_OK = [
  "const a = Number(process.argv[process.argv.indexOf('--a') + 1]);",
  "const b = Number(process.argv[process.argv.indexOf('--b') + 1]);",
  "if (!Number.isFinite(a) || !Number.isFinite(b)) {",
  "  process.exitCode = 2;",
  "  process.stdout.write(JSON.stringify({ ok: false, erro: 'faltando argumento' }) + '\\n');",
  "} else {",
  "  process.stdout.write(JSON.stringify({ ok: true, soma: a + b }) + '\\n');",
  "}",
].join("\n");

test("buildPrompt e compacto e traz contrato, proibidos e testes", () => {
  const p = buildPrompt(req());
  assert.match(p, /somar dois numeros/);
  assert.match(p, /--a <valor>/);
  assert.match(p, /acessar rede/);
  assert.match(p, /soma 2\+2/);
  assert.ok(p.length < 2_000, `prompt deve ser curto, veio ${p.length}`);
});

test("extractCode pega o bloco com fences e ignora o texto ao redor", () => {
  const text = "claro!\n```javascript\nconst x = 1\n```\npronto";
  assert.equal(extractCode(text), "const x = 1");
  assert.equal(extractCode("```\nconst y = 2\n```"), "const y = 2");
  assert.equal(extractCode("sem bloco"), "sem bloco");
});

test("checkFile aprova codigo valido e recusa quebrado", () => {
  const dir = tmpDir();
  try {
    const good = join(dir, "bom.mjs");
    const bad = join(dir, "ruim.mjs");
    writeFileSync(good, "const x = 1;\n", "utf8");
    // fim de comentário de bloco no meio do código: não faz parse
    writeFileSync(bad, "/* fim */ const x = ;\n", "utf8");
    assert.equal(checkFile({ file: good }).ok, true);
    assert.equal(checkFile({ file: bad }).ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gera cli.mjs real a partir do modelo", async () => {
  const dir = tmpDir();
  try {
    const res = await generateWithModel({
      request: req(),
      outDir: dir,
      runModel: async () => ({ text: "```javascript\n" + CODE_OK + "\n```", tokens: 321 }),
    });
    assert.deepEqual(res.files.sort(), ["README.md", "cli.mjs", "verify.mjs"]);
    assert.equal(res.tokens, 321);
    const code = readFileSync(join(dir, "cli.mjs"), "utf8");
    assert.match(code, /soma/);
    assert.ok(readFileSync(join(dir, "verify.mjs"), "utf8").includes("spawnSync"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recusa codigo que nao passa no node --check (e nao escreve verify)", async () => {
  const dir = tmpDir();
  try {
    await assert.rejects(
      () =>
        generateWithModel({
          request: req(),
          outDir: dir,
          runModel: async () => ({ text: "```\nconst = ;\n```" }),
        }),
      (err) => {
        assert.ok(err instanceof ForgeGenerationError);
        assert.equal(err.code, "syntax-error");
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resposta vazia e erro tipado, nao um artefato vazio", async () => {
  const dir = tmpDir();
  try {
    await assert.rejects(
      () => generateWithModel({ request: req(), outDir: dir, runModel: async () => ({ text: "   " }) }),
      (err) => err.code === "empty-response",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("modelo ausente (runModel lanca) nao derruba o chamador", async () => {
  const dir = tmpDir();
  try {
    await assert.rejects(
      () =>
        generateWithModel({
          request: req(),
          outDir: dir,
          runModel: async () => {
            throw new Error("rate limit");
          },
        }),
      (err) => err instanceof ForgeGenerationError && err.code === "no-model" && /rate limit/.test(err.message),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sem runModel o erro e claro", async () => {
  const dir = tmpDir();
  try {
    await assert.rejects(
      () => generateWithModel({ request: req(), outDir: dir }),
      (err) => err instanceof ForgeGenerationError && err.code === "no-model",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("o codigo gerado funciona de verdade (soma 2+2 = 4)", async () => {
  const dir = tmpDir();
  try {
    const res = await generateWithModel({
      request: req(),
      outDir: dir,
      runModel: async () => ({ text: "```javascript\n" + CODE_OK + "\n```" }),
    });
    const { spawnSync } = await import("node:child_process");
    const out = spawnSync(process.execPath, [join(dir, "cli.mjs"), "--a", "2", "--b", "2"], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(out.status, 0, out.stderr);
    const parsed = JSON.parse(out.stdout.trim());
    assert.equal(parsed.soma, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});