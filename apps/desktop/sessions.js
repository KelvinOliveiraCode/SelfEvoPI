let activeId = null;
let listElRef = null;
let onOpenRef = null;

async function load() {
  try {
    const res = await fetch('/api/sessions');
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    if (data.sessions.length && activeId === null) {
      activeId = data.sessions[0].id;
    }
    render(data.sessions);
  } catch (e) {
    console.error('[sessions] falha ao listar', e);
  }
}

function render(sessions) {
  if (!listElRef) return;
  listElRef.innerHTML = '';
  for (const s of sessions) {
    const btn = document.createElement('button');
    btn.className = 'session' + (s.id === activeId ? ' active' : '');
    btn.dataset.id = s.id;
    btn.type = 'button';

    const title = document.createElement('span');
    title.className = 's-title';
    title.textContent = s.title || 'Sem título';

    const meta = document.createElement('span');
    meta.className = 's-meta';
    meta.textContent = `${s.turns || 0} turnos · ${s.tokens || 0} tokens`;

    btn.append(title, meta);
    btn.addEventListener('click', () => openSession(s.id));
    listElRef.appendChild(btn);
  }
}

export async function initSessions({ listEl, onOpen }) {
  if (!listEl || !onOpen) return;
  listElRef = listEl;
  onOpenRef = onOpen;
  await load();
}

export async function openSession(id) {
  try {
    const res = await fetch('/api/sessions/' + id);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    activeId = id;
    if (onOpenRef) onOpenRef(data.messages);
    await load();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function newSession() {
  activeId = null;
  if (listElRef) {
    listElRef.querySelectorAll('.session.active').forEach(el => el.classList.remove('active'));
  }
  return null;
}

export function getActiveSession() {
  return activeId;
}