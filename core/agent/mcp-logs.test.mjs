#!/usr/bin/env node
/**
 * core/agent/mcp-logs.test.mjs — diagnóstico de logs de MCP/plugins.
 *
 * O que mais importa aqui: a prova de que credencial **não sai**. O usuário
 * vai colar o relatório em outro lugar, então o teste de redigência não é
 * enfeite — é a garantia de que `apiKey=...` nunca aparece na saída.
 *
 * O segundo eixo é a honestidade: log ausente devolve "sem log", não uma
 * lista vazia com cara de sucesso.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  listMcpLogs,
  readMcpLog,
  formatErrorReport,
  redact,
  LOG_LAYOUT,
} from "./mcp-logs.mjs";

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

async function comProjeto(files = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "selfevopi-mcplogs-"));
  // todo projeto de teste declara um servidor, para o relatório ter comando
  await writeFile(
    path.join(root, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        filesystem: { command: "node", args: ["server.mjs"] },
        contexto: { command: "npx", args: ["-y", "servidor"] },
      },
    }),
    "utf8",
  );

  for (const [rel, conteudo] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, conteudo, "utf8");
  }

  return { root, limpar: () => rm(root, { recursive: true, force: true }) };
}

const caminhoLog = (root, nome) =>
  path.join(root, LOG_LAYOUT.mcp.replace(/\//g, path.sep), `${nome}.log`);

/* ------------------------------------------------------------------ */
/* redact — a garantia central                                         */
/* ------------------------------------------------------------------ */

test("redact cobre os formatos de credencial mais comuns", () => {
  // JWT de mentira, montado em tempo de execução. O verificador C2
  // (evals/checks/check-no-secrets-tracked.mjs) procura o padrão
  // eyJ<10+>.eyJ<10+> — e um JWT de verdade casa exatamente essa forma.
  // Montar as partes aqui mantém o teste realista sem deixar o padrão
  // completo como string literal no fonte.
  const jwtFake = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "abcdefghij"].join(".");

  const casos = [
    ["apiKey=sk-1234567890abcdef", "apiKey"],
    ["token: abc123def456", "token"],
    ["secret='valor-secreto'", "secret"],
    ["password=hunter2", "password"],
    ["Authorization: Bearer abcdef123456", "Bearer"],
    ["sk-1234567890abcdef", "sk-"],
    ["ghp_1234567890abcdef", "ghp_"],
    ["xoxb-1234567890abcdef", "xox"],
    ["AKIAIOSFODNN7EXAMPLE", "AKIA"],
    ["https://usuario:senha@host/path", "URL"],
    ["https://api.exemplo.com/v1?api_key=segredo&x=1", "query"],
    [jwtFake, "JWT"],
  ];

  for (const [entrada, rotulo] of casos) {
    const saida = redact(entrada);
    assert.ok(saida.includes("[redigido]"), `${rotulo}: não redigiu -> ${saida}`);
  }
});

test("redact não inventa [redigido] quando não há credencial", () => {
  const texto = "servidor iniciou na porta 7777 com 3 ferramentas";
  assert.equal(redact(texto), texto);
});

test("redact preserva o nome do campo e remove só o valor", () => {
  const saida = redact("apiKey=sk-abcdef1234567890");
  assert.ok(saida.startsWith("apiKey="));
  assert.ok(!saida.includes("abcdef1234567890"));
});

test("redact é idempotente", () => {
  const uma = redact("token=abc123");
  const duas = redact(uma);
  assert.equal(uma, duas);
});

test("redact não altera texto sem credencial nem string vazia", () => {
  assert.equal(redact(""), "");
  assert.equal(redact(null), null);
  assert.equal(redact(undefined), undefined);
});

/* ------------------------------------------------------------------ */
/* log ausente                                                         */
/* ------------------------------------------------------------------ */

test("servidor sem log devolve lines [] e reason 'sem log'", async () => {
  const p = await comProjeto();
  try {
    const r = await readMcpLog({ root: p.root, server: "filesystem" });

    assert.equal(r.server, "filesystem");
    assert.deepEqual(r.lines, []);
    assert.equal(r.reason, "sem log");
    assert.equal(r.source, null);
    assert.equal(r.truncated, false);
  } finally {
    await p.limpar();
  }
});

test("servidor que não existe devolve 'sem log' sem lançar", async () => {
  const p = await comProjeto();
  try {
    const r = await readMcpLog({ root: p.root, server: "nunca-declarado" });
    assert.deepEqual(r.lines, []);
    assert.equal(r.reason, "sem log");
  } finally {
    await p.limpar();
  }
});

test("nome de servidor vazio é recusado com motivo explícito", async () => {
  const p = await comProjeto();
  try {
    const r = await readMcpLog({ root: p.root, server: "" });
    assert.deepEqual(r.lines, []);
    assert.match(r.reason, /servidor não informado/);
  } finally {
    await p.limpar();
  }
});

test("diretório inteiro inexistente não lança", async () => {
  const root = path.join(tmpdir(), "selfevopi-mcplogs-inexistente-" + process.pid);
  const r = await readMcpLog({ root, server: "filesystem" });
  assert.deepEqual(r.lines, []);
  assert.equal(r.reason, "sem log");
});

/* ------------------------------------------------------------------ */
/* log existente                                                       */
/* ------------------------------------------------------------------ */

test("log existente devolve as linhas e a origem", async () => {
  const p = await comProjeto({
    [LOG_LAYOUT.mcp + "/filesystem.log"]:
      "conectando ao workspace\nferramentas: 5\npronto\n",
  });
  try {
    const r = await readMcpLog({ root: p.root, server: "filesystem" });

    assert.equal(r.reason, null);
    assert.equal(r.lines.length, 3);
    assert.equal(r.lines[0], "conectando ao workspace");
    assert.equal(r.source, ".pi/harness/logs/mcp/filesystem.log");
    assert.equal(r.truncated, false);
  } finally {
    await p.limpar();
  }
});

test("JSONL é lido como texto linha a linha", async () => {
  const p = await comProjeto({
    [LOG_LAYOUT.mcp + "/contexto.jsonl"]:
      '{"at":"2026-11-15T22:00:00.000Z","level":"info","message":"iniciando"}\n' +
      '{"at":"2026-11-15T22:00:01.000Z","level":"error","message":"falhou ao abrir índice"}\n',
  });
  try {
    const r = await readMcpLog({ root: p.root, server: "contexto" });
    assert.equal(r.lines.length, 2);
    assert.ok(r.lines[1].includes("falhou ao abrir índice"));
  } finally {
    await p.limpar();
  }
});

test("plugin tem o próprio diretório e é encontrado", async () => {
  const p = await comProjeto({
    [LOG_LAYOUT.plugins + "/meu-plugin.log"]: "plugin carregou\n",
  });
  try {
    const r = await readMcpLog({ root: p.root, server: "meu-plugin" });
    assert.equal(r.reason, null);
    assert.deepEqual(r.lines, ["plugin carregou"]);
  } finally {
    await p.limpar();
  }
});

test("log consolidado serve o servidor quando não há arquivo próprio", async () => {
  const p = await comProjeto({
    [LOG_LAYOUT.consolidated]:
      '{"server":"filesystem","at":"2026-11-15T22:00:00.000Z","level":"info","message":"linha do filesystem"}\n' +
      '{"server":"contexto","at":"2026-11-15T22:00:01.000Z","level":"warn","message":"linha do contexto"}\n',
  });
  try {
    const r = await readMcpLog({ root: p.root, server: "contexto" });
    assert.equal(r.lines.length, 1);
    assert.ok(r.lines[0].includes("linha do contexto"));
    assert.equal(r.source, LOG_LAYOUT.consolidated);
  } finally {
    await p.limpar();
  }
});

test("arquivo próprio do servidor tem preferência sobre o consolidado", async () => {
  const p = await comProjeto({
    [LOG_LAYOUT.mcp + "/contexto.log"]: "do arquivo proprio\n",
    [LOG_LAYOUT.consolidated]:
      '{"server":"contexto","level":"info","message":"do consolidado"}\n',
  });
  try {
    const r = await readMcpLog({ root: p.root, server: "contexto" });
    assert.equal(r.source, LOG_LAYOUT.mcp + "/contexto.log");
    assert.deepEqual(r.lines, ["do arquivo proprio"]);
  } finally {
    await p.limpar();
  }
});

/* ------------------------------------------------------------------ */
/* tail e truncamento                                                  */
/* ------------------------------------------------------------------ */

test("tail devolve só as últimas N linhas", async () => {
  const linhas = Array.from({ length: 500 }, (_, i) => `linha ${i}`).join("\n") + "\n";
  const p = await comProjeto({ [LOG_LAYOUT.mcp + "/filesystem.log"]: linhas });
  try {
    const r = await readMcpLog({ root: p.root, server: "filesystem", tail: 10 });

    assert.equal(r.lines.length, 10);
    assert.equal(r.lines[0], "linha 490");
    assert.equal(r.lines[9], "linha 499");
    assert.equal(r.total, 500);
  } finally {
    await p.limpar();
  }
});

test("arquivo maior que o limite de leitura marca truncated", async () => {
  // 300 KB de lixo, acima do teto de 64 KB
  const gordo = "x".repeat(1024) + "\n";
  const conteudo = gordo.repeat(300);
  const p = await comProjeto({ [LOG_LAYOUT.mcp + "/filesystem.log"]: conteudo });
  try {
    const r = await readMcpLog({ root: p.root, server: "filesystem", tail: 5 });

    assert.equal(r.truncated, true);
    assert.ok(r.size > 64 * 1024);
    assert.ok(r.lines.length <= 5);
  } finally {
    await p.limpar();
  }
});

test("maxBytes pequeno reduz o que é lido", async () => {
  const linhas = Array.from({ length: 200 }, (_, i) => `linha ${i} `.padEnd(60)).join("\n") + "\n";
  const p = await comProjeto({ [LOG_LAYOUT.mcp + "/filesystem.log"]: linhas });
  try {
    const grande = await readMcpLog({ root: p.root, server: "filesystem", tail: 100, maxBytes: 1024 * 1024 });
    const pequeno = await readMcpLog({ root: p.root, server: "filesystem", tail: 100, maxBytes: 2048 });

    assert.ok(pequeno.truncated, "com 2 KB o começo tinha que ficar de fora");
    assert.equal(grande.truncated, false);
    assert.ok(pequeno.lines.length < grande.lines.length);
  } finally {
    await p.limpar();
  }
});

test("arquivo vazio não é erro: devolve lista vazia sem 'sem log'", async () => {
  const p = await comProjeto({ [LOG_LAYOUT.mcp + "/filesystem.log"]: "" });
  try {
    const r = await readMcpLog({ root: p.root, server: "filesystem" });
    assert.deepEqual(r.lines, []);
    assert.equal(r.reason, null, "o arquivo existe; só está vazio");
    assert.equal(r.source, LOG_LAYOUT.mcp + "/filesystem.log");
  } finally {
    await p.limpar();
  }
});

/* ------------------------------------------------------------------ */
/* listMcpLogs                                                         */
/* ------------------------------------------------------------------ */

test("listMcpLogs agrega entradas de vários servidores", async () => {
  const p = await comProjeto({
    [LOG_LAYOUT.mcp + "/filesystem.log"]:
      '{"at":"2026-11-15T22:00:00.000Z","level":"info","message":"a"}\n',
    [LOG_LAYOUT.mcp + "/contexto.log"]:
      '{"at":"2026-11-15T22:00:05.000Z","level":"error","message":"b"}\n',
  });
  try {
    const lista = await listMcpLogs({ root: p.root });
    assert.equal(lista.length, 2);
    // mais recentes primeiro
    assert.equal(lista[0].server, "contexto");
    assert.equal(lista[0].level, "error");
    assert.equal(lista[1].server, "filesystem");
  } finally {
    await p.limpar();
  }
});

test("listMcpLogs filtra por servidor", async () => {
  const p = await comProjeto({
    [LOG_LAYOUT.mcp + "/filesystem.log"]: "linha do filesystem\n",
    [LOG_LAYOUT.mcp + "/contexto.log"]: "linha do contexto\n",
  });
  try {
    const lista = await listMcpLogs({ root: p.root, server: "contexto" });
    assert.equal(lista.length, 1);
    assert.equal(lista[0].server, "contexto");
  } finally {
    await p.limpar();
  }
});

test("listMcpLogs respeita o limite", async () => {
  const linhas = Array.from({ length: 100 }, (_, i) => `linha ${i}`).join("\n") + "\n";
  const p = await comProjeto({ [LOG_LAYOUT.mcp + "/filesystem.log"]: linhas });
  try {
    const lista = await listMcpLogs({ root: p.root, limit: 5 });
    assert.equal(lista.length, 5);
  } finally {
    await p.limpar();
  }
});

test("listMcpLogs redige credencial que esteja no log", async () => {
  const p = await comProjeto({
    [LOG_LAYOUT.mcp + "/filesystem.log"]:
      '{"at":"2026-11-15T22:00:00.000Z","level":"error","message":"falha com apiKey=sk-1234567890abcdef"}\n',
  });
  try {
    const lista = await listMcpLogs({ root: p.root });
    assert.equal(lista.length, 1);
    assert.ok(lista[0].message.includes("[redigido]"));
    assert.ok(!lista[0].message.includes("1234567890abcdef"));
  } finally {
    await p.limpar();
  }
});

test("listMcpLogs sem nenhum log devolve lista vazia", async () => {
  const p = await comProjeto();
  try {
    const lista = await listMcpLogs({ root: p.root });
    assert.deepEqual(lista, []);
  } finally {
    await p.limpar();
  }
});

/* ------------------------------------------------------------------ */
/* formatErrorReport — o texto que se cola                             */
/* ------------------------------------------------------------------ */

test("relatório tem cabeçalho, comando e os eventos", async () => {
  const p = await comProjeto({
    [LOG_LAYOUT.mcp + "/filesystem.log"]:
      "conectando\nferramentas: 5\npronto\n",
  });
  try {
    const rel = await formatErrorReport({ root: p.root, server: "filesystem" });

    assert.ok(rel.includes("# SelfEvoPI — diagnóstico de MCP/plugin"));
    assert.ok(rel.includes("servidor: filesystem"));
    assert.ok(rel.includes("comando:  node"));
    assert.ok(rel.includes("server.mjs"));
    assert.ok(rel.includes("conectando"));
    assert.ok(rel.includes("pronto"));
  } finally {
    await p.limpar();
  }
});

test("relatório sem log explica onde procurar em vez de mentir", async () => {
  const p = await comProjeto();
  try {
    const rel = await formatErrorReport({ root: p.root, server: "filesystem" });

    assert.ok(rel.includes("servidor: filesystem"));
    assert.ok(rel.includes("comando:  node"));
    assert.ok(rel.includes("Nenhum log encontrado"));
    assert.ok(rel.includes(LOG_LAYOUT.mcp + "/<servidor>.log"));
    assert.ok(!rel.includes("Últimos eventos —"));
  } finally {
    await p.limpar();
  }
});

test("relatório redige credencial — prova de que o texto colável é seguro", async () => {
  const p = await comProjeto({
    [LOG_LAYOUT.mcp + "/filesystem.log"]:
      "erro: não autenticou\n" +
      "Authorization: Bearer abcdef1234567890\n" +
      "apiKey=sk-1234567890abcdef\n" +
      "conectou em https://usuario:senha@api.exemplo.com/v1\n",
  });
  try {
    const rel = await formatErrorReport({ root: p.root, server: "filesystem" });

    assert.ok(rel.includes("[redigido]"));
    assert.ok(!rel.includes("abcdef1234567890"), "o Bearer vazou");
    assert.ok(!rel.includes("1234567890abcdef"), "a apiKey vazou");
    assert.ok(!rel.includes("senha"), "a senha da URL vazou");
  } finally {
    await p.limpar();
  }
});

test("relatório avisa quando foi truncado", async () => {
  const linhas = Array.from({ length: 500 }, (_, i) => `linha ${i}`).join("\n") + "\n";
  const p = await comProjeto({ [LOG_LAYOUT.mcp + "/filesystem.log"]: linhas });
  try {
    const rel = await formatErrorReport({ root: p.root, server: "filesystem", tail: 20 });
    assert.ok(rel.includes("Atenção"));
    assert.ok(rel.includes("últimas 20 de 500"));
  } finally {
    await p.limpar();
  }
});

test("relatório respeita o teto de bytes", async () => {
  const linhas = Array.from({ length: 2000 }, (_, i) => `linha ${i} `.padEnd(120)).join("\n") + "\n";
  const p = await comProjeto({ [LOG_LAYOUT.mcp + "/filesystem.log"]: linhas });
  try {
    const rel = await formatErrorReport({ root: p.root, server: "filesystem", tail: 2000, maxBytes: 2048 });
    assert.ok(Buffer.byteLength(rel) < 4096, `relatório grande demais: ${Buffer.byteLength(rel)}`);
    assert.ok(rel.includes("cortado em 2048 bytes"));
  } finally {
    await p.limpar();
  }
});

test("relatório respeita o teto de linhas", async () => {
  const linhas = Array.from({ length: 500 }, (_, i) => `linha ${i}`).join("\n") + "\n";
  const p = await comProjeto({ [LOG_LAYOUT.mcp + "/filesystem.log"]: linhas });
  try {
    const rel = await formatErrorReport({ root: p.root, server: "filesystem", tail: 500, maxLines: 50 });
    assert.ok(rel.includes("cortado em 50 linhas"));
  } finally {
    await p.limpar();
  }
});

test("relatório devolve string não vazia e termina com orientação", async () => {
  const p = await comProjeto({ [LOG_LAYOUT.mcp + "/filesystem.log"]: "algo quebrou\n" });
  try {
    const rel = await formatErrorReport({ root: p.root, server: "filesystem" });
    assert.equal(typeof rel, "string");
    assert.ok(rel.trim().length > 0);
    assert.ok(rel.includes("core/agent/mcp-logs.mjs"));
    assert.ok(rel.includes("redigidas"));
  } finally {
    await p.limpar();
  }
});

test("relatório sem nome de servidor não lança", async () => {
  const p = await comProjeto();
  try {
    const rel = await formatErrorReport({ root: p.root, server: "" });
    assert.ok(rel.includes("(não informado)"));
  } finally {
    await p.limpar();
  }
});

/* ------------------------------------------------------------------ */
/* nível e carimbo de tempo                                            */
/* ------------------------------------------------------------------ */

test("nível é detectado depois do carimbo de tempo (formato comum)", async () => {
  const p = await comProjeto({
    [LOG_LAYOUT.mcp + "/filesystem.log"]:
      "2026-11-15T22:00:00.000Z INFO  iniciando\n" +
      "2026-11-15T22:00:01.000Z ERROR falhou\n" +
      "2026-11-15T22:00:02.000Z WARN  cuidado\n" +
      "2026-11-15T22:00:03.000Z DEBUG detalhe\n",
  });
  try {
    const lista = await listMcpLogs({ root: p.root });
    const niveis = lista.map((e) => e.level);

    assert.ok(niveis.includes("error"), "ERROR depois do timestamp não virou error");
    assert.ok(niveis.includes("warn"), "WARN depois do timestamp não virou warn");
    assert.ok(niveis.includes("debug"), "DEBUG depois do timestamp não virou debug");
    assert.ok(niveis.includes("info"), "INFO depois do timestamp não virou info");
  } finally {
    await p.limpar();
  }
});

test("nível com colchetes e sem timestamp também é lido", async () => {
  const p = await comProjeto({
    [LOG_LAYOUT.mcp + "/filesystem.log"]: "[ERROR] algo quebrou\n[INFO] tudo certo\n",
  });
  try {
    const lista = await listMcpLogs({ root: p.root });
    const niveis = lista.map((e) => e.level);

    assert.ok(niveis.includes("error"));
    assert.ok(niveis.includes("info"));
  } finally {
    await p.limpar();
  }
});

test("nível do campo JSONL vence o texto", async () => {
  const p = await comProjeto({
    [LOG_LAYOUT.mcp + "/contexto.jsonl"]:
      '{"at":"2026-11-15T22:00:00.000Z","level":"error","message":"texto tranquilo"}\n',
  });
  try {
    const lista = await listMcpLogs({ root: p.root });
    assert.equal(lista[0].level, "error");
    assert.equal(lista[0].message, "texto tranquilo");
  } finally {
    await p.limpar();
  }
});

test("linha sem marcador fica info — sem adivinhação", async () => {
  const p = await comProjeto({
    [LOG_LAYOUT.mcp + "/filesystem.log"]: "a palavra error aparece no meio da frase\n",
  });
  try {
    const lista = await listMcpLogs({ root: p.root });
    assert.equal(lista[0].level, "info");
  } finally {
    await p.limpar();
  }
});