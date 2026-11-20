import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { pickFolder, pickFile, ExplorerError } from "./file-explorer.mjs";

/* ------------------------------------------------------------------ */
/* Fake spawn: devolve um ChildProcess-like que emite close/error       */
/* ------------------------------------------------------------------ */

/**
 * Cria um `spawnImpl` falso. Captura os argumentos (cmd, args, opts) para
 * asserções e emite `close` (ou `error`) no próximo tick, com stdout/stderr.
 *
 * @param {{ stdout?: string, stderr?: string, code?: number, error?: Error, hang?: boolean }} spec
 */
function fakeSpawn(spec = {}) {
  const { stdout = "", stderr = "", code = 0, error = null, hang = false } = spec;
  const calls = [];
  const fn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    if (hang) return child; // nunca fecha: força o timeout
    setImmediate(() => {
      if (stdout) child.stdout.write(stdout);
      if (stderr) child.stderr.write(stderr);
      child.stdout.end();
      child.stderr.end();
      if (error) child.emit("error", error);
      else child.emit("close", code);
    });
    return child;
  };
  fn.calls = calls;
  return fn;
}

const PATH = "C:\\Users\\Kelvin\\Desktop\\projeto";

/* ------------------------------------------------------------------ */
/* pickFolder                                                          */
/* ------------------------------------------------------------------ */

test("pickFolder devolve o caminho quando o PowerShell imprime o path", async () => {
  const spawnImpl = fakeSpawn({ stdout: PATH, code: 0 });
  const out = await pickFolder({ title: "Escolha a pasta", spawnImpl });
  assert.equal(out, PATH);
});

test("pickFolder usa powershell.exe com -STA e -Command (array de args)", async () => {
  const spawnImpl = fakeSpawn({ stdout: PATH, code: 0 });
  await pickFolder({ spawnImpl });
  assert.equal(spawnImpl.calls.length, 1);
  const { cmd, args } = spawnImpl.calls[0];
  assert.equal(cmd, "powershell.exe");
  assert.ok(Array.isArray(args), "args deve ser array (sem shell string)");
  assert.ok(args.includes("-STA"), "deve usar -STA (WinForms)");
  assert.ok(args.includes("-Command"), "deve usar -Command");
  assert.ok(args.some((a) => String(a).includes("FolderBrowserDialog")), "script do FolderBrowserDialog");
});

/* ------------------------------------------------------------------ */
/* pickFile                                                            */
/* ------------------------------------------------------------------ */

test("pickFile devolve o caminho quando escolhe um arquivo", async () => {
  const spawnImpl = fakeSpawn({ stdout: "C:\\img\\foto.png", code: 0 });
  const out = await pickFile({ title: "Escolha", filter: "Imagens|*.png;*.jpg", spawnImpl });
  assert.equal(out, "C:\\img\\foto.png");
});

test("pickFile usa OpenFileDialog no script", async () => {
  const spawnImpl = fakeSpawn({ stdout: "x", code: 0 });
  await pickFile({ spawnImpl });
  const script = spawnImpl.calls[0].args.find((a) => String(a).includes("OpenFileDialog"));
  assert.ok(script, "script deve conter OpenFileDialog");
});

/* ------------------------------------------------------------------ */
/* Cancelamento → null (não lança)                                     */
/* ------------------------------------------------------------------ */

test("pickFolder devolve null quando o usuário cancela (stdout vazio)", async () => {
  const spawnImpl = fakeSpawn({ stdout: "", code: 0 });
  const out = await pickFolder({ spawnImpl });
  assert.equal(out, null);
});

test("pickFile devolve null quando cancela (stdout só com espaços)", async () => {
  const spawnImpl = fakeSpawn({ stdout: "   \n", code: 0 });
  const out = await pickFile({ spawnImpl });
  assert.equal(out, null);
});

/* ------------------------------------------------------------------ */
/* Título/filtro vão por ambiente, NUNCA como argumento                */
/* ------------------------------------------------------------------ */

test("título e filtro vão por env, não como argumento (sem injection)", async () => {
  const spawnImpl = fakeSpawn({ stdout: PATH, code: 0 });
  const title = "-ominoso; rm -rf C:\\";
  const filter = "Imagens|*.png";
  await pickFile({ title, filter, spawnImpl });
  const { args, opts } = spawnImpl.calls[0];
  // o título não aparece em nenhum argumento de linha de comando
  assert.ok(!args.some((a) => String(a).includes(title)), "título não pode virar argumento");
  // mas está no ambiente, como texto literal
  assert.equal(opts.env.SELFEOPI_DIALOG_TITLE, title);
  assert.equal(opts.env.SELFEOPI_DIALOG_FILTER, filter);
});

/* ------------------------------------------------------------------ */
/* Erros tipados                                                       */
/* ------------------------------------------------------------------ */

test("pickFolder rejeita ExplorerError(failed) quando o processo sai != 0", async () => {
  const spawnImpl = fakeSpawn({ stdout: "", stderr: "erro no dialogo", code: 1 });
  await assert.rejects(
    () => pickFolder({ spawnImpl }),
    (err) => {
      assert.ok(err instanceof ExplorerError);
      assert.equal(err.code, "failed");
      assert.match(err.message, /diálogo falhou/);
      return true;
    },
  );
});

test("pickFile rejeita ExplorerError(no-powershell) quando powershell.exe não existe (ENOENT)", async () => {
  const enoent = Object.assign(new Error("spawn powershell.exe ENOENT"), { code: "ENOENT" });
  const spawnImpl = fakeSpawn({ error: enoent });
  await assert.rejects(
    () => pickFile({ spawnImpl }),
    (err) => {
      assert.ok(err instanceof ExplorerError);
      assert.equal(err.code, "no-powershell");
      return true;
    },
  );
});

test("pickFolder rejeita ExplorerError(timeout) quando o diálogo não fecha a tempo", async () => {
  const spawnImpl = fakeSpawn({ hang: true });
  await assert.rejects(
    () => pickFolder({ spawnImpl, timeoutMs: 20 }),
    (err) => {
      assert.ok(err instanceof ExplorerError);
      assert.equal(err.code, "timeout");
      assert.match(err.message, /excedeu/);
      return true;
    },
  );
});

test("ExplorerError tem name/code e herda de Error", () => {
  const e = new ExplorerError("failed", "x");
  assert.ok(e instanceof Error);
  assert.equal(e.name, "ExplorerError");
  assert.equal(e.code, "failed");
});