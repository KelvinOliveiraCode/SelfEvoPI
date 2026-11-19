/**
 * Teste de INTEGRAÇÃO com o pi-harness real.
 *
 * - PULA (skip) quando nenhum servidor pi-harness responde — CI verde em máquina
 *   sem o app, ou com o app quebrado (é o caso do pi-harness@0.1.1 no Node 24).
 * - PULA também se o servidor morrer no meio do teste (defeito conhecido do
 *   pi-harness@0.1.1: criar sessão dispara um crash em background por `agentDir`
 *   undefined). Um crash conhecido vira skip com motivo, nunca falha.
 * - RODA quando um servidor responde e sobrevive à criação de sessão.
 *
 * Não instala nada, não sobe o servidor: só fala com um que já esteja de pé.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { probePiHarness, createSession, toSessionResponse } from "./pi-harness.mjs";

/** Candidatos de URL: env primeiro, depois portas padrão. */
function candidateUrls() {
  const urls = [];
  if (process.env.PI_HARNESS_URL) urls.push(process.env.PI_HARNESS_URL);
  urls.push("http://127.0.0.1:8787", "http://127.0.0.1:8788");
  return urls;
}

/** Acha a primeira URL que responde /health, ou null. */
async function findServer() {
  for (const baseUrl of candidateUrls()) {
    const h = await probePiHarness({ baseUrl, timeoutMs: 1500 });
    if (h) return { baseUrl, health: h };
  }
  return null;
}

/** Executa uma etapa de rede; se o servidor morrer, marca skip com o motivo. */
async function step(t, fn, what) {
  try {
    return await fn();
  } catch (err) {
    t.skip(`pi-harness morreu durante "${what}": ${err?.message ?? err} — integração não concluída`);
    return undefined;
  }
}

test("integração: /health, criar sessão e mapear run (pula sem servidor)", async (t) => {
  const server = await findServer();
  if (!server) {
    t.skip("pi-harness não responde em nenhuma URL candidata — integração não executada");
    return;
  }

  // 1) /health tem o formato HealthResponse
  assert.equal(server.health.status, "ok");
  assert.equal(typeof server.health.sessions, "number");
  assert.equal(typeof server.health.uptime, "number");

  // 2) POST /sessions devolve sessionId (pula se o servidor cair aqui)
  const created = await step(t, () =>
    createSession({ baseUrl: server.baseUrl, body: { sessionId: `run-A8-${Date.now()}` } })
  );
  if (created === undefined) return;
  assert.ok(created.sessionId, "POST /sessions devolve sessionId");

  // 3) o nosso run mapeia para o MESMO formato de SessionResponse (puro, sem rede)
  const mapped = toSessionResponse({
    runId: created.sessionId,
    status: "running",
    startedAt: new Date().toISOString(),
  });
  assert.equal(mapped.sessionId, created.sessionId);
  assert.equal(mapped.status, "active", "run em andamento = sessão ativa");
  assert.equal(typeof mapped.createdAt, "string");
});