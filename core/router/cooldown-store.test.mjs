import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readCooldown, writeCooldown, normalizarEntradas } from "./cooldown-store.mjs";

test("normalizarEntradas aceita refs simples e descarta lixo", () => {
  const agora = 90_000_000;
  const mapa = normalizarEntradas({
    "kilo1/modelo:free": agora - 1_000,
    "or1/x": "abc",
    "chave\nestrada": agora - 1_000,
    "velho/modelo": 1,
  }, { now: agora });
  assert.equal(mapa.get("kilo1/modelo:free"), agora - 1_000);
  assert.equal(mapa.has("or1/x"), false);
  assert.equal(mapa.has("chave\nestrada"), false);
  assert.equal(mapa.has("velho/modelo"), false);
});

test("normalizarEntradas lê tanto {refs} quanto mapa plano", () => {
  const mapa = normalizarEntradas({ refs: { "a/b": 100 } }, { now: 200 });
  assert.equal(mapa.get("a/b"), 100);
});

test("readCooldown com arquivo ausente ou quebrado devolve vazio", async () => {
  const dir = mkdtempSync(join(tmpdir(), "se-cd-"));
  try {
    assert.equal((await readCooldown(join(dir, "nao-existe.json"))).size, 0);
    const quebrado = join(dir, "quebrado.json");
    writeFileSync(quebrado, "{ quebrado", "utf8");
    assert.equal((await readCooldown(quebrado)).size, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("writeCooldown + readCooldown preservam refs e expiram velhos", async () => {
  const dir = mkdtempSync(join(tmpdir(), "se-cd-"));
  const arquivo = join(dir, "sub", "model-cooldown.json");
  try {
    const agora = 90_000_000;
    assert.equal(await writeCooldown(arquivo, new Map([["kilo1/x", agora - 100], ["or1/y", 100]]), { now: agora }), true);
    const lido = await readCooldown(arquivo, { now: agora });
    assert.equal(lido.get("kilo1/x"), agora - 100);
    assert.equal(lido.has("or1/y"), false, "entrada com mais de 1 dia some");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("writeCooldown não grava chaves redigidas nem quebras", async () => {
  const dir = mkdtempSync(join(tmpdir(), "se-cd-"));
  const arquivo = join(dir, "cd.json");
  try {
    await writeCooldown(arquivo, new Map([["apiKey=segredo", 100], ["ok/ref", 200]]), { now: 300 });
    const texto = readFileSync(arquivo, "utf8");
    assert.ok(!texto.includes("segredo"));
    assert.equal((await readCooldown(arquivo, { now: 300 })).size, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
