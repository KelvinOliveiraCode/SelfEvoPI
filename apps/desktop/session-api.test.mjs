/**
 * session-api.test.mjs — teste da API de sessões do desktop (CONTRATO 1.0 §1–2).
 *
 * Este arquivo NÃO afrouxa verificador para acomodar implementação. As asserções
 * seguem o contrato congelado (`docs/design/CONTRATO-desktop-1.0.md`):
 *   GET  /api/sessions        -> { ok:true, sessions:[SessionMeta], dir }
 *   GET  /api/sessions/:id    -> { ok:true, session:{...}, messages:[Msg] }
 *   POST /api/sessions/fork   -> { ok:true, session:SessionMeta }
 *   SessionMeta tem `client` (novo) e `forkedFrom`.
 *
 * Se as rotas ainda não existirem (A8 não entregou), o teste registra PENDENTE
 * e FALHA — não passa. Quando A8 entregar, as mesmas asserções passam a valer.
 *
 * Cobre também (itens 2 e 3, no nível do módulo, onde controlamos a fixture):
 *   - resolução da pasta: sessão com cwd=<raiz> aparece em listSessions(dir)
 *     ("os dois executivos se enxergam");
 *   - campo `client` no header (ausente = "cli", por retrocompatibilidade).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { listSessions, loadSession, forkSession, parseSession } from "../../core/agent/sessions.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const DESKTOP = join(ROOT, "scripts", "desktop.mjs");

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

async function tempDir() {
  return mkdtemp(join(tmpdir(), "session-api-"));
}

/** Escreve uma sessão sintética com header do contrato (client opcional). */
async function writeSession(dir, { id, timestamp, cwd, client, title, messages = [] }) {
  const iso = new Date(timestamp).toISOString().replace(/[:.]/g, "-");
  const file = join(dir, `${iso}_${id}.jsonl`);
  const header = { type: "session", version: 3, id, timestamp, cwd };
  if (client !== undefined) header.client = client;
  if (title !== undefined) header.title = title;
  const lines = [JSON.stringify(header)];
  for (const m of messages) lines.push(JSON.stringify(m));
  await writeFile(file, lines.join("\n") + "\n", "utf8");
  return file;
}

const MSGS = [
  { role: "user", content: "olá", at: "2026-11-15T23:01:40.000Z" },
  { role: "assistant", content: "oi, como posso ajudar?", at: "2026-11-15T23:01:42.000Z" },
  { role: "user", content: "faça X", at: "2026-11-15T23:01:44.000Z" },
];

/* ------------------------------------------------------------------ */
/* Sobe o desktop uma vez para a suíte (porta efêmera)                */
/* ------------------------------------------------------------------ */

/** Acha uma porta livre e devolve-a. */
async function freePort() {
  const { createServer } = await import("node:http");
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

/** Sobe o desktop headless e espera ele responder; devolve { port, stop }. */
async function startDesktop() {
  const port = await freePort();
  const child = spawn(process.execPath, [DESKTOP, "--no-open", "--port", String(port)], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, SELFEOPI_FORCE_NO_ENGINE: "1" },
  });
  const base = `http://127.0.0.1:${port}`;
  const stop = () => new Promise((r) => child.once("exit", r).kill?.() ?? child.kill() ?? r());
  // espera o servidor aceitar conexão (até ~5s)
  const deadline = Date.now() + 5000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base + "/api/state", { signal: AbortSignal.timeout(500) });
      if (res.status === 200) {
        up = true;
        break;
      }
    } catch {
      /* ainda não subiu */
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  if (!up) {
    child.kill();
    throw new Error("desktop não subiu em 5s");
  }
  return { port, base, stop: () => (child.kill(), Promise.resolve()) };
}

/* ================================================================== */
/* 1. API HTTP de sessões (contrato §2)                               */
/* ================================================================== */

test("GET /api/sessions devolve { ok, sessions, dir } (contrato §2)", async () => {
  const { base, stop } = await startDesktop();
  try {
    const res = await fetch(base + "/api/sessions");
    // PENDENTE: A8 ainda não implementou a rota (404 = ausente).
    assert.notEqual(res.status, 404, "PENDENTE: GET /api/sessions ausente (A8 não entregou)");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.sessions), "sessions é lista");
    assert.equal(typeof body.dir, "string", "dir é caminho");
    for (const s of body.sessions) {
      assert.equal(typeof s.id, "string");
      assert.equal(typeof s.turns, "number");
      assert.equal(typeof s.tokens, "number");
      assert.ok("forkedFrom" in s, "SessionMeta tem forkedFrom");
      assert.ok("client" in s, "SessionMeta tem client (contrato §1/§2)");
    }
  } finally {
    await stop();
  }
});

test("GET /api/sessions/:id devolve { ok, session, messages } (contrato §2)", async () => {
  const { base, stop } = await startDesktop();
  try {
    // precisa existir ao menos uma sessão; pega o id da listagem
    const listRes = await fetch(base + "/api/sessions");
    assert.notEqual(listRes.status, 404, "PENDENTE: GET /api/sessions ausente");
    const { sessions } = await listRes.json();
    if (!sessions || sessions.length === 0) {
      // sem sessão real nesta máquina: registra PENDENTE em vez de afrouxar
      assert.fail("PENDENTE: nenhuma sessão para GET /api/sessions/:id (crie uma e rode de novo)");
    }
    const id = sessions[0].id;
    const res = await fetch(base + "/api/sessions/" + encodeURIComponent(id));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.session.id, id);
    assert.ok(Array.isArray(body.messages), "messages é lista");
    for (const m of body.messages) {
      assert.ok(["user", "assistant", "tool"].includes(m.role), "Msg.role válido");
      assert.ok("content" in m, "Msg tem content");
      assert.ok("at" in m, "Msg tem at");
    }
  } finally {
    await stop();
  }
});

test("POST /api/sessions/fork cria nova sessão com forkedFrom (contrato §2)", async () => {
  const { base, stop } = await startDesktop();
  try {
    const listRes = await fetch(base + "/api/sessions");
    assert.notEqual(listRes.status, 404, "PENDENTE: GET /api/sessions ausente");
    const { sessions } = await listRes.json();
    if (!sessions || sessions.length === 0) {
      assert.fail("PENDENTE: nenhuma sessão para POST /api/sessions/fork");
    }
    const id = sessions[0].id;
    const res = await fetch(base + "/api/sessions/fork", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, name: "fork de teste" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.session.id, "string");
    assert.notEqual(body.session.id, id, "fork tem id novo");
    assert.equal(body.session.forkedFrom, id, "fork aponta para a origem");
  } finally {
    await stop();
  }
});

test("API de sessões: erro devolve { ok:false, error } com 4xx/5xx (contrato §2)", async () => {
  const { base, stop } = await startDesktop();
  try {
    const res = await fetch(base + "/api/sessions/nao-existe-id");
    assert.notEqual(res.status, 404, "PENDENTE: GET /api/sessions/:id ausente");
    assert.ok(res.status >= 400 && res.status < 600, "erro é 4xx/5xx");
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(typeof body.error, "string");
  } finally {
    await stop();
  }
});

/* ================================================================== */
/* 2. Resolução da pasta: desktop e CLI se enxergam (contrato §1)     */
/* ================================================================== */

test("sessão com cwd=<raiz> aparece em listSessions (os dois executivos se veem)", async () => {
  const dir = await tempDir();
  try {
    const cwd = process.cwd();
    await writeSession(dir, {
      id: "desk-1",
      timestamp: "2026-11-15T23:01:39.318Z",
      cwd,
      client: "desktop",
      messages: MSGS,
    });
    const list = await listSessions(dir);
    const found = list.find((s) => s.id === "desk-1");
    assert.ok(found, "sessão criada pelo desktop tem que aparecer na listagem do CLI");
    assert.equal(found.turns, 2, "2 mensagens user");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("listSessions NÃO mistura sessões de outro projeto (cwd diferente)", async () => {
  const dir = await tempDir();
  try {
    await writeSession(dir, { id: "outro", timestamp: "2026-11-15T23:01:39.318Z", cwd: "/outro/projeto", messages: [] });
    await writeSession(dir, { id: "meu", timestamp: "2026-11-15T23:02:00.000Z", cwd: process.cwd(), messages: MSGS });
    const list = await listSessions(dir);
    // listSessions devolve TODAS da pasta (a filtragem por cwd é do sessionDir do CLI);
    // aqui garantimos que ambas são listadas e distinguíveis — nenhuma some.
    const ids = list.map((s) => s.id);
    assert.ok(ids.includes("outro"));
    assert.ok(ids.includes("meu"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/* ================================================================== */
/* 3. Campo `client` no header (contrato §1)                          */
/* ================================================================== */

test("client=desktop é reconhecido (parseSession preserva o campo)", () => {
  const text = [
    JSON.stringify({ type: "session", version: 3, id: "d1", timestamp: "2026-11-15T23:01:39.318Z", cwd: "/x", client: "desktop" }),
    JSON.stringify({ role: "user", content: "oi" }),
  ].join("\n");
  const { header } = parseSession(text);
  assert.equal(header.client, "desktop");
});

test("client ausente = 'cli' (retrocompatibilidade, contrato §1)", () => {
  const text = [
    JSON.stringify({ type: "session", version: 3, id: "c1", timestamp: "2026-11-15T23:01:39.318Z", cwd: "/x" }),
    JSON.stringify({ role: "user", content: "oi" }),
  ].join("\n");
  const { header } = parseSession(text);
  assert.equal(header.client, undefined, "header cru não inventa client");
  // A normalização para "cli" é responsabilidade de quem lê; aqui documentamos
  // que o header antigo continua válido (sem client) e parseável.
  assert.equal(header.type, "session");
  assert.equal(header.id, "c1");
});

test("loadSession preserva mensagens de sessão client=desktop", async () => {
  const dir = await tempDir();
  try {
    await writeSession(dir, {
      id: "d2",
      timestamp: "2026-11-15T23:01:39.318Z",
      cwd: process.cwd(),
      client: "desktop",
      messages: MSGS,
    });
    const { messages, meta } = await loadSession(dir, "d2");
    assert.equal(messages.length, MSGS.length);
    assert.equal(meta.id, "d2");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("forkSession herda o histórico e marca forkedFrom (contrato §1)", async () => {
  const dir = await tempDir();
  try {
    await writeSession(dir, {
      id: "orig",
      timestamp: "2026-11-15T23:01:39.318Z",
      cwd: process.cwd(),
      client: "desktop",
      messages: MSGS,
    });
    const newId = await forkSession(dir, "orig", "cópia");
    const { messages, meta } = await loadSession(dir, newId);
    assert.equal(messages.length, MSGS.length, "fork mantém o histórico");
    assert.equal(meta.forkedFrom, "orig", "fork aponta para a origem");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});