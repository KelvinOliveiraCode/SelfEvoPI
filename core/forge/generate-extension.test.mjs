import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { createArtifactRequest } from "./contract.mjs";
import { generateExtension } from "./generate-extension.mjs";

async function tempDir() {
  return mkdtemp(join(tmpdir(), "forge-extension-"));
}

const BASE = {
  goal: "registrar comando no PI",
  kind: "extension",
  inputs: { a: "primeiro", b: "segundo" },
  outputs: { soma: "resultado" },
  permissions: [],
  forbidden: ["acessar rede"],
  tests: [{ name: "smoke", command: 'node -e "process.exit(0)"' }],
};

test("extension: gera index.mjs, node --check passa e verify registra comando", async () => {
  const out = await tempDir();
  try {
    const req = createArtifactRequest(BASE);
    const res = await generateExtension(req, out);
    assert.deepEqual(res.files, ["index.mjs", "README.md", "verify.mjs"]);

    const chk = spawnSync(process.execPath, ["--check", join(out, "index.mjs")], { encoding: "utf8" });
    assert.equal(chk.status, 0, "index.mjs deve passar no node --check");

    const v = spawnSync(res.verifyCommand, { shell: true, encoding: "utf8", cwd: out });
    assert.equal(v.status, 0, v.stderr);
    assert.match(v.stdout, /PASS extension: comando/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("extension: o handler responde ok:true com as saídas", async () => {
  const out = await tempDir();
  try {
    const req = createArtifactRequest(BASE);
    await generateExtension(req, out);
    // script auxiliar importa o index.mjs (file:// no Windows) com pi falso
    const url = pathToFileURL(join(out, "index.mjs")).href;
    const probe = join(out, "__probe.mjs");
    await writeFile(
      probe,
      [
        'import mod from "' + url + '";',
        "const commands = {};",
        "const handlers = {};",
        "const pi = { on(){}, registerFlag(){}, registerCommand(n,d){ commands[n]=d; handlers[n]=d.handler; } };",
        "mod(pi);",
        "const name = Object.keys(commands)[0];",
        "const out = handlers[name]({});",
        "process.stdout.write(JSON.stringify({ name, ok: out.ok, outputs: Object.keys(out.outputs) }));",
        "",
      ].join("\n"),
      "utf8",
    );
    const r = spawnSync(process.execPath, [probe], { encoding: "utf8", cwd: out });
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.ok, true);
    assert.ok(j.outputs.includes("soma"));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("extension: recusa sobrescrever e kind errado", async () => {
  const out = await tempDir();
  try {
    const req = createArtifactRequest(BASE);
    await generateExtension(req, out);
    await assert.rejects(generateExtension(req, out), /já existe index\.mjs/);
    const bad = createArtifactRequest({ ...BASE, kind: "cli" });
    await assert.rejects(generateExtension(bad, join(out, "y")), /kind deve ser "extension"/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});