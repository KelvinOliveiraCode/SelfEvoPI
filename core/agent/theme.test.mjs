import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  THEMES,
  getTheme,
  setTheme,
  listThemes,
  getThemeColors,
  themeToCss,
  themeToAnsi,
  themeToAnsi256,
  hexToAnsi256,
  applyAnsiTheme,
} from "./theme.mjs";

/* --------------------------- estrutura ---------------------------------- */

test("THEMES tem padrão, violeta e várias cores", () => {
  assert.ok(THEMES.padrao, "falta padrao");
  assert.ok(THEMES.violeta, "falta violeta");
  for (const cor of ["azul", "ciano", "verde", "rosa", "vermelho", "grafite"]) {
    assert.ok(THEMES[cor], `falta ${cor}`);
  }
  assert.equal(THEMES.escuro, undefined, "escuro foi renomeado para padrao");
  assert.equal(THEMES["alto-contraste"], undefined, "alto-contraste saiu do conjunto");
});

test("listThemes devolve pelo menos doze nomes", () => {
  const names = listThemes();
  assert.ok(names.length >= 12, `esperados >=12 temas, veio ${names.length}`);
  assert.ok(names.includes("padrao"));
  assert.ok(names.includes("violeta"));
});

test("nomes antigos migram para padrão", () => {
  assert.equal(getThemeColors("escuro"), THEMES.padrao);
  assert.equal(getThemeColors("alto-contraste"), THEMES.padrao);
  assert.equal(setTheme("escuro"), true);
  assert.equal(getTheme(), "padrao");
  setTheme("padrao");
});

test("getTheme devolve um tema válido por padrão", () => {
  const name = getTheme();
  assert.ok(THEMES[name], `tema inválido: ${name}`);
});

test("setTheme rejeita nome desconhecido", () => {
  assert.equal(setTheme("nao-existe"), false);
});

test("setTheme aceita e persiste um tema válido", () => {
  const tmp = mkdtempSync(join(tmpdir(), "selfevopi-theme-"));
  const orig = process.env.USERPROFILE;
  process.env.USERPROFILE = tmp; // redireciona ~/.pi/agent/theme.json
  try {
    assert.equal(setTheme("violeta"), true);
    assert.equal(getTheme(), "violeta");
    // arquivo persistido
    const file = join(tmp, ".pi", "agent", "theme.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(doc.theme, "violeta");
  } finally {
    process.env.USERPROFILE = orig;
    rmSync(tmp, { recursive: true, force: true });
    setTheme("padrao"); // restaura
  }
});

/* --------------------------- paleta ------------------------------------- */

test("cada tema tem as seis chaves semânticas", () => {
  for (const [name, t] of Object.entries(THEMES)) {
    for (const k of ["fg", "muted", "accent", "ok", "warn", "fail"]) {
      assert.ok(t[k], `tema ${name} sem ${k}`);
      assert.match(t[k], /^#[0-9a-f]{6}$/i, `cor inválida ${t[k]} em ${name}.${k}`);
    }
  }
});

test("getThemeColors devolve a paleta do tema", () => {
  const t = getThemeColors("violeta");
  assert.equal(t.bg, THEMES.violeta.bg);
  assert.equal(t.fg, THEMES.violeta.fg);
});

test("getThemeColors com nome inválido cai no padrão", () => {
  const t = getThemeColors("nao-existe");
  assert.ok(t.fg, "deveria cair no padrão");
});

/* --------------------------- CSS ---------------------------------------- */

test("themeToCss gera variáveis --fg, --muted, --accent, --ok, --warn, --fail", () => {
  const css = themeToCss("padrao");
  for (const v of ["--bg", "--fg", "--muted", "--accent", "--ok", "--warn", "--fail"]) {
    assert.ok(css.includes(v), `CSS sem ${v}`);
  }
  assert.ok(css.includes(THEMES.padrao.fg), "CSS deve usar o fg do tema");
});

test("themeToCss de uma cor usa as cores do tema", () => {
  const css = themeToCss("azul");
  assert.ok(css.includes(THEMES.azul.accent), "accent do tema azul");
});

test("temas têm contraste alto no texto (WCAG >= 4.5)", () => {
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contraste = (a, b) => {
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  for (const [nome, tema] of Object.entries(THEMES)) {
    for (const papel of ["fg", "muted", "accent", "ok", "warn", "fail", "code", "tool"]) {
      assert.ok(contraste(tema[papel], tema.bg) >= 4.5, `${nome}.${papel} com contraste baixo`);
    }
  }
});

/* --------------------------- ANSI --------------------------------------- */

test("themeToAnsi gera sequências truecolor", () => {
  const ansi = themeToAnsi("padrao");
  assert.ok(ansi.fg.startsWith("\x1b[38;2;"), "fg não é truecolor");
  assert.ok(ansi.ok.startsWith("\x1b[38;2;"), "ok não é truecolor");
});

test("themeToAnsi256 gera sequências ANSI-256 (38;5;N) e é distinta por tema", () => {
  const a = themeToAnsi256("padrao");
  assert.ok(a.accent.startsWith("\x1b[38;5;"), "accent não é 256 cores");
  const idx = (seq) => { const n = (seq.match(/\d+/g) || []); return Number(n[n.length - 1]); };
  // temas diferentes não podem cair todos no mesmo índice ANSI-256
  const accents = new Set(listThemes().map((t) => idx(themeToAnsi256(t).accent)));
  assert.ok(accents.size >= 8, "accent 256 não distingue os temas de cor");
  // hexToAnsi256 mapeia branco/preto para índices do cubo
  const branco = hexToAnsi256("#ffffff");
  assert.ok(branco >= 16 && branco <= 255, "hexToAnsi256 fora da faixa");
});

test("applyAnsiTheme define variáveis SELFEVOPI_ANSI_*", () => {
  applyAnsiTheme("violeta");
  assert.ok(process.env.SELFEVOPI_ANSI_FG, "falta SELFEVOPI_ANSI_FG");
  assert.ok(process.env.SELFEVOPI_ANSI_OK, "falta SELFEVOPI_ANSI_OK");
  // limpa
  delete process.env.SELFEVOPI_ANSI_FG;
  delete process.env.SELFEVOPI_ANSI_OK;
  delete process.env.SELFEVOPI_ANSI_MUTED;
  delete process.env.SELFEVOPI_ANSI_ACCENT;
  delete process.env.SELFEVOPI_ANSI_WARN;
  delete process.env.SELFEVOPI_ANSI_FAIL;
});

/* --------------------------- WCAG AA ------------------------------------ */

function relLum(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = parseInt(m[1], 16);
  const ch = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const l1 = relLum(a);
  const l2 = relLum(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

test("padrão: fg, accent e muted passam AA", () => {
  const t = THEMES.padrao;
  const bg = t.bg;
  for (const k of ["fg", "accent", "muted"]) {
    assert.ok(contrast(t[k], bg) >= 4.5, `${k} = ${t[k]} contrast ${contrast(t[k], bg).toFixed(2)} < 4.5`);
  }
});

test("temas de cor têm accents distintos uns dos outros", () => {
  const cores = listThemes().filter((n) => n !== "padrao" && n !== "grafite");
  const accents = new Set(cores.map((n) => THEMES[n].accent));
  assert.equal(accents.size, cores.length, "duas cores compartilham o mesmo accent");
});