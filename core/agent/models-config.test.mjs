/** models-config.test.mjs — escrita segura e operações de provider/modelo. */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const TEMP = mkdtempSync(path.join(os.tmpdir(), "selfevopi-models-"));
const FILE = path.join(TEMP, "models.json");
process.env.PI_MODELS_FILE = FILE;
const cfg = await import("./models-config.mjs");

after(() => {
  delete process.env.PI_MODELS_FILE;
  rmSync(TEMP, { recursive: true, force: true });
});

const model = (id, extra = {}) => ({ id, name: id, input: ["text"], ...extra });
function withProvider() {
  const doc = { $schema: "https://pi.dev/schemas/models.schema.json", providers: {} };
  cfg.upsertProvider(doc, { id: "gw", baseUrl: "https://gw/v1", apiKey: "SEGREDO", models: [] });
  return doc;
}

test("arquivo ausente vira config vazia", async () => {
  const doc = await cfg.readModels();
  assert.deepEqual(doc.providers, {});
});

test("upsert de provider e modelos, com merge", async () => {
  const doc = withProvider();
  cfg.upsertModels(doc, "gw", [model("a"), model("b")], { mode: "merge" });
  cfg.upsertModels(doc, "gw", [model("b", { name: "B novo" })], { mode: "merge" });
  assert.equal(doc.providers.gw.models.length, 2);
  assert.equal(doc.providers.gw.models.find((m) => m.id === "b").name, "B novo");
  assert.equal(cfg.keyInfo(doc.providers.gw.apiKey).present, true);
  assert.equal(cfg.keyInfo(doc.providers.gw.apiKey).length, 7);
});

test("writeModels faz backup e não expõe a chave no JSON de relatório", async () => {
  const doc = withProvider();
  const first = await cfg.writeModels(doc, { file: FILE, acl: false });
  assert.equal(first.backup, null);
  doc.providers.gw.name = "Gateway";
  const second = await cfg.writeModels(doc, { file: FILE, acl: false });
  assert.ok(second.backup && second.backup.includes(".bak-"));
  const raw = readFileSync(FILE, "utf8");
  assert.ok(raw.includes("SEGREDO"), "a chave fica no arquivo local, não no log");
  assert.equal(JSON.stringify(second).includes("SEGREDO"), false);
});

test("remoção seletiva e de provider", async () => {
  const doc = withProvider();
  cfg.upsertModels(doc, "gw", [model("a"), model("b")], { mode: "merge" });
  assert.equal(cfg.removeModel(doc, "gw", "a"), true);
  assert.equal(cfg.removeModel(doc, "gw", "a"), false);
  assert.deepEqual(doc.providers.gw.models.map((m) => m.id), ["b"]);
  assert.equal(cfg.removeProvider(doc, "gw"), true);
  assert.equal(cfg.removeProvider(doc, "gw"), false);
});
