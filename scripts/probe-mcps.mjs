#!/usr/bin/env node
/**
 * scripts/probe-mcps.mjs — sonda de verdade nos MCPs do SelfEvoPI.
 *
 * O `core/agent/mcp-opencode.mjs` sabe **listar** e sabe **sondar**. Faltava
 * alguém que rodasse isso contra a config real do usuário e dissesse, servidor
 * por servidor, o que respondeu e o que não respondeu — com o motivo.
 *
 * Uso:
 *   node scripts/probe-mcps.mjs                    tabela + código de saída
 *   node scripts/probe-mcps.mjs --json             saída de máquina
 *   node scripts/probe-mcps.mjs --only serena      sonda só um
 *   node scripts/probe-mcps.mjs --timeout 12000    teto por servidor
 *   node scripts/probe-mcps.mjs --concurrency 4    quantos ao mesmo tempo
 *
 * Três decisões:
 *
 *  1. **Remoto não é falha.** `hotmart` e `n8n-instance` são servidores remotos:
 *     não existe processo local para sondar. Aparecem como `remoto`, não como
 *     erro, e não derrubam o código de saída.
 *  2. **O motivo vai junto.** "falhou" sem motivo não deixa o usuário fazer
 *     nada. Cada linha diz `timeout`, `sem comando`, `processo não abriu`,
 *     `sem credencial` ou a mensagem que o servidor deu.
 *  3. **Ambiente nunca é impresso.** Só o **nome** das variáveis declaradas.
 *     Um MCP pode pedir chave; o que se registra é "sem credencial", não o valor.
 *
 * Código de saída: 0 se nenhum servidor local falhou, 1 se algum falhou.
 */

import { findOpencodeConfig, listOpencodeMcp, probeOpencodeMcp } from "../core/agent/mcp-probe.mjs";

/* ------------------------------------------------------------------ */
/* Argumentos                                                          */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const opts = {
    json: false,
    timeoutMs: 8_000,
    concurrency: 4,
    only: [],
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];

    if (a === "--json") opts.json = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--timeout") opts.timeoutMs = Number(argv[++i]);
    else if (a === "--concurrency") opts.concurrency = Number(argv[++i]);
    else if (a === "--only") opts.only.push(argv[++i]);
    else if (a.startsWith("--timeout=")) opts.timeoutMs = Number(a.split("=")[1]);
    else if (a.startsWith("--concurrency=")) opts.concurrency = Number(a.split("=")[1]);
    else if (a.startsWith("--only=")) opts.only.push(a.split("=")[1]);
  }

  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs < 100) opts.timeoutMs = 8_000;
  if (!Number.isFinite(opts.concurrency) || opts.concurrency < 1) opts.concurrency = 4;

  return opts;
}

const AJUDA = `
  node scripts/probe-mcps.mjs [opcoes]

  --json              saida de maquina (um objeto por linha? nao: um JSON so)
  --only <nome>       sonda apenas este servidor (repetivel)
  --timeout <ms>      teto por servidor (padrao 8000)
  --concurrency <n>   quantos servidores em paralelo (padrao 4)
  --help              esta tela
`;

/* ------------------------------------------------------------------ */
/* Classificação                                                       */
/* ------------------------------------------------------------------ */

/** Devolve { status, motivo } a partir do que o probe contou. */
function classificar(server, resultado) {
  if (server.status === "disabled") return { status: "erro", motivo: "desabilitado na configuração" };
  // remoto vem antes: servidor remoto não tem comando local, e isso é esperado
  if (server.type === "remote") return { status: "remoto", motivo: "servidor remoto: sem processo local" };
  if (server.status === "broken" || !server.command) {
    return { status: "erro", motivo: "comando não encontrado nesta máquina" };
  }

  const erro = resultado?.error ?? null;
  if (resultado?.ok) {
    if (erro) return { status: "parcial", motivo: erro };
    return { status: "ok", motivo: null };
  }

  if (!erro) return { status: "erro", motivo: "o probe não deu motivo" };
  if (/não respondeu/i.test(erro)) return { status: "timeout", motivo: erro };
  if (/não consegui iniciar/i.test(erro)) {
    const cmd = server.command ? server.command.split(/[\\/]/).pop() : "?";
    const dica = /\.cmd$/i.test(server.command ?? "") ? ` (${cmd} é .cmd: spawn sem shell recusa no Windows)` : "";
    return { status: "erro", motivo: `${erro}${dica}` };
  }
  if (/initialize respondeu sem result/i.test(erro)) return { status: "erro", motivo: erro };
  if (/tools\/list não respondeu/i.test(erro)) return { status: "erro", motivo: erro };

  // erro que o próprio servidor emitiu (401, auth, chave ausente…)
  if (/auth|token|key|credential|401|403|unauthorized/i.test(erro)) {
    return { status: "erro", motivo: `sem credencial — ${erro}` };
  }
  return { status: "erro", motivo: erro };
}

/** Nomes das variáveis declaradas, sem valor. */
function nomesDeAmbiente(server) {
  return Object.keys(server.environment ?? {}).sort();
}

/* ------------------------------------------------------------------ */
/* Sonda                                                               */
/* ------------------------------------------------------------------ */

/** Roda `fn` com no máximo `n` em paralelo, preservando a ordem de entrada. */
async function emLotes(lista, n, fn) {
  const out = new Array(lista.length);
  let cursor = 0;

  async function trabalhador() {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= lista.length) return;
      out[i] = await fn(lista[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(n, lista.length) }, trabalhador));
  return out;
}

async function sondarUm(server, opts) {
  const inicio = Date.now();
  const resultado = await probeOpencodeMcp({
    name: server.name,
    timeoutMs: opts.timeoutMs,
  });
  const ms = Date.now() - inicio;
  const { status, motivo } = classificar(server, resultado);

  return {
    nome: server.name,
    tipo: server.type,
    status,
    tools: Array.isArray(resultado?.tools) ? resultado.tools.length : 0,
    nomesTools: Array.isArray(resultado?.tools) ? resultado.tools : [],
    ms,
    motivo,
    erro: resultado?.error ?? null,
    env: nomesDeAmbiente(server),
  };
}

/* ------------------------------------------------------------------ */
/* Saída                                                               */
/* ------------------------------------------------------------------ */

function tabela(linhas) {
  const cab = ["nome", "tipo", "status", "tools", "ms", "motivo"];
  const larg = Object.fromEntries(cab.map((c) => [c, c.length]));

  const corpo = linhas.map((l) => ({
    nome: l.nome,
    tipo: l.tipo,
    status: l.status,
    tools: l.tools > 0 ? String(l.tools) : "-",
    ms: String(l.ms),
    motivo: l.motivo ?? "",
  }));

  for (const row of corpo) {
    for (const c of cab) larg[c] = Math.max(larg[c], String(row[c]).length);
  }

  const fmt = (row) =>
    cab.map((c) => (c === "motivo" ? String(row[c]) : String(row[c]).padEnd(larg[c]))).join("  ");

  const linhasTxt = [fmt(Object.fromEntries(cab.map((c) => [c, c]))), ...corpo.map(fmt)];
  return linhasTxt.join("\n");
}

/* ------------------------------------------------------------------ */
/* Programa                                                            */
/* ------------------------------------------------------------------ */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(AJUDA);
    return 0;
  }

  const config = await findOpencodeConfig({});
  if (!config) {
    process.stdout.write("não achei a configuração do SelfEvoPI (~/.pi/settings.json)\n");
    return 1;
  }

  let servidores;
  try {
    servidores = await listOpencodeMcp({});
  } catch (err) {
    process.stdout.write(`não consegui ler ${config}: ${err?.message ?? err}\n`);
    return 1;
  }

  if (opts.only.length > 0) {
    const pedidos = new Set(opts.only.map((n) => n.toLowerCase()));
    servidores = servidores.filter((s) => pedidos.has(s.name.toLowerCase()));
  }

  if (servidores.length === 0) {
    process.stdout.write("nenhum servidor para sondar\n");
    return 1;
  }

  if (!opts.json) {
    process.stdout.write(`config: ${config}\n`);
    process.stdout.write(`servidores: ${servidores.length} · timeout: ${opts.timeoutMs} ms · paralelo: ${opts.concurrency}\n\n`);
  }

  const linhas = await emLotes(servidores, opts.concurrency, (s) => sondarUm(s, opts));

  const ok = linhas.filter((l) => l.status === "ok");
  const remotos = linhas.filter((l) => l.status === "remoto");
  const falhas = linhas.filter((l) => l.status === "timeout" || l.status === "erro");
  const parciais = linhas.filter((l) => l.status === "parcial");

  if (opts.json) {
    const payload = {
      config,
      testadoEm: new Date().toISOString(),
      resumo: {
        total: linhas.length,
        ok: ok.length,
        parciais: parciais.length,
        remotos: remotos.length,
        falhas: falhas.length,
      },
      servidores: linhas.map((l) => ({
        nome: l.nome,
        tipo: l.tipo,
        status: l.status,
        tools: l.tools,
        ferramentas: l.nomesTools,
        ms: l.ms,
        motivo: l.motivo,
        erro: l.erro,
        envSomenteNomes: l.env,
      })),
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  } else {
    process.stdout.write(tabela(linhas) + "\n\n");

    // nomes de variáveis declaradas, sem valor
    const comEnv = linhas.filter((l) => l.env.length > 0);
    if (comEnv.length > 0) {
      process.stdout.write("variaveis declaradas (somente nomes — nenhum valor e impresso):\n");
      for (const l of comEnv) process.stdout.write(`  ${l.nome.padEnd(24)} ${l.env.join(", ")}\n`);
      process.stdout.write("\n");
    }

    process.stdout.write(
      `resumo: ${ok.length} ok · ${parciais.length} parciais · ${remotos.length} remotos · ${falhas.length} com falha (de ${linhas.length})\n`
    );

    if (falhas.length > 0) {
      process.stdout.write("\nfalhas, uma a uma:\n");
      for (const l of falhas) {
        process.stdout.write(`  ${l.nome} [${l.status}] ${l.motivo ?? ""}\n`);
      }
    }
  }

  // remoto não é falha: não derruba o código de saída
  return falhas.length > 0 ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stdout.write(`erro na sondagem: ${err?.stack ?? err}\n`);
    process.exitCode = 1;
  });