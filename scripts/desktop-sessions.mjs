/**
 * desktop-sessions — as rotas de sessão do desktop.
 *
 * Existe como módulo separado (e não dentro do desktop.mjs) por um motivo:
 * o dono do desktop.mjs e o dono das rotas podem trabalhar ao mesmo tempo
 * sem editar o mesmo arquivo. A ligação são duas linhas no handler HTTP.
 *
 * Fonte de verdade: core/agent/sessions.mjs. Nada aqui reimplementa a
 * leitura de sessão — só traduz HTTP para aquelas funções.
 *
 * Formato das respostas: docs/design/CONTRATO-desktop-1.0.md §2.
 */

import { listSessions, loadSession, forkSession } from "../core/agent/sessions.mjs";

/** Sessão que não existe tem que dar 404, não 500 com stack. */
class NaoEncontrada extends Error {}

/**
 * Traduz as linhas cruas do JSONL da sessao para o formato do contrato.
 *
 * O motor grava {"type":"message","message":{"role","content",...}} e ainda
 * registra mudancas de modelo e de raciocinio. A interface nao deve saber
 * disso: ela recebe {role, content, at} e pronto.
 */
export function normalizarMensagens(messages) {
  const out = [];
  for (const m of messages || []) {
    if (!m || m.type !== "message") continue;
    const inner = m.message || {};
    if (!inner.role) continue;
    out.push({
      role: String(inner.role),
      content: typeof inner.content === "string" ? inner.content : "",
      at: m.timestamp || m.time || null,
    });
  }
  return out;
}

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  res.end(text);
}

/** Corpo de uma requisição POST, com teto de tamanho. */
async function lerJson(req, limite = 64 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > limite) throw new Error("corpo da requisicao excede o limite");
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("corpo da requisicao deve ser um objeto JSON");
  }
  return parsed;
}

/**
 * Tenta atender uma rota de sessão.
 *
 * @returns {Promise<boolean>} true quando a rota existia e foi atendida.
 */
export async function handleSessionRoute({ req, res, url, dir }) {
  const path = url.pathname;

  if (path === "/api/sessions" && req.method === "GET") {
    try {
      const sessions = await listSessions(dir);
      return json(res, 200, { ok: true, sessions, dir }), true;
    } catch (err) {
      json(res, 500, { ok: false, error: String(err && err.message ? err.message : err) });
      return true;
    }
  }

  if (path === "/api/sessions/fork" && req.method === "POST") {
    let body;
    try {
      body = await lerJson(req);
    } catch (err) {
      json(res, 400, { ok: false, error: String(err.message) });
      return true;
    }
    if (!body.id) {
      json(res, 400, { ok: false, error: "informe id" });
      return true;
    }
    try {
      await forkSession(dir, String(body.id), body.name == null ? null : String(body.name));
      const sessions = await listSessions(dir, { refresh: true });
      // O fork acabou de nascer: é o mais recente.
      const nova = sessions[0] ?? null;
      if (!nova) {
        json(res, 500, { ok: false, error: "fork nao apareceu na listagem" });
        return true;
      }
      json(res, 200, { ok: true, session: nova });
      return true;
    } catch (err) {
      json(res, 404, { ok: false, error: String(err && err.message ? err.message : err) });
      return true;
    }
  }

  const m = path.match(/^\/api\/sessions\/([^/]+)$/);
  if (m && req.method === "GET") {
    const id = decodeURIComponent(m[1]);
    try {
      // loadSession devolve meta com o id recebido mesmo quando o arquivo nao
      // existe — ou seja, nao da para usar o retorno dele como prova de vita.
      // A existencia vem da listagem, que e a fonte que a CLI tambem usa.
      const listadas = await listSessions(dir);
      if (!listadas.some((s) => s.id === id)) {
        json(res, 404, { ok: false, error: "sessao nao encontrada" });
        return true;
      }
      const { messages, meta } = await loadSession(dir, id);
      json(res, 200, { ok: true, session: meta, messages: normalizarMensagens(messages) });
      return true;
    } catch (err) {
      json(res, 500, { ok: false, error: String(err && err.message ? err.message : err) });
      return true;
    }
  }

  return false;
}

export default { handleSessionRoute };