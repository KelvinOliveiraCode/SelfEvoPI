
const log = document.getElementById("log");
const input = document.getElementById("input");
const msgs = [];
let streaming = false;
let mode = "build";
let permission = "ask";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
}
function md(s) {
  let h = esc(s);
  h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
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

    if (m.reasoning) {
      const r = document.createElement("div");
      r.className = "reason";
      r.innerHTML = "<span class='lbl'>raciocínio</span><br>" + esc(m.reasoning);
      body.appendChild(r);
    }

    if (m.role === "you") {
      const t = document.createElement("span");
      t.textContent = m.text;
      body.appendChild(t);
    } else {
      const t = document.createElement("span");
      t.innerHTML = md(m.text);
      body.appendChild(t);
    }

    for (const tool of (m.tools || [])) {
      const line = document.createElement("div");
      line.className = "tool";
      line.innerHTML = "<span class='sym'>⏺</span><span class='tn'>" + esc(tool.name) +
        "</span>" + (tool.arg ? "<span class='ta'>" + esc(tool.arg) + "</span>" : "");
      body.appendChild(line);
    }

    if (m.role === "agent" && m === currentAgent() && streaming) {
      const w = document.createElement("div");
      w.className = "working on";
      w.innerHTML = "<span class='pulse'></span><span>trabalhando<span class='dots' id='dots'></span></span>";
      body.appendChild(w);
    }

    wrap.appendChild(who);
    wrap.appendChild(body);
    log.appendChild(wrap);
  }
  animateDots();
  log.scrollTop = log.scrollHeight;
}

let dotTimer = null;
function animateDots() {
  if (dotTimer) { clearInterval(dotTimer); dotTimer = null; }
  if (!streaming) return;
  const el = document.getElementById("dots");
  if (!el) return;
  let n = 0;
  dotTimer = setInterval(() => {
    n = (n + 1) % 4;
    if (el.isConnected) el.textContent = ".".repeat(n);
  }, 400);
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
  const agent = { role: "agent", text: "", tools: [], reasoning: "" };
  msgs.push(agent);
  streaming = true;
  input.value = "";
  resize();
  render();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: msg, mode }),
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

/* ---- SSE: texto, ferramenta, raciocínio, fim, erro ---- */
const es = new EventSource("/api/chat/stream");

es.addEventListener("text", (e) => {
  let d = {};
  try { d = JSON.parse(e.data); } catch { return; }
  const a = currentAgent();
  if (a && typeof d.delta === "string") { a.text += d.delta; render(); }
});

es.addEventListener("thinking", (e) => {
  let d = {};
  try { d = JSON.parse(e.data); } catch { return; }
  const a = currentAgent();
  if (a && typeof d.delta === "string") {
    a.reasoning = (a.reasoning || "") + d.delta;
    render();
  }
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
    else a.text += "\n\n" + (d.message || "não consegui concluir.");
    render();
  }
});

es.addEventListener("settled", () => {
  streaming = false;
  render();
  input.focus();
});

/* ---- painel de estado ---- */
async function loadStatus() {
  try {
    const s = await (await fetch("/api/status")).json();
    document.getElementById("model").textContent = s.model || (s.available ? "padrão" : "desligado");
    document.getElementById("effort").textContent = s.thinkingLevel || "—";
    const caps = Array.isArray(s.capabilities) && s.capabilities.length ? s.capabilities.join(", ") : "—";
    document.getElementById("caps").textContent = caps;
    const rr = document.getElementById("reasonWrap");
    if (s.available === false) {
      document.getElementById("reason").textContent = "desligado";
    } else if (s.reasoning) {
      document.getElementById("reason").textContent = "exposto";
    } else {
      document.getElementById("reason").textContent = "modelo não expõe";
    }
    document.getElementById("perm").textContent = permission;
    const dot = document.getElementById("hdot");
    dot.className = "dot " + (s.isStreaming || streaming ? "ok" : "");
  } catch (e) { /* mantém o último */ }
}

/* ---- modos e permissão ---- */
document.querySelectorAll("#modes button").forEach((b) => {
  b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  b.addEventListener("click", () => {
    mode = b.dataset.mode;
    document.querySelectorAll("#modes button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  });
});

/* ---- drawer de skills/MCP ---- */
const drawer = document.getElementById("drawer");
document.getElementById("openDrawer").addEventListener("click", (e) => {
  e.preventDefault();
  drawer.classList.add("open");
  loadIntegrations();
});
document.getElementById("closeDrawer").addEventListener("click", (e) => {
  e.preventDefault();
  drawer.classList.remove("open");
});

async function loadIntegrations() {
  const body = document.getElementById("drawerBody");
  let d;
  try {
    d = await (await fetch("/api/integrations")).json();
  } catch (e) {
    body.innerHTML = "<div class='empty'>não consegui ler as integrações.</div>";
    return;
  }
  body.innerHTML = "";

  const skills = document.createElement("section");
  skills.innerHTML = "<h2>skills (" + (d.skills || []).length + ")</h2>";
  if (!d.skills || d.skills.length === 0) {
    skills.innerHTML += "<div class='empty'>nenhuma skill configurada.</div>";
  } else {
    for (const s of d.skills) {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = "<span class='name'>" + esc(s.name) + "</span><span class='tag'>" + esc(s.description || "") + "</span>";
      skills.appendChild(row);
    }
  }
  body.appendChild(skills);

  const mcp = document.createElement("section");
  mcp.innerHTML = "<h2>mcp (" + (d.mcp || []).length + ")</h2>";
  if (!d.mcp || d.mcp.length === 0) {
    mcp.innerHTML += "<div class='empty'>nenhum servidor MCP configurado.</div>";
  } else {
    for (const s of d.mcp) {
      const row = document.createElement("div");
      row.className = "row";
      const cls = s.status === "configurado" ? "" : " warn";
      row.innerHTML = "<span class='name'>" + esc(s.name) + "</span><span class='tag" + cls + "'>" + esc(s.status) + " · " + esc(s.transport || "") + "</span>";
      mcp.appendChild(row);
    }
  }
  if (d.mcpErrors && d.mcpErrors.length) {
    const h = document.createElement("h2");
    h.textContent = "falhas";
    h.style.marginTop = "14px";
    mcp.appendChild(h);
    const pre = document.createElement("pre");
    pre.className = "log";
    pre.textContent = d.mcpErrors.join("\n");
    mcp.appendChild(pre);
    const btn = document.createElement("button");
    btn.className = "copy";
    btn.textContent = "copiar log";
    btn.addEventListener("click", () => navigator.clipboard?.writeText(d.mcpErrors.join("\n")));
    mcp.appendChild(btn);
  }
  if (d.stderr && d.stderr.trim()) {
    const h = document.createElement("h2");
    h.textContent = "log do processo";
    h.style.marginTop = "14px";
    mcp.appendChild(h);
    const pre = document.createElement("pre");
    pre.className = "log";
    pre.textContent = d.stderr;
    mcp.appendChild(pre);
    const btn = document.createElement("button");
    btn.className = "copy";
    btn.textContent = "copiar";
    btn.addEventListener("click", () => navigator.clipboard?.writeText(d.stderr));
    mcp.appendChild(btn);
  }
  body.appendChild(mcp);
}

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send(input.value);
  }
});
input.addEventListener("input", resize);

document.querySelectorAll("button[data-send]").forEach((b) => {
  b.addEventListener("click", () => {
    const cmd = b.dataset.send;
    if (permission === "ask" && !confirm("Rodar " + cmd + "?")) return;
    send(cmd);
  });
});

render();
loadStatus();
setInterval(loadStatus, 3000);
input.focus();
