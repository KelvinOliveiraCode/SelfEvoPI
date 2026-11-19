import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

import {
  toPiStatus,
  toSessionResponse,
  toSessionList,
  parseSessionJsonl,
  probePiHarness,
} from "./pi-harness.mjs";

/* ------------------------------------------------------------------ */
/* Mapeadores puros (sempre rodam)                                     */
/* ------------------------------------------------------------------ */

test("toPiStatus: status do run -> active/ended", () => {
  assert.equal(toPiStatus("running"), "active");
  assert.equal(toPiStatus("pending"), "active");
  assert.equal(toPiStatus("paused"), "active");
  assert.equal(toPiStatus("blocked"), "active");
  assert.equal(toPiStatus("waiting-human"), "active");
  assert.equal(toPiStatus("completed"), "ended");
  assert.equal(toPiStatus("failed"), "ended");
  assert.equal(toPiStatus("done"), "ended");
  assert.equal(toPiStatus("desconhecido"), "active", "default = active");
});

test("toSessionResponse: run -> { sessionId, status, createdAt }", () => {
  const doc = { runId: "run-1", status: "completed", startedAt: "2026-11-17T10:00:00.000Z" };
  assert.deepEqual(toSessionResponse(doc), {
    sessionId: "run-1",
    status: "ended",
    createdAt: "2026-11-17T10:00:00.000Z",
  });
});

test("toSessionList: vários runs -> { sessions: [...] }", () => {
  const docs = [
    { runId: "run-1", status: "completed", startedAt: "2026-11-17T10:00:00.000Z" },
    { runId: "run-2", status: "running", startedAt: "2026-11-17T10:05:00.000Z" },
  ];
  const out = toSessionList(docs);
  assert.equal(out.sessions.length, 2);
  assert.equal(out.sessions[0].sessionId, "run-1");
  assert.equal(out.sessions[0].status, "ended");
  assert.equal(out.sessions[1].status, "active");
});

test("toSessionResponse tolera doc vazio", () => {
  assert.deepEqual(toSessionResponse(null), { sessionId: null, status: "active", createdAt: null });
});

/* ------------------------------------------------------------------ */
/* Parser do JSONL real do pi                                          */
/* ------------------------------------------------------------------ */

const SAMPLE_JSONL = [
  `{"type":"session","version":3,"id":"01a1e990-6c3e-77ef-a5de-d8bbc7f489f9","timestamp":"2026-11-17T12:51:58.655Z","cwd":"C:\\\\tmp\\\\proj"}`,
  `{"type":"model_change","id":"eec0c383","parentId":null,"timestamp":"2026-11-17T12:51:59.044Z","provider":"kilo1","modelId":"nvidia/nemotron-3-ultra-550b-a55b:free"}`,
  `{"type":"thinking_level_change","id":"f23a2fb2","parentId":"eec0c383","timestamp":"2026-11-17T12:51:59.045Z","thinkingLevel":"off"}`,
  `{"type":"message","id":"10fca239","parentId":"f23a2fb2","timestamp":"2026-11-17T12:51:59.066Z","message":{"role":"system","content":""}}`,
  `{"type":"message","id":"ad7eeee5","parentId":"10fca239","timestamp":"2026-11-17T12:51:59.066Z","message":{"role":"user","content":[{"type":"text","text":"responda apenas: ok"}]}}`,
  `{"type":"message","id":"57dc1d98","parentId":"ad7eeee5","timestamp":"2026-11-17T12:52:01.607Z","message":{"role":"assistant","content":[{"type":"text","text":"ok"}]}}`,
].join("\n");

test("parseSessionJsonl lê cabeçalho, modelo, mensagens e timestamps", () => {
  const s = parseSessionJsonl(SAMPLE_JSONL);

  assert.equal(s.id, "01a1e990-6c3e-77ef-a5de-d8bbc7f489f9");
  assert.equal(s.version, 3);
  assert.equal(s.cwd, "C:\\tmp\\proj");
  assert.equal(s.startedAt, "2026-11-17T12:51:58.655Z");
  assert.equal(s.endedAt, "2026-11-17T12:52:01.607Z");

  assert.deepEqual(s.model, { provider: "kilo1", modelId: "nvidia/nemotron-3-ultra-550b-a55b:free" });
  assert.equal(s.thinkingLevel, "off");

  assert.equal(s.messages.length, 3);
  assert.deepEqual(s.messages.map((m) => m.role), ["system", "user", "assistant"]);
  // linked list: cada message aponta para a anterior
  assert.equal(s.messages[1].parentId, s.messages[0].id);
  assert.equal(s.messages[2].parentId, s.messages[1].id);

  assert.equal(s.eventCount, 6);
  assert.equal(s.malformed, 0);
});

test("parseSessionJsonl conta linhas malformadas sem quebrar", () => {
  const text = [SAMPLE_JSONL, "{ isto não é json }"].join("\n");
  const s = parseSessionJsonl(text);
  assert.equal(s.malformed, 1);
  assert.equal(s.messages.length, 3, "dados válidos preservados");
});

test("parseSessionJsonl devolve esqueleto para texto vazio", () => {
  const s = parseSessionJsonl("");
  assert.equal(s.eventCount, 0);
  assert.equal(s.messages.length, 0);
  assert.equal(s.id, null);
});

/* ------------------------------------------------------------------ */
/* Parser contra um arquivo REAL do pi em disco (se existir)           */
/* ------------------------------------------------------------------ */

test("parseSessionJsonl lê uma sessão real do pi em disco (se houver)", async () => {
  const root = join(homedir(), ".pi", "agent", "sessions");
  let dir = null;
  try {
    const entries = await readFile;
    void entries;
    const fs = await import("node:fs/promises");
    const top = await fs.readdir(root).catch(() => []);
    dir = top.find((d) => d.startsWith("--"));
  } catch {
    dir = null;
  }
  if (!dir) return; // sem sessões locais: nada a verificar

  const fs = await import("node:fs/promises");
  const files = (await fs.readdir(join(root, dir)).catch(() => [])).filter((f) => f.endsWith(".jsonl"));
  if (files.length === 0) return;

  const raw = await fs.readFile(join(root, dir, files[0]), "utf8");
  const s = parseSessionJsonl(raw);
  assert.ok(s.eventCount > 0, "sessão real tem eventos");
  assert.ok(s.messages.length > 0, "sessão real tem mensagens");
});

/* ------------------------------------------------------------------ */
/* probePiHarness: nunca lança por indisponibilidade                   */
/* ------------------------------------------------------------------ */

test("probePiHarness devolve null quando fetch falha (servidor ausente)", async () => {
  const fetchImpl = async () => {
    throw new Error("ECONNREFUSED");
  };
  const out = await probePiHarness({ baseUrl: "http://127.0.0.1:59999", fetchImpl });
  assert.equal(out, null, "nunca lança; sinaliza ausência com null");
});

test("probePiHarness devolve o corpo quando /health responde", async () => {
  const fetchImpl = async (url) => {
    assert.match(String(url), /\/health$/);
    return { ok: true, json: async () => ({ status: "ok", sessions: 0, uptime: 1, version: "0.1.0" }) };
  };
  const out = await probePiHarness({ baseUrl: "http://x", fetchImpl });
  assert.equal(out.status, "ok");
  assert.equal(out.version, "0.1.0");
});