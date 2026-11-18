#!/usr/bin/env node
/**
 * core/agent/mcp.test.mjs — o inventário de servidores MCP.
 *
 * Usa diretórios temporários de verdade: é a única forma de provar que a
 * leitura de `.mcp.json` e `.pi/settings.json` funciona sem depender da
 * máquina de quem roda. Nada aqui conecta em nada.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { listMcpServers, readMcpConfig, MCP_FILES, serversFromConfig, normalizeServer } from "./mcp.mjs";

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

async function comProjeto(files) {
  const root = await mkdtemp(path.join(tmpdir(), "selfevopi-mcp-"));
  for (const [rel, conteudo] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, conteudo, "utf8");
  }
  return {
    root,
    limpar: () => rm(root, { recursive: true, force: true }),
  };
}

/* ------------------------------------------------------------------ */
/* readMcpConfig — formato e leitura                                   */
/* ------------------------------------------------------------------ */

test("MCP_FILES é a ordem canônica: .mcp.json antes de .pi/settings.json", () => {
  assert.deepEqual(MCP_FILES, [".mcp.json", ".pi/settings.json"]);
});

test("serversFromConfig aceita mcpServers plano", () => {
  const doc = { mcpServers: { a: { command: "node", args: ["a.mjs"] } } };
  assert.deepEqual(Object.keys(serversFromConfig(doc)), ["a"]);
});

test("serversFromConfig aceita mcp.servers aninhado", () => {
  const doc = { mcp: { servers: { b: { command: "node" } } } };
  assert.deepEqual(Object.keys(serversFromConfig(doc)), ["b"]);
});

test("serversFromConfig devolve vazio para lixo e para null", () => {
  assert.deepEqual(serversFromConfig(null), {});
  assert.deepEqual(serversFromConfig([]), {});
  assert.deepEqual(serversFromConfig("texto"), {});
  assert.deepEqual(serversFromConfig({}), {});
});

/* ------------------------------------------------------------------ */
/* listMcpServers — projeto com .mcp.json                              */
/* ------------------------------------------------------------------ */

test("projeto com .mcp.json lista os servidores com status configured", async () => {
  const p = await comProjeto({
    ".mcp.json": JSON.stringify({
      mcpServers: {
        filesystem: { command: "node", args: ["server.mjs"], env: { TOKEN: "segredo" } },
        contexto: { command: "npx", args: ["-y", "@modelcontextprotocol/server-sequential-thinking"] },
      },
    }),
  });
  try {
    const lista = await listMcpServers({ root: p.root });

    assert.equal(lista.length, 2);
    assert.deepEqual(
      lista.map((s) => s.name),
      ["contexto", "filesystem"],
    );

    const fs = lista.find((s) => s.name === "filesystem");
    assert.equal(fs.command, "node");
    assert.deepEqual(fs.args, ["server.mjs"]);
    assert.equal(fs.status, "configured");

    // credencial nunca sai: `env` não faz parte do formato público
    assert.deepEqual(Object.keys(fs).sort(), ["args", "command", "name", "status"]);
    assert.equal("env" in fs, false);
  } finally {
    await p.limpar();
  }
});

/* ------------------------------------------------------------------ */
/* projeto sem config                                                  */
/* ------------------------------------------------------------------ */

test("projeto sem .mcp.json e sem .pi/settings.json devolve lista vazia", async () => {
  const p = await comProjeto({ "README.md": "# nada" });
  try {
    const lista = await listMcpServers({ root: p.root });
    assert.deepEqual(lista, []);
  } finally {
    await p.limpar();
  }
});

test("diretório inexistente não lança: devolve lista vazia", async () => {
  const root = path.join(tmpdir(), "selfevopi-mcp-que-nao-existe-" + process.pid);
  const lista = await listMcpServers({ root });
  assert.deepEqual(lista, []);
});

/* ------------------------------------------------------------------ */
/* .mcp.json malformado                                                */
/* ------------------------------------------------------------------ */

test(".mcp.json malformado não lança e não derruba os outros arquivos", async () => {
  const p = await comProjeto({
    ".mcp.json": "{ isto nao e json",
    ".pi/settings.json": JSON.stringify({
      mcpServers: { valido: { command: "node" } },
    }),
  });
  try {
    const lista = await listMcpServers({ root: p.root });

    // o arquivo quebrado não impede o outro: o que era legível continua de pé
    assert.equal(lista.length, 1);
    assert.equal(lista[0].name, "valido");

    // e o diagnóstico diz por quê, em vez de esconder
    const diag = await readMcpConfig({ root: p.root });
    const quebrado = diag.files.find((f) => f.path === ".mcp.json");
    assert.equal(quebrado.ok, false);
    assert.match(quebrado.error, /JSON inválido/);
  } finally {
    await p.limpar();
  }
});

test(".pi/settings.json malformado é diagnosticado sem derrubar .mcp.json", async () => {
  const p = await comProjeto({
    ".mcp.json": JSON.stringify({ mcpServers: { a: { command: "node" } } }),
    ".pi/settings.json": "[1,2,3]",
  });
  try {
    const diag = await readMcpConfig({ root: p.root });
    const settings = diag.files.find((f) => f.path === ".pi/settings.json");
    assert.equal(settings.exists, true);
    // JSON válido, mas não é um objeto de configuração: nenhum servidor dele
    assert.equal(settings.ok, true);
    assert.deepEqual(settings.servers, []);

    const lista = await listMcpServers({ root: p.root });
    assert.equal(lista.length, 1);
    assert.equal(lista[0].name, "a");
  } finally {
    await p.limpar();
  }
});

/* ------------------------------------------------------------------ */
/* status: missing e disabled                                          */
/* ------------------------------------------------------------------ */

test("servidor sem command e sem url fica missing", async () => {
  const p = await comProjeto({
    ".mcp.json": JSON.stringify({ mcpServers: { vazio: {} } }),
  });
  try {
    const [server] = await listMcpServers({ root: p.root });
    assert.equal(server.name, "vazio");
    assert.equal(server.status, "missing");
    assert.equal(server.command, null);
    assert.deepEqual(server.args, []);
  } finally {
    await p.limpar();
  }
});

test("servidor remoto (só url) fica configured e sem command", async () => {
  const p = await comProjeto({
    ".mcp.json": JSON.stringify({
      mcpServers: { remoto: { url: "https://example.com/mcp" } },
    }),
  });
  try {
    const [server] = await listMcpServers({ root: p.root });
    assert.equal(server.status, "configured");
    assert.equal(server.command, null);
  } finally {
    await p.limpar();
  }
});

test("disabled: true e enabled: false tiram o servidor do ar", async () => {
  const p = await comProjeto({
    ".mcp.json": JSON.stringify({
      mcpServers: {
        desligado: { command: "node", disabled: true },
        desligado2: { command: "node", enabled: false },
        ligado: { command: "node" },
      },
    }),
  });
  try {
    const lista = await listMcpServers({ root: p.root });
    const mapa = Object.fromEntries(lista.map((s) => [s.name, s.status]));

    assert.equal(mapa.desligado, "disabled");
    assert.equal(mapa.desligado2, "disabled");
    assert.equal(mapa.ligado, "configured");
  } finally {
    await p.limpar();
  }
});

/* ------------------------------------------------------------------ */
/* colisão de nomes e ordenação                                        */
/* ------------------------------------------------------------------ */

test("na colisão de nomes vence .mcp.json (o arquivo canônico)", async () => {
  const p = await comProjeto({
    ".mcp.json": JSON.stringify({ mcpServers: { dup: { command: "node", args: ["mcp.mjs"] } } }),
    ".pi/settings.json": JSON.stringify({ mcpServers: { dup: { command: "outro" } } }),
  });
  try {
    const lista = await listMcpServers({ root: p.root });
    assert.equal(lista.length, 1);
    assert.equal(lista[0].command, "node");
    assert.deepEqual(lista[0].args, ["mcp.mjs"]);
  } finally {
    await p.limpar();
  }
});

test("a saída é ordenada por nome, independente da ordem do arquivo", async () => {
  const p = await comProjeto({
    ".mcp.json": JSON.stringify({
      mcpServers: {
        zebra: { command: "node" },
        alfa: { command: "node" },
        meio: { command: "node" },
      },
    }),
  });
  try {
    const lista = await listMcpServers({ root: p.root });
    assert.deepEqual(
      lista.map((s) => s.name),
      ["alfa", "meio", "zebra"],
    );
  } finally {
    await p.limpar();
  }
});

/* ------------------------------------------------------------------ */
/* normalizeServer — unidade                                           */
/* ------------------------------------------------------------------ */

test("normalizeServer aceita args não-string e devolve strings", () => {
  const server = normalizeServer("x", { command: "node", args: ["a", 2, true] });
  assert.deepEqual(server.args, ["a", "2", "true"]);
});

test("normalizeServer com entrada nula não lança e fica missing", () => {
  const server = normalizeServer("x", null);
  assert.equal(server.status, "missing");
  assert.equal(server.command, null);
  assert.deepEqual(server.args, []);
});

test("normalizeServer com command vazio em branco fica missing", () => {
  assert.equal(normalizeServer("x", { command: "   " }).status, "missing");
});

/* ------------------------------------------------------------------ */
/* readMcpConfig — formato do diagnóstico                              */
/* ------------------------------------------------------------------ */

test("readMcpConfig marca arquivo ausente e arquivo presente", async () => {
  const p = await comProjeto({
    ".mcp.json": JSON.stringify({ mcpServers: { a: { command: "node" } } }),
  });
  try {
    const diag = await readMcpConfig({ root: p.root });
    const mcp = diag.files.find((f) => f.path === ".mcp.json");
    const settings = diag.files.find((f) => f.path === ".pi/settings.json");

    assert.equal(mcp.exists, true);
    assert.equal(mcp.ok, true);
    assert.equal(mcp.servers.length, 1);

    assert.equal(settings.exists, false);
    assert.equal(settings.ok, true);
    assert.deepEqual(settings.servers, []);
  } finally {
    await p.limpar();
  }
});

test("readMcpConfig usa caminho relativo com barras, não absoluto", async () => {
  const p = await comProjeto({ ".mcp.json": "{}" });
  try {
    const diag = await readMcpConfig({ root: p.root });
    for (const file of diag.files) {
      assert.equal(path.isAbsolute(file.path), false);
      assert.equal(file.path.includes("\\"), false);
    }
  } finally {
    await p.limpar();
  }
});