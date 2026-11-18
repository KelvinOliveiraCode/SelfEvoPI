import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert';
import { initSessions, openSession, newSession, getActiveSession } from './sessions.js';

const createMockElement = (tag) => {
  let _innerHTML = '';
  const el = {
    tagName: tag.toUpperCase(),
    _className: '',
    get className() { return this._className; },
    set className(v) {
      this._className = v;
      this.classList._classes = new Set(v.split(' ').filter(Boolean));
    },
    dataset: {},
    id: '',
    get innerHTML() { return _innerHTML; },
    set innerHTML(v) { _innerHTML = v; this.children = []; },
    children: [],
    attributes: {},
    textContent: '',
    style: {},
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); }
    },
    append(...nodes) {
      nodes.forEach(n => this.children.push(n));
    },
    appendChild(node) {
      this.children.push(node);
      return node;
    },
    removeChild(node) {
      const idx = this.children.indexOf(node);
      if (idx >= 0) this.children.splice(idx, 1);
      return node;
    },
    querySelector(sel) {
      if (sel.startsWith('[')) {
        const attrMatch = sel.match(/\[data-id="([^"]+)"\]/);
        if (attrMatch) {
          for (const child of this.children) {
            if (child.dataset && child.dataset.id === attrMatch[1]) return child;
          }
        }
      }
      if (sel.startsWith('.')) {
        const cls = sel.slice(1);
        for (const child of this.children) {
          if (child.classList && child.classList.contains(cls)) return child;
        }
      }
      return null;
    },
    querySelectorAll(sel) {
      const results = [];
      if (sel.startsWith('.')) {
        const cls = sel.slice(1);
        const collect = (node) => {
          if (node.classList && node.classList.contains(cls)) results.push(node);
          for (const child of node.children) collect(child);
        };
        collect(this);
      }
      return results;
    },
    addEventListener() {},
    removeEventListener() {}
  };
  return el;
};

const createMockDocument = () => {
  const body = createMockElement('body');
  const doc = {
    body,
    createElement: createMockElement,
    getElementById: (id) => { return null; },
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel)
  };
  global.document = doc;
  return doc;
};

describe('sessions.js', () => {
  let listEl, onOpenCalls, originalFetch;

  before(() => {
    createMockDocument();
    originalFetch = global.fetch;
    global.fetch = async (url) => {
      if (url === '/api/sessions') {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            sessions: [
              { id: 's1', title: 'Sessão 1', turns: 3, tokens: 123 },
              { id: 's2', title: 'Sessão 2', turns: 1, tokens: 45 }
            ]
          })
        };
      }
      if (url === '/api/sessions/s1' || url === '/api/sessions/s2') {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            session: { id: url.split('/').pop(), title: 'Sessão ' + url.split('/').pop() },
            messages: [{ role: 'user', content: 'oi', at: '2026-11-15T00:00:00Z' }]
          })
        };
      }
      return {
        ok: false,
        json: async () => ({ ok: false, error: 'not found' })
      };
    };
  });

  after(() => {
    global.fetch = originalFetch;
    delete global.document;
  });

  it('initSessions renderiza lista e ativa sessão', async () => {
    listEl = document.createElement('div');
    listEl.id = 'sessions';
    onOpenCalls = [];
    document.body.appendChild(listEl);

    await initSessions({
      listEl,
      onOpen: (msgs) => onOpenCalls.push(msgs)
    });

    const sessions = listEl.querySelectorAll('.session');
    assert.strictEqual(sessions.length, 2);
    assert.ok(sessions[0].classList.contains('active'));
    assert.ok(!sessions[1].classList.contains('active'));

    document.body.removeChild(listEl);
  });

  it('openSession carrega mensagens e marca ativa', async () => {
    listEl = document.createElement('div');
    listEl.id = 'sessions';
    onOpenCalls = [];
    document.body.appendChild(listEl);

    await initSessions({
      listEl,
      onOpen: (msgs) => onOpenCalls.push(msgs)
    });

    await openSession('s2');

    assert.strictEqual(onOpenCalls.length, 1);
    assert.strictEqual(onOpenCalls[0][0].content, 'oi');
    const s2 = listEl.querySelector('[data-id="s2"]');
    const s1 = listEl.querySelector('[data-id="s1"]');
    assert.ok(s2.classList.contains('active'));
    assert.ok(!s1.classList.contains('active'));

    document.body.removeChild(listEl);
  });

  it('newSession limpa estado ativo', async () => {
    listEl = document.createElement('div');
    listEl.id = 'sessions';
    onOpenCalls = [];
    document.body.appendChild(listEl);

    await initSessions({
      listEl,
      onOpen: (msgs) => onOpenCalls.push(msgs)
    });

    newSession();
    assert.strictEqual(getActiveSession(), null);
    assert.strictEqual(listEl.querySelector('.session.active'), null);

    document.body.removeChild(listEl);
  });

  it('getActiveSession retorna id ou null', async () => {
    listEl = document.createElement('div');
    listEl.id = 'sessions';
    onOpenCalls = [];
    document.body.appendChild(listEl);

    await initSessions({
      listEl,
      onOpen: (msgs) => onOpenCalls.push(msgs)
    });

    assert.strictEqual(getActiveSession(), 's1');
    newSession();
    assert.strictEqual(getActiveSession(), null);

    document.body.removeChild(listEl);
  });

  it('openSession erro retorna {ok:false,error}', async () => {
    listEl = document.createElement('div');
    listEl.id = 'sessions';
    onOpenCalls = [];
    document.body.appendChild(listEl);

    await initSessions({
      listEl,
      onOpen: (msgs) => onOpenCalls.push(msgs)
    });

    const result = await openSession('inexistente');
    assert.deepStrictEqual(result, { ok: false, error: 'not found' });

    document.body.removeChild(listEl);
  });
});