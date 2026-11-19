#!/usr/bin/env node
/**
 * apps/cli-menu.test.mjs — testes da CLI (TUI) do SelfEvoPI.
 *
 * Cobre: cada tela renderiza sem lançar; o frame cabe em 72 colunas; `q` sai;
 * estado vazio não quebra; ausência de pi é reportada e não derruba.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SCREENS,
  renderScreen,
  handleKey,
  applyAction,
  normalizeKey,
  checkPi,
  harnessState,
  stripAnsi,
  visibleWidth,
} from "./cli-menu.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, "cli-menu.mjs");
const WIDTH = 72;

/** Executa `node apps/cli.mjs --render <screen>` e devolve { code, out }. */
function render(screen, env = {}) {
  try {
    const out = execFileSync(process.execPath, [CLI, "--render", screen], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      timeout: 30_000,
    });
    return { code: 0, out };
  } catch (err) {
    return { code: typeof err.status === "number" ? err.status : 1, out: String(err.stdout || "") };
  }
}

const ALL_SCREENS = ["menu", ...SCREENS.map((s) => s.id)];

test("cada tela renderiza sem lançar e sai 0", () => {
  for (const screen of ALL_SCREENS) {
    const { code, out } = render(screen);
    assert.equal(code, 0, `tela ${screen} saiu ${code}`);
    assert.ok(out.length > 0, `tela ${screen} não imprimiu nada`);
  }
});

test("nenhuma linha do frame passa de 72 colunas", () => {
  for (const screen of ALL_SCREENS) {
    const { out } = render(screen);
    for (const line of out.split("\n")) {
      const w = visibleWidth(line);
      assert.ok(w <= WIDTH, `tela ${screen}: linha com ${w} colunas (> ${WIDTH})`);
    }
  }
});

test("renderScreen não quebra com estado vazio", () => {
  for (const screen of ALL_SCREENS) {
    const frame = renderScreen(screen, {});
    assert.equal(typeof frame, "string");
    assert.ok(frame.length > 0);
    for (const line of frame.split("\n")) {
      assert.ok(visibleWidth(line) <= WIDTH, `tela ${screen}: linha passou de ${WIDTH} com estado vazio`);
    }
  }
});

test("q sai (handleKey + applyAction)", () => {
  const action = handleKey("q", { screen: "menu", selected: 0 });
  assert.equal(action.action, "quit");
  const next = applyAction({ screen: "menu", selected: 0 }, action);
  assert.equal(next.quit, true);
});

test("navegação por teclado (setas) move a seleção", () => {
  let state = { screen: "menu", selected: 0 };
  state = applyAction(state, handleKey("\x1b[B", state)); // down
  assert.equal(state.selected, 1);
  state = applyAction(state, handleKey("\x1b[A", state)); // up
  assert.equal(state.selected, 0);
  // wrap: cima a partir de 0 vai para o último
  const wrapped = applyAction({ screen: "menu", selected: 0 }, handleKey("up", {}));
  assert.equal(wrapped.selected, SCREENS.length - 1);
});

test("enter no menu seleciona a tela; esc volta ao menu", () => {
  const picked = applyAction({ screen: "menu", selected: 0 }, handleKey("enter", {}));
  assert.equal(picked.screen, SCREENS[0].id);
  const back = applyAction({ screen: "status", selected: 0 }, handleKey("esc", {}));
  assert.equal(back.screen, "menu");
});

test("normalizeKey reconhece sequências ANSI e caracteres", () => {
  assert.equal(normalizeKey("\x1b[A"), "up");
  assert.equal(normalizeKey("\x1b[B"), "down");
  assert.equal(normalizeKey("\r"), "enter");
  assert.equal(normalizeKey("\x1b"), "esc");
  assert.equal(normalizeKey("Q"), "q");
});

test("ausência de pi é reportada e não derruba", () => {
  const absent = checkPi({ bundlePath: path.join("C:", "nao-existe", "cli.js") });
  assert.equal(absent.available, false);
  // renderiza uma tela com pi forçado ausente: não lança, sai 0
  const { code, out } = render("status", { SELFEOPI_PI_FORCE_ABSENT: "1" });
  assert.equal(code, 0);
  assert.match(stripAnsi(out), /ausente|pi/i);
});

test("checkPi respeita override de caminho inexistente", () => {
  const r = checkPi({ bundlePath: path.join(__dirname, "nao-existe.js") });
  assert.equal(r.available, false);
});

test("harnessState: cold start sem lkg, pronto com lkg", () => {
  assert.match(harnessState({}).label, /cold start|sem lkg/i);
  assert.match(harnessState({ lkg: { sha: "abc1234" } }).label, /pronto/i);
});

test("--list-screens lista as telas", () => {
  const out = execFileSync(process.execPath, [CLI, "--list-screens"], { encoding: "utf8" });
  for (const s of ALL_SCREENS) assert.ok(out.includes(s), `falta a tela ${s}`);
});

test("--render de tela desconhecida sai 2", () => {
  try {
    execFileSync(process.execPath, [CLI, "--render", "nao-existe"], { encoding: "utf8", stdio: "pipe" });
    assert.fail("deveria ter saído 2");
  } catch (err) {
    assert.equal(err.status, 2);
  }
});