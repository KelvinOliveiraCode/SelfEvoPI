import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DapClient,
  encodeDapMessage,
  createDapParser,
  readDapConfig,
  adapterForFile,
} from "./dap.mjs";

/* ------------------------------------------------------------------ */
/* Adaptador DAP falso, escrito em arquivo temporário no próprio teste  */
/* ------------------------------------------------------------------ */

const ADAPTADOR_FALSO = String.raw`
let buffer = Buffer.alloc(0);

function enviar(obj) {
  const corpo = Buffer.from(JSON.stringify(obj), "utf8");
  const cabecalho = Buffer.from("Content-Length: " + corpo.length + "\r\n\r\n", "ascii");
  process.stdout.write(Buffer.concat([cabecalho, corpo]));
}
function responder(seq, command, body) {
  enviar({ type: "response", request_seq: seq, success: true, command, body });
}

function tratar(msg) {
  if (msg.type !== "request") return;
  const seq = msg.seq;
  const cmd = msg.command;
  const args = msg.arguments || {};
  switch (cmd) {
    case "initialize":
      responder(seq, cmd, { supportsConfigurationDoneRequest: true });
      return;
    case "launch":
    case "attach":
    case "disconnect":
      responder(seq, cmd, {});
      if (cmd === "disconnect") setTimeout(() => process.exit(0), 20);
      return;
    case "setBreakpoints": {
      const lista = (args.breakpoints || []).map((b) => ({
        verified: b.line !== 999,
        line: b.line,
        id: b.line,
      }));
      responder(seq, cmd, { breakpoints: lista });
      return;
    }
    case "continue":
    case "next":
    case "stepIn":
    case "stepOut":
    case "pause":
      responder(seq, cmd, {});
      enviar({ type: "event", event: "stopped", body: {
        reason: "breakpoint", threadId: 1, description: "parou ☕"
      }});
      return;
    case "threads":
      responder(seq, cmd, { threads: [{ id: 1, name: "principal ☕" }] });
      return;
    case "stackTrace":
      responder(seq, cmd, { stackFrames: [
        { id: 10, name: "main", line: 3, column: 1, source: { path: "fonte.js" } }
      ]});
      return;
    case "scopes":
      responder(seq, cmd, { scopes: [
        { name: "Locais", variablesReference: 100, expensive: false }
      ]});
      return;
    case "variables":
      responder(seq, cmd, { variables: [
        { name: "café", value: "☕ 42", variablesReference: 0 }
      ]});
      return;
    default:
      responder(seq, cmd, {});
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

const ADAPTADOR_MUDO = "process.stdin.resume(); setInterval(() => {}, 1000);\n";

async function scriptTemp(conteudo) {
  const dir = await mkdtemp(join(tmpdir(), "selfevopi-dap-"));
  const arquivo = join(dir, "adapter.mjs");
  await writeFile(arquivo, conteudo, "utf8");
  return { dir, arquivo };
}

/* --------------------------- framing ------------------------------------ */

test("framing: Content-Length em bytes UTF-8 e chunk cortado no meio de emoji", () => {
  const mensagem = {
    type: "request",
    seq: 1,
    command: "launch",
    arguments: { nome: "Atenção, café ☕ 🚀" },
  };
  const json = JSON.stringify(mensagem);
  const bytes = Buffer.byteLength(json, "utf8");
  assert.ok(bytes > json.length, "multibyte aumenta o total de bytes");

  const quadro = encodeDapMessage(mensagem);
  const fim = quadro.indexOf(Buffer.from("\r\n\r\n", "ascii"));
  assert.equal(quadro.subarray(0, fim).toString("ascii"), `Content-Length: ${bytes}`);
  assert.equal(quadro.length, fim + 4 + bytes);

  const recebidos = [];
  const parser = createDapParser((msg) => recebidos.push(msg));
  const corte = quadro.indexOf(Buffer.from("🚀", "utf8")) + 1;
  parser.feed(quadro.subarray(0, corte));
  parser.feed(quadro.subarray(corte, corte + 3));
  parser.feed(quadro.subarray(corte + 3));
  assert.deepEqual(recebidos, [mensagem]);
});

/* --------------------------- cliente ------------------------------------ */

test("fluxo completo: start, launch, breakpoints, continue, stopped, stack, variables, close", async (t) => {
  const { dir, arquivo } = await scriptTemp(ADAPTADOR_FALSO);
  const cliente = new DapClient({ command: process.execPath, args: [arquivo], timeoutMs: 1000 });
  t.after(async () => {
    await cliente.close();
    await rm(dir, { recursive: true, force: true });
  });

  const caps = await cliente.start();
  assert.equal(caps.supportsConfigurationDoneRequest, true);
  assert.deepEqual(cliente.capabilities, caps);
  assert.equal(cliente.running, true);

  assert.deepEqual(await cliente.launch({ program: "fonte.js", stopOnEntry: false }), {});
  assert.deepEqual(await cliente.attach({}), {}, "attach disponível no adaptador falso");

  const breakpoints = await cliente.setBreakpoints({ path: "fonte.js", lines: [3, 7, 999] });
  assert.deepEqual(
    breakpoints.map((bp) => bp.line),
    [3, 7],
    "breakpoint não verificado é descartado",
  );

  assert.deepEqual(await cliente.continueRequest(1), {});
  const parado = await cliente.waitForEvent("stopped", 1000);
  assert.equal(parado.reason, "breakpoint");
  assert.equal(parado.threadId, 1);
  assert.equal(parado.description, "parou ☕");

  const threads = await cliente.threads();
  assert.deepEqual(threads, [{ id: 1, name: "principal ☕" }]);

  const frames = await cliente.stackTrace(1);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].id, 10);
  assert.equal(frames[0].line, 3);

  const variaveis = await cliente.variables(10);
  assert.deepEqual(variaveis, [{ name: "café", value: "☕ 42", variablesReference: 0 }]);

  for (const passo of [cliente.next, cliente.stepIn, cliente.stepOut, cliente.pause]) {
    assert.deepEqual(await passo.call(cliente, 1), {});
  }
  assert.equal(await cliente.waitForEvent("terminated", 80), null, "evento ausente expira para null");

  await cliente.close();
  assert.equal(cliente.running, false);
});

test("waitForEvent resolve um evento que ainda não chegou", async (t) => {
  const { dir, arquivo } = await scriptTemp(ADAPTADOR_FALSO);
  const cliente = new DapClient({ command: process.execPath, args: [arquivo], timeoutMs: 1000 });
  t.after(async () => {
    await cliente.close();
    await rm(dir, { recursive: true, force: true });
  });

  await cliente.start();
  const espera = cliente.waitForEvent("stopped", 1000);
  await cliente.continueRequest(1);
  const evento = await espera;
  assert.equal(evento.reason, "breakpoint");
  assert.equal(evento.description, "parou ☕");
});

test("start() expira quando o adaptador não responde ao initialize", async (t) => {
  const { dir, arquivo } = await scriptTemp(ADAPTADOR_MUDO);
  const cliente = new DapClient({ command: process.execPath, args: [arquivo], timeoutMs: 250 });
  t.after(async () => {
    await cliente.close();
    await rm(dir, { recursive: true, force: true });
  });

  await assert.rejects(() => cliente.start(), /timeout em initialize/);
  assert.equal(cliente.running, false);
});

/* --------------------------- configuração ------------------------------- */

test("readDapConfig: ausente, válido, quebrado e formato inesperado", async () => {
  const dir = await mkdtemp(join(tmpdir(), "selfevopi-dap-config-"));
  try {
    assert.deepEqual(await readDapConfig(dir), { adapters: {} });

    const arquivo = join(dir, ".pi", "dap.json");
    await mkdir(join(dir, ".pi"), { recursive: true });
    await writeFile(
      arquivo,
      JSON.stringify({
        adapters: {
          node: { command: "depurador-node", args: ["--inspect-brk"] },
          python: { command: "depurador-python", args: [] },
        },
      }),
      "utf8",
    );
    const valido = await readDapConfig(dir);
    assert.equal(valido.adapters.node.command, "depurador-node");
    assert.equal(valido.error, undefined);

    await writeFile(arquivo, "{ isto nao e json }", "utf8");
    const quebrado = await readDapConfig(dir);
    assert.deepEqual(quebrado.adapters, {});
    assert.match(quebrado.error, /JSON inválido/);

    await writeFile(arquivo, '{ "adapters": [] }', "utf8");
    const forma = await readDapConfig(dir);
    assert.deepEqual(forma.adapters, {});
    assert.match(forma.error, /formato inesperado/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("adapterForFile escolhe por extensão, respeita config e prefere a mais longa", () => {
  const config = {
    adapters: {
      node: { command: "a" },
      python: { command: "b" },
      depurador: { command: "c", extensions: [".dapr", ".meu.test"] },
    },
  };
  assert.equal(adapterForFile(config, "src/app.ts").nome, "node");
  assert.equal(adapterForFile(config, "src/app.MJS").nome, "node");
  assert.equal(adapterForFile(config, "src/main.py").nome, "python");
  assert.equal(adapterForFile(config, "src/arquivo.dapr").nome, "depurador");
  assert.equal(adapterForFile(config, "src/arquivo.meu.test").nome, "depurador", "extensão longa vence");
  assert.equal(adapterForFile(config, "src/main.rs"), null, "sem adaptador rust configurado");
  assert.equal(adapterForFile(null, "a.js"), null);
  assert.equal(adapterForFile(config, null), null);
});
