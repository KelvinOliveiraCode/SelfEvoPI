import test from "node:test";
import assert from "node:assert/strict";

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  listCustomThemes,
  getCustomTheme,
  saveCustomTheme,
  clearCustomTheme,
  mergeColors,
  CUSTOM_ROLES,
  GENERAL_ROLES,
} from "./theme-custom.mjs";

/* ------------------------------------------------------------------ */
/* Fixture: home temporário (cada teste isolado)                        */
/* ------------------------------------------------------------------ */

const homes = [];

async function novoHome() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "selfevopi-theme-"));
  homes.push(dir);
  return dir;
}

test.after(() => {
  for (const h of homes) rm(h, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/* Slots vazios                                                        */
/* ------------------------------------------------------------------ */

test("sem arquivo: listCustomThemes devolve 3 slots nulos", async () => {
  const home = await novoHome();
  const lista = await listCustomThemes({ home });
  assert.equal(lista.length, 3);
  assert.deepEqual(
    lista.map((s) => ({ slot: s.slot, name: s.name })),
    [
      { slot: 1, name: null },
      { slot: 2, name: null },
      { slot: 3, name: null },
    ],
  );
});

test("getCustomTheme em slot vazio devolve null", async () => {
  const home = await novoHome();
  assert.equal(await getCustomTheme(1, { home }), null);
});

/* ------------------------------------------------------------------ */
/* Salvar e ler                                                        */
/* ------------------------------------------------------------------ */

test("salva slot 1 e lê de volta", async () => {
  const home = await novoHome();
  const saved = await saveCustomTheme(1, { name: "Meu Tema", colors: { fg: "#112233", accent: "#aabbcc" } }, { home });
  assert.equal(saved.slot, 1);
  assert.equal(saved.name, "Meu Tema");

  const got = await getCustomTheme(1, { home });
  assert.ok(got);
  assert.equal(got.name, "Meu Tema");
  assert.equal(got.colors.fg, "#112233");
  assert.equal(got.colors.accent, "#aabbcc");

  const lista = await listCustomThemes({ home });
  assert.equal(lista[0].name, "Meu Tema");
  assert.equal(lista[1].name, null);
});

test("merge parcial preserva outras cores", async () => {
  const home = await novoHome();
  await saveCustomTheme(1, { name: "T", colors: { fg: "#111111", accent: "#222222", ok: "#00ff00" } }, { home });
  // atualiza só o fg
  await saveCustomTheme(1, { name: "T", colors: { fg: "#999999" } }, { home });

  const got = await getCustomTheme(1, { home });
  assert.equal(got.colors.fg, "#999999", "fg atualizado");
  assert.equal(got.colors.accent, "#222222", "accent preservado");
  assert.equal(got.colors.ok, "#00ff00", "ok preservado");
});

test("3 slots independentes", async () => {
  const home = await novoHome();
  await saveCustomTheme(1, { name: "A", colors: { fg: "#aaaaaa" } }, { home });
  await saveCustomTheme(2, { name: "B", colors: { fg: "#bbbbbb" } }, { home });
  await saveCustomTheme(3, { name: "C", colors: { fg: "#cccccc" } }, { home });

  const lista = await listCustomThemes({ home });
  assert.deepEqual(lista.map((s) => s.name), ["A", "B", "C"]);
  assert.equal((await getCustomTheme(1, { home })).colors.fg, "#aaaaaa");
  assert.equal((await getCustomTheme(2, { home })).colors.fg, "#bbbbbb");
  assert.equal((await getCustomTheme(3, { home })).colors.fg, "#cccccc");
});

/* ------------------------------------------------------------------ */
/* Validação                                                           */
/* ------------------------------------------------------------------ */

test("hex inválido rejeita", async () => {
  const home = await novoHome();
  await assert.rejects(
    () => saveCustomTheme(1, { name: "X", colors: { fg: "azul" } }, { home }),
    (err) => err instanceof RangeError,
  );
  await assert.rejects(
    () => saveCustomTheme(1, { name: "X", colors: { fg: "#fff" } }, { home }),
    (err) => err instanceof RangeError, // hex curto inválido
  );
});

test("role desconhecida rejeita", async () => {
  const home = await novoHome();
  await assert.rejects(
    () => saveCustomTheme(1, { name: "X", colors: { neon: "#123456" } }, { home }),
    (err) => err instanceof RangeError,
  );
});

test("slot inválido rejeita", async () => {
  const home = await novoHome();
  await assert.rejects(() => saveCustomTheme(0, { name: "X", colors: {} }, { home }), RangeError);
  await assert.rejects(() => saveCustomTheme(4, { name: "X", colors: {} }, { home }), RangeError);
});

/* ------------------------------------------------------------------ */
/* Clear                                                               */
/* ------------------------------------------------------------------ */

test("clear zera o slot", async () => {
  const home = await novoHome();
  await saveCustomTheme(2, { name: "B", colors: { fg: "#bbbbbb" } }, { home });
  assert.ok(await getCustomTheme(2, { home }));

  const res = await clearCustomTheme(2, { home });
  assert.equal(res.cleared, true);
  assert.equal(await getCustomTheme(2, { home }), null);

  const lista = await listCustomThemes({ home });
  assert.equal(lista[1].name, null);
});

/* ------------------------------------------------------------------ */
/* JSON corrompido                                                     */
/* ------------------------------------------------------------------ */

test("JSON corrompido não quebra: devolve 3 nulos", async () => {
  const home = await novoHome();
  // escreve lixo no arquivo (via override de path)
  const { writeFile, mkdir } = await import("node:fs/promises");
  const dir = path.join(home, ".pi", "agent");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "custom-themes.json"), "{ isto nao e json", "utf8");

  const lista = await listCustomThemes({ home });
  assert.equal(lista.length, 3);
  assert.ok(lista.every((s) => s.name === null));
});

/* ------------------------------------------------------------------ */
/* mergeColors                                                         */
/* ------------------------------------------------------------------ */

test("mergeColors: override vence, valida hex e role", () => {
  const out = mergeColors({ fg: "#111111", accent: "#222222" }, { accent: "#999999" });
  assert.deepEqual(out, { fg: "#111111", accent: "#999999" });

  assert.throws(() => mergeColors({ fg: "ruim" }, {}), RangeError);
  assert.throws(() => mergeColors({}, { bogus: "#123456" }), RangeError);
});

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

test("CUSTOM_ROLES e GENERAL_ROLES batem o contrato", () => {
  assert.deepEqual(CUSTOM_ROLES, [
    "fg", "muted", "accent", "ok", "warn", "fail", "code", "tool", "link", "rule", "bg",
  ]);
  assert.deepEqual(GENERAL_ROLES, ["fg", "accent", "ok", "warn", "fail"]);
});