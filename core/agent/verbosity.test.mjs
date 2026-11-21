/** verbosity.test.mjs — níveis de feedback da CLI. */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const TEMP = mkdtempSync(path.join(os.tmpdir(), "selfevopi-verb-"));
process.env.SELFEOPI_VERBOSITY_FILE = path.join(TEMP, "verb.json");
const savedEnv = process.env.SELFEOPI_VERBOSITY;
delete process.env.SELFEOPI_VERBOSITY;

after(() => {
  delete process.env.SELFEOPI_VERBOSITY_FILE;
  if (savedEnv === undefined) delete process.env.SELFEOPI_VERBOSITY;
  else process.env.SELFEOPI_VERBOSITY = savedEnv;
  rmSync(TEMP, { recursive: true, force: true });
});

const v = await import("./verbosity.mjs");

test("padrão é full", () => {
  assert.equal(v.DEFAULT_VERBOSITY, "full");
  assert.equal(v.getVerbosity(), "full");
  assert.deepEqual(v.LEVELS, ["minimal", "tools", "reasoning", "full", "verbose"]);
});

test("presets controlam cada parte do feedback", () => {
  assert.deepEqual(
    ["minimal", "tools", "reasoning", "full", "verbose"].map((l) => [
      v.shows("activity", l),
      v.shows("tools", l),
      v.shows("toolResult", l),
      v.shows("reasoning", l),
      v.shows("metrics", l),
    ]),
    [
      [false, false, false, false, false],
      [true, true, false, false, false],
      [true, false, false, true, false],
      [true, true, true, true, false],
      [true, true, true, true, true],
    ],
  );
});

test("aliases e validação", () => {
  assert.equal(v.normalize("off"), "minimal");
  assert.equal(v.normalize("compact"), "tools");
  assert.equal(v.normalize("ALL"), "verbose");
  assert.equal(v.normalize("nada"), null);
  assert.equal(v.setVerbosity("nada"), false);
});

test("setVerbosity persiste e vence a variável de ambiente", async () => {
  process.env.SELFEOPI_VERBOSITY = "minimal";
  assert.equal(v.getVerbosity(), "minimal");
  assert.equal(v.setVerbosity("tools"), true);
  assert.equal(v.getVerbosity(), "tools", "escolha explícita vence o env");
  const again = await import("./verbosity.mjs?again");
  assert.equal(again.getVerbosity(), "tools", "preferência persiste em disco");
  assert.match(v.describe("verbose"), /tokens/);
});
