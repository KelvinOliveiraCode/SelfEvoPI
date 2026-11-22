#!/usr/bin/env node
/**
 * scripts/code-mode-mcp.mjs — gateway MCP opt-in para Code Mode.
 *
 * Expõe UMA ferramenta, `execute`, que recebe um programa JavaScript curto e o
 * executa com acesso restrito às ferramentas dos servidores MCP configurados
 * localmente. Nenhum nome de servidor, comando ou segredo vive neste arquivo:
 * tudo é lido da config do usuário em tempo de execução.
 *
 * Uso (registro local, feito pelo próprio usuário):
 *   "mcpServers": {
 *     "selfevopi-code-mode": {
 *       "command": "node",
 *       "args": ["<caminho>/scripts/code-mode-mcp.mjs"]
 *     }
 *   }
 *
 * Variáveis opcionais:
 *   SELFEOPI_CODE_MODE_CONFIG   caminho alternativo do settings.json
 *   SELFEOPI_CODE_MODE_SERVERS  lista separada por vírgula para limitar servidores
 *   SELFEOPI_CODE_MODE_TIMEOUT  timeout do programa em ms (padrão 10000)
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCode } from "../core/agent/code-mode.mjs";

const PROTOCOL = "2024-11-05";
const CONNECT_TIMEOUT = 12_000;
const CONCURRENCY = 4;

function erro(texto) {
  process.stderr.write(String(texto).slice(0, 1000) + "\n");
}

function lerConfig() {
  const alvo = process.env.SELFEOPI_CODE_MODE_CONFIG || path.join(os.homedir(), ".pi", "settings.json");
  return readFile(alvo, "utf8").then((txt) => {
    const doc = JSON.parse(txt);
    const servidores = doc?.mcpServers ?? doc?.mcp?.servers ?? {};
    if (!servidores || typeof servidores !== "object" || Array.isArray(servidores)) return { alvo, servidores: {} };
    const permitidos = String(process.env.SELFEOPI_CODE_MODE_SERVERS || "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    const entradas = Object.entries(servidores).filter(([id]) => {
      if (id === "selfevopi-code-mode") return false;
      return permitidos.length === 0 || permitidos.includes(id);
    });
    return { alvo, servidores: Object.fromEntries(entradas) };
  });
}

/** Cliente MCP mínimo sobre JSON-RPC 2.0 delimitado por linha. */
class ClienteStdio {
  constructor(id, cfg) {
    this.id = id;
    this.cfg = cfg;
    this.prox = null;
    this.pendentes = new Map();
    this.seq = 0;
    this.buffer = "";
    this.iniciado = false;
  }

  start() {
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(this.cfg.command, Array.isArray(this.cfg.args) ? this.cfg.args : [], {
          env: { ...process.env, ...(this.cfg.env || {}) },
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch (e) { reject(e); return; }
      this.prox = child;
      let resolvido = false;
      const timer = setTimeout(() => {
        if (!resolvido) { resolvido = true; reject(new Error("timeout no initialize")); }
      }, CONNECT_TIMEOUT);
      if (timer.unref) timer.unref();

      child.stderr?.on("data", (d) => { /* stderr do servidor não polui stdout */ void d; });
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => {
        this.buffer += chunk;
        let idx;
        while ((idx = this.buffer.indexOf("\n")) >= 0) {
          const linha = this.buffer.slice(0, idx).trim();
          this.buffer = this.buffer.slice(idx + 1);
          if (!linha) continue;
          let msg;
          try { msg = JSON.parse(linha); } catch { continue; }
          if (msg.id != null && this.pendentes.has(msg.id)) {
            const { resolve: ok, reject: falha, timer: t } = this.pendentes.get(msg.id);
            clearTimeout(t);
            this.pendentes.delete(msg.id);
            if (msg.error) falha(new Error(msg.error.message || "erro JSON-RPC"));
            else ok(msg.result);
          }
        }
      });
      child.on("error", (e) => {
        if (!resolvido) { resolvido = true; clearTimeout(timer); reject(e); }
      });
      child.on("close", () => {
        for (const p of this.pendentes.values()) {
          clearTimeout(p.timer);
          p.reject(new Error("servidor MCP encerrado"));
        }
        this.pendentes.clear();
      });

      this.request("initialize", {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: "selfevopi-code-mode", version: "1.0.0" },
      }).then((resultado) => {
        if (resolvido) return;
        resolvido = true;
        clearTimeout(timer);
        this.iniciado = true;
        this.notify("notifications/initialized", {});
        resolve(resultado);
      }).catch((e) => {
        if (resolvido) return;
        resolvido = true;
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.prox || !this.prox.stdin?.writable) { reject(new Error("servidor indisponível")); return; }
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pendentes.delete(id);
        reject(new Error("timeout: " + method));
      }, CONNECT_TIMEOUT);
      if (timer.unref) timer.unref();
      this.pendentes.set(id, { resolve, reject, timer });
      this.prox.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  notify(method, params = {}) {
    if (this.prox?.stdin?.writable) {
      this.prox.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
    }
  }

  async tools() {
    const r = await this.request("tools/list", {});
    return Array.isArray(r?.tools) ? r.tools : [];
  }

  async call(name, args) {
    const r = await this.request("tools/call", { name, arguments: args });
    const partes = Array.isArray(r?.content) ? r.content : [];
    const texto = partes.map((p) => (p?.type === "text" ? p.text : JSON.stringify(p))).join("\n");
    return { isError: Boolean(r?.isError), text: texto };
  }

  close() {
    try { this.prox?.stdin?.end(); } catch { /* já fechado */ }
    for (const p of this.pendentes.values()) clearTimeout(p.timer);
    this.pendentes.clear();
  }
}

let cache = null;
async function obterFerramentas() {
  if (cache) return cache;
  const { servidores } = await lerConfig();
  const ids = Object.keys(servidores);
  const mapa = new Map();
  const clientes = [];

  // Conexões em lotes: servidores que falham são ignorados, nunca derrubam o gateway.
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const lote = ids.slice(i, i + CONCURRENCY);
    const resultados = await Promise.allSettled(lote.map(async (id) => {
      const cliente = new ClienteStdio(id, servidores[id]);
      await cliente.start();
      return { id, cliente };
    }));
    for (const r of resultados) {
      if (r.status !== "fulfilled") { erro("falha ao conectar em servidor MCP local: " + String(r.reason?.message || r.reason).slice(0, 120)); continue; }
      const { id, cliente } = r.value;
      clientes.push(cliente);
      let ferramentas = [];
      try { ferramentas = await cliente.tools(); } catch { /* sem tools */ }
      for (const t of ferramentas) {
        if (!t || typeof t.name !== "string") continue;
        const nome = `${id}.${t.name}`;
        if (mapa.has(nome)) continue;
        mapa.set(nome, { cliente, nomeOriginal: t.name, descricao: t.description || "" });
      }
    }
  }

  const tools = {};
  for (const [nome, info] of mapa) {
    tools[nome] = async (args) => {
      const r = await info.cliente.call(info.nomeOriginal, args || {});
      return { ok: !r.isError, text: r.text };
    };
  }
  cache = { tools, clientes, totalServidores: ids.length };
  return cache;
}

/* ------------------------------- servidor MCP ------------------------------ */

function responder(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function responderErro(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

async function tratar(msg) {
  if (msg.jsonrpc !== "2.0") return;
  const metodo = msg.method;
  if (msg.id == null) return; // notificação

  if (metodo === "initialize") {
    responder(msg.id, {
      protocolVersion: PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "selfevopi-code-mode", version: "1.0.0" },
    });
    return;
  }
  if (metodo === "ping") { responder(msg.id, {}); return; }
  if (metodo === "shutdown") { responder(msg.id, {}); return; }
  if (metodo === "tools/list") {
    responder(msg.id, {
      tools: [{
        name: "run_code",
        description: "Runs a short JavaScript program that chains MCP tool calls via tools.call(name, args). Use tools.list() to discover names. No filesystem, network, shell or eval access.",
        inputSchema: {
          type: "object",
          properties: {
            code: { type: "string", description: "JavaScript program body. Return the final value." },
          },
          required: ["code"],
        },
      }],
    });
    return;
  }
  if (metodo === "tools/call") {
    const nome = msg.params?.name;
    if (nome !== "run_code") { responderErro(msg.id, -32602, "ferramenta desconhecida"); return; }
    const code = msg.params?.arguments?.code;
    if (typeof code !== "string") { responderErro(msg.id, -32602, "code deve ser string"); return; }
    try {
      const { tools, totalServidores } = await obterFerramentas();
      const timeout = Number(process.env.SELFEOPI_CODE_MODE_TIMEOUT) || 10_000;
      const r = await runCode(code, {
        tools,
        timeoutMs: timeout,
        log: (linha) => erro("code-mode: " + linha),
      });
      const texto = JSON.stringify({
        ok: r.ok,
        value: r.value,
        error: r.error,
        calls: r.calls,
        durationMs: r.durationMs,
        servers: totalServidores,
        tools: tools ? Object.keys(tools).length : 0,
      });
      responder(msg.id, {
        content: [{ type: "text", text: texto }],
        isError: !r.ok,
      });
    } catch (e) {
      responder(msg.id, {
        content: [{ type: "text", text: JSON.stringify({ ok: false, error: String(e?.message || e) }) }],
        isError: true,
      });
    }
    return;
  }
  responderErro(msg.id, -32601, "método não encontrado");
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const linha = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!linha) continue;
    let msg;
    try { msg = JSON.parse(linha); } catch { continue; }
    void tratar(msg).catch((e) => erro("erro ao tratar mensagem: " + String(e?.message || e)));
  }
});
process.stdin.on("end", () => {
  for (const c of cache?.clientes || []) c.close();
  process.exit(0);
});
