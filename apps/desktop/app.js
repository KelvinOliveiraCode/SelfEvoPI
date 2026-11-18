/**
 * apps/desktop/app.js — bootstrap, SSE e chat do desktop SelfEvoPI.
 *
 * Contrato: docs/design/CONTRATO-desktop-1.0.md
 * IDs obrigatórios: #chat #composer #send #sessions #settings #settingsPanel #status
 *
 * Módulos irmãos (import dinâmico com degradação — se um não existir, o chat
 * continua funcionando):
 *   ./sessions.js  initSessions({listEl,onOpen}) · openSession(id) · newSession() · getActiveSession()
 *   ./settings.js  initSettings(opts) · initControlBar(opts) · getSettings()
 */

const $ = (id) => document.getElementById(id);

const chatEl = $("chat");
const inputEl = $("composer");
const sendEl = $("send");
const statusEl = $("status");
const sessionsEl = $("sessions");
const settingsPanel = $("settingsPanel");

/* ------------------------------------------------------------------ */
/* Estado                                                              */
/* ------------------------------------------------------------------ */

/** @type {Array<{role:string,text:string,tools:Array,reasoning:string,reasoningOpen?:boolean}>} */
const messages = [];
let streaming = false;
let mode = "build";
let permission = "ask";
let effort = null;
let settingsApi = null;
let sessionsApi = null;

/* ------------------------------------------------------------------ */
/* Texto                                                               */
/* ------------------------------------------------------------------ */

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/** Markdown mínimo e seguro: negrito e código inline. */
function md(s) {
  let h = esc(s);
  h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return h;
}

function fmtDur(ms) {
  if (ms == null) return "";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/* ------------------------------------------------------------------ */
/* Cartões de ferramenta (pattern 7)                                   */
/* ------------------------------------------------------------------ */

/**
 * Cada tool call vira um cartão: nome, entrada, duração, estado e corpo
 * expansível. Chamadas consecutivas do MESMO nome colapsam num cartão com
 * contador ("read ×3").
 */
const toolCards = new Map(); // id do cartão -> { el, bodyEl, countEl, statusEl, tool, count }

function lastToolCard() {
  const arr = [...toolCards.values()];
  return arr.length ? arr[arr.length - 1] : null;
}

/** Cria (ou colapsa) um cartão de ferramenta e devolve o registro. */
function addToolCard(call) {
  const name = call.name || "tool";
  const prev = lastToolCard();

  // colapsa chamadas consecutivas iguais (mesmo nome), ainda abertas
  if (prev && prev.tool === name && prev.open) {
    prev.count += 1;
    prev.countEl.textContent = `×${prev.count}`;
    prev.el.classList.add("collapsed");
    return prev;
  }

  const el = document.createElement("div");
  el.className = "toolcard";

  const head = document.createElement("div");
  head.className = "tc-head";

  const sym = document.createElement("span");
  sym.className = "tc-sym";
  sym.textContent = "⏺";

  const nameEl = document.createElement("span");
  nameEl.className = "tc-name";
  nameEl.textContent = name;

  const argEl = document.createElement("span");
  argEl.className = "tc-arg";
  argEl.textContent = call.arg || "";

  const countEl = document.createElement("span");
  countEl.className = "tc-count";

  const durEl = document.createElement("span");
  durEl.className = "tc-dur";

  const statusEl = document.createElement("span");
  statusEl.className = "tc-status running";
  statusEl.textContent = "rodando";

  head.append(sym, nameEl, argEl, countEl, durEl, statusEl);
  el.append(head);

  const bodyEl = document.createElement("div");
  bodyEl.className = "tc-body";
  bodyEl.style.display = "none";
  el.append(bodyEl);

  head.addEventListener("click", () => {
    const open = bodyEl.style.display !== "none";
    bodyEl.style.display = open ? "none" : "block";
    el.classList.toggle("open", !open);
  });

  const card = {
    el,
    bodyEl,
    countEl,
    durEl,
    statusEl,
    tool: name,
    count: 1,
    open: true,
    close() {
      this.open = false;
    },
  };
  toolCards.set(card, card);
  return card;
}

function closeToolCards() {
  for (const c of toolCards.values()) c.close();
}

/** Atualiza o cartão correspondente no fim do turno. */
function finishTool(card, { isError, durationMs }) {
  if (!card) return;
  card.statusEl.className = "tc-status " + (isError ? "failed" : "done");
  card.statusEl.textContent = isError ? "falhou" : "ok";
  if (durationMs != null) card.durEl.textContent = fmtDur(durationMs);
}

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */

function currentAgent() {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "agent") return messages[i];
  return null;
}

function scrollIfNearEnd() {
  const near = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 80;
  if (near) chatEl.scrollTop = chatEl.scrollHeight;
}

function makeMessageEl(m) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + (m.role === "you" ? "you" : "agent");

  const who = document.createElement("div");
  who.className = "who";
  who.textContent = m.role === "you" ? "Você" : "SelfEvoPI";
  wrap.appendChild(who);

  const body = document.createElement("div");
  body.className = "body";

  // raciocínio: colapsado por padrão (pattern 8)
  if (m.role === "agent") {
    const r = document.createElement("div");
    r.className = "reason";
    const toggle = document.createElement("button");
    toggle.className = "reason-toggle";
    toggle.type = "button";
    const bodyText = document.createElement("div");
    bodyText.className = "reason-body";
    bodyText.style.display = "none";
    const sync = () => {
      const n = (m.reasoning || "").trim().length;
      toggle.textContent = n ? `raciocínio · ${n} caracteres` : "raciocínio";
      toggle.disabled = !n;
      bodyText.textContent = m.reasoning || "";
    };
    toggle.addEventListener("click", () => {
      const open = bodyText.style.display !== "none";
      bodyText.style.display = open ? "none" : "block";
      r.classList.toggle("open", !open);
    });
    r.append(toggle, bodyText);
    m._reasonEl = r;
    m._reasonToggle = toggle;
    m._reasonBody = bodyText;
    m._syncReason = sync;
    sync();
    body.appendChild(r);
  }

  const text = document.createElement("div");
  text.className = "text";
  body.appendChild(text);
  m._textEl = text;

  const tools = document.createElement("div");
  tools.className = "tools";
  body.appendChild(tools);
  m._toolsEl = tools;

  wrap.appendChild(body);

  m._textEl.innerHTML = m.role === "you" ? esc(m.text) : md(m.text);
  m._el = wrap;
  return wrap;
}

function render() {
  chatEl.innerHTML = "";
  toolCards.clear();
  for (const m of messages) chatEl.appendChild(makeMessageEl(m));
  // cartões de ferramentas já criados ficam dentro do body do agente
  updateWorking();
  updateFooter();
  chatEl.scrollTop = chatEl.scrollHeight;
}

/** Atualiza só o texto do agente corrente (streaming, sem refazer a árvore). */
function paintAgent() {
  const a = currentAgent();
  if (!a || !a._textEl) return;
  a._textEl.innerHTML = md(a.text);
  if (a._syncReason) a._syncReason();
  scrollIfNearEnd();
}

function updateWorking() {
  const a = currentAgent();
  const el = document.getElementById("working");
  if (!el) return;
  el.style.display = streaming && a ? "flex" : "none";
  const dot = document.getElementById("hdot");
  if (dot) dot.className = "dot " + (streaming ? "ok" : "");
}

/* ------------------------------------------------------------------ */
/* Rodapé de verificação (anti-"resultado confiante e errado")         */
/* ------------------------------------------------------------------ */

function updateFooter() {
  const el = document.getElementById("verify");
  if (!el) return;
  const ran = [];
  for (const c of toolCards.values()) {
    for (let i = 0; i < c.count; i++) ran.push(c.tool);
  }
  if (ran.length === 0) {
    el.textContent = "verificação: nenhuma ação executada — o texto do modelo não é evidência";
    el.className = "verify none";
  } else {
    const counts = {};
    for (const t of ran) counts[t] = (counts[t] || 0) + 1;
    const parts = Object.entries(counts).map(([k, v]) => `${k}${v > 1 ? "×" + v : ""}`);
    el.textContent = "verificado: " + parts.join(", ");
    el.className = "verify ok";
  }
}

/* ------------------------------------------------------------------ */
/* Envio                                                               */
/* ------------------------------------------------------------------ */

function resize() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(180, inputEl.scrollHeight) + "px";
}

async function send(text) {
  const msg = String(text || "").trim();
  if (!msg || streaming) return;

  // se havia cartões abertos do turno anterior, fecha
  closeToolCards();

  const you = { role: "you", text: msg, tools: [] };
  const agent = { role: "agent", text: "", tools: [], reasoning: "" };
  messages.push(you, agent);
  streaming = true;
  inputEl.value = "";
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
      if (!agent.text && agent.tools.length === 0) messages.pop();
      messages.push({ role: "agent", text: j.error || "não consegui iniciar o turno.", tools: [] });
      streaming = false;
      render();
    }
  } catch (e) {
    if (!agent.text && agent.tools.length === 0) messages.pop();
    messages.push({ role: "agent", text: "não consegui falar com o servidor.", tools: [] });
    streaming = false;
    render();
  }
}

/* ------------------------------------------------------------------ */
/* SSE: texto, raciocínio, ferramenta, fim, erro                       */
/* ------------------------------------------------------------------ */

const es = new EventSource("/api/chat/stream");

es.addEventListener("text", (e) => {
  let d = {};
  try { d = JSON.parse(e.data); } catch { return; }
  const a = currentAgent();
  if (a && typeof d.delta === "string") {
    a.text += d.delta;
    paintAgent();
  }
});

es.addEventListener("thinking", (e) => {
  let d = {};
  try { d = JSON.parse(e.data); } catch { return; }
  const a = currentAgent();
  if (a && typeof d.delta === "string") {
    a.reasoning = (a.reasoning || "") + d.delta;
    if (a._syncReason) a._syncReason();
  }
});

es.addEventListener("tool", (e) => {
  let d = {};
  try { d = JSON.parse(e.data); } catch { return; }
  const a = currentAgent();
  if (!a) return;

  if (d.phase === "start") {
    a._card = addToolCard({ name: d.name, arg: d.arg });
    a._toolsEl.appendChild(a._card.el);
    updateFooter();
    scrollIfNearEnd();
  } else if (d.phase === "end") {
    if (a._card) {
      finishTool(a._card, { isError: d.isError, durationMs: d.durationMs });
      a._card = null;
      updateFooter();
    }
  }
});

es.addEventListener("error", (e) => {
  let d = {};
  try { d = JSON.parse(e.data); } catch { return; }
  const a = currentAgent();
  if (a) {
    const note = d.message || "não consegui concluir.";
    a.text += (a.text ? "\n\n" : "") + note;
    paintAgent();
  }
});

es.addEventListener("settled", () => {
  streaming = false;
  closeToolCards();
  render();
  updateFooter();
  inputEl.focus();
});

/* ------------------------------------------------------------------ */
/* Painel de estado (#status)                                          */
/* ------------------------------------------------------------------ */

async function loadStatus() {
  try {
    const s = await (await fetch("/api/status")).json();
    const model = $("s-model");
    const effortEl = $("s-effort");
    const caps = $("s-caps");
    const reason = $("s-reason");
    if (model) model.textContent = s.model || (s.available ? "padrão" : "desligado");
    if (effortEl) effortEl.textContent = effort ?? s.thinkingLevel ?? "—";
    if (caps) {
      const list = Array.isArray(s.capabilities) && s.capabilities.length ? s.capabilities.join(", ") : "—";
      caps.textContent = list;
    }
    if (reason) {
      reason.textContent = s.available === false ? "desligado" : s.reasoning ? "exposto" : "modelo não expõe";
    }
  } catch { /* mantém o último */ }
}

/* ------------------------------------------------------------------ */
/* Modos / permissão (fallback quando settings.js não existe)          */
/* ------------------------------------------------------------------ */

function renderModes() {
  const box = $("modes");
  if (!box) return;
  box.innerHTML = "";
  for (const m of ["plan", "build", "ask"]) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.mode = m;
    b.textContent = m;
    b.setAttribute("aria-pressed", String(m === mode));
    b.addEventListener("click", () => {
      mode = m;
      renderModes();
    });
    box.appendChild(b);
  }
}

/* ------------------------------------------------------------------ */
/* Bootstrap                                                           */
/* ------------------------------------------------------------------ */

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send(inputEl.value);
  }
});
inputEl.addEventListener("input", resize);

if (sendEl) {
  sendEl.addEventListener("click", () => send(inputEl.value));
}

document.querySelectorAll("button[data-send]").forEach((b) => {
  b.addEventListener("click", () => {
    const cmd = b.dataset.send;
    if (permission === "ask" && !confirm("Rodar " + cmd + "?")) return;
    send(cmd);
  });
});

/* atalhos: Ctrl+K sessões · Ctrl+, configurações · Esc fecha */
document.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "k") {
    e.preventDefault();
    toggleSessions();
  } else if (mod && e.key === ",") {
    e.preventDefault();
    toggleSettings();
  } else if (e.key === "Escape") {
    closeAll();
  }
});

/* Os mesmos destinos pelo mouse. Sem estes dois listeners o botao "config"
   existia na barra e nao fazia nada — o painel so abria pelo teclado. */
document.getElementById("settings")?.addEventListener("click", (e) => {
  e.preventDefault();
  toggleSettings();
});
document.getElementById("openDrawer")?.addEventListener("click", (e) => {
  e.preventDefault();
  toggleSessions();
});

function toggleSessions() {
  document.body.classList.toggle("show-sessions");
}
function toggleSettings() {
  if (settingsPanel) settingsPanel.classList.toggle("open");
  else document.body.classList.toggle("show-settings");
}
function closeAll() {
  document.body.classList.remove("show-sessions", "show-settings");
  settingsPanel?.classList.remove("open");
  document.getElementById("drawer")?.classList.remove("open");
}

/* sessões (módulo irmão) */
try {
  const mod = await import("./sessions.js");
  sessionsApi = mod;
  if (sessionsEl && typeof mod.initSessions === "function") {
    await mod.initSessions({
      listEl: sessionsEl,
      onOpen: (msgs) => {
        // carrega o histórico da sessão escolhida na área de conversa
        messages.length = 0;
        for (const m of msgs || []) {
          messages.push({
            role: m.role === "assistant" ? "agent" : "you",
            text: m.content ?? "",
            tools: [],
            reasoning: "",
          });
        }
        streaming = false;
        render();
      },
    });
  }
} catch (e) {
  console.warn("[desktop] sessions.js ausente ou inválido:", e?.message || e);
}

/* configurações (módulo irmão de A3) */
try {
  const mod = await import("./settings.js");
  settingsApi = mod;
  if (typeof mod.initSettings === "function") mod.initSettings({ panel: settingsPanel });
  if (typeof mod.initControlBar === "function") {
    const bar = $("controlBar");
    if (bar) mod.initControlBar({ bar, onChange: (s) => applySettings(s) });
  }
} catch (e) {
  console.warn("[desktop] settings.js ausente — usando controles locais:", e?.message || e);
}

function applySettings(s) {
  if (!s) return;
  if (typeof s.mode === "string") mode = s.mode;
  if (typeof s.effort === "string") effort = s.effort;
  if (typeof s.permission === "string") permission = s.permission;
  renderModes();
  loadStatus();
}

renderModes();
render();
loadStatus();
setInterval(loadStatus, 3000);
resize();
inputEl.focus();

export { send, messages };