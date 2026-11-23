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

test("THEMES tem default, violet e várias cores", () => {
  assert.ok(THEMES.default, "falta default");
  assert.ok(THEMES.violet, "falta violet");
  for (const cor of ["blue", "cyan", "green", "pink", "red", "graphite"]) {
    assert.ok(THEMES[cor], `falta ${cor}`);
  }
  assert.equal(THEMES.escuro, undefined, "escuro foi renomeado para default");
  assert.equal(THEMES["alto-contraste"], undefined, "alto-contraste saiu do conjunto");
  assert.equal(THEMES.padrao, undefined, "padrao foi renomeado para default");
});

test("listThemes devolve os doze nomes em inglês", () => {
  const nomes = listThemes();
  assert.deepEqual(nomes, [
    "default",
    "violet",
    "blue",
    "cyan",
    "green",
    "emerald",
    "orange",
    "pink",
    "red",
    "magenta",
    "gold",
    "graphite",
  ]);
  for (const nome of nomes) {
    assert.equal(THEMES[nome].name, nome, `campo name divergente em ${nome}`);
  }
});

test("nomes antigos migram para default", () => {
  assert.equal(getThemeColors("escuro"), THEMES.default);
  assert.equal(getThemeColors("alto-contraste"), THEMES.default);
  assert.equal(setTheme("escuro"), true);
  assert.equal(getTheme(), "default");
  setTheme("default");
});

test("todo nome antigo em português migra para o tema em inglês", () => {
  const antigos = {
    padrao: "default",
    violeta: "violet",
    azul: "blue",
    ciano: "cyan",
    verde: "green",
    esmeralda: "emerald",
    laranja: "orange",
    rosa: "pink",
    vermelho: "red",
    magenta: "magenta",
    dourado: "gold",
    grafite: "graphite",
    claro: "violet",
  };
  for (const [antigo, novo] of Object.entries(antigos)) {
    assert.strictEqual(getThemeColors(antigo), THEMES[novo], `${antigo} deve migrar para ${novo}`);
  }
});

test("migração: getThemeColors('violeta') é o mesmo objeto que getThemeColors('violet')", () => {
  const antigo = getThemeColors("violeta");
  const novo = getThemeColors("violet");
  assert.strictEqual(antigo, novo);
  assert.equal(novo.name, "violet");
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
    assert.equal(setTheme("violet"), true);
    assert.equal(getTheme(), "violet");
    // arquivo persistido
    const file = join(tmp, ".pi", "agent", "theme.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(doc.theme, "violet");
  } finally {
    process.env.USERPROFILE = orig;
    rmSync(tmp, { recursive: true, force: true });
    setTheme("default"); // restaura
  }
});

test("migração: setTheme('azul') persiste 'blue'", () => {
  const tmp = mkdtempSync(join(tmpdir(), "selfevopi-theme-"));
  const orig = process.env.USERPROFILE;
  process.env.USERPROFILE = tmp;
  try {
    assert.equal(setTheme("azul"), true);
    assert.equal(getTheme(), "blue");
    const doc = JSON.parse(readFileSync(join(tmp, ".pi", "agent", "theme.json"), "utf8"));
    assert.equal(doc.theme, "blue", "não pode persistir o nome antigo");
  } finally {
    process.env.USERPROFILE = orig;
    rmSync(tmp, { recursive: true, force: true });
    setTheme("default");
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
  const t = getThemeColors("violet");
  assert.equal(t.bg, THEMES.violet.bg);
  assert.equal(t.fg, THEMES.violet.fg);
});

test("getThemeColors com nome inválido cai no padrão", () => {
  const t = getThemeColors("nao-existe");
  assert.ok(t.fg, "deveria cair no padrão");
  assert.strictEqual(t, THEMES.default);
});

/* --------------------------- CSS ---------------------------------------- */

test("themeToCss gera variáveis --fg, --muted, --accent, --ok, --warn, --fail", () => {
  const css = themeToCss("default");
  for (const v of ["--bg", "--fg", "--muted", "--accent", "--ok", "--warn", "--fail"]) {
    assert.ok(css.includes(v), `CSS sem ${v}`);
  }
  assert.ok(css.includes(THEMES.default.fg), "CSS deve usar o fg do tema");
});

test("themeToCss de uma cor usa as cores do tema", () => {
  const css = themeToCss("blue");
  assert.ok(css.includes(THEMES.blue.accent), "accent do tema blue");
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
  const ansi = themeToAnsi("default");
  assert.ok(ansi.fg.startsWith("\x1b[38;2;"), "fg não é truecolor");
  assert.ok(ansi.ok.startsWith("\x1b[38;2;"), "ok não é truecolor");
});

test("themeToAnsi256 gera sequências ANSI-256 (38;5;N) e é distinta por tema", () => {
  const a = themeToAnsi256("default");
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
  applyAnsiTheme("violet");
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

test("default: fg, accent e muted passam AA", () => {
  const t = THEMES.default;
  const bg = t.bg;
  for (const k of ["fg", "accent", "muted"]) {
    assert.ok(contrast(t[k], bg) >= 4.5, `${k} = ${t[k]} contrast ${contrast(t[k], bg).toFixed(2)} < 4.5`);
  }
});

test("temas de cor têm accents distintos uns dos outros", () => {
  const cores = listThemes().filter((n) => n !== "default" && n !== "graphite");
  const accents = new Set(cores.map((n) => THEMES[n].accent));
  assert.equal(accents.size, cores.length, "duas cores compartilham o mesmo accent");
});
