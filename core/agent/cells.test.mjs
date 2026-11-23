import test from "node:test";
import assert from "node:assert/strict";

import { createCellRuntime } from "./cells.mjs";

const ferramentas = {
  soma: async ({ a, b }) => ({ total: Number(a) + Number(b) }),
  eco: async ({ texto }) => ({ texto: String(texto).toUpperCase() }),
  lenta: async () => {
    await new Promise((r) => setTimeout(r, 300));
    return { ok: true };
  },
};

test("célula mantém contexto (state) entre chamadas", async () => {
  const rt = createCellRuntime({ tools: ferramentas });
  const r1 = await rt.run("state.comptador = (state.comptador || 0) + 1; return state.comptador;");
  assert.equal(r1.ok, true);
  assert.equal(r1.value, 1);
  const r2 = await rt.run("state.comptador = state.comptador + 1; return state.comptador;");
  assert.equal(r2.value, 2);
});

test("célula globaliza valor e lê na chamada seguinte", async () => {
  const rt = createCellRuntime({ tools: ferramentas });
  await rt.run("globalThis.salvo = 41;");
  const r = await rt.run("return globalThis.salvo + 1;");
  assert.equal(r.value, 42);
});

test("reentrada: célula chama ferramenta e usa resultado na próxima chamada", async () => {
  const rt = createCellRuntime({ tools: ferramentas });
  const r1 = await rt.run("state.soma = await tools.call('soma', { a: 2, b: 3 });");
  assert.equal(r1.ok, true);
  assert.equal(r1.calls, 1);
  const r2 = await rt.run("return state.soma.total + 10;");
  assert.equal(r2.value, 15);
});

test("célula encadeia duas ferramentas numa execução", async () => {
  const rt = createCellRuntime({ tools: ferramentas });
  const r = await rt.run(
    "const a = await tools.call('soma', { a: 2, b: 3 }); return await tools.call('eco', { texto: String(a.total) });",
  );
  assert.equal(r.ok, true);
  assert.equal(r.value.texto, "5");
  assert.equal(r.calls, 2);
});

test("allowlist restringe o que a célula pode chamar", async () => {
  const rt = createCellRuntime({ tools: ferramentas, allow: ["eco"] });
  const lista = await rt.run("return tools.list();");
  assert.deepEqual(lista.value, ["eco"]);

  const negada = await rt.run("return await tools.call('soma', { a: 1, b: 1 });");
  assert.equal(negada.ok, false);
  assert.match(negada.error, /não permitida/);

  const permitida = await rt.run("return await tools.call('eco', { texto: 'ok' });");
  assert.equal(permitida.ok, true);
});

test("ferramenta desconhecida é recusada", async () => {
  const rt = createCellRuntime({ tools: ferramentas });
  const r = await rt.run("return await tools.call('inexistente', {});");
  assert.equal(r.ok, false);
  assert.match(r.error, /não permitida/);
});

test("args precisa ser objeto", async () => {
  const rt = createCellRuntime({ tools: ferramentas });
  const r = await rt.run("return await tools.call('soma', [1, 2]);");
  assert.equal(r.ok, false);
  assert.match(r.error, /args deve ser um objeto/);
});

test("célula não enxerga process, require, fetch, nem temporizadores", async () => {
  const rt = createCellRuntime({ tools: ferramentas });
  const r = await rt.run(
    "return [typeof process, typeof require, typeof fetch, typeof setTimeout, typeof globalThis.process];",
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, ["undefined", "undefined", "undefined", "undefined", "undefined"]);
});

test("célula não usa eval nem Function (codeGeneration desligado)", async () => {
  const rt = createCellRuntime({ tools: ferramentas });
  for (const code of ["return eval('1+1');", "return Function('return 1')();"]) {
    const r = await rt.run(code);
    assert.equal(r.ok, false, `deveria bloquear: ${code}`);
  }
});

test("célula não faz import dinâmico", async () => {
  const rt = createCellRuntime({ tools: ferramentas });
  const r = await rt.run("return await import('node:fs');");
  assert.equal(r.ok, false);
});

test("limite de chamadas por execução", async () => {
  const rt = createCellRuntime({ tools: ferramentas, maxCalls: 2 });
  const r = await rt.run("for (let i = 0; i < 10; i++) await tools.call('soma', { a: 1, b: 1 }); return 1;");
  assert.equal(r.ok, false);
  assert.match(r.error, /limite de chamadas/);
});

test("timeout encerra execução lenta", async () => {
  const rt = createCellRuntime({ tools: ferramentas, timeoutMs: 100 });
  const r = await rt.run("await tools.call('lenta', {}); return 1;");
  assert.equal(r.ok, false);
  assert.match(r.error, /tempo esgotado/);
});

test("código acima do limite de tamanho é recusado", async () => {
  const rt = createCellRuntime({ tools: ferramentas, maxCodeChars: 50 });
  const r = await rt.run("x".repeat(100));
  assert.equal(r.ok, false);
  assert.match(r.error, /limite de tamanho/);
});

test("resultado grande é truncado", async () => {
  const rt = createCellRuntime({ tools: ferramentas, maxOutputChars: 100 });
  const r = await rt.run("return 'a'.repeat(5000);");
  assert.equal(r.ok, true);
  assert.equal(r.truncated, true);
  assert.equal(r.value.preview.length, 100);
});

test("reset descarta o contexto e limpa o estado", async () => {
  const rt = createCellRuntime({ tools: ferramentas });
  await rt.run("state.marcador = 'vivo'; globalThis.g = 7;");
  rt.reset();
  const r = await rt.run("return [typeof state.marcador, typeof globalThis.g];");
  assert.deepEqual(r.value, ["undefined", "undefined"]);
});

test("código vazio é recusado sem lançar", async () => {
  const rt = createCellRuntime({ tools: ferramentas });
  const r = await rt.run("   ");
  assert.equal(r.ok, false);
  assert.match(r.error, /código vazio/);
});

test("célula não consegue sobrescrever a api de ferramentas", async () => {
  const rt = createCellRuntime({ tools: ferramentas });
  // Tentativa de burlar a allowlist/estado sobrescrevendo `tools` ou `state`.
  const r = await rt.run("tools = null; state = 5; return typeof tools.call;");
  assert.equal(r.ok, true);
  assert.equal(r.value, "function", "tools deve continuar sendo a api congelada");
  const depois = await rt.run("return await tools.call('soma', { a: 4, b: 4 });");
  assert.equal(depois.value.total, 8);
});

test("poluir state.__proto__ não afeta o processo hospedeiro", async () => {
  const antes = ({}).polluted;
  const rt = createCellRuntime({ tools: ferramentas });
  const r = await rt.run("state.__proto__.polluted = 1; return 1;");
  assert.equal(r.ok, true);
  // O objeto {} da célula e o do host são de reignos diferentes.
  assert.equal(({}).polluted, antes, "Object.prototype do host não pode ser poluído");
});

test("poluir o protótipo do resultado de ferramenta não afeta o host", async () => {
  const antes = ({}).vazou;
  const rt = createCellRuntime({ tools: ferramentas });
  const r = await rt.run("const x = await tools.call('soma', {a:1,b:1}); x.__proto__.vazou = 1; return ({}).vazou;");
  assert.equal(r.ok, true);
  assert.equal(({}).vazou, antes, "resultado da ferramenta deve viver no reigno da célula");
  // Dentro da célula, ({}).vazou também não deve existir (reino isolado do host,
  // mas o resultado e o literal {} são do mesmo reigno -> aqui interessa o host).
});

test("construtor do reigno da célula não alcança o host (codeGeneration off)", async () => {
  const rt = createCellRuntime({ tools: ferramentas });
  const r = await rt.run("return state.constructor.constructor('return 1')();");
  assert.equal(r.ok, false, "Function do reigno da célula também é bloqueado");
});