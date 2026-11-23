/**
 * core/agent/integration-real.test.mjs — testes de integração condicionais.
 *
 * Estes testes exercitam o cliente de linguagem (LSP) e o cliente de depuração
 * (DAP) contra processos REAIS, apontados por variáveis de ambiente. Não há
 * caminho de máquina, nome de provedor nem executável escrito no código: o
 * binário vem do ambiente ou o teste é pulado. Sem a variável, a suíte fica
 * verde (tudo `skip`) — é o contrato pedido.
 *
 * Variáveis (nomes genéricos, valor = caminho de um executável):
 *   SELFEOPI_TEST_LSP_SERVER   Servidor LSP real (ex.: um .mjs/.js rodado por node)
 *   SELFEOPI_TEST_DAP_ADAPTER  Adaptador de depuração real (ex.: lldb-dap, debugpy)
 *
 * Cobertura: handshake, capacidades e fechamento — para ambos os clientes. O
 * que NÃO é coberto (e fica dito): depuração de processo real pelo DAP, e
 * interoperabilidade com todo servidor LSP existente.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { LspClient } from "./lsp.mjs";
import { DapClient } from "./dap.mjs";

const LSP = process.env.SELFEOPI_TEST_LSP_SERVER;
const DAP = process.env.SELFEOPI_TEST_DAP_ADAPTER;

/* ------------------------------------------------------------------ */
/* Cliente de linguagem (LSP) — handshake, capacidades, fechamento     */
/* ------------------------------------------------------------------ */

test(
  "LSP real: handshake devolve capabilities e o cliente abre",
  { skip: !LSP },
  async (t) => {
    const cliente = new LspClient({
      command: process.execPath,
      args: [LSP],
      timeoutMs: 8000,
    });
    t.after(async () => {
      await cliente.close().catch(() => {});
    });

    const caps = await cliente.start();
    assert.ok(caps && typeof caps === "object", "servidor real deve devolver capabilities");
    assert.ok(Object.keys(caps).length > 0, "capabilities não pode ser objeto vazio");
    assert.equal(cliente.running, true, "cliente deve estar rodando após start");
  },
);

test(
  "LSP real: fechamento encerra o processo (running=false)",
  { skip: !LSP },
  async () => {
    const cliente = new LspClient({
      command: process.execPath,
      args: [LSP],
      timeoutMs: 8000,
    });
    await cliente.start();
    assert.equal(cliente.running, true);
    await cliente.close();
    assert.equal(cliente.running, false, "após close o processo não pode continuar vivo");
  },
);

test(
  "LSP real: start() é idempotente (segunda chamada não sobe outro processo)",
  { skip: !LSP },
  async (t) => {
    const cliente = new LspClient({
      command: process.execPath,
      args: [LSP],
      timeoutMs: 8000,
    });
    t.after(async () => {
      await cliente.close().catch(() => {});
    });
    const caps1 = await cliente.start();
    const caps2 = await cliente.start();
    assert.deepEqual(caps2, caps1, "start() repetido deve devolver as mesmas capabilities");
    assert.equal(cliente.running, true);
  },
);

/* ------------------------------------------------------------------ */
/* Cliente de depuração (DAP) — handshake, capacidades, fechamento     */
/* ------------------------------------------------------------------ */

test(
  "DAP real: handshake devolve capabilities e o cliente abre",
  { skip: !DAP },
  async (t) => {
    const cliente = new DapClient({
      command: process.execPath,
      args: [DAP],
      timeoutMs: 8000,
    });
    t.after(async () => {
      await cliente.close().catch(() => {});
    });

    const caps = await cliente.start();
    assert.ok(caps && typeof caps === "object", "adaptador real deve devolver capabilities");
    assert.ok(Object.keys(caps).length > 0, "capabilities não pode ser objeto vazio");
    assert.equal(cliente.running, true, "cliente deve estar rodando após start");
  },
);

test(
  "DAP real: fechamento encerra o processo (running=false)",
  { skip: !DAP },
  async () => {
    const cliente = new DapClient({
      command: process.execPath,
      args: [DAP],
      timeoutMs: 8000,
    });
    await cliente.start();
    assert.equal(cliente.running, true);
    await cliente.close();
    assert.equal(cliente.running, false, "após close o processo não pode continuar vivo");
  },
);

/* ------------------------------------------------------------------ */
/* Sem variável: nada roda, suíte verde                                */
/* ------------------------------------------------------------------ */

test("sem variáveis de ambiente, os testes reais ficam pulados (não-vermelho)", () => {
  // Afirmação de contrato: a ausência de binário não pode derrubar a suíte.
  // Aqui só documentamos o comportamento — os `skip` acima é que importam.
  assert.ok(true);
});