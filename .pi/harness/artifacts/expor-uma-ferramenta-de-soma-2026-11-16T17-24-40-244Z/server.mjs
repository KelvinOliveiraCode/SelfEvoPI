#!/usr/bin/env node
/**
 * server.mjs — servidor MCP autogerado pelo Forge (JSON-RPC 2.0 sobre stdio).
 * Objetivo: expor uma ferramenta de soma
 *
 * Metodos: initialize, tools/list, tools/call.
 * Sem dependencias externas: apenas builtins do Node.
 */

import { createInterface } from "node:readline";

const INPUTS = {
  "a": "a",
  "b": "b"
};
const OUTPUTS = {
  "soma": "soma"
};

// Uma ferramenta por entrada declarada. O schema e minimo e honesto.
const TOOLS = Object.keys(INPUTS).map(function (name) {
  return {
    name: name,
    description: INPUTS[name],
    inputSchema: { type: "object", properties: {} }
  };
});

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function ok(id, result) {
  send({ jsonrpc: "2.0", id: id, result: result });
}

function fail(id, code, message) {
  send({ jsonrpc: "2.0", id: id, error: { code: code, message: message } });
}

function handle(msg) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    fail(msg && msg.id, -32600, "Requisição inválida");
    return;
  }
  const id = msg.id;
  const method = msg.method;

  if (method === "initialize") {
    ok(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "forge-mcp-server", version: "0.0.0" }
    });
    return;
  }

  if (method === "tools/list") {
    ok(id, { tools: TOOLS });
    return;
  }

  if (method === "tools/call") {
    const params = msg.params || {};
    const name = params.name;
    const tool = TOOLS.find(function (t) { return t.name === name; });
    if (!tool) {
      fail(id, -32602, "Ferramenta desconhecida: " + name);
      return;
    }
    // Esqueleto honesto: devolve as saídas declaradas sem inventar cálculo.
    const out = {};
    Object.keys(OUTPUTS).forEach(function (k) { out[k] = null; });
    ok(id, { content: [{ type: "text", text: JSON.stringify(out) }] });
    return;
  }

  fail(id, -32601, "Método não suportado: " + method);
}

const rl = createInterface({ input: process.stdin });
rl.on("line", function (line) {
  const text = String(line || "").trim();
  if (text === "") return;
  let msg = null;
  try {
    msg = JSON.parse(text);
  } catch (e) {
    fail(null, -32700, "Parse error");
    return;
  }
  handle(msg);
});
