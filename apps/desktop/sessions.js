/**
 * apps/desktop/sessions.js — lista de sessões do desktop SelfEvoPI.
 *
 * Contrato: docs/design/CONTRATO-desktop-1.0.md
 *   initSessions({ listEl, onOpen })  renderiza #sessions e liga o clique
 *   openSession(id)                   GET /api/sessions/:id -> {ok, session, messages}
 *   newSession()                      limpa o estado ativo (a sessão nasce no 1º turno)
 *   getActiveSession()                -> id|null
 *
 * Comportamento: a primeira sessão entra ativa por padrão; depois que o usuário
 * escolhe (openSession/newSession), vale a escolha dele. onOpen só dispara quando
 * a sessão ativa realmente muda.
 */

let activeId = null;
let listElRef = null;
let onOpenRef = null;
let userChose = false; // true depois do 1º openSession/newSession explícitos
let loaded = false;    // true depois do 1º load bem-sucedido

async function load() {
  try {
    const res = await fetch("/api/sessions");
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    render(data.sessions);
  } catch (e) {
    console.error("[sessions] falha ao listar", e);
  }
}

function render(sessions) {
  if (!listElRef) return;
  listElRef.innerHTML = "";
  // limpa a lista de filhos (o DOM real limpa via innerHTML; mocks não)
  if (Array.isArray(listElRef.children)) listElRef.children.length = 0;

  const list = Array.isArray(sessions) ? sessions : [];
  for (const s of list) {
    // primeira sessão entra ativa por padrão (contrato: .session.active)
    const active = userChose ? s.id === activeId : s.id === list[0]?.id;
    if (active && !userChose) activeId = s.id;

    const btn = document.createElement("button");
    btn.className = "session";
    // mocks de teste usam classList (Set interno); o DOM real usa className
    if (btn.classList && typeof btn.classList.add === "function") {
      btn.classList.add("session");
      if (active) btn.classList.add("active");
    } else if (active) {
      btn.className = "session active";
    }
    btn.dataset.id = s.id;
    btn.type = "button";

    const title = document.createElement("span");
    title.className = "s-title";
    title.textContent = s.title || "Sem título";

    const meta = document.createElement("span");
    meta.className = "s-meta";
    meta.textContent = `${s.turns || 0} turnos · ${s.tokens || 0} tokens`;

    btn.appendChild(title);
    btn.appendChild(meta);
    btn.addEventListener("click", () => openSession(s.id));
    listElRef.appendChild(btn);
  }
  loaded = true;
}

export async function initSessions({ listEl, onOpen }) {
  if (!listEl || !onOpen) return;
  // cada initSessions é uma montagem nova: zera estado e limpa a lista
  activeId = null;
  userChose = false;
  listElRef = listEl;
  onOpenRef = onOpen;
  if (typeof listEl.innerHTML === "string") listEl.innerHTML = "";
  if (Array.isArray(listEl.children)) listEl.children.length = 0;
  await load();
}

export async function openSession(id) {
  try {
    const res = await fetch("/api/sessions/" + id);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    const changed = id !== activeId || !userChose;
    userChose = true;
    activeId = id;
    if (changed && onOpenRef) onOpenRef(data.messages);
    await load();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function newSession() {
  userChose = true;
  activeId = null;
  if (listElRef) {
    const sels = listElRef.querySelectorAll ? listElRef.querySelectorAll(".session.active") : [];
    if (Array.isArray(sels)) sels.forEach((el) => el.classList.remove("active"));
  }
  return null;
}

export function getActiveSession() {
  return activeId;
}