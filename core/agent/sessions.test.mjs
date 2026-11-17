import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listSessions, loadSession, forkSession, parseSession } from "./sessions.mjs";

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