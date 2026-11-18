import test from "node:test";
import assert from "node:assert/strict";

import { initSettings, getSettings, initControlBar } from "./settings.js";

/* ------------------------------------------------------------------ */
/* Mock localStorage (browser não existe em node:test)                 */
/* ------------------------------------------------------------------ */

const _store = new Map();

globalThis.localStorage = {
  getItem: (k) => _store.get(k) ?? null,
  setItem: (k, v) => _store.set(k, v),
  removeItem: (k) => _store.delete(k),
  clear: () => _store.clear(),
};

/* ------------------------------------------------------------------ */
/* initSettings                                                        */
/* ------------------------------------------------------------------ */

test("initSettings carrega defaults quando localStorage vazio", () => {
  _store.clear();
  const mod = initSettings();
  const s = getSettings();

  assert.equal(s.mode, "build");
  assert.equal(s.effort, "medium");
  assert.equal(s.permission, "ask");
  assert.equal(s.model, "");
});

test("initSettings persiste e recupera do localStorage", () => {
  _store.clear();
  const mod = initSettings();

  mod.setMode("plan");
  mod.setEffort("high");
  mod.setPermission("auto");

  // Simula reload: novo initSettings deve ler do localStorage
  const mod2 = initSettings();
  const s = getSettings();

  assert.equal(s.mode, "plan");
  assert.equal(s.effort, "high");
  assert.equal(s.permission, "auto");
});

test("initSettings com models lista disponíveis", () => {
  _store.clear();
  initSettings({
    models: [
      { provider: "kilo1", id: "nemotron-3-ultra:free" },
      { provider: "or1", id: "ernie:free" },
    ],
  });

  const s = getSettings();
  assert.equal(s.models.length, 2);
  assert.equal(s.models[0].label, "kilo1/nemotron-3-ultra:free");
  assert.equal(s.models[1].value, "or1/ernie:free");
});

test("initSettings com defaultModel preenche model", () => {
  _store.clear();
  initSettings({ defaultModel: "kilo1/nemotron:free" });
  const s = getSettings();
  assert.equal(s.model, "kilo1/nemotron:free");
});

/* ------------------------------------------------------------------ */
/* getSettings                                                         */
/* ------------------------------------------------------------------ */

test("getSettings inclui descrição de permissão do modo", () => {
  _store.clear();
  const mod = initSettings();
  mod.setMode("plan");

  const s = getSettings();
  assert.ok(s.permissionLabel.length > 0);
  assert.ok(s.permissionSummary.length > 0);
  assert.ok(Array.isArray(s.asks));
});

test("getSettings modeLabel traz a nota do modo", () => {
  _store.clear();
  const mod = initSettings();
  mod.setMode("build");

  const s = getSettings();
  assert.ok(s.modeLabel.includes("escreve"));
});

/* ------------------------------------------------------------------ */
/* Setters                                                             */
/* ------------------------------------------------------------------ */

test("setMode aceita modos válidos", () => {
  _store.clear();
  const mod = initSettings();

  for (const mode of ["plan", "build", "manual", "ask", "goal"]) {
    mod.setMode(mode);
    assert.equal(getSettings().mode, mode);
  }
});

test("setMode rejeita modo inválido", () => {
  _store.clear();
  const mod = initSettings();

  assert.throws(() => mod.setMode("yolo"), /modo inválido/);
  assert.throws(() => mod.setMode("invalid"), /modo inválido/);
});

test("setModel aceita string não vazia", () => {
  _store.clear();
  const mod = initSettings();

  mod.setModel("kilo1/test:free");
  assert.equal(getSettings().model, "kilo1/test:free");
});

test("setModel rejeita string vazia", () => {
  _store.clear();
  const mod = initSettings();

  assert.throws(() => mod.setModel(""), /não pode ser vazio/);
  assert.throws(() => mod.setModel("  "), /não pode ser vazio/);
});

test("setEffort aceita valores válidos", () => {
  _store.clear();
  const mod = initSettings();

  for (const e of ["off", "low", "medium", "high"]) {
    mod.setEffort(e);
    assert.equal(getSettings().effort, e);
  }
});

test("setEffort rejeita valor inválido", () => {
  _store.clear();
  const mod = initSettings();

  assert.throws(() => mod.setEffort("ultra"), /esforço inválido/);
});

test("setPermission aceita valores válidos", () => {
  _store.clear();
  const mod = initSettings();

  for (const p of ["full-access", "auto", "ask"]) {
    mod.setPermission(p);
    assert.equal(getSettings().permission, p);
  }
});

test("setPermission rejeita valor inválido", () => {
  _store.clear();
  const mod = initSettings();

  assert.throws(() => mod.setPermission("yolo"), /permissão inválida/);
});

/* ------------------------------------------------------------------ */
/* Listas                                                              */
/* ------------------------------------------------------------------ */

test("listModes devolve 5 modos com nota", () => {
  _store.clear();
  const mod = initSettings();
  const modes = mod.listModes();

  assert.equal(modes.length, 5);
  const names = modes.map((m) => m.name);
  assert.ok(names.includes("plan"));
  assert.ok(names.includes("build"));
  assert.ok(names.includes("manual"));
  assert.ok(names.includes("ask"));
  assert.ok(names.includes("goal"));

  for (const m of modes) {
    assert.ok(m.nota.length > 0, `modo ${m.name} deve ter nota`);
  }
});

test("listEfforts devolve 4 valores", () => {
  _store.clear();
  const mod = initSettings();
  assert.deepEqual(mod.listEfforts(), ["off", "low", "medium", "high"]);
});

test("listPermissions devolve 3 valores", () => {
  _store.clear();
  const mod = initSettings();
  assert.deepEqual(mod.listPermissions(), ["full-access", "auto", "ask"]);
});

/* ------------------------------------------------------------------ */
/* Reset                                                               */
/* ------------------------------------------------------------------ */

test("reset restaura defaults", () => {
  _store.clear();
  const mod = initSettings();

  mod.setMode("plan");
  mod.setEffort("off");
  mod.setPermission("full-access");
  mod.reset();

  const s = getSettings();
  assert.equal(s.mode, "build");
  assert.equal(s.effort, "medium");
  assert.equal(s.permission, "ask");
});

/* ------------------------------------------------------------------ */
/* onChange callback                                                   */
/* ------------------------------------------------------------------ */

test("onChange dispara ao mudar configuração", () => {
  _store.clear();
  let called = 0;
  let lastState = null;

  initSettings({ onChange: (state) => { called++; lastState = state; } });

  const mod = initSettings({ onChange: (state) => { called++; lastState = state; } });
  mod.setMode("plan");

  assert.ok(called >= 1);
  assert.equal(lastState.mode, "plan");
});

/* ------------------------------------------------------------------ */
/* Persistência                                                        */
/* ------------------------------------------------------------------ */

test("configuração persiste sob a chave selfevopi.settings", () => {
  _store.clear();
  const mod = initSettings();

  mod.setMode("ask");
  mod.setEffort("low");

  const raw = _store.get("selfevopi.settings");
  assert.ok(raw, "deve ter gravado no localStorage");

  const parsed = JSON.parse(raw);
  assert.equal(parsed.mode, "ask");
  assert.equal(parsed.effort, "low");
});

test("localStorage corrompido não quebra initSettings", () => {
  _store.clear();
  _store.set("selfevopi.settings", "not-json{{{");

  const mod = initSettings();
  const s = getSettings();

  // Deve cair nos defaults sem lançar
  assert.equal(s.mode, "build");
});

/* ------------------------------------------------------------------ */
/* initControlBar                                                      */
/* ------------------------------------------------------------------ */

test("initControlBar em headless devolve stub", () => {
  // Em node:test não há document, então deve devolver stub
  const bar = initControlBar();
  assert.equal(bar.el, null);
  assert.equal(typeof bar.destroy, "function");
});

test("initControlBar lê estado de getSettings", () => {
  _store.clear();
  initSettings({ defaultModel: "kilo1/test:free" });

  // Em headless, initControlBar não renderiza mas o estado está lá
  const s = getSettings();
  assert.equal(s.model, "kilo1/test:free");
});