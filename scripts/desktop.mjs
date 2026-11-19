#!/usr/bin/env node
/**
 * desktop.mjs — o desktop do SelfEvoPI.
 *
 * Um servidor local (127.0.0.1) que serve a conversa e uma API de estado.
 * Nasce com `node scripts/desktop.mjs` (ou pelo atalho da Área de Trabalho) e
 * abre no navegador — ou, com `--app`, numa janela sem barra de endereço
 * (Edge/Chrome em modo `--app`), 1280×820, como um programa.
 *
 * Por que um servidor local e não um HTML estático: a conversa precisa falar com
 * o motor **de agora** — sessões, streaming, estado do modelo.
 * Um arquivo aberto com file:// não consegue buscar nada.
 *
 * Segurança:
 *  - escuta só em 127.0.0.1 (nunca na rede)
 *  - o chat fala com o motor por uma allowlist de rotas; nada de "execute o que vier"
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
 * A API JSON (`/api/state`, `/api/chat`, `/api/status`, `/api/integrations`, `/api/sessions*`) é contrato e não muda.
 */

import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

import { createPiClient } from "../core/agent/pi-rpc.mjs";
import { handleSessionRoute } from "./desktop-sessions.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const APP_W = 1280;
const APP_H = 820;

/**
 * Pasta de sessões do projeto em execução.
 *
 * O motor grava em ~/.pi/agent/sessions/<cwd codificado>/<iso>_<uuid>.jsonl.
 * A CLI acha a subpasta certa casando `header.cwd` com a raiz do projeto
 * (sessionDir() em apps/cli.mjs). A mesma regra aqui: sem ela, CLI e desktop
 * conversariam sobre a base e nunca sobre a mesma sessão.
 */
async function sessionDir() {
  const base = path.join(process.env.USERPROFILE || process.env.HOME || ".", ".pi", "agent", "sessions");
  const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
  let parseSession = () => ({ header: null });
  try {
    ({ parseSession } = await import("../core/agent/sessions.mjs"));
  } catch {
    return base;
  }
  const alvo = String(ROOT).replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const sub = path.join(base, e.name);
    const files = (await readdir(sub).catch(() => [])).filter((f) => f.endsWith(".jsonl"));
    if (files.length === 0) continue;
    const { header } = parseSession(await readFile(path.join(sub, files[0]), "utf8").catch(() => ""));
    const cwd = header && typeof header.cwd === "string" ? header.cwd : null;
    if (cwd && cwd.replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase() === alvo) return sub;
  }
  // Sem pasta do projeto: estado vazio honesto. NUNCA devolver a base — ela
  // reúne sessões de TODOS os projetos, e o desktop mostraria sessões que o
  // usuário nunca usou. Um caminho inexistente faz listSessions devolver []
  // (nenhuma sessão ainda), que é a verdade quando o projeto não conversou.
  return path.join(base, "__sem_sessoes_do_projeto__");
}

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

/** Coleta o estado da conversa (baseline, ledger, artefatos, grafo). */
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
    cold = { value: coldFromMedidas, asOf: docDate(medidas, "docs/medidas-2026-11-17.md"), source: "docs/medidas-2026-11-17.md" };
  } else if (coldFromEstado != null) {
    cold = { value: coldFromEstado, asOf: docDate(estado, "docs/estado.md"), source: "docs/estado.md" };
  } else {
    const n = firstNumber(lkgDetail(lkg, "cold-start"));
    if (n != null) cold = { value: n, asOf: lkg?.verifiedAt ?? null, source: "last-known-good.json" };
  }

  const testsFromEstado = parseTestsEstado(estado);
  let tests = { value: null, asOf: null, source: null };
  if (testsFromEstado != null) {
    tests = { value: testsFromEstado, asOf: docDate(estado, "docs/estado.md"), source: "docs/estado.md" };
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

/**
 * Data de medição de um documento.
 *
 * Numero com data e evidencia; numero sem data e afirmacao. A data vem do
 * proprio documento — do cabeçalho "Atualizado: AAAA-MM-DD" quando existe,
 * do nome do arquivo (medidas-AAAA-MM-DD.md) quando e o que ele carrega.
 * Fixar a data no codigo seria dizer "medido em" um dia que nao e o da medição.
 */
function docDate(text, filePath) {
  if (text) {
    const noHeader = text.match(/Atualizado:\*{0,2}\s*(\d{4}-\d{2}-\d{2})/i);
    if (noHeader) return noHeader[1];
  }
  if (filePath) {
    const noNome = String(filePath).match(/(\d{4}-\d{2}-\d{2})/);
    if (noNome) return noNome[1];
  }
  return null;
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
/* Formatação                                                          */
/* ------------------------------------------------------------------ */

/** Data ISO -> dd/mm/aaaa. */
function fmtDate(asOf) {
  if (!asOf) return null;
  const m = String(asOf).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(asOf);
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
  const tests = m.tests.value == null ? "-" : String(m.tests.value);
  const css = readFileSync(path.join(ROOT, "apps", "desktop", "desktop.css"), "utf8");
  const js = readFileSync(path.join(ROOT, "apps", "desktop", "app.js"), "utf8");
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SelfEvoPI — conversa</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>${css}</style>
</head>
<body>
<div class="app">
  <aside class="sessions" id="sessions" aria-label="sessoes"></aside>
  <header>
    <span class="logo">${LOGO_HEADER ?? ""}</span>
    <h1>SelfEvoPI</h1>
    <span class="spacer"></span>
    <span class="host"><span class="dot" id="hdot"></span><span id="host">127.0.0.1:${PORT}</span></span>
    <a href="#" id="settings">config</a>
    <a href="#" id="openDrawer">skills</a>
  </header>

  <div class="statusbar" id="status">
    <span class="item">modo
      <span class="modes" id="modes"></span>
    </span>
    <span class="item">permissão <b id="s-perm">ask</b></span>
    <span class="item">modelo <b id="s-model">—</b></span>
    <span class="item">effort <b id="s-effort">—</b></span>
    <span class="item">cap. <b id="s-caps">—</b></span>
    <span class="item">raciocínio <b id="s-reason">—</b></span>
  </div>

  <main id="chat"></main>

  <div id="working" class="working"><span class="pulse"></span><span>trabalhando<span class="dots" id="dots"></span></span></div>

  <div class="composer" id="composer">
    <div class="actions">
      <button data-send="/evals">/evals</button>
      <button data-send="/detect">/detect</button>
      <button data-send="/gate">/gate</button>
    </div>
    <div class="inputwrap">
      <span class="prompt">&gt;</span>
      <textarea id="input" rows="1" placeholder="escreva uma mensagem..."></textarea>
      <button id="send" type="button" class="send">enviar</button>
    </div>
    <div id="controlBar" class="controlbar"></div>
  </div>

  <div id="verify" class="verify none">verificação: nenhuma ação executada — o texto do modelo não é evidência</div>

  <div id="settingsPanel" class="settingspanel none" aria-label="configuracoes"></div>

  <footer>
    <span>${m.passes}/${m.baselineRuns} baseline<span class="dot-sep">·</span>${tests} testes</span>
    <span><kbd>/</kbd> commands<span class="dot-sep">·</span><kbd>@</kbd> files<span class="dot-sep">·</span><kbd>!</kbd> shell<span class="dot-sep">·</span><kbd>Ctrl</kbd>+<kbd>K</kbd> sessões<span class="dot-sep">·</span>enter envia</span>
  </footer>
</div>

<aside class="drawer" id="drawer">
  <header><h2>skills &amp; MCP</h2><span class="spacer"></span><a href="#" id="closeDrawer">fechar</a></header>
  <div class="body" id="drawerBody"></div>
</aside>

<aside class="settings-panel" id="settingsPanel"></aside>

<script type="module">${js}</script>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/* Conversa (canal SSE + cliente compartilhado)                        */
/* ------------------------------------------------------------------ */

/**
 * Modos da conversa. É um conceito do SelfEvoPI (não do motor): muda a
 * diretiva enviada com cada turno, e a barra de estado mostra qual está ativo.
 */
export const MODES = Object.freeze({
  ask: "Responda apenas com explicação, sem executar ferramentas.",
  plan: "Antes de agir, descreva o plano em passos curtos e espere confirmação.",
  build: "",
});

function modeDirective(mode) {
  return MODES[mode] ?? MODES.build;
}

/**
 * Um único cliente de conversa por processo — é a mesma camada que a CLI usa
 * (`core/agent/pi-rpc.mjs`). O front-end nunca fala do motor: quem traduz
 * evento é o cliente; aqui só viramos evento em SSE.
 */
let piClient = null;
let piPromise = null;
let turnRunning = false;
let currentMode = "build";
const sseClients = new Set();

async function ensurePi() {
  if (piClient) return piClient;
  if (!piPromise) {
    piPromise = createPiClient({ cwd: ROOT, ...(MODEL ? { model: MODEL } : {}) }).then(
      (c) => {
        piClient = c;
        // raciocínio: o cliente normalizado descarta thinking_delta; assinamos o
        // stream cru para mostrar o pensamento (discreto). Se o motor não emitir,
        // simplesmente não chega nada — e a barra diz "não exposto".
        try {
          const raw = c._rpc;
          if (raw && typeof raw.onEvent === "function") {
            raw.onEvent((ev) => {
              const inner = ev?.assistantMessageEvent;
              if (ev?.type === "message_update" && inner?.type === "thinking_delta" && typeof inner.delta === "string") {
                broadcast("thinking", { delta: inner.delta });
              }
            });
          }
        } catch {
          /* sem acesso ao cru: raciocínio fica "não exposto" */
        }
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

/** Estado do motor para a conversa (modelo, effort, streaming, capacidades). */
async function piState() {
  try {
    const client = await ensurePi();
    const st = (await client._rpc.getState()) ?? {};
    const model = st.model ?? null;
    const caps = Array.isArray(model?.input) ? model.input.map(String) : [];
    return {
      available: true,
      model: model ? model.name || model.id || null : null,
      modelId: model?.id ?? null,
      provider: model?.provider ?? null,
      thinkingLevel: st.thinkingLevel ?? null,
      reasoning: model?.reasoning === true,
      capabilities: caps,
      isStreaming: st.isStreaming === true,
      sessionId: st.sessionId ?? null,
      messageCount: st.messageCount ?? 0,
    };
  } catch (err) {
    return { available: false, reason: productError(err) };
  }
}

/** Skills (via comandos do motor) e MCP (via configuração), com falhas e log. */
async function integrations() {
  const out = { skills: [], mcp: [], stderr: "", source: "motor" };
  try {
    const client = await ensurePi();
    const res = await client._rpc.getCommands();
    const cmds = Array.isArray(res) ? res : Array.isArray(res?.commands) ? res.commands : [];
    out.skills = cmds
      .filter((c) => c && (c.source === "skill" || String(c.name || "").startsWith("skill:")))
      .map((c) => ({
        name: String(c.name || "").replace(/^skill:/, ""),
        description: c.description ? String(c.description).slice(0, 120) : "",
      }));
    try {
      out.stderr = String(client._rpc.getStderr?.() ?? "").slice(-4000);
    } catch {
      out.stderr = "";
    }
  } catch (err) {
    out.error = productError(err);
  }

  // MCP: configuração do projeto e do usuário (caminhos fixos, nunca entrada HTTP)
  const candidates = [path.join(ROOT, ".pi", "settings.json")];
  const home = process.env.USERPROFILE || process.env.HOME;
  if (home) candidates.push(path.join(home, ".pi", "agent", "settings.json"));
  const seen = new Set();
  for (const file of candidates) {
    const doc = await readJson(file, null).catch(() => null);
    const servers = doc?.mcp?.servers;
    if (!servers || typeof servers !== "object") continue;
    for (const [name, cfg] of Object.entries(servers)) {
      if (seen.has(name)) continue;
      seen.add(name);
      const failed = cfg?.enabled === false;
      out.mcp.push({
        name,
        status: failed ? "desabilitado" : "configurado",
        transport: cfg?.type || cfg?.transport || (cfg?.command ? "stdio" : cfg?.url ? "http" : "desconhecido"),
      });
    }
  }
  // falhas de MCP que aparecem no stderr do processo
  const mcpErrors = out.stderr
    .split(/\r?\n/)
    .filter((l) => /mcp/i.test(l) && /error|fail|recus|timeout|ECONN/i.test(l))
    .slice(-20);
  out.mcpErrors = mcpErrors;
  return out;
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
function runTurn(message, mode = "build") {
  if (turnRunning) return Promise.resolve(false);
  turnRunning = true;
  const currentMode = MODES[mode] ? mode : "build";

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
      const directive = modeDirective(currentMode);
      const prompt = directive ? `[modo: ${currentMode}] ${directive}\n\n${message}` : message;
      Promise.resolve(client.prompt(prompt)).catch((err) => {
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

  // Modulos irmaos do app.js. Sem esta rota, o `import("./sessions.js")` do
  // app.js cai no 404 do servidor e a lista de sessoes fica vazia em silencio.
  const MODULOS = new Set(["sessions.js", "settings.js", "modes-data.js"]);
  const modulo = url.pathname.startsWith("/") ? url.pathname.slice(1) : "";
  if (MODULOS.has(modulo)) {
    try {
      const txt = await readFile(path.join(ROOT, "apps", "desktop", modulo), "utf8");
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      res.end(txt);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("modulo nao encontrado");
    }
    return;
  }

  // rotas de sessao ficam em modulo proprio (scripts/desktop-sessions.mjs) para
  // nao disputar este arquivo com quem as escreveu.
  if (url.pathname.startsWith("/api/sessions")) {
    if (await handleSessionRoute({ req, res, url, dir: await sessionDir() })) return;
  }

  // tela principal: a conversa
  if (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/chat") {
    const metrics = await collectMetrics();
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(chatPage(metrics));
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
      let mode = "build";
      try {
        const doc = JSON.parse(body || "{}");
        message = String(doc.message ?? "");
        if (typeof doc.mode === "string") mode = doc.mode;
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
      res.end(JSON.stringify({ ok: true, mode }));
      currentMode = MODES[mode] ? mode : "build";
      await runTurn(message, mode);
    });
    return;
  }

  // estado do motor (modelo, effort, capacidades, streaming)
  if (url.pathname === "/api/status") {
    const st = await piState();
    st.mode = currentMode;
    st.turnRunning = turnRunning;
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(st));
    return;
  }

  // skills + MCP + log de falhas
  if (url.pathname === "/api/integrations") {
    const data = await integrations();
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(data));
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
