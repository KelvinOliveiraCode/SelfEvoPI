#!/usr/bin/env node
/**
 * desktop.mjs — o desktop do SelfEvoPI.
 *
 * Um servidor local (127.0.0.1) que serve um painel HTML e uma API de estado.
 * Nasce com `node scripts/desktop.mjs` (ou pelo atalho da Área de Trabalho) e
 * abre no navegador — ou, com `--app`, numa janela sem barra de endereço
 * (Edge/Chrome em modo `--app`), 1280×820, como um programa.
 *
 * Por que um servidor local e não um HTML estático: o painel precisa mostrar o
 * estado **de agora** — evals, lacunas, execuções do grafo, últimos artefatos.
 * Um arquivo aberto com file:// não consegue buscar nada.
 *
 * Segurança:
 *  - escuta só em 127.0.0.1 (nunca na rede)
 *  - ações são uma allowlist explícita; nada de "execute o que vier"
 *  - não lê nada fora da raiz do projeto
 *
 * Uso:
 *   node scripts/desktop.mjs [--port 7777] [--no-open] [--app] [--dry-run]
 *
 *   --no-open   não abre janela nenhuma (CI/headless)
 *   --app       abre como app (Edge primeiro, Chrome depois), 1280×820, sem barra
 *   --dry-run   com --app, só imprime o comando que abriria (não abre)
 *
 * Ciclo de vida: a janela fecha, o servidor continua de pé (Ctrl+C encerra).
 * A API JSON (`/api/state`, `/api/action`) é contrato e não muda.
 */

import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

import { createPiClient } from "../core/agent/pi-rpc.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const APP_W = 1280;
const APP_H = 820;

/** Escapa HTML para valores interpolados no servidor. */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function argValue(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const PORT = Number(argValue("port", "7777"));
const NO_OPEN = process.argv.includes("--no-open");
const APP_MODE = process.argv.includes("--app");
const DRY_RUN = process.argv.includes("--dry-run");
/** Rede de segurança: um turno não fica preso para sempre. */
const TURN_TIMEOUT_MS = 10 * 60_000;
/** Modelo opcional (provider/modelo); sem ele, vale o padrão do motor. */
const MODEL = argValue("model", null);

/* ------------------------------------------------------------------ */
/* Marca (símbolo)                                                     */
/* ------------------------------------------------------------------ */

/**
 * Símbolo da marca em duas variantes:
 *  - `LOGO_HEADER`: traço em `currentColor` (o CSS põe branco no fundo preto).
 *  - `LOGO_FAVICON`: branco sobre placa preta, visível em aba clara e escura.
 * Fonte: `assets/logo.svg`. Não recolorimos fora da paleta — só usamos branco.
 */
let LOGO_HEADER = null;
let LOGO_FAVICON = null;
try {
  const raw = await readFile(path.join(ROOT, "assets", "logo.svg"), "utf8");
  // remove as cores fixas do SVG: o traço passa a herdar `color` do CSS
  LOGO_HEADER = raw.replace(/\scolor="#[0-9a-fA-F]{3,6}"/g, "");
  // favicon: força branco e põe uma placa preta atrás (função de aba clara/escura)
  LOGO_FAVICON = raw
    .replace(/color="#[0-9a-fA-F]{3,6}"/g, 'color="#ffffff"')
    .replace(/(<svg[^>]*>)/, '$1<rect x="0" y="0" width="256" height="256" rx="48" fill="#000000"/>');
} catch {
  LOGO_HEADER = null;
  LOGO_FAVICON = null;
}

/* ------------------------------------------------------------------ */
/* Leitura de estado                                                   */
/* ------------------------------------------------------------------ */

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(path.join(ROOT, file), "utf8"));
  } catch {
    return fallback;
  }
}

/** Lê um texto do projeto, ou null se não existir. */
async function readText(rel) {
  try {
    return await readFile(path.join(ROOT, rel), "utf8");
  } catch {
    return null;
  }
}

async function readJsonl(file, limit = 200) {
  let raw;
  try {
    raw = await readFile(path.join(ROOT, file), "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter((l) => l.trim() !== "")
    .slice(-limit)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { invalid: true, raw: l.slice(0, 120) };
      }
    });
}

async function listDir(rel) {
  const abs = path.join(ROOT, rel);
  try {
    const entries = await readdir(abs, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Coleta o estado que o painel mostra. */
async function collectState() {
  const [baseline, lkg, ledger, artifacts, runs] = await Promise.all([
    readJson("evals/baseline.json"),
    readJson(".pi/harness/last-known-good.json"),
    readJsonl(".pi/harness/ledger/evals.jsonl", 200),
    listDir(".pi/harness/artifacts"),
    (async () => {
      const idx = await readJson(".pi/harness/graph/index.json");
      return Array.isArray(idx?.runs) ? idx.runs : [];
    })(),
  ]);

  const tasks = baseline?.tasks ?? {};
  const groups = {};
  let totalRuns = 0;
  let totalPass = 0;
  for (const t of Object.values(tasks)) {
    groups[t.group] = groups[t.group] ?? { runs: 0, passes: 0 };
    groups[t.group].runs += t.runs ?? 0;
    groups[t.group].passes += t.passes ?? 0;
    totalRuns += t.runs ?? 0;
    totalPass += t.passes ?? 0;
  }

  // últimos resultados do ledger (as execuções mais recentes)
  const recent = ledger.slice(-12).reverse().map((r) => ({
    at: r.at ?? null,
    task: r.taskId ?? "—",
    group: r.group ?? "—",
    ok: r.passed === true,
    ms: r.durationMs ?? 0,
    tokens: r.tokens ?? 0,
    model: r.metrics?.model ?? r.runner ?? "—",
  }));

  const okRuns = recent.filter((r) => r.ok).length;

  return {
    at: new Date().toISOString(),
    baseline: {
      generatedAt: baseline?.generatedAt ?? null,
      tasks: Object.keys(tasks).length,
      runs: totalRuns,
      passes: totalPass,
      rate: totalRuns > 0 ? totalPass / totalRuns : null,
      tokens: baseline?.totals?.tokens ?? 0,
      groups,
    },
    lkg: {
      sha: lkg?.sha ?? null,
      phase: lkg?.phase ?? null,
      verifiedAt: lkg?.verifiedAt ?? null,
      label: lkg?.label ?? null,
    },
    ledger: { total: ledger.length, recent, recentPass: okRuns, recentTotal: recent.length },
    artifacts: artifacts.slice(-20).reverse(),
    runs: runs.slice(-10).reverse(),
  };
}

/* ------------------------------------------------------------------ */
/* Métricas do cabeçalho (snapshot de baseline + last-known-good)      */
/* ------------------------------------------------------------------ */

/** Primeiro número de um texto ("433 ms (meta < 500)" -> 433). */
function firstNumber(text) {
  const m = String(text ?? "").match(/\d[\d.]*/);
  return m ? Number(m[0].replace(/\.$/, "")) : null;
}

/** Acha o `detail` de um check do last-known-good pelo nome. */
function lkgDetail(lkg, name) {
  const check = (lkg?.checks ?? []).find((c) => c && c.name === name);
  return check?.detail ?? null;
}

/**
 * Monta a faixa de métricas. Regra: número sem data é afirmação, número com
 * data é evidência — então todo número medido carrega a data da medição.
 *
 * Fontes, em ordem de preferência:
 *  - execuções / baseline / tarefas: `evals/baseline.json` (ao vivo, "agora")
 *  - cold start: `docs/medidas-2026-11-17.md` -> `docs/estado.md` -> LKG (com data)
 *  - testes:     `docs/estado.md` -> LKG (com data)
 */
async function collectMetrics() {
  const [baseline, lkg, medidas, estado] = await Promise.all([
    readJson("evals/baseline.json"),
    readJson(".pi/harness/last-known-good.json"),
    readText("docs/medidas-2026-11-17.md"),
    readText("docs/estado.md"),
  ]);
  const totals = baseline?.totals ?? {};

  const coldFromMedidas = parseColdStartMedidas(medidas);
  const coldFromEstado = parseColdStartEstado(estado);
  let cold = { value: null, asOf: null, source: null };
  if (coldFromMedidas != null) {
    cold = { value: coldFromMedidas, asOf: "2026-11-17", source: "docs/medidas-2026-11-17.md" };
  } else if (coldFromEstado != null) {
    cold = { value: coldFromEstado, asOf: "2026-11-17", source: "docs/estado.md" };
  } else {
    const n = firstNumber(lkgDetail(lkg, "cold-start"));
    if (n != null) cold = { value: n, asOf: lkg?.verifiedAt ?? null, source: "last-known-good.json" };
  }

  const testsFromEstado = parseTestsEstado(estado);
  let tests = { value: null, asOf: null, source: null };
  if (testsFromEstado != null) {
    tests = { value: testsFromEstado, asOf: "2026-11-17", source: "docs/estado.md" };
  } else {
    const n = firstNumber(lkgDetail(lkg, "unit-tests"));
    if (n != null) tests = { value: n, asOf: lkg?.verifiedAt ?? null, source: "last-known-good.json" };
  }

  return {
    executions: totals.taskRuns ?? 0,
    passes: totals.passes ?? 0,
    baselineRuns: totals.taskRuns ?? 0,
    tasks: Object.keys(baseline?.tasks ?? {}).length,
    tests,
    cold,
    lkgSha: lkg?.sha ?? null,
  };
}

/** Cold start de referência em medidas-2026-11-17.md ("... é o novo valor de referência"). */
function parseColdStartMedidas(text) {
  if (!text) return null;
  const m = text.match(/(\d+)\s*ms\D{0,40}novo valor de referência/i);
  return m ? Number(m[1]) : null;
}

/** Linha "Cold start | **443 ms** ..." de docs/estado.md. */
function parseColdStartEstado(text) {
  if (!text) return null;
  const m = text.match(/Cold start\s*\|[^0-9]*(\d+)\s*ms/i);
  return m ? Number(m[1]) : null;
}

/** Linha "Testes unitários | **449** ..." de docs/estado.md. */
function parseTestsEstado(text) {
  if (!text) return null;
  const m = text.match(/Testes unit[aá]rios\s*\|[^0-9]*(\d+)/i);
  return m ? Number(m[1]) : null;
}

/* ------------------------------------------------------------------ */
/* Ações (allowlist)                                                   */
/* ------------------------------------------------------------------ */

const ACOES = {
  detect: { titulo: "Detectar lacunas", args: ["core/forge/cli.mjs", "detect", "--json"] },
  status: { titulo: "Estado do harness", args: ["core/forge/cli.mjs", "status"] },
  evals: { titulo: "Rodar evals estruturais (A/C)", args: ["evals/run.mjs", "--group", "A"] },
  verify: { titulo: "Verificação completa", args: ["scripts/verify-selfevopi.mjs"] },
};

/** Roda uma ação da allowlist e devolve { ok, stdout, stderr, code }. */
async function runAction(id) {
  const acao = ACOES[id];
  if (!acao) return { ok: false, error: `ação desconhecida: ${id}` };

  const [script, ...args] = acao.args;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, script), ...args], {
      cwd: ROOT,
      windowsHide: true,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    let stdout = "";
    let stderr = "";
    // `buf +=` dentro de arrow não escreve na variável externa: o painel mostraria
    // sempre saída vazia. Aqui a atribuição é explícita.
    const cap = (buf) => {
      if (stdout.length < 200_000) stdout += buf.toString();
    };
    const capErr = (buf) => {
      if (stderr.length < 200_000) stderr += buf.toString();
    };
    child.stdout.on("data", cap);
    child.stderr.on("data", capErr);
    const timer = setTimeout(() => child.kill(), 5 * 60_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout, stderr });
    });
    child.on("error", (err) => resolve({ ok: false, code: -1, stdout, stderr: String(err?.message ?? err) }));
  });
}

/* ------------------------------------------------------------------ */
/* Painel                                                              */
/* ------------------------------------------------------------------ */

/** Data ISO -> dd/mm/aaaa. */
function fmtDate(asOf) {
  if (!asOf) return null;
  const m = String(asOf).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(asOf);
}

/** Um cartão de métrica: número em 400, rótulo muted, data opcional. */
function metricTile({ value, label, date = null, id = null, title = null }) {
  const v = value == null || value === "" ? "—" : esc(value);
  const d = date ? `<span class="md">${esc(date)}</span>` : "";
  return `    <div class="metric"${id ? ` id="${id}"` : ""}${title ? ` title="${esc(title)}"` : ""}>
      <span class="mv">${v}</span>
      <span class="ml">${esc(label)}</span>${d}
    </div>`;
}

function metricsStrip(m) {
  return `  <div class="metrics">
${metricTile({ value: m.executions, label: "execuções", id: "m-exec", title: "execuções de eval na baseline (agora)" })}
${metricTile({ value: `${m.passes}/${m.baselineRuns}`, label: "baseline", id: "m-base", title: "passaram / total (agora)" })}
${metricTile({ value: m.tests.value, label: "testes", date: fmtDate(m.tests.asOf), title: m.tests.source ? `fonte: ${m.tests.source}` : null })}
${metricTile({ value: m.cold.value == null ? null : `${m.cold.value} ms`, label: "cold start", date: fmtDate(m.cold.asOf), title: m.cold.source ? `fonte: ${m.cold.source}` : null })}
${metricTile({ value: m.tasks, label: "tarefas de eval", title: "tarefas de eval na baseline (agora)" })}
  </div>`;
}

/** Painel antigo (métricas, execuções, artefatos, grafo). Continua acessível em /panel. */
function panelPage(m) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SelfEvoPI — desktop</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
  :root {
    --bg:#000000; --bg-2:#0d0d0d; --bg-3:#1a1a1a;
    --fg:#ffffff; --muted:#787878;
    --line:rgba(255,255,255,.08); --line-strong:rgba(255,255,255,.18);
    --ok:#3FB950; --warn:#D29922; --fail:#F85149;
    --font:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
    --r:8px; --ease:cubic-bezier(.22,1,.36,1); --t:200ms;
  }
  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;background:var(--bg);color:var(--fg);
    font:400 15.5px/1.5 var(--font);-webkit-font-smoothing:antialiased}
  .wrap{max-width:1180px;margin:0 auto;padding:16px;display:flex;flex-direction:column;gap:16px}

  /* cabeçalho 56 px */
  header{height:56px;display:flex;align-items:center;gap:12px;
    border-bottom:1px solid var(--line)}
  header .logo{width:32px;height:32px;color:#fff;flex:0 0 auto}
  header .logo svg{width:100%;height:100%;display:block}
  header h1{font-size:17px;font-weight:500;letter-spacing:-0.01em;margin:0}
  header .host{margin-left:auto;display:inline-flex;align-items:center;gap:8px;
    color:var(--muted);font-size:13px}
  .dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:0 0 auto}
  .dot.ok{background:var(--ok)} .dot.warn{background:var(--warn)} .dot.fail{background:var(--fail)}

  /* faixa de métricas */
  .metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1px;
    background:var(--line);border:1px solid var(--line);border-radius:var(--r);overflow:hidden}
  .metric{background:var(--bg-2);padding:14px 16px;display:flex;flex-direction:column;gap:2px}
  .metric .mv{font-size:24px;font-weight:400;letter-spacing:-0.01em;font-variant-numeric:tabular-nums}
  .metric .ml{font-size:13px;color:var(--muted)}
  .metric .md{font-size:11px;color:var(--muted);opacity:.75}

  section{background:var(--bg-2);border:1px solid var(--line);border-radius:var(--r);padding:16px 18px}
  section h2{font-size:12px;font-weight:500;margin:0 0 12px;color:var(--muted);
    text-transform:uppercase;letter-spacing:.06em}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line)}
  th{font-size:12px;color:var(--muted);font-weight:400}
  tr:last-child td{border-bottom:none}
  td.num{font-variant-numeric:tabular-nums}
  .cellstate{display:inline-flex;align-items:center;gap:7px}

  .btns{display:flex;flex-wrap:wrap;gap:8px}
  button{background:var(--bg-2);color:var(--fg);border:1px solid var(--line);
    border-radius:var(--r);padding:9px 15px;font:400 13px/1 var(--font);cursor:pointer;
    transition:background-color var(--t) var(--ease), border-color var(--t) var(--ease)}
  button:hover{background:var(--bg-3);border-color:var(--line-strong)}
  button:disabled{opacity:.5;cursor:wait}
  pre{background:var(--bg);border:1px solid var(--line);border-radius:var(--r);padding:12px;
    overflow:auto;max-height:340px;font:400 12px/1.5 var(--font);margin:0;white-space:pre-wrap}
  footer{color:var(--muted);font-size:12px;text-align:center}
  .muted{color:var(--muted)}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <span class="logo">${LOGO_HEADER ?? ""}</span>
    <h1>SelfEvoPI</h1>
    <span class="host"><span class="dot ok"></span>127.0.0.1:${PORT}</span>
  </header>

  ${metricsStrip(m)}

  <section>
    <h2>Ações</h2>
    <div class="btns">
      <button data-act="status">Estado do harness</button>
      <button data-act="detect">Detectar lacunas</button>
      <button data-act="evals">Evals A + C</button>
      <button data-act="verify">Verificação completa</button>
    </div>
    <pre id="out" style="display:none;margin-top:12px"></pre>
  </section>

  <section>
    <h2>Evals por grupo</h2>
    <table><thead><tr><th>Grupo</th><th>Execuções</th><th>Passaram</th><th>Taxa</th></tr></thead>
    <tbody id="grupos"></tbody></table>
  </section>

  <section>
    <h2>Últimas execuções</h2>
    <table><thead><tr><th>Quando</th><th>Tarefa</th><th>Grupo</th><th>Resultado</th><th>ms</th><th>Tokens</th></tr></thead>
    <tbody id="recent"></tbody></table>
  </section>

  <section>
    <h2>Artefatos promovidos</h2>
    <table><thead><tr><th>Artefato</th></tr></thead><tbody id="arts"></tbody></table>
  </section>

  <section>
    <h2>Execuções do grafo</h2>
    <table><thead><tr><th>Run</th><th>Estado</th><th>Progresso</th><th>Nós</th></tr></thead>
    <tbody id="runs"></tbody></table>
  </section>

  <footer>atualiza a cada 5 s · Ctrl+C no terminal encerra o desktop</footer>
</div>

<script>
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function dot(cls, text) {
  return "<span class='cellstate'><span class='dot " + cls + "'></span>" + esc(text) + "</span>";
}

async function refresh() {
  try {
    const s = await (await fetch("/api/state")).json();

    const b = s.baseline || {};
    $("#m-exec").textContent = b.runs ?? 0;
    $("#m-base").textContent = (b.passes ?? 0) + "/" + (b.runs ?? 0);

    const g = b.groups || {};
    $("#grupos").innerHTML = Object.keys(g).sort().map((k) => {
      const x = g[k];
      const r = x.runs ? Math.round((x.passes / x.runs) * 100) : 0;
      const cls = r === 100 ? "ok" : r >= 90 ? "warn" : "fail";
      return "<tr><td>" + esc(k) + "</td><td class='num'>" + x.runs + "</td><td class='num'>" + x.passes +
        "</td><td>" + dot(cls, r + "%") + "</td></tr>";
    }).join("") || "<tr><td colspan='4' class='muted'>sem dados de baseline</td></tr>";

    const led = s.ledger || {};
    $("#recent").innerHTML = (led.recent || []).map((r) =>
      "<tr><td>" + esc((r.at || "").replace("T", " ").slice(0, 19)) + "</td><td>" +
      esc(r.task) + "</td><td>" + esc(r.group) + "</td><td>" +
      (r.ok ? dot("ok", "passou") : dot("fail", "falhou")) +
      "</td><td class='num'>" + (r.ms || 0) + "</td><td class='num'>" + (r.tokens || 0) + "</td></tr>"
    ).join("") || "<tr><td colspan='6' class='muted'>nenhuma execução registrada</td></tr>";

    $("#arts").innerHTML = (s.artifacts || []).map((a) =>
      "<tr><td>" + esc(a) + "</td></tr>"
    ).join("") || "<tr><td class='muted'>nenhum artefato promovido ainda</td></tr>";

    $("#runs").innerHTML = (s.runs || []).map((r) => {
      const p = r.progress == null ? "—" : Math.round(r.progress * 100) + "%";
      return "<tr><td>" + esc(r.runId) + "</td><td>" + esc(r.status) +
        "</td><td class='num'>" + p + "</td><td class='num'>" + (r.done ?? 0) + "/" + (r.nodes ?? 0) + "</td></tr>";
    }).join("") || "<tr><td colspan='4' class='muted'>nenhuma execução de grafo</td></tr>";
  } catch (e) {
    const foot = document.querySelector("footer");
    if (foot) foot.textContent = "erro: " + e.message;
  }
}

document.querySelectorAll("button[data-act]").forEach((b) => {
  b.addEventListener("click", async () => {
    const out = $("#out");
    out.style.display = "block";
    out.textContent = "rodando " + b.dataset.act + "…";
    const buttons = document.querySelectorAll("button[data-act]");
    buttons.forEach((x) => (x.disabled = true));
    try {
      const r = await (await fetch("/api/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: b.dataset.act }),
      })).json();
      out.textContent = (r.stdout || "") + (r.stderr ? "\\n[stderr]\\n" + r.stderr : "") +
        (r.ok ? "\\n\\n[ok] concluído" : "\\n\\n[erro] falhou (exit " + r.code + ")");
    } catch (e) {
      out.textContent = "erro: " + e.message;
    } finally {
      buttons.forEach((x) => (x.disabled = false));
      refresh();
    }
  });
});

refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;
}


/* ------------------------------------------------------------------ */
/* Navegador (modo --app)                                              */
/* ------------------------------------------------------------------ */

const BROWSERS = [
  {
    name: "Edge",
    paths: [
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      path.join(process.env.LOCALAPPDATA ?? "", "Microsoft\\Edge\\Application\\msedge.exe"),
    ],
  },
  {
    name: "Chrome",
    paths: [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      path.join(process.env.LOCALAPPDATA ?? "", "Google\\Chrome\\Application\\chrome.exe"),
    ],
  },
];

/** Primeiro navegador instalado (Edge antes de Chrome), ou null. */
function findBrowser() {
  for (const b of BROWSERS) {
    for (const p of b.paths) {
      if (p && existsSync(p)) return { name: b.name, path: p };
    }
  }
  return null;
}

/** Comando do modo app (sem abrir): [exe, ...args]. */
function appCommand(browser, url) {
  // perfil dedicado dentro de .pi/harness/tmp (gitignore): evita reaproveitar a
  // sessão do navegador do usuário e não deixa caminho pessoal no comando.
  const profile = path.join(ROOT, ".pi", "harness", "tmp", "app-profile");
  return [browser.path, [`--app=${url}`, `--window-size=${APP_W},${APP_H}`, `--user-data-dir=${profile}`]];
}

/* ------------------------------------------------------------------ */
/* Tela principal: conversa                                            */
/* ------------------------------------------------------------------ */

function chatPage(m) {
  const tests = m.tests.value == null ? "—" : String(m.tests.value);
  const cold = m.cold.value == null ? "—" : `${m.cold.value} ms`;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SelfEvoPI — conversa</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
  :root {
    --bg:#000000; --bg-2:#0d0d0d; --bg-3:#1a1a1a;
    --fg:#ffffff; --muted:#787878;
    --line:rgba(255,255,255,.08); --line-strong:rgba(255,255,255,.18);
    --ok:#3FB950; --warn:#D29922; --fail:#F85149;
    --font:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
    --r:8px; --ease:cubic-bezier(.22,1,.36,1); --t:200ms;
  }
  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;background:var(--bg);color:var(--fg);
    font:400 15.5px/1.6 var(--font);-webkit-font-smoothing:antialiased}
  .app{height:100%;display:flex;flex-direction:column;max-width:900px;margin:0 auto;padding:0 16px}

  header{height:56px;flex:0 0 auto;display:flex;align-items:center;gap:12px;
    border-bottom:1px solid var(--line)}
  header .logo{width:30px;height:30px;color:#fff;flex:0 0 auto}
  header .logo svg{width:100%;height:100%;display:block}
  header h1{font-size:16px;font-weight:500;letter-spacing:-0.01em;margin:0}
  header .host{margin-left:auto;display:inline-flex;align-items:center;gap:8px;color:var(--muted);font-size:12.5px}
  header .dot{width:8px;height:8px;border-radius:50%;background:var(--ok);display:inline-block}
  header a{color:var(--muted);text-decoration:none;font-size:12.5px;padding:6px 8px;border-radius:6px;
    transition:background-color var(--t) var(--ease),color var(--t) var(--ease)}
  header a:hover{background:var(--bg-3);color:var(--fg)}

  main{flex:1 1 auto;overflow-y:auto;padding:20px 0 8px;display:flex;flex-direction:column;gap:18px}

  .msg{display:flex;flex-direction:column;gap:4px}
  .msg .who{font-size:11.5px;letter-spacing:.08em;color:var(--muted);text-transform:uppercase;font-weight:500}
  .msg .body{white-space:normal}
  .msg.you .body{color:var(--fg)}
  .msg.agent .body{color:var(--fg)}
  .msg .body strong{font-weight:500}
  .msg .body code{background:var(--bg-3);padding:1px 5px;border-radius:4px;font-size:.92em}

  .tool{margin-top:6px;color:var(--muted);font-size:13px;display:flex;align-items:baseline;gap:7px}
  .tool .sym{color:var(--muted)}
  .tool .tn{font-weight:500;color:var(--fg)}
  .tool .ta{opacity:.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60ch}

  .composer{flex:0 0 auto;padding:10px 0 6px;border-top:1px solid var(--line);background:var(--bg)}
  .actions{display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap}
  .actions button{background:var(--bg-2);color:var(--muted);border:1px solid var(--line);
    border-radius:6px;padding:5px 10px;font:400 12px/1 var(--font);cursor:pointer;
    transition:background-color var(--t) var(--ease),color var(--t) var(--ease),border-color var(--t) var(--ease)}
  .actions button:hover{background:var(--bg-3);color:var(--fg);border-color:var(--line-strong)}

  .inputwrap{display:flex;align-items:flex-end;gap:8px;background:var(--bg-2);
    border:1px solid var(--line);border-radius:var(--r);padding:10px 12px;
    transition:border-color var(--t) var(--ease)}
  .inputwrap:focus-within{border-color:var(--line-strong)}
  .inputwrap .prompt{color:var(--muted);font-size:15px;flex:0 0 auto}
  textarea{flex:1 1 auto;background:transparent;border:none;outline:none;resize:none;
    color:var(--fg);font:400 15.5px/1.6 var(--font);max-height:180px;padding:0}
  textarea::placeholder{color:var(--muted)}

  footer{flex:0 0 auto;padding:8px 0 12px;color:var(--muted);font-size:12px;display:flex;
    justify-content:space-between;gap:12px;flex-wrap:wrap}
  .dot-sep{opacity:.5;padding:0 4px}
</style>
</head>
<body>
<div class="app">
  <header>
    <span class="logo">${LOGO_HEADER ?? ""}</span>
    <h1>SelfEvoPI</h1>
    <span class="host"><span class="dot"></span>127.0.0.1:${PORT}</span>
    <a href="/panel">painel</a>
  </header>

  <main id="log"></main>

  <div class="composer">
    <div class="actions">
      <button data-send="/evals">/evals</button>
      <button data-send="/detect">/detect</button>
      <button data-send="/gate">/gate</button>
    </div>
    <div class="inputwrap">
      <span class="prompt">&gt;</span>
      <textarea id="input" rows="1" placeholder="escreva uma mensagem..."></textarea>
    </div>
  </div>

  <footer>
    <span>${m.passes}/${m.baselineRuns} baseline<span class="dot-sep">·</span>${tests} testes<span class="dot-sep">·</span>${cold}</span>
    <span>enter envia<span class="dot-sep">·</span>shift+enter quebra</span>
  </footer>
</div>

<script>
const log = document.getElementById("log");
const input = document.getElementById("input");
const msgs = [];
let streaming = false;

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
}
function md(s) {
  let h = esc(s);
  h = h.replace(/\`([^\`]+)\`/g, "<code>$1</code>");
  h = h.replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");
  return h;
}

function render() {
  log.innerHTML = "";
  for (const m of msgs) {
    const wrap = document.createElement("div");
    wrap.className = "msg " + (m.role === "you" ? "you" : "agent");

    const who = document.createElement("div");
    who.className = "who";
    who.textContent = m.role === "you" ? "Você" : "SelfEvoPI";

    const body = document.createElement("div");
    body.className = "body";
    if (m.role === "you") {
      body.textContent = m.text;
    } else {
      body.innerHTML = md(m.text);
      for (const t of m.tools) {
        const line = document.createElement("div");
        line.className = "tool";
        line.innerHTML = "<span class='sym'>⏺</span><span class='tn'>" + esc(t.name) +
          "</span>" + (t.arg ? "<span class='ta'>" + esc(t.arg) + "</span>" : "");
        body.appendChild(line);
      }
    }

    wrap.appendChild(who);
    wrap.appendChild(body);
    log.appendChild(wrap);
  }
  log.scrollTop = log.scrollHeight;
}

function currentAgent() {
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "agent") return msgs[i];
  return null;
}

function resize() {
  input.style.height = "auto";
  input.style.height = Math.min(180, input.scrollHeight) + "px";
}

async function send(text) {
  const msg = String(text || "").trim();
  if (!msg || streaming) return;
  msgs.push({ role: "you", text: msg });
  const agent = { role: "agent", text: "", tools: [] };
  msgs.push(agent);
  streaming = true;
  input.value = "";
  resize();
  render();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: msg }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      if (agent.text === "" && agent.tools.length === 0) msgs.pop();
      msgs.push({ role: "agent", text: j.error || "não consegui iniciar o turno.", tools: [] });
      streaming = false;
      render();
    }
  } catch (e) {
    if (agent.text === "" && agent.tools.length === 0) msgs.pop();
    msgs.push({ role: "agent", text: "não consegui falar com o servidor.", tools: [] });
    streaming = false;
    render();
  }
}

const es = new EventSource("/api/chat/stream");
es.addEventListener("text", (e) => {
  let d = {};
  try { d = JSON.parse(e.data); } catch { return; }
  const a = currentAgent();
  if (a && typeof d.delta === "string") { a.text += d.delta; render(); }
});
es.addEventListener("tool", (e) => {
  let d = {};
  try { d = JSON.parse(e.data); } catch { return; }
  const a = currentAgent();
  if (a) { a.tools.push({ name: d.name || "tool", arg: d.arg || "" }); render(); }
});
es.addEventListener("error", (e) => {
  let d = {};
  try { d = JSON.parse(e.data); } catch { return; }
  const a = currentAgent();
  if (a) {
    if (a.text === "" && a.tools.length === 0) a.text = d.message || "não consegui concluir.";
    else a.text += "\\n\\n" + (d.message || "não consegui concluir.");
    render();
  }
});
es.addEventListener("settled", () => {
  streaming = false;
  input.focus();
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send(input.value);
  }
});
input.addEventListener("input", resize);

document.querySelectorAll("button[data-send]").forEach((b) => {
  b.addEventListener("click", () => send(b.dataset.send));
});

render();
input.focus();
</script>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/* Conversa (canal SSE + cliente compartilhado)                        */
/* ------------------------------------------------------------------ */

/**
 * Um único cliente de conversa por processo — é a mesma camada que a CLI usa
 * (`core/agent/pi-rpc.mjs`). O front-end nunca fala do motor: quem traduz
 * evento é o cliente; aqui só viramos evento em SSE.
 */
let piClient = null;
let piPromise = null;
let turnRunning = false;
const sseClients = new Set();

async function ensurePi() {
  if (piClient) return piClient;
  if (!piPromise) {
    piPromise = createPiClient({ cwd: ROOT, ...(MODEL ? { model: MODEL } : {}) }).then(
      (c) => {
        piClient = c;
        return c;
      },
      (err) => {
        piPromise = null;
        throw err;
      }
    );
  }
  return piPromise;
}

function sseSend(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    sseClients.delete(res);
  }
}

function broadcast(event, data) {
  for (const res of sseClients) sseSend(res, event, data);
}

/** Voz do produto: nunca ecoa o erro cru do provedor. */
function productError(err) {
  const code = err && err.code;
  const raw = String((err && err.message) || err || "");
  if (code === "ENGINE_NOT_FOUND" || /motor não encontrado/i.test(raw)) {
    return "Não consegui iniciar a conversa: o componente de conversa não está instalado nesta máquina.";
  }
  if (code === "ENGINE_NO_RPC" || /RpcClient/i.test(raw)) {
    return "Não consegui iniciar a conversa: o componente de conversa está incompleto.";
  }
  if (/401|auth|token|credencial|bearer/i.test(raw)) {
    return "Falha de autenticação com o provedor. Confira as credenciais e tente de novo.";
  }
  if (/429|rate|limite/i.test(raw)) {
    return "O provedor está limitando as chamadas agora. Tente novamente em instantes.";
  }
  return "Não consegui concluir este turno. Tente novamente.";
}

/**
 * Executa um turno: dispara eventos SSE e serializa (um por vez).
 * `prompt()` apenas confirma o aceite ("started") — o turno termina no evento
 * `settled`. Por isso o encerramento NÃO espera o retorno do prompt.
 */
function runTurn(message) {
  if (turnRunning) return Promise.resolve(false);
  turnRunning = true;

  return (async () => {
    let client;
    try {
      client = await ensurePi();
    } catch (err) {
      broadcast("error", { message: productError(err) });
      broadcast("settled", { aborted: false });
      turnRunning = false;
      return true;
    }

    return await new Promise((resolve) => {
      let done = false;
      let timer = null;

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        for (const off of offs) {
          try {
            off();
          } catch {
            /* idem */
          }
        }
      };

      const finishTurn = (aborted) => {
        if (done) return;
        done = true;
        cleanup();
        broadcast("settled", { aborted: !!aborted });
        turnRunning = false;
        resolve(true);
      };

      const offs = [
        client.on("text", (delta) => broadcast("text", { delta })),
        client.on("tool", (call) =>
          broadcast("tool", {
            name: call?.name ?? "tool",
            phase: call?.phase ?? "start",
            arg: toolArg(call?.args),
            isError: call?.isError === true,
          })
        ),
        client.on("error", (msg) => broadcast("error", { message: productError({ message: msg }) })),
        client.on("settled", (info) => finishTurn(info && info.aborted)),
      ];

      // rede de segurança: um turno não fica preso para sempre
      timer = setTimeout(() => {
        if (done) return;
        broadcast("error", { message: "O turno demorou demais e foi encerrado." });
        finishTurn(true);
        client.abort?.().catch?.(() => {});
      }, TURN_TIMEOUT_MS);

      // dispara; o fim é o evento `settled`, não o retorno do prompt
      Promise.resolve(client.prompt(message)).catch((err) => {
        if (done) return;
        broadcast("error", { message: productError(err) });
        finishTurn(false);
      });
    });
  })();
}

/** Extrai um argumento curto e legível para a linha de ferramenta. */
function toolArg(args) {
  if (typeof args === "string") return args.slice(0, 100);
  if (args && typeof args === "object") {
    for (const v of Object.values(args)) {
      if (typeof v === "string" && v.trim()) return v.slice(0, 100);
    }
  }
  return "";
}

/* ------------------------------------------------------------------ */
/* Servidor                                                            */
/* ------------------------------------------------------------------ */

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

  // tela principal: a conversa
  if (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/chat") {
    const metrics = await collectMetrics();
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(chatPage(metrics));
    return;
  }

  // painel antigo (métricas, execuções, artefatos, grafo) — continua acessível
  if (url.pathname === "/panel") {
    const metrics = await collectMetrics();
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(panelPage(metrics));
    return;
  }

  // favicon: não há conversor de SVG→ICO nesta máquina; serve o próprio SVG
  // (branco sobre placa preta, legível em aba clara e escura).
  if (url.pathname === "/favicon.ico" || url.pathname === "/favicon.svg") {
    if (!LOGO_FAVICON) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("logo não encontrado");
      return;
    }
    res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "public, max-age=3600" });
    res.end(LOGO_FAVICON);
    return;
  }

  if (url.pathname === "/api/state") {
    const state = await collectState();
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(state));
    return;
  }

  // conversa: aceita um turno
  if (url.pathname === "/api/chat" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      let message = "";
      try {
        message = String(JSON.parse(body || "{}").message ?? "");
      } catch {
        message = "";
      }
      if (!message.trim()) {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "mensagem vazia" }));
        return;
      }
      if (turnRunning) {
        res.writeHead(409, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "um turno já está em execução" }));
        return;
      }
      res.writeHead(202, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true }));
      await runTurn(message);
    });
    return;
  }

  // conversa: stream de eventos (SSE)
  if (url.pathname === "/api/chat/stream") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    res.write(": conectado\n\n");
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  if (url.pathname === "/api/action" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      let id = null;
      try {
        id = JSON.parse(body || "{}").id;
      } catch {
        /* corpo inválido */
      }
      const r = await runAction(id);
      res.writeHead(r.ok ? 200 : 500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(r));
    });
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("não encontrado");
});

server.listen(PORT, "127.0.0.1", () => {
  const addr = `http://127.0.0.1:${PORT}`;
  process.stdout.write(`SelfEvoPI desktop: ${addr}\n`);
  process.stdout.write(`(escute só em 127.0.0.1 · Ctrl+C para encerrar)\n`);

  if (!LOGO_FAVICON) {
    process.stdout.write(`AVISO: assets/logo.svg ausente; sem ícone de marca.\n`);
  } else {
    process.stdout.write(`favicon: nenhum conversor SVG->ICO disponível; servindo o SVG em /favicon.ico e /favicon.svg\n`);
  }
  if (MODEL) process.stdout.write(`modelo: ${MODEL}\n`);

  if (NO_OPEN) {
    process.stdout.write(`--no-open: não vou abrir janela (headless).\n`);
    return;
  }

  if (APP_MODE) {
    const browser = findBrowser();
    if (!browser) {
      process.stdout.write(`AVISO: nem Edge nem Chrome foram encontrados; abrindo no navegador padrão (modo app indisponível).\n`);
      launchDefault(addr);
      return;
    }
    const [exe, args] = appCommand(browser, addr);
    if (DRY_RUN) {
      process.stdout.write(`[dry-run] ${browser.name}: "${exe}" ${args.join(" ")}\n`);
      return;
    }
    process.stdout.write(`abrindo como app (${browser.name}) ${APP_W}x${APP_H} sem barra de endereço\n`);
    spawn(exe, args, { detached: true, stdio: "ignore" }).unref();
    return;
  }

  launchDefault(addr);
});

function launchDefault(addr) {
  if (DRY_RUN) {
    process.stdout.write(`[dry-run] abriria ${addr} no navegador padrão\n`);
    return;
  }
  const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", addr] : [addr];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    process.stdout.write("\nencerrando o desktop.\n");
    for (const res of sseClients) {
      try {
        res.end();
      } catch {
        /* idem */
      }
    }
    sseClients.clear();
    if (piClient) {
      piClient.close().catch(() => {});
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  });
}
