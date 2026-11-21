/** model-metadata.test.mjs — efforts e capacidades lidos do models.json. */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const TEMP = mkdtempSync(path.join(os.tmpdir(), "selfevopi-meta-"));
const FILE = path.join(TEMP, "models.json");
writeFileSync(
  FILE,
  JSON.stringify({
    providers: {
      or1: {
        models: [
          {
            id: "baidu/ernie-5.5-flash-preview:free",
            reasoning: true,
            thinkingLevelMap: { off: null, low: null, medium: null, high: "high", xhigh: null, max: null },
            input: ["text"],
          },
          { id: "vision/model:free", input: ["text", "image"] },
          { id: "plain/model:free", input: ["text"] },
        ],
      },
    },
  }),
  "utf8",
);
process.env.PI_MODELS_FILE = FILE;

test.after(() => {
  delete process.env.PI_MODELS_FILE;
  rmSync(TEMP, { recursive: true, force: true });
});

const mod = await import("./model-metadata.mjs");

test("ERNIE 5.5 Flash expõe somente high", () => {
  assert.deepEqual(mod.effortLevelsFor("or1", "baidu/ernie-5.5-flash-preview:free"), ["high"]);
});

test("modelo sem reasoning expõe off", () => {
  assert.deepEqual(mod.effortLevelsFor("or1", "plain/model:free"), ["off"]);
});

test("modelo desconhecido devolve null", () => {
  assert.equal(mod.effortLevelsFor("or1", "nao/existe"), null);
});

test("capacidade de imagem vem de input", () => {
  assert.equal(mod.supportsImage("or1", "vision/model:free"), true);
  assert.equal(mod.supportsImage("or1", "plain/model:free"), false);
  assert.equal(mod.supportsImage("or1", "baidu/ernie-5.5-flash-preview:free"), false);
});

test("listModelMetadata não expõe chaves", () => {
  const all = mod.listModelMetadata();
  assert.equal(all.length, 3);
  assert.ok(all.every((m) => !("apiKey" in m)));
  assert.ok(all.some((m) => m.efforts.join(",") === "high"));
});
