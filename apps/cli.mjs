#!/usr/bin/env node
/**
 * apps/cli.mjs — a CLI (TUI) do SelfEvoPI. Node puro, zero dependência.
 *
 * Gramática: TUI de terminal (ANSI). Herda a MARCA (docs/design/marca.md §1.1):
 * símbolo ◍, paleta via truecolor (#000/#fff/#787878) quando o terminal aceita,
 * hierarquia, contenção, estado como ponto. NÃO finge fonte/raio/sombra/transição
 * — isso é do desktop.
 *
 * Não reimplementa nada: chama os módulos existentes (core/forge/detect,
 * core/memory/store) e os comandos evals/run.mjs, evals/gate.mjs, verify-urls.
 *
 * Uso:
 *   node apps/cli.mjs                      # TUI interativo (exige TTY)
 *   node apps/cli.mjs --render <tela>      # imprime o frame como texto e sai
 *   node apps/cli.mjs --list-screens       # lista as telas
 *
 * Telas: menu, status, detect, evals, verify, gate, skills, panel.
 * Largura 72 colunas (régua de 64 `─`); em 80 não quebra.
 * Sem TTY: mostra o menu uma vez e sai 0 (nunca pendura).
 */

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import { detectGaps } from "../core/forge/detect.mjs";
import { openStore } from "../core/memory/store.mjs";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const LEDGER = path.join(ROOT, ".pi", "harness", "ledger", "evals.jsonl");
const BASELINE = path.join(ROOT, "evals", "baseline.json");
const LKG = path.join(ROOT, ".pi", "harness", "last-known-good.json");
const TASKS = path.join(ROOT, "evals", "tasks");
const MEMORY = path.join(ROOT, ".pi", "harness", "memory");

const WIDTH = 72; // colunas do frame (em 80 não quebra)
const RULE = 64; // régua de ─ (marca §1.1)

/* ------------------------------------------------------------------ */
/* Paleta (marca §1.1 / §2) — truecolor ou degradação honesta          */
/* ------------------------------------------------------------------ */

function detectTruecolor() {
  const ct = String(process.env.COLORTERM || "").toLowerCase();
  return ct.includes("truecolor") || ct.includes("24bit");
}

const TRUE = detectTruecolor();

const PX = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  // texto
  fg: TRUE ? "\x1b[38;2;255;255;255m" : "", // #ffffff
  muted: TRUE ? "\x1b[38;2;120;120;120m" : "\x1b[90m", // #787878
  // estado (ponto de 8px / badge) — §2
  ok: TRUE ? "\x1b[38;2;63;185;80m" : "\x1b[32m", // #3FB950
  warn: TRUE ? "\x1b[38;2;210;153;34m" : "\x1b[33m", // #D29922
  fail: TRUE ? "\x1b[38;2;248;81;73m" : "\x1b[31m", // #F85149
};

const STATE_KEY = { green: "ok", amber: "warn", red: "fail" };

function paint(text, key) {
  const c = PX[key];
  return c ? `${c}${text}${PX.reset}` : String(text);
}

export function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/\x1b\[[0-9;]*m/g, "");
}

export function visibleWidth(s) {
  return stripAnsi(s).length;
}

/** Trunca/preenche uma linha para a largura (colunas visíveis). */
function fit(s, width = WIDTH) {
  const plain = stripAnsi(String(s));
  if (plain.length > width) return plain.slice(0, width);
  return plain + " ".repeat(width - plain.length);
}

function rule() {
  return "  " + "─".repeat(RULE);
}

/* ------------------------------------------------------------------ */
/* Dados (chamam os módulos existentes)                                */
/* ------------------------------------------------------------------ */

async function readJson(file, fallback = {}) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

export async function loadData() {
  const lkg = await readJson(LKG, {});
  const baseline = await readJson(BASELINE, {});
  let gaps = { scanned: 0, counts: {}, gaps: [] };
  try {
    gaps = await detectGaps({ ledger: LEDGER, threshold: 3, maxGaps: 20 });
  } catch {
    /* ledger ausente: sem lacunas */
  }
  let skills = [];
  try {
    const store = openStore({ root: MEMORY });
    skills = store.query({ level: "skills" }).filter((e) => !e.invalid);
  } catch {
    /* memória ausente */
  }
  const tasks = await loadTaskGroups();
  return { lkg, baseline, gaps, skills, tasks };
}

async function loadTaskGroups() {
  let files = [];
  try {
    const { readdir } = await import("node:fs/promises");
    files = (await readdir(TASKS)).filter((f) => f.endsWith(".json"));
  } catch {
    return {};
  }
  const groups = {};
  for (const f of files) {
    try {
      const doc = JSON.parse(await readFile(path.join(TASKS, f), "utf8"));
      for (const t of Array.isArray(doc) ? doc : [doc]) {
        if (!t || !t.id || !t.group) continue;
        groups[t.group] = (groups[t.group] || 0) + 1;
      }
    } catch {
      /* ignora arquivo inválido */
    }
  }
  return groups;
}

/** Estado do harness para a barra de topo (cor = cor de estado, não texto). */
export function harnessState(data) {
  const lkg = data.lkg || {};
  if (lkg.sha) return { label: "pronto", color: "green" };
  if (data.baseline && Object.keys(data.baseline).length > 0) return { label: "cold start", color: "amber" };
  return { label: "cold start", color: "amber" };
}

/** Disponibilidade do pi (a CLI é do SelfEvoPI; não depende de pi instalado). */
export function checkPi({ bundlePath } = {}) {
  if (process.env.SELFEOPI_PI_FORCE_ABSENT === "1") return { available: false, path: "(forçado ausente)" };
  const p =
    bundlePath ||
    path.join(
      process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming"),
      "npm", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js",
    );
  return { available: existsSync(p), path: p };
}

/* ------------------------------------------------------------------ */
/* Banner, barra de estado, rodapé                                     */
/* ------------------------------------------------------------------ */

let VERSION = "0.0.0";

function banner() {
  const left = `  ${paint("◍", "fg")}  ${paint("SelfEvoPI", "bold")}`;
  const right = paint(`v${VERSION}`, "muted");
  const pad = Math.max(1, WIDTH - visibleWidth(left) - visibleWidth(right));
  return left + " ".repeat(pad) + right;
}

export function statusBar(data, width = WIDTH) {
  const st = harnessState(data);
  const dot = paint("●", STATE_KEY[st.color] || "warn"); // estado como ponto (§1.1)
  const total = data.baseline?.totals || {};
  const taskCount = Object.keys(data.baseline?.tasks || data.tasks || {}).length || (data.tasks ? Object.values(data.tasks).reduce((a, b) => a + b, 0) : 0);
  const baseCell = total.passes != null && total.taskRuns != null ? `${total.passes}/${total.taskRuns}` : "?";
  const text = `${dot} ${st.label} · ${taskCount} tarefas · baseline ${baseCell}`;
  return fit(`  ${text}`, width);
}

export function footer(screenId, width = WIDTH) {
  const keys = screenId === "menu" ? "↑↓ navegar   enter escolher   q sair" : "esc voltar   ↑↓ navegar   q sair";
  return fit(paint(`  ${keys}`, "dim"), width);
}

/* ------------------------------------------------------------------ */
/* Telas                                                               */
/* ------------------------------------------------------------------ */

export const SCREENS = [
  { id: "status", label: "Estado do harness", desc: "estado do harness, cold start, baseline" },
  { id: "detect", label: "Detectar lacunas", desc: "lacunas de ferramenta no ledger" },
  { id: "evals", label: "Rodar evals estruturais", desc: "grupos A/B/C (sem modelo)" },
  { id: "verify", label: "Verificação completa", desc: "testes + evals A/B/C + URLs" },
  { id: "gate", label: "Gate de regressão", desc: "regressão contra a baseline" },
  { id: "skills", label: "O que já foi gerado", desc: "skills registradas pelo loop" },
  { id: "panel", label: "Abrir painel", desc: "visão geral do harness" },
];

const SCREEN_IDS = SCREENS.map((s) => s.id);

function heading(title, subtitle) {
  return [paint(title, "bold"), paint(subtitle, "muted"), ""];
}

function kv(key, value, colorKey) {
  return `  ${key.padEnd(18)} ${colorKey ? paint(String(value), colorKey) : value}`;
}

/* ---- menu (anatomia §6: > na linha selecionada, lista numerada) ---- */

export function renderMenu(data, state = {}) {
  const selected = state.selected ?? 0;
  const lines = [];
  lines.push("");
  SCREENS.forEach((s, i) => {
    const sel = i === selected;
    const marker = sel ? paint(">", "fg") : " ";
    const label = sel ? paint(s.label, "bold") : s.label;
    lines.push(`  ${marker} ${String(i + 1).padEnd(2)}  ${label}`);
  });
  lines.push(`  ${paint("q", "muted").padEnd(4)}  Sair`);
  return lines;
}

/* ---- status ---- */

export function renderStatus(data) {
  const st = harnessState(data);
  const total = data.baseline?.totals || {};
  const lkg = data.lkg || {};
  const lines = heading("ESTADO DO HARNESS", "last-known-good, baseline e lacunas");
  lines.push(kv("estado:", st.label));
  lines.push(kv("last-known-good:", lkg.sha ? `${String(lkg.sha).slice(0, 12)} (${lkg.phase || "?"})` : "nenhum"));
  lines.push(kv("baseline:", total.taskRuns != null ? `${total.taskRuns} exec, taxa ${Math.round((total.rate || 0) * 100)}%` : "ausente"));
  lines.push(kv("  latência média:", total.avgMs != null ? `${total.avgMs} ms` : "?"));
  lines.push(kv("  tokens:", total.tokens != null ? String(total.tokens) : "?"));
  lines.push(kv("lacunas abertas:", String(data.gaps?.gaps?.length ?? 0)));
  const pi = checkPi();
  lines.push(kv("pi:", pi.available ? "disponível" : "ausente (comandos de modelo não rodam)"));
  return lines;
}

/* ---- detect ---- */

export function renderDetect(data) {
  const det = data.gaps || {};
  const lines = heading("DETECTAR LACUNAS", "lacunas de ferramenta a partir do ledger");
  lines.push(kv("execuções lidas:", String(det.scanned ?? 0)));
  lines.push(kv("tool-failing:", String(det.counts?.["tool-failing"] ?? 0)));
  lines.push(kv("tool-missing:", String(det.counts?.["tool-missing"] ?? 0)));
  lines.push(kv("tool-fragile:", String(det.counts?.["tool-fragile"] ?? 0)));
  const gaps = det.gaps || [];
  lines.push("");
  if (gaps.length === 0) {
    lines.push(paint("  nenhum gap acionável", "muted"));
  } else {
    for (const g of gaps.slice(0, 10)) {
      const dot = paint("●", g.kind === "tool-failing" ? "fail" : "warn");
      lines.push(`  ${dot} [${g.kind}] ${g.taskId} → ${g.capability}`);
    }
  }
  return lines;
}

/* ---- evals estruturais ---- */

export function renderEvals(data) {
  const total = data.baseline?.totals || {};
  const lines = heading("RODAR EVALS ESTRUTURAIS", "grupos A/B/C — determinísticos, sem modelo");
  const structural = ["A", "B", "C"];
  for (const g of structural) {
    const count = data.tasks?.[g] ?? 0;
    lines.push(`  ${paint(g, "fg")}  ${count} tarefa(s)`);
  }
  lines.push("");
  lines.push(kv("execuções (baseline):", String(total.taskRuns ?? 0)));
  lines.push(kv("taxa:", total.rate != null ? `${Math.round(total.rate * 100)}%` : "?"));
  lines.push(kv("tokens (estruturais):", "0"));
  lines.push("");
  lines.push(paint("  pressione r para executar os grupos A/B/C", "muted"));
  return lines;
}

/* ---- verificação completa ---- */

export function renderVerify(data) {
  const lines = heading("VERIFICAÇÃO COMPLETA", "o que o CI e o `npm run verify` executam");
  const steps = [
    ["npm test", "testes unitários (core/, scripts/)"],
    ["run.mjs --group A", "evals estruturais A"],
    ["run.mjs --group B", "evals estruturais B"],
    ["run.mjs --group C", "evals estruturais C"],
    ["verify-urls.mjs", "integridade das URLs citadas"],
  ];
  for (const [cmd, desc] of steps) {
    lines.push(`  ${paint("▸", "fg")} ${cmd}`);
    lines.push(`      ${paint(desc, "muted")}`);
  }
  lines.push("");
  lines.push(paint("  pressione r para executar a verificação completa", "muted"));
  return lines;
}

/* ---- gate ---- */

export function renderGate(data) {
  const total = data.baseline?.totals || {};
  const lines = heading("GATE DE REGRESSÃO", "compara a suíte atual com a baseline");
  lines.push(kv("baseline:", total.taskRuns != null ? `${total.taskRuns} exec` : "ausente"));
  lines.push(kv("taxa de acerto:", total.rate != null ? `${Math.round(total.rate * 100)}%` : "?"));
  lines.push(kv("latência média:", total.avgMs != null ? `${total.avgMs} ms` : "?"));
  lines.push(kv("tokens:", total.tokens != null ? String(total.tokens) : "?"));
  lines.push("");
  lines.push(paint("  o gate sai 1 se qualquer tarefa cair abaixo da baseline", "muted"));
  lines.push(paint("  pressione r para executar o gate", "muted"));
  return lines;
}

/* ---- skills ---- */

export function renderSkills(data) {
  const skills = data.skills || [];
  const lines = heading("O QUE JÁ FOI GERADO", "skills registradas pelo loop evolutivo");
  if (skills.length === 0) {
    lines.push(paint("  nenhuma skill registrada ainda", "muted"));
    return lines;
  }
  lines.push(kv("total:", String(skills.length)));
  lines.push("");
  for (const s of skills.slice(0, 12)) {
    const text = String(s.text || "").replace(/\s+/g, " ").slice(0, 60);
    lines.push(`  ${paint("●", "ok")} ${text}`);
  }
  return lines;
}

/* ---- painel ---- */

export function renderPanel(data) {
  const st = harnessState(data);
  const total = data.baseline?.totals || {};
  const lines = heading("PAINEL", "visão geral do harness");
  lines.push(kv("estado:", st.label));
  lines.push(kv("grupos:", Object.entries(data.tasks || {}).map(([g, n]) => `${g}=${n}`).join("  ") || "?"));
  lines.push(kv("baseline:", total.taskRuns != null ? `${total.taskRuns} exec · ${Math.round((total.rate || 0) * 100)}%` : "ausente"));
  lines.push(kv("tokens (baseline):", total.tokens != null ? String(total.tokens) : "?"));
  lines.push(kv("lacunas:", String(data.gaps?.gaps?.length ?? 0)));
  lines.push(kv("skills:", String(data.skills?.length ?? 0)));
  const pi = checkPi();
  lines.push(kv("pi:", pi.available ? "disponível" : "ausente"));
  return lines;
}

/* ------------------------------------------------------------------ */
/* Composição do frame (anatomia §6)                                   */
/* ------------------------------------------------------------------ */

export function renderScreen(screenId, data, state = {}) {
  let content;
  switch (screenId) {
    case "menu": content = renderMenu(data, state); break;
    case "status": content = renderStatus(data); break;
    case "detect": content = renderDetect(data); break;
    case "evals": content = renderEvals(data); break;
    case "verify": content = renderVerify(data); break;
    case "gate": content = renderGate(data); break;
    case "skills": content = renderSkills(data); break;
    case "panel": content = renderPanel(data); break;
    default: content = [paint(`tela desconhecida: ${screenId}`, "fail")];
  }

  const out = [];
  out.push(banner()); // ◍  SelfEvoPI ... v0.5.0
  out.push(rule()); // 64 ─
  out.push(statusBar(data)); // ● estado · tarefas · baseline
  out.push(rule());
  for (const line of content) out.push(fit(line));
  out.push(rule());
  out.push(footer(screenId === "menu" ? "menu" : screenId));
  return out.join("\n");
}

/* ------------------------------------------------------------------ */
/* Teclado (puro, testável)                                            */
/* ------------------------------------------------------------------ */

export function normalizeKey(input) {
  if (input == null) return null;
  const s = String(input);
  if (s === "\x1b[A" || s === "up") return "up";
  if (s === "\x1b[B" || s === "down") return "down";
  if (s === "\r" || s === "\n" || s === "enter") return "enter";
  if (s === "\x1b" || s === "esc" || s === "escape") return "esc";
  if (s.length === 1) return s.toLowerCase();
  return s;
}

export function handleKey(key, state = {}) {
  const k = normalizeKey(key);
  const count = SCREEN_IDS.length;
  const selected = state.selected ?? 0;
  const screen = state.screen || "menu";
  if (k === "q") return { action: "quit" };
  if (k === "up") return { action: "move", delta: -1, screen };
  if (k === "down") return { action: "move", delta: 1, screen };
  if (k === "enter") {
    if (screen === "menu") {
      const next = SCREENS[selected % count];
      return { action: "select", screen: next.id };
    }
    return { action: "run", screen };
  }
  if (k === "esc") return { action: "back", screen: "menu" };
  if (k === "r" && screen !== "menu") return { action: "run", screen };
  return { action: null, screen };
}

/** Aplica uma ação a um estado, devolvendo o novo estado. */
export function applyAction(state, action) {
  const next = { ...state };
  if (action.action === "quit") return { ...next, quit: true };
  if (action.action === "back") {
    next.screen = "menu";
    return next;
  }
  if (action.action === "select") {
    next.screen = action.screen;
    return next;
  }
  if (action.action === "move") {
    const count = SCREEN_IDS.length;
    const cur = next.selected ?? 0;
    next.selected = ((cur + action.delta) % count + count) % count;
    return next;
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* Execução de ações (r) — chama os comandos existentes                */
/* ------------------------------------------------------------------ */

function exec(command, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, windowsHide: true, ...opts });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d) => (out += d.toString()));
    child.stderr?.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => resolve({ code: 1, out: "", err: String(e.message) }));
    child.on("close", (code) => resolve({ code: code ?? 1, out, err }));
  });
}

export async function runAction(screenId) {
  if (screenId === "evals") {
    const results = [];
    for (const g of ["A", "B", "C"]) {
      const r = await exec("node", [path.join(ROOT, "evals", "run.mjs"), "--group", g, "--no-ledger"]);
      const last = String(r.out).trim().split("\n").pop() || "";
      results.push({ group: g, code: r.code, last });
    }
    return results;
  }
  if (screenId === "verify") {
    const r = await exec("npm", ["run", "verify"], { shell: process.platform === "win32" });
    const last = String(r.out).trim().split("\n").slice(-3).join(" | ") || String(r.err).slice(0, 200);
    return { code: r.code, last };
  }
  if (screenId === "gate") {
    const r = await exec("node", [path.join(ROOT, "evals", "gate.mjs")]);
    const last = String(r.out).trim().split("\n").pop() || "";
    return { code: r.code, last };
  }
  if (screenId === "detect") return { code: 0, last: "detect re-executado" };
  return { code: 0, last: "nada a executar" };
}

/* ------------------------------------------------------------------ */
/* TUI interativo                                                      */
/* ------------------------------------------------------------------ */

async function interactive(data) {
  const stdin = process.stdin;
  const stdout = process.stdout;
  if (!stdin.isTTY || !stdout.isTTY) {
    // Degradação: sem TTY, mostra o menu uma vez e sai (nunca pendura).
    process.stdout.write(renderScreen("menu", data) + "\n");
    process.exitCode = 0;
    return;
  }

  let state = { screen: "menu", selected: 0 };
  let running = false;

  const draw = () => {
    stdout.write("\x1b[2J\x1b[H");
    stdout.write(renderScreen(state.screen, data) + "\n");
  };

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  const cleanup = () => {
    try {
      stdin.setRawMode(false);
    } catch {}
    stdin.off("data", onData);
    stdout.write("\x1b[?25h");
  };

  const onData = async (chunk) => {
    if (running) return;
    const action = handleKey(chunk, state);
    if (action.action === "quit") {
      cleanup();
      process.exitCode = 0;
      return;
    }
    if (action.action === "run") {
      running = true;
      stdout.write("\x1b[2J\x1b[H");
      stdout.write(banner() + "\n" + rule() + "\n");
      stdout.write("  executando…\n");
      const result = await runAction(action.screen);
      stdout.write("\n");
      if (Array.isArray(result)) {
        for (const r of result) stdout.write(`  grupo ${r.group}: ${r.last}\n`);
      } else {
        stdout.write(`  ${result.last || "(sem saída)"}\n`);
      }
      stdout.write("\n  pressione qualquer tecla para voltar\n");
      const once = () => {
        stdin.off("data", once);
        running = false;
        draw();
      };
      stdin.once("data", once);
      return;
    }
    state = applyAction(state, action);
    draw();
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  draw();
  stdin.on("data", onData);
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(
      "uso:\n" +
        "  node apps/cli.mjs                      # TUI interativo (exige TTY)\n" +
        "  node apps/cli.mjs --render <tela>      # imprime o frame como texto e sai\n" +
        "  node apps/cli.mjs --list-screens       # lista as telas\n" +
        `\ntelas: ${SCREEN_IDS.join(", ")}\n`,
    );
    process.exit(0);
  }

  if (args.includes("--list-screens")) {
    const all = [{ id: "menu", label: "Menu" }, ...SCREENS];
    for (const s of all) process.stdout.write(`${s.id}\t${s.label}\n`);
    process.exit(0);
  }

  // versão do package.json (banner)
  try {
    const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
    VERSION = pkg.version || VERSION;
  } catch {
    /* mantém 0.0.0 */
  }

  const renderIdx = args.indexOf("--render");
  if (renderIdx !== -1) {
    const screen = args[renderIdx + 1];
    if (!screen) {
      process.stderr.write("erro: --render exige o nome de uma tela\n");
      process.stderr.write(`telas: ${SCREEN_IDS.join(", ")}\n`);
      process.exit(2);
    }
    if (!SCREEN_IDS.includes(screen) && screen !== "menu") {
      process.stderr.write(`erro: tela desconhecida "${screen}"\n`);
      process.stderr.write(`telas: ${SCREEN_IDS.join(", ")}\n`);
      process.exit(2);
    }
    const data = await loadData();
    process.stdout.write(renderScreen(screen === "menu" ? "menu" : screen, data) + "\n");
    process.exit(0);
  }

  const data = await loadData();
  await interactive(data);
}

// Só executa quando chamado direto; importar (testes) não dispara main().
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`cli: ${err?.stack || err?.message || err}\n`);
    process.exit(2);
  });
}