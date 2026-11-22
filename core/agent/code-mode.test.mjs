import test from "node:test";
import assert from "node:assert/strict";

import { runCode } from "./code-mode.mjs";

const ferramentas = {
  soma: async ({ a, b }) => ({ total: Number(a) + Number(b) }),
  eco: async ({ texto }) => ({ texto: String(texto).toUpperCase() }),
  lenta: async () => { await new Promise((r) => setTimeout(r, 400)); return { ok: true }; },
};

test("runCode encadeia chamadas e devolve valor", async () => {
  const r = await runCode("const a = await tools.call('soma', {a:2,b:3}); return await tools.call('eco', {texto:String(a.total)});", { tools: ferramentas });
  assert.equal(r.ok, true);
  assert.equal(r.value.texto, "5");
  assert.equal(r.calls, 2);
});

test("runCode expõe tools.list e tools.has", async () => {
  const r = await runCode("return { lista: tools.list().sort(), tem: tools.has('soma') };", { tools: ferramentas });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.lista, ["eco", "lenta", "soma"]);
  assert.equal(r.value.tem, true);
});

test("runCode recusa ferramenta desconhecida e args inválidos", async () => {
  let r = await runCode("return await tools.call('inexistente', {});", { tools: ferramentas });
  assert.equal(r.ok, false);
  assert.match(r.error, /ferramenta desconhecida/);
  r = await runCode("return await tools.call('soma', [1,2]);", { tools: ferramentas });
  assert.equal(r.ok, false);
  assert.match(r.error, /args deve ser um objeto/);
});

test("runCode não dá acesso a process, require, fetch ou eval", async () => {
  for (const nome of ["process", "require", "fetch"]) {
    const r = await runCode(`return typeof ${nome};`, { tools: ferramentas });
    assert.equal(r.ok, true);
    assert.equal(r.value, "undefined", `${nome} não deveria existir no contexto`);
  }
  const viaGlobal = await runCode("return [typeof globalThis.process, typeof globalThis.require, typeof globalThis.fetch];", { tools: ferramentas });
  assert.deepEqual(viaGlobal.value, ["undefined", "undefined", "undefined"]);
  for (const expressao of ["return Function('return 1')();", "return eval('1+1');"]) {
    const r = await runCode(expressao, { tools: ferramentas });
    assert.equal(r.ok, false, `deveria bloquear: ${expressao}`);
  }
});

test("runCode respeita limite de chamadas e timeout", async () => {
  let r = await runCode("for (let i=0;i<10;i++) await tools.call('soma',{a:1,b:1}); return 1;", { tools: ferramentas, maxCalls: 3 });
  assert.equal(r.ok, false);
  assert.match(r.error, /limite de chamadas/);
  r = await runCode("await tools.call('lenta',{}); return 1;", { tools: ferramentas, timeoutMs: 100 });
  assert.equal(r.ok, false);
  assert.match(r.error, /tempo esgotado/);
});

test("runCode limita tamanho do código e trunca resultado grande", async () => {
  let r = await runCode("x".repeat(21_000), { tools: ferramentas });
  assert.equal(r.ok, false);
  assert.match(r.error, /limite de tamanho/);
  r = await runCode("return 'a'.repeat(5000);", { tools: ferramentas, maxResultChars: 100 });
  assert.equal(r.ok, true);
  assert.equal(r.truncated, true);
  assert.equal(r.value.preview.length, 100);
});

test("runCode registra logs sem expor o ambiente", async () => {
  const linhas = [];
  const r = await runCode("tools.log('oi', 42); return 1;", { tools: ferramentas, log: (s) => linhas.push(s) });
  assert.equal(r.ok, true);
  assert.deepEqual(linhas, ["oi 42"]);
});
