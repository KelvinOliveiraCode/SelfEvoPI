import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listSessions, loadSession, forkSession, parseSession, referenceSession, listReferences, readReference, removeReference } from "./sessions.mjs";

async function tempDir() {
  return mkdtemp(join(tmpdir(), "forge-sessions-"));
}

/** Escreve uma sessão sintética no formato do PI: header + mensagens JSONL. */
async function writeSession(dir, { id, timestamp, cwd = "/tmp/proj", messages = [] }) {
  const iso = new Date(timestamp).toISOString().replace(/[:.]/g, "-");
  const file = join(dir, `${iso}_${id}.jsonl`);
  const lines = [JSON.stringify({ type: "session", version: 3, id, timestamp, cwd })];
  for (const m of messages) lines.push(JSON.stringify(m));
  await writeFile(file, lines.join("\n") + "\n", "utf8");
  return file;
}

const MSGS = [
  { role: "user", content: "olá" },
  { role: "assistant", content: "oi, como posso ajudar?" },
  { role: "user", content: "faça X" },
];

test("parseSession separa header de mensagens", () => {
  const text = [
    JSON.stringify({ type: "session", version: 3, id: "abc", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/x" }),
    JSON.stringify({ role: "user", content: "oi" }),
    JSON.stringify({ role: "assistant", content: "olá" }),
  ].join("\n");
  const { header, messages } = parseSession(text);
  assert.equal(header.id, "abc");
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "user");
});

test("listSessions devolve metadados (não o conteúdo)", async () => {
  const dir = await tempDir();
  try {
    await writeSession(dir, { id: "s1", timestamp: "2026-01-01T10:00:00.000Z", messages: MSGS });
    await writeSession(dir, { id: "s2", timestamp: "2026-01-02T10:00:00.000Z", messages: [{ role: "user", content: "x" }] });

    const list = await listSessions(dir);
    assert.equal(list.length, 2);
    // metadados
    for (const s of list) {
      assert.equal(typeof s.id, "string");
      assert.equal(typeof s.turns, "number");
      assert.equal(typeof s.tokens, "number");
      assert.equal("messages" in s, false, "listagem não carrega conteúdo");
    }
    // ordenado por updatedAt desc (mais recente primeiro)
    assert.equal(list[0].id, "s2");
    assert.equal(list[1].id, "s1");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadSession devolve mensagens e meta", async () => {
  const dir = await tempDir();
  try {
    await writeSession(dir, { id: "s1", timestamp: "2026-01-01T10:00:00.000Z", messages: MSGS });
    const { messages, meta } = await loadSession(dir, "s1");
    assert.equal(messages.length, 3);
    assert.equal(messages[0].content, "olá");
    assert.equal(meta.id, "s1");
    assert.equal(meta.turns, 2); // 2 mensagens user
    assert.ok(meta.tokens > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadSession inexistente devolve vazio, não lança", async () => {
  const dir = await tempDir();
  try {
    const { messages, meta } = await loadSession(dir, "nao-existe");
    assert.deepEqual(messages, []);
    assert.equal(meta.turns, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("forkSession cria nova sessão com o mesmo histórico", async () => {
  const dir = await tempDir();
  try {
    await writeSession(dir, { id: "orig", timestamp: "2026-01-01T10:00:00.000Z", messages: MSGS });
    const newId = await forkSession(dir, "orig", "cópia");

    assert.notEqual(newId, "orig");
    assert.ok(newId.length > 0);

    // a nova sessão existe e tem o mesmo histórico
    const { messages, meta } = await loadSession(dir, newId);
    assert.equal(messages.length, MSGS.length);
    assert.equal(messages[0].content, "olá");
    assert.equal(meta.title, "cópia");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("forkSession registra linhagem (reutiliza harness-store)", async () => {
  const dir = await tempDir();
  try {
    await writeSession(dir, { id: "orig", timestamp: "2026-01-01T10:00:00.000Z", messages: MSGS });
    const newId = await forkSession(dir, "orig");

    const lineageFile = join(dir, ".forge", "lineage", "index.json");
    const index = JSON.parse(await readFile(lineageFile, "utf8"));
    const entry = index.runs.find((r) => r.runId === newId);
    assert.ok(entry, "linhagem deve registrar o novo id");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("forkSession de sessão inexistente lança erro", async () => {
  const dir = await tempDir();
  try {
    await assert.rejects(forkSession(dir, "nao-existe"), /sessão não encontrada/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("listSessions em pasta vazia devolve []", async () => {
  const dir = await tempDir();
  try {
    assert.deepEqual(await listSessions(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* Fork com linhagem (forkedFrom na listagem)                          */
/* ------------------------------------------------------------------ */

test("fork aparece na listagem com forkedFrom e não corrompe a original", async () => {
  const dir = await tempDir();
  try {
    await writeSession(dir, { id: "orig", timestamp: "2026-01-01T10:00:00.000Z", messages: MSGS });
    const newId = await forkSession(dir, "orig", "cópia");

    const list = await listSessions(dir);
    const fork = list.find((s) => s.id === newId);
    const orig = list.find((s) => s.id === "orig");
    assert.ok(fork, "fork deve aparecer na listagem");
    assert.equal(fork.forkedFrom, "orig", "fork deve apontar para a origem");
    assert.equal(fork.title, "cópia");
    // original intacta
    assert.ok(orig, "original continua na listagem");
    assert.equal(orig.forkedFrom, null);
    const origLoad = await loadSession(dir, "orig");
    assert.equal(origLoad.messages.length, MSGS.length);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* Referência cruzada (citar uma sessão em outra)                      */
/* ------------------------------------------------------------------ */

test("referenceSession cria recorte (não a sessão inteira) e readReference devolve", async () => {
  const dir = await tempDir();
  try {
    // sessão de origem com 5 mensagens
    const many = Array.from({ length: 5 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "msg " + i }));
    await writeSession(dir, { id: "A", timestamp: "2026-01-01T10:00:00.000Z", messages: many });
    await writeSession(dir, { id: "B", timestamp: "2026-01-02T10:00:00.000Z", messages: [] });

    const { ref, tokens } = await referenceSession({ from: "A", to: "B", note: "veja isto", dir, maxMessages: 2 });
    assert.ok(ref, "ref id");
    assert.ok(tokens > 0, "tokens do recorte");

    // recorte: só as últimas 2 mensagens
    const { messages, meta } = await readReference({ session: "B", ref, dir });
    assert.equal(messages.length, 2, "recorte = últimas 2");
    assert.equal(messages[0].content, "msg 3");
    assert.equal(meta.from, "A");
    assert.equal(meta.note, "veja isto");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("listReferences devolve metadados (não o conteúdo)", async () => {
  const dir = await tempDir();
  try {
    await writeSession(dir, { id: "A", timestamp: "2026-01-01T10:00:00.000Z", messages: MSGS });
    await writeSession(dir, { id: "B", timestamp: "2026-01-02T10:00:00.000Z", messages: [] });

    await referenceSession({ from: "A", to: "B", note: "n1", dir });
    const refs = await listReferences({ session: "B", dir });
    assert.equal(refs.length, 1);
    assert.equal(refs[0].from, "A");
    assert.equal(refs[0].note, "n1");
    assert.equal("messages" in refs[0], false, "listagem não carrega conteúdo");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("removeReference remove a referência", async () => {
  const dir = await tempDir();
  try {
    await writeSession(dir, { id: "A", timestamp: "2026-01-01T10:00:00.000Z", messages: MSGS });
    await writeSession(dir, { id: "B", timestamp: "2026-01-02T10:00:00.000Z", messages: [] });

    const { ref } = await referenceSession({ from: "A", to: "B", dir });
    const r = await removeReference({ session: "B", ref, dir });
    assert.equal(r.removed, true);
    const refs = await listReferences({ session: "B", dir });
    assert.equal(refs.length, 0);
    // remover de novo = false
    const r2 = await removeReference({ session: "B", ref, dir });
    assert.equal(r2.removed, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("referenceSession de sessão inexistente lança erro", async () => {
  const dir = await tempDir();
  try {
    await writeSession(dir, { id: "B", timestamp: "2026-01-02T10:00:00.000Z", messages: [] });
    await assert.rejects(referenceSession({ from: "nao-existe", to: "B", dir }), /sessão de origem não encontrada/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readReference de ref inexistente devolve vazio", async () => {
  const dir = await tempDir();
  try {
    await writeSession(dir, { id: "B", timestamp: "2026-01-02T10:00:00.000Z", messages: [] });
    const { messages } = await readReference({ session: "B", ref: "nao-existe", dir });
    assert.deepEqual(messages, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* Índice leve (não raspa diretório toda hora)                         */
/* ------------------------------------------------------------------ */

test("listSessions usa índice e o invalida quando a pasta muda", async () => {
  const dir = await tempDir();
  try {
    await writeSession(dir, { id: "s1", timestamp: "2026-01-01T10:00:00.000Z", messages: MSGS });

    // primeira chamada: reconstrói e grava índice
    const first = await listSessions(dir);
    assert.equal(first.length, 1);
    const indexPath = join(dir, ".forge", "sessions-index.json");
    const idx = JSON.parse(await readFile(indexPath, "utf8"));
    assert.equal(idx.sessions.length, 1);
    assert.ok(idx.signature, "índice tem assinatura");

    // adiciona outra sessão: a assinatura muda, o índice deve ser reconstruído
    await new Promise((r) => setTimeout(r, 20)); // garante mtime diferente
    await writeSession(dir, { id: "s2", timestamp: "2026-01-02T10:00:00.000Z", messages: [{ role: "user", content: "x" }] });

    const second = await listSessions(dir);
    assert.equal(second.length, 2, "índice deve invalidar e reconstruir");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("listSessions refresh=true ignora o índice", async () => {
  const dir = await tempDir();
  try {
    await writeSession(dir, { id: "s1", timestamp: "2026-01-01T10:00:00.000Z", messages: MSGS });
    await listSessions(dir); // grava índice
    const r = await listSessions(dir, { refresh: true });
    assert.equal(r.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});