#!/usr/bin/env node
/**
 * desktop.mjs — o desktop do SelfEvoPI.
 *
 * Um servidor local (127.0.0.1) que serve um painel HTML e uma API de estado.
 * Nasce com `node scripts/desktop.mjs` (ou pelo atalho da Área de Trabalho) e
 * abre no navegador.
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
 *   node scripts/desktop.mjs [--port 7777] [--no-open]
 */

import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");

function argValue(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const PORT = Number(argValue("port", "7777"));
const NO_OPEN = process.argv.includes("--no-open");

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

function page() {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SelfEvoPI — desktop</title>
<style>
  :root {
    --bg:#0f1115; --bg2:#161a21; --bg3:#1d222b; --fg:#e6e8eb; --fg2:#9aa3ad;
    --bd:#262c36; --ok:#4ade80; --warn:#fbbf24; --bad:#f87171; --accent:#60a5fa;
  }
  *{box-sizing:border-box}
  body{margin:0;padding:16px;background:var(--bg);color:var(--fg);
    font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
  .wrap{max-width:1100px;margin:0 auto;display:flex;flex-direction:column;gap:16px}
  h1{font-size:18px;margin:0}
  .sub{color:var(--fg2);font-size:12px}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}
  .tile{background:var(--bg2);border:1px solid var(--bd);border-radius:8px;padding:10px 12px}
  .tile .n{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
  .tile .l{font-size:11px;color:var(--fg2);margin-top:2px}
  .ok{color:var(--ok)} .warn{color:var(--warn)} .bad{color:var(--bad)}
  section{background:var(--bg2);border:1px solid var(--bd);border-radius:8px;padding:12px 14px}
  section h2{font-size:13px;margin:0 0 10px;color:var(--fg2);text-transform:uppercase;letter-spacing:.05em;font-weight:600}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--bd)}
  th{font-size:11px;color:var(--fg2);font-weight:500}
  tr:last-child td{border-bottom:none}
  .mono{font-family:ui-monospace,Consolas,monospace;font-size:12px}
  .btns{display:flex;flex-wrap:wrap;gap:8px}
  button{background:var(--bg3);color:var(--fg);border:1px solid var(--bd);
    border-radius:6px;padding:7px 12px;font:inherit;cursor:pointer}
  button:hover{border-color:var(--accent)}
  button:disabled{opacity:.5;cursor:wait}
  pre{background:#0b0d11;border:1px solid var(--bd);border-radius:6px;padding:10px;
    overflow:auto;max-height:340px;font:12px/1.45 ui-monospace,Consolas,monospace;margin:0;white-space:pre-wrap}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
  .d-ok{background:var(--ok)} .d-bad{background:var(--bad)} .d-warn{background:var(--warn)}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>SelfEvoPI <span class="sub">— painel local</span></h1>
    <div class="sub">atualizado <span id="at">—</span> · atualiza a cada 5 s</div>
  </header>

  <div class="tiles" id="tiles"></div>

  <section>
    <h2>Ações</h2>
    <div class="btns">
      <button data-act="status">Estado do harness</button>
      <button data-act="detect">Detectar lacunas</button>
      <button data-act="evals">Evals A + C</button>
      <button data-act="verify">Verificação completa</button>
    </div>
    <pre id="out" style="margin-top:10px;display:none"></pre>
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
</div>

<script>
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

function tile(n, l, cls) {
  return '<div class="tile"><div class="n ' + (cls||"") + '">' + esc(n) + '</div><div class="l">' + esc(l) + '</div></div>';
}

async function refresh() {
  try {
    const s = await (await fetch("/api/state")).json();
    $("#at").textContent = new Date(s.at).toLocaleString("pt-BR");

    const b = s.baseline || {};
    const l = s.lkg || {};
    const rate = b.rate == null ? "—" : Math.round(b.rate * 100) + "%";
    const rateCls = b.rate == null ? "" : b.rate >= 0.99 ? "ok" : b.rate >= 0.9 ? "warn" : "bad";

    $("#tiles").innerHTML = [
      tile(b.tasks ?? 0, "tarefas de eval"),
      tile((b.passes ?? 0) + "/" + (b.runs ?? 0), "execuções", rateCls),
      tile(rate, "taxa", rateCls),
      tile((b.tokens ?? 0).toLocaleString("pt-BR"), "tokens da suíte"),
      tile(l.sha ?? "—", "last-known-good"),
      tile(s.artifacts.length, "artefatos"),
    ].join("");

    const g = b.groups || {};
    $("#grupos").innerHTML = Object.keys(g).sort().map((k) => {
      const x = g[k];
      const r = x.runs ? Math.round((x.passes / x.runs) * 100) : 0;
      return "<tr><td>" + esc(k) + "</td><td>" + x.runs + "</td><td>" + x.passes +
        "</td><td class='" + (r === 100 ? "ok" : r >= 90 ? "warn" : "bad") + "'>" + r + "%</td></tr>";
    }).join("") || "<tr><td colspan='4' class='sub'>sem dados de baseline</td></tr>";

    const led = s.ledger || {};
    $("#recent").innerHTML = (led.recent || []).map((r) =>
      "<tr><td class='mono'>" + esc((r.at || "").replace("T", " ").slice(0, 19)) + "</td><td>" +
      esc(r.task) + "</td><td>" + esc(r.group) + "</td><td class='" + (r.ok ? "ok" : "bad") + "'>" +
      (r.ok ? "passou" : "falhou") + "</td><td>" + (r.ms || 0) + "</td><td>" + (r.tokens || 0) + "</td></tr>"
    ).join("") || "<tr><td colspan='6' class='sub'>nenhuma execução registrada</td></tr>";

    $("#arts").innerHTML = (s.artifacts || []).map((a) =>
      "<tr><td class='mono'>" + esc(a) + "</td></tr>"
    ).join("") || "<tr><td class='sub'>nenhum artefato promovido ainda</td></tr>";

    $("#runs").innerHTML = (s.runs || []).map((r) => {
      const p = r.progress == null ? "—" : Math.round(r.progress * 100) + "%";
      return "<tr><td class='mono'>" + esc(r.runId) + "</td><td>" + esc(r.status) +
        "</td><td>" + p + "</td><td>" + (r.done ?? 0) + "/" + (r.nodes ?? 0) + "</td></tr>";
    }).join("") || "<tr><td colspan='4' class='sub'>nenhuma execução de grafo</td></tr>";
  } catch (e) {
    $("#at").textContent = "erro: " + e.message;
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
      out.textContent = (r.stdout || "") + (r.stderr ? "\n[stderr]\n" + r.stderr : "") +
        (r.ok ? "\n\n✓ concluído" : "\n\n✗ falhou (exit " + r.code + ")");
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
/* Servidor                                                            */
/* ------------------------------------------------------------------ */

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(page());
    return;
  }

  if (url.pathname === "/api/state") {
    const state = await collectState();
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(state));
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

  if (!NO_OPEN) {
    const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", addr] : [addr];
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  }
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    process.stdout.write("\nencerrando o painel.\n");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  });
}