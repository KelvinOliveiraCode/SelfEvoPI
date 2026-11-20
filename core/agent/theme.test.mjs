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

test("THEMES exporta os três temas", () => {
  assert.ok(THEMES.escuro, "falta escuro");
  assert.ok(THEMES.violeta, "falta violeta");
  assert.ok(THEMES["alto-contraste"], "falta alto-contraste");
});

test("listThemes devolve os três nomes", () => {
  const names = listThemes();
  assert.equal(names.length, 3);
  assert.ok(names.includes("escuro"));
  assert.ok(names.includes("violeta"));
  assert.ok(names.includes("alto-contraste"));
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
    setTheme("escuro"); // restaura
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
  assert.equal(t.bg, "#000000");
  assert.equal(t.fg, "#ffffff");
});

test("getThemeColors com nome inválido cai no padrão", () => {
  const t = getThemeColors("nao-existe");
  assert.ok(t.fg, "deveria cair no padrão");
});

/* --------------------------- CSS ---------------------------------------- */

test("themeToCss gera variáveis --fg, --muted, --accent, --ok, --warn, --fail", () => {
  const css = themeToCss("escuro");
  for (const v of ["--bg", "--fg", "--muted", "--accent", "--ok", "--warn", "--fail"]) {
    assert.ok(css.includes(v), `CSS sem ${v}`);
  }
  assert.ok(css.includes("#ffffff"), "escuro deve ter fg branco");
});

test("themeToCss do alto-contraste usa as cores do tema", () => {
  const css = themeToCss("alto-contraste");
  assert.ok(css.includes("#00d4ff"), "accent do alto-contraste");
});

/* --------------------------- ANSI --------------------------------------- */

test("themeToAnsi gera sequências truecolor", () => {
  const ansi = themeToAnsi("escuro");
  assert.ok(ansi.fg.startsWith("\x1b[38;2;"), "fg não é truecolor");
  assert.ok(ansi.ok.startsWith("\x1b[38;2;"), "ok não é truecolor");
});

test("themeToAnsi256 gera sequências ANSI-256 (38;5;N) e é distinta por tema", () => {
  const a = themeToAnsi256("escuro");
  assert.ok(a.accent.startsWith("\x1b[38;5;"), "accent não é 256 cores");
  const idx = (seq) => { const n = (seq.match(/\d+/g) || []); return Number(n[n.length - 1]); };
  // os três temas têm accent 256 distintos (não caem todos no mesmo índice)
  const accents = new Set(["escuro", "violeta", "alto-contraste"].map((t) => idx(themeToAnsi256(t).accent)));
  assert.ok(accents.size >= 2, "accent 256 não distingue os temas");
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

test("alto-contraste passa WCAG AA em fundo preto (4.5:1)", () => {
  const t = THEMES["alto-contraste"];
  const bg = t.bg; // #000000
  for (const k of ["fg", "muted", "accent", "ok", "warn", "fail"]) {
    const ratio = contrast(t[k], bg);
    assert.ok(ratio >= 4.5, `${k} = ${t[k]} contrast ${ratio.toFixed(2)} < 4.5`);
  }
});

test("escuro: fg e accent passam AA; muted é decorativo (>= 3:1)", () => {
  const t = THEMES.escuro;
  const bg = t.bg;
  assert.ok(contrast(t.fg, bg) >= 4.5, "fg do escuro deve passar AA");
  assert.ok(contrast(t.accent, bg) >= 4.5, "accent do escuro deve passar AA");
  // muted é texto secundário/decorativo: exige >= 3:1 (AA large / decorativo)
  assert.ok(contrast(t.muted, bg) >= 3.0, "muted do escuro deve passar 3:1");
});