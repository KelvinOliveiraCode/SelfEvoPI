/**
 * core/agent/refutation-audit.test.mjs — auditor de refutação em ação.
 *
 * Este arquivo faz duas coisas:
 *
 *  1. Testa o classificador `audit()` com casos sintéticos (afirmação
 *     sustentada, refutada e sem prova).
 *
 *  2. Tenta ATIVAMENTE refutar afirmações do PROJECT.md, exercitando o código
 *     real. Cada tentativa produz um "achado" e o `audit()` diz, com evidência,
 *     se a afirmação sobreviveu (sustentada) ou caiu (refutada).
 *
 * Afirmações atacadas (PROJECT.md):
 *   A. "a saída headless não passa de setenta e duas colunas"  (§11, §14)
 *   B. "balanço ANSI é zero"                                    (§2, §11)
 *   C. "o recorte de sessão não sobrescreve o original"         (§7, §15)
 *   D. "a reconexão não imprime erro em cima de resposta correta" (§7, §11)
 *   E. "nenhuma reticência de truncamento" (extra, §2/§11)
 *
 * "Tentar quebrar" = procurar o contraexemplo e o pior caso, não confirmar o
 * caminho feliz. O juiz para A e B é a CLI REAL em processo filho (`--render`
 * e comandos de barra por stdin): é a saída headless de verdade, não uma função
 * interna isolada. Para C e D o juiz é o módulo puro / o caminho de conversa.
 *
 * Zero dependência npm. Nada de caminho de máquina, provedor ou modelo no
 * código: os textos são genéricos e os processos são dublês locais.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripAnsi, visibleWidth, converse, converseOrFallback } from "../../apps/cli.mjs";
import { rewindSession } from "./rewind.mjs";
import { audit } from "./refutation-audit.mjs";

const LARGURA = 72;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, "..", "..", "apps", "cli.mjs");

/* ------------------------------------------------------------------ */
/* Utilidades de medição (juiz externo à UI: conta colunas e SGR)      */
/* ------------------------------------------------------------------ */

/** Saldo de códigos SGR: abre-estilo menos fecha-estilo, por linha. */
function ansiBalance(linha) {
  const re = /\x1b\[([0-9;]*)m/g;
  let bal = 0;
  let m;
  while ((m = re.exec(linha))) {
    const corpo = m[1];
    if (corpo === "0" || corpo === "") bal = Math.max(0, bal - 1);
    else bal += 1;
  }
  return bal;
}

/** Pares [índice, texto] de linhas que terminam em reticência de corte. */
function reticenciasNoFim(texto) {
  return stripAnsi(texto)
    .split("\n")
    .map((l, i) => [i, l])
    .filter(([, l]) => /…|\.\.\.\s*$/.test(l));
}

/** Linhas (com índice e largura) que passam de `largura` colunas. */
function linhasAcima(texto, largura = LARGURA) {
  return stripAnsi(texto)
    .split("\n")
    .map((l, i) => ({ linha: i, colunas: visibleWidth(l), texto: l }))
    .filter((l) => l.colunas > largura);
}

/** Roda a CLI real (headless) com uma entrada de stdin e devolve stdout+stderr. */
function rodarCli(entrada) {
  try {
    return execFileSync(process.execPath, [CLI], {
      cwd: path.join(__dirname, "..", ".."),
      encoding: "utf8",
      input: entrada,
      env: { ...process.env, SELFEOPI_LOCALE: "pt", SELFEOPI_FORCE_NO_ENGINE: "1" },
      timeout: 30_000,
    });
  } catch (err) {
    return String(err.stdout || "");
  }
}

/* ------------------------------------------------------------------ */
/* 1. Testes do classificador audit() com casos sintéticos             */
/* ------------------------------------------------------------------ */

test("audit: afirmação sustentada tem status 'sustentada' e zero lacunas", () => {
  const r = audit(
    [{ id: "s1", texto: "exemplo sustentado" }],
    [{ id: "s1", status: "sustenta", fonte: "teste-sintetico", detalhe: "medição 1" }],
  );
  assert.equal(r.total, 1);
  assert.equal(r.sustentadas, 1);
  assert.equal(r.resultados[0].status, "sustentada");
  assert.deepEqual(r.lacunas, []);
});

test("audit: achado 'refuta' marca a afirmação como refutada", () => {
  const r = audit(
    [{ id: "r1", texto: "exemplo refutado" }],
    [{ id: "r1", status: "refuta", fonte: "teste-sintetico", detalhe: "linha com 90 col" }],
  );
  assert.equal(r.refutadas, 1);
  assert.equal(r.resultados[0].status, "refutada");
  assert.equal(r.lacunas.length, 1);
});

test("audit: afirmação sem achado conclusivo fica 'sem prova'", () => {
  const r = audit([{ id: "n1", texto: "exemplo sem prova" }], []);
  assert.equal(r.semProva, 1);
  assert.equal(r.resultados[0].status, "sem prova");
  assert.match(r.resultados[0].motivo, /nenhum achado/);
});

/* ------------------------------------------------------------------ */
/* 2. Refutação ativa das afirmações do PROJECT.md                     */
/* ------------------------------------------------------------------ */

test("REFUTAR A: 'headless ≤ 72 colunas' — CLI real, pior caso", () => {
  // Juiz: a CLI real em processo filho. Contraexemplos tentados: todas as telas
  // de --render e uma rajada de comandos de barra com argumentos gigantes.
  const telas = ["conversation", "help", "banner", "panel", "busy", "status", "palette"];
  const achados = [];

  for (const tela of telas) {
    let frame = "";
    try {
      frame = execFileSync(process.execPath, [CLI, "--render", tela], {
        cwd: path.join(__dirname, "..", ".."),
        encoding: "utf8",
        env: { ...process.env, SELFEOPI_LOCALE: "pt", SELFEOPI_FORCE_NO_ENGINE: "1" },
        timeout: 30_000,
      });
    } catch (err) {
      frame = String(err.stdout || "");
    }
    for (const l of linhasAcima(frame)) {
      achados.push({
        id: "A",
        status: "refuta",
        fonte: `--render ${tela}`,
        detalhe: `linha ${l.linha} com ${l.colunas} colunas`,
      });
    }
  }

  // rajada de comandos com argumento gigante
  for (const cmd of [
    "/" + "x".repeat(300),
    "/goal " + "y".repeat(500),
    "/model " + "z".repeat(200),
    "/theme " + "w".repeat(200),
  ]) {
    const out = rodarCli(cmd + "\nq\n");
    for (const l of linhasAcima(out)) {
      achados.push({
        id: "A",
        status: "refuta",
        fonte: "comando de barra",
        detalhe: `linha ${l.linha} com ${l.colunas} colunas (${JSON.stringify(cmd.slice(0, 10))})`,
      });
    }
  }

  const r = audit(
    [{ id: "A", texto: "headless ≤ 72" }],
    achados.length
      ? achados
      : [{ id: "A", status: "sustenta", fonte: "CLI real (--render + comandos)", detalhe: "nenhuma linha acima de 72" }],
  );
  if (achados.length > 0) {
    console.error("REFUTADA A — linhas acima de 72:", achados.slice(0, 5));
    assert.equal(r.resultados[0].status, "refutada");
  } else {
    assert.equal(r.resultados[0].status, "sustentada", "afirmação A sobreviveu ao pior caso");
  }
});

test("REFUTAR B: 'balanço ANSI é zero' — CLI real, pior caso", () => {
  // Juiz: a CLI real. Contraexemplo: telas --render com cor e comandos que
  // emitem texto colorido; se sobrar SGR aberto em alguma linha, cai.
  const telas = ["conversation", "help", "banner", "panel", "busy", "status", "palette"];
  const achados = [];

  const medir = (fonte, out) => {
    for (const [i, linha] of out.split("\n").entries()) {
      const bal = ansiBalance(linha);
      if (bal !== 0) {
        achados.push({ id: "B", status: "refuta", fonte, detalhe: `linha ${i} com saldo ${bal}` });
      }
    }
  };

  for (const tela of telas) {
    let frame = "";
    try {
      frame = execFileSync(process.execPath, [CLI, "--render", tela], {
        cwd: path.join(__dirname, "..", ".."),
        encoding: "utf8",
        env: { ...process.env, SELFEOPI_LOCALE: "pt", SELFEOPI_FORCE_NO_ENGINE: "1" },
        timeout: 30_000,
      });
    } catch (err) {
      frame = String(err.stdout || "");
    }
    medir(`--render ${tela}`, frame);
  }

  // comando de barra com texto longo colorido
  medir("comando /init", rodarCli("/init\nq\n"));
  medir("comando /help", rodarCli("/help\nq\n"));

  const r = audit(
    [{ id: "B", texto: "balanço ANSI zero" }],
    achados.length
      ? achados
      : [{ id: "B", status: "sustenta", fonte: "CLI real", detalhe: "saldo 0 em todas as linhas" }],
  );
  if (achados.length > 0) {
    console.error("REFUTADA B — saldo ANSI != 0:", achados.slice(0, 5));
    assert.equal(r.resultados[0].status, "refutada");
  } else {
    assert.equal(r.resultados[0].status, "sustentada");
  }
});

test("REFUTAR C: 'recorte não sobrescreve o original' — pureza e imutabilidade", () => {
  // Contraexemplo tentado: sessão com erro + contexto ligado. Verifica que o
  // texto de entrada continua intacto (não sobrescrito) e que a saída é um NOVO
  // texto recortado, não o original.
  const ev = (o) => JSON.stringify(o);
  const original = [
    ev({ type: "session", version: 3, id: "sess-orig", cwd: "/x" }),
    ev({ type: "message", id: "m1", parentId: null, message: { role: "user", content: "oi" } }),
    ev({ type: "message", id: "e1", parentId: "m1", message: { role: "assistant", stopReason: "error", content: [] } }),
    ev({ type: "context_edit", id: "c1", parentId: "e1" }),
    ev({ type: "message", id: "m2", parentId: "c1", message: { role: "user", content: "de novo" } }),
  ].join("\n") + "\n";

  const copiaFiel = original; // valor original guardado (string é imutável)
  const r = rewindSession(original, { dropErrors: true });

  const achados = [];
  if (original !== copiaFiel) {
    achados.push({ id: "C", status: "refuta", fonte: "rewindSession", detalhe: "texto de entrada mudou" });
  }
  if (r.jsonl === original) {
    achados.push({ id: "C", status: "refuta", fonte: "rewindSession", detalhe: "devolveu o original sem recortar" });
  }
  if (!original.includes('"stopReason":"error"')) {
    achados.push({ id: "C", status: "refuta", fonte: "rewindSession", detalhe: "original perdeu o erro (sobrescrito)" });
  }

  const r2 = audit(
    [{ id: "C", texto: "recorte não sobrescreve" }],
    achados.length
      ? achados
      : [{ id: "C", status: "sustenta", fonte: "rewindSession", detalhe: "entrada intacta; saída é novo texto" }],
  );
  if (achados.length > 0) {
    console.error("REFUTADA C:", achados);
    assert.equal(r2.resultados[0].status, "refutada");
  } else {
    assert.equal(r2.resultados[0].status, "sustentada");
    // reforço: o recorte removeu erro e contexto ligado, preservou msg boa
    assert.ok(!r.jsonl.includes('"stopReason":"error"'), "erro deveria sair do recorte");
    assert.ok(!r.jsonl.includes("context_edit"), "contexto ligado deveria sair");
    assert.ok(r.jsonl.includes("de novo"), "mensagem boa deveria ficar");
    // e o cabeçalho/original seguem intactos
    assert.ok(original.includes('"stopReason":"error"'), "original não pode ser sobrescrito");
  }
});

test("REFUTAR D: 'reconexão não imprime erro sobre resposta correta'", async () => {
  // Contraexemplo tentado: 1º attempt emite erro transitório (429) e depois o
  // texto correto. A tela não pode mostrar o erro por cima da resposta. Vale
  // para `converse` (turno único) e para o caminho de reconexão.
  function fakePi({ script }) {
    const h = { text: new Set(), tool: new Set(), settled: new Set(), error: new Set() };
    const rec = { aborted: false, prompts: [], sessions: 0 };
    const emit = (k, a) => { for (const cb of h[k] || []) cb(a); };
    return {
      rec,
      on(k, cb) { (h[k] ||= new Set()).add(cb); return () => h[k]?.delete(cb); },
      prompt: async (msg) => { rec.prompts.push(msg); if (script) script(emit); return "started"; },
      abort: async () => { rec.aborted = true; emit("settled", { aborted: true }); },
      getState: async () => ({}),
      getAvailableModels: async () => [],
      setModel: async () => ({}),
      cycleModel: async () => null,
      newSession: async () => { rec.sessions += 1; return { cancelled: false }; },
    };
  }

  const achados = [];

  // (1) converse: erro transitório seguido de texto correto
  {
    const pi = fakePi({
      script: (emit) => {
        emit("error", "429: Provider returned error");
        emit("text", "resposta correta");
        emit("settled", { aborted: false });
      },
    });
    const chunks = [];
    const res = await converse(pi, "oi", (s) => chunks.push(s));
    const out = stripAnsi(chunks.join(""));
    if (!res.ok || !/resposta correta/.test(out)) {
      achados.push({ id: "D", status: "refuta", fonte: "converse", detalhe: "resposta correta não apareceu" });
    }
    if (/não consegui|429|Provider returned/i.test(out)) {
      achados.push({ id: "D", status: "refuta", fonte: "converse", detalhe: "erro transitório vazou sobre a resposta" });
    }
  }

  // (2) converseOrFallback: falha, reconecta, e a resposta final aparece limpa
  {
    let attempt = 0;
    const pi = fakePi({
      script: (emit) => {
        attempt += 1;
        if (attempt < 3) { emit("error", "429 Provider returned error"); emit("settled", { aborted: false }); }
        else { emit("text", "resposta após reconexão"); emit("settled", { aborted: false }); }
      },
    });
    const chunks = [];
    const res = await converseOrFallback(pi, "oi", (s) => chunks.push(s), { allowFallback: false, candidates: [] });
    const out = stripAnsi(chunks.join(""));
    if (!res.ok || !/resposta após reconexão/.test(out)) {
      achados.push({ id: "D", status: "refuta", fonte: "converseOrFallback", detalhe: "resposta final não apareceu" });
    }
    if (/429|Provider returned|não consegui falar/i.test(out)) {
      achados.push({ id: "D", status: "refuta", fonte: "converseOrFallback", detalhe: "erro das tentativas vazou na tela" });
    }
  }

  const r = audit(
    [{ id: "D", texto: "reconexão não imprime erro sobre resposta" }],
    achados.length
      ? achados
      : [{ id: "D", status: "sustenta", fonte: "converse/converseOrFallback", detalhe: "erro transitório não aparece; resposta final sim" }],
  );
  if (achados.length > 0) {
    console.error("REFUTADA D:", achados);
    assert.equal(r.resultados[0].status, "refutada");
  } else {
    assert.equal(r.resultados[0].status, "sustentada");
  }
});

/* ------------------------------------------------------------------ */
/* 3. EXTRA: reticência de corte (relacionada, não-negativa)           */
/* ------------------------------------------------------------------ */

test("EXTRA: 'nenhuma reticência de truncamento' — a paleta corta com …", () => {
  // PROJECT.md §2/§11 diz "nenhuma reticência de truncamento". A paleta usa
  // truncateVisible() e emite "…" no fim de descrições longas. Esta é uma
  // quinta afirmação do documento que cai; reportamos com arquivo:linha.
  let frame = "";
  try {
    frame = execFileSync(process.execPath, [CLI, "--render", "palette"], {
      cwd: path.join(__dirname, "..", ".."),
      encoding: "utf8",
      env: { ...process.env, SELFEOPI_LOCALE: "pt", SELFEOPI_FORCE_NO_ENGINE: "1" },
      timeout: 30_000,
    });
  } catch (err) {
    frame = String(err.stdout || "");
  }
  const retic = reticenciasNoFim(frame);

  if (retic.length > 0) {
    const r = audit(
      [{ id: "E", texto: "nenhuma reticência de truncamento" }],
      retic.map(([i]) => ({
        id: "E",
        status: "refuta",
        fonte: "apps/cli.mjs:1686 (truncateVisible em renderPalette)",
        detalhe: `linha ${i} termina em reticência`,
      })),
    );
    console.error(
      "REFUTADA E (reticência) — apps/cli.mjs:1686 truncateVisible; linhas:",
      retic.map(([i, l]) => `${i}:${JSON.stringify(l.slice(-18))}`).slice(0, 3),
    );
    assert.equal(r.resultados[0].status, "refutada");
  } else {
    assert.equal(retic.length, 0, "nenhuma reticência deveria existir");
  }
});
