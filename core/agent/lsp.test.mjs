import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { encodeLspMessage, createLspParser, LspClient, readLspConfig, serverForFile } from "./lsp.mjs";

/* ------------------------------------------------------------------ */
/* Servidor LSP falso — escrito em arquivo temporário no próprio teste  */
/* ------------------------------------------------------------------ */

const SERVIDOR_FALSO = String.raw`
const R = { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } };
const R2 = { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } };
let buffer = Buffer.alloc(0);

function enviar(obj) {
  const corpo = Buffer.from(JSON.stringify(obj), "utf8");
  const cabecalho = Buffer.from("Content-Length: " + corpo.length + "\r\n\r\n", "ascii");
  process.stdout.write(Buffer.concat([cabecalho, corpo]));
}

function publicar(uri, mensagem, severidade, fonte) {
  enviar({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: {
    uri, diagnostics: [{ range: R, severity: severidade, message: mensagem, source: fonte }]
  }});
}

function tratar(msg) {
  const params = msg.params || {};
  const uri = params.textDocument?.uri;
  switch (msg.method) {
    case "initialize":
      enviar({ jsonrpc: "2.0", id: msg.id, result: {
        capabilities: { hoverProvider: true, renameProvider: true, diagnosticProvider: { identifier: "fake" } },
        serverInfo: { name: "fake-lsp", version: "1" }
      }});
      return;
    case "initialized":
      return;
    case "textDocument/didOpen":
      publicar(uri, "Atenção: café ☕ inválido", 1, "fake");
      return;
    case "textDocument/didChange":
      publicar(uri, "Atenção: mudou ☕", 2, "fake-change");
      return;
    case "textDocument/rename":
      enviar({ jsonrpc: "2.0", id: msg.id, result: { changes: {
        [uri]: [{ range: R, newText: params.newName }]
      }}});
      return;
    case "textDocument/hover":
      enviar({ jsonrpc: "2.0", id: msg.id, result: {
        contents: { kind: "markdown", value: "**dica** — café ☕" }
      }});
      return;
    case "textDocument/documentSymbol":
      enviar({ jsonrpc: "2.0", id: msg.id, result: [
        { name: "principal", kind: 5, range: R, selectionRange: R,
          children: [{ name: "filho", kind: 6, range: R2, selectionRange: R2 }] }
      ]});
      return;
    case "textDocument/diagnostic":
      enviar({ jsonrpc: "2.0", id: msg.id, result: { items: [
        { range: R, severity: 3, message: "pull ☕", source: "fake-pull" }
      ]}});
      return;
    case "shutdown":
      enviar({ jsonrpc: "2.0", id: msg.id, result: null });
      return;
    case "exit":
      process.exit(0);
      return;
    default:
      return;
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const fim = buffer.indexOf("\r\n\r\n");
    if (fim < 0) return;
    const cabecalho = buffer.subarray(0, fim).toString("ascii");
    const found = /content-length\s*:\s*(\d+)/i.exec(cabecalho);
    if (!found) { buffer = buffer.subarray(fim + 4); continue; }
    const n = Number(found[1]);
    const inicio = fim + 4;
    if (buffer.length < inicio + n) return;
    const corpo = buffer.subarray(inicio, inicio + n);
    buffer = buffer.subarray(inicio + n);
    try { tratar(JSON.parse(corpo.toString("utf8"))); }
    catch (err) { process.stderr.write(String(err)); }
  }
});
process.stdin.resume();
setInterval(() => {}, 1000);
`;

const SERVIDOR_MUDO = "process.stdin.resume(); setInterval(() => {}, 1000);\n";

const R = { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } };

async function scriptTemp(conteudo) {
  const dir = await mkdtemp(join(tmpdir(), "selfevopi-lsp-"));
  const arquivo = join(dir, "server.mjs");
  await writeFile(arquivo, conteudo, "utf8");
  return { dir, arquivo };
}

/* ------------------------------------------------------------------ */
/* Framing                                                             */
/* ------------------------------------------------------------------ */

test("framing: Content-Length conta bytes UTF-8, não caracteres", () => {
  const mensagem = { jsonrpc: "2.0", method: "teste", params: { texto: "Atenção, café ☕ 🚀" } };
  const json = JSON.stringify(mensagem);
  const bytes = Buffer.byteLength(json, "utf8");
  assert.ok(bytes > json.length, "acento/emoji aumentam o tamanho em bytes");

  const quadro = encodeLspMessage(mensagem);
  const fim = quadro.indexOf(Buffer.from("\r\n\r\n", "ascii"));
  assert.equal(quadro.subarray(0, fim).toString("ascii"), `Content-Length: ${bytes}`);
  assert.equal(quadro.length, fim + 4 + bytes);
  assert.equal(quadro.subarray(fim + 4).toString("utf8"), json);
});

test("parser reúne chunks cortados dentro de um emoji e lê 2 quadros de uma vez", () => {
  const a = { id: 1, texto: "café ☕" };
  const b = { id: 2, texto: "olá 🚀" };
  const quadro = Buffer.concat([encodeLspMessage(a), encodeLspMessage(b)]);

  const recebidos = [];
  const parser = createLspParser((msg) => recebidos.push(msg));
  const corte = quadro.indexOf(Buffer.from("☕", "utf8")) + 1; // meio do codepoint
  parser.feed(quadro.subarray(0, corte));
  parser.feed(quadro.subarray(corte, corte + 3));
  parser.feed(quadro.subarray(corte + 3));
  assert.deepEqual(recebidos, [a, b]);

  const direto = [];
  createLspParser((msg) => direto.push(msg)).feed(quadro);
  assert.deepEqual(direto, [a, b]);
});

/* ------------------------------------------------------------------ */
/* Integração com servidor falso                                       */
/* ------------------------------------------------------------------ */

test("cliente completo: initialize, diagnósticos, rename, hover e symbols", async (t) => {
  const { dir, arquivo } = await scriptTemp(SERVIDOR_FALSO);
  const cliente = new LspClient({ command: process.execPath, args: [arquivo], timeoutMs: 1000 });
  const uri = "file:///C:/projeto/fonte.ts";
  t.after(async () => {
    await cliente.close();
    await rm(dir, { recursive: true, force: true });
  });

  const caps = await cliente.start();
  assert.equal(caps.hoverProvider, true);
  assert.equal(cliente.capabilities.renameProvider, true);
  assert.equal(cliente.running, true);
  assert.deepEqual(cliente.capabilities, caps);

  cliente.openDocument(uri, "typescript", "const café = 1;\n");
  const diagnosticos = await cliente.diagnostics(uri);
  assert.equal(diagnosticos.length, 1);
  assert.equal(diagnosticos[0].message, "Atenção: café ☕ inválido");
  assert.equal(diagnosticos[0].severity, 1);
  assert.equal(diagnosticos[0].source, "fake");
  assert.deepEqual(Object.keys(diagnosticos[0]), ["range", "severity", "message", "source"]);

  cliente.changeDocument(uri, "const café = 2;\n", 2);
  const depois = await cliente.diagnostics(uri);
  assert.equal(depois[0].message, "Atenção: mudou ☕", "cache invalidado no didChange");
  assert.equal(depois[0].severity, 2);

  // uri sem publicação: cai no pull diagnostics anunciado nas capabilities
  const puxados = await cliente.diagnostics("file:///C:/projeto/outro.ts");
  assert.equal(puxados[0].message, "pull ☕");
  assert.equal(puxados[0].source, "fake-pull");

  const renomeio = await cliente.rename(uri, 0, 6, "acucar");
  assert.deepEqual(renomeio, { changes: { [uri]: [{ range: R, newText: "acucar" }] } });

  assert.equal(await cliente.hover(uri, 0, 6), "**dica** — café ☕");

  const simbolos = await cliente.documentSymbols(uri);
  assert.deepEqual(
    simbolos.map((s) => s.name),
    ["principal", "filho"],
  );
  assert.equal(simbolos[0].kind, 5);
  assert.deepEqual(simbolos[0].selectionRange, R);
  assert.equal(simbolos[1].kind, 6);

  await cliente.close();
  assert.equal(cliente.running, false);
});

test("start() expira quando o servidor não responde ao initialize", async (t) => {
  const { dir, arquivo } = await scriptTemp(SERVIDOR_MUDO);
  const cliente = new LspClient({ command: process.execPath, args: [arquivo], timeoutMs: 250 });
  t.after(async () => {
    await cliente.close();
    await rm(dir, { recursive: true, force: true });
  });

  await assert.rejects(() => cliente.start(), /timeout em initialize/);
  assert.equal(cliente.running, false);
});

/* ------------------------------------------------------------------ */
/* Configuração                                                        */
/* ------------------------------------------------------------------ */

test("readLspConfig: ausente, válido, JSON quebrado e formato inesperado", async () => {
  const dir = await mkdtemp(join(tmpdir(), "selfevopi-lsp-config-"));
  try {
    assert.deepEqual(await readLspConfig(dir), { servers: {} });

    const arquivo = join(dir, ".pi", "lsp.json");
    await mkdir(join(dir, ".pi"), { recursive: true });
    await writeFile(
      arquivo,
      JSON.stringify({
        servers: { typescript: { command: "servidor-lsp", args: ["--stdio"], extensions: [".ts", ".tsx"] } },
      }),
      "utf8",
    );
    const valido = await readLspConfig(dir);
    assert.equal(valido.servers.typescript.command, "servidor-lsp");
    assert.deepEqual(valido.servers.typescript.extensions, [".ts", ".tsx"]);
    assert.equal(valido.error, undefined);

    await writeFile(arquivo, "{ isto nao e json }", "utf8");
    const quebrado = await readLspConfig(dir);
    assert.deepEqual(quebrado.servers, {});
    assert.match(quebrado.error, /JSON inválido/);

    await writeFile(arquivo, '{ "servers": [] }', "utf8");
    const forma = await readLspConfig(dir);
    assert.deepEqual(forma.servers, {});
    assert.match(forma.error, /formato inesperado/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("serverForFile casa sufixo, ignora caixa e prefere a extensão mais longa", () => {
  const config = {
    servers: {
      ts: { command: "a", extensions: [".ts"] },
      tsx: { command: "b", extensions: [".tsx", ".d.ts"] },
      semExtensao: { command: "c" },
    },
  };
  assert.equal(serverForFile(config, "C:/proj/arquivo.ts").nome, "ts");
  assert.equal(serverForFile(config, "src/Componente.TSX").nome, "tsx");
  assert.equal(serverForFile(config, "src/tipos.d.ts").nome, "tsx", ".d.ts vence sobre .ts");
  assert.equal(serverForFile(config, "src/main.py"), null);
  assert.equal(serverForFile(null, "a.ts"), null);
  assert.equal(serverForFile(config, null), null);
});
