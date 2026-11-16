import test, { after } from "node:test";
import assert from "node:assert/strict";

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runSandboxed, MAX_OUTPUT_BYTES } from "./run-sandboxed.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const TMP_ROOT = path.join(HERE, ".tmp-tests");

/* ------------------------------------------------------------------ */
/* Fixtures e controle de processos                                    */
/* ------------------------------------------------------------------ */

/** Cria workspace descartável dentro da árvore do projeto (nunca no tmp do sistema). */
async function workspace(files = {}) {
  await mkdir(TMP_ROOT, { recursive: true });
  const dir = await mkdtemp(path.join(TMP_ROOT, "ws-"));
  for (const [name, body] of Object.entries(files)) {
    const full = path.join(dir, name);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body, "utf8");
  }
  return dir;
}

/** Todo pid que o runner levantou, para o teste final de "nada ficou vivo". */
const pids = new Set();

async function run(opts) {
  const r = await runSandboxed({ timeoutMs: 8_000, ...opts });
  if (typeof r.pid === "number" && r.pid > 0) pids.add(r.pid);
  return r;
}

/** Processo vivo? `kill(pid, 0)` não mata; só pergunta. */
function isAlive(pid) {
  if (typeof pid !== "number" || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM"; // existe, mas é de outro usuário
  }
}

after(async () => {
  // No Windows o pid pode continuar "existe" por alguns milissegundos depois de
  // o processo morrer (o handle ainda nao foi liberado). Sem esta espera, a
  // suite falha so quando roda junto com as outras — e ai parece vazamento.
  let vivos = [...pids].filter((pid) => isAlive(pid));
  const t0 = Date.now();
  while (vivos.length > 0 && Date.now() - t0 < 3000) {
    await new Promise((r) => setTimeout(r, 100));
    vivos = vivos.filter((pid) => isAlive(pid));
  }
  await rm(TMP_ROOT, { recursive: true, force: true });
  assert.deepEqual(vivos, [], `processos que sobreviveram aos testes: ${vivos.join(", ")}`);
});

/* ------------------------------------------------------------------ */
/* Contrato de flags                                                   */
/* ------------------------------------------------------------------ */

test("monta --permission e nunca --allow-net nem --allow-child-process", async () => {
  const ws = await workspace({ "flags.mjs": 'console.log(JSON.stringify(process.execArgv));\n' });
  const r = await run({ script: "flags.mjs", workdir: ws });

  assert.equal(r.ok, true, `stdout=${r.stdout} stderr=${r.stderr}`);
  const argv = JSON.parse(r.stdout.trim());

  assert.ok(argv.includes("--permission"), "sem --permission não há contenção");
  assert.ok(
    !argv.some((a) => a.startsWith("--allow-net")),
    `--allow-net não pode ser passado: ${argv.join(" ")}`
  );
  assert.ok(
    !argv.some((a) => a.startsWith("--allow-child-process")),
    `--allow-child-process não pode ser passado: ${argv.join(" ")}`
  );
  assert.ok(argv.some((a) => a.startsWith("--allow-fs-read=")), "leitura restrita ao workdir");
  assert.ok(
    !argv.some((a) => a.startsWith("--allow-fs-write=")),
    "sem allowWrite não existe flag de escrita"
  );
});

test("allowWrite acrescenta --allow-fs-write", async () => {
  const ws = await workspace({ "flags2.mjs": 'console.log(JSON.stringify(process.execArgv));\n' });
  const r = await run({ script: "flags2.mjs", workdir: ws, allowWrite: true });
  assert.equal(r.ok, true, r.stderr);
  const argv = JSON.parse(r.stdout.trim());
  assert.ok(argv.some((a) => a.startsWith("--allow-fs-write=")));
});

/* ------------------------------------------------------------------ */
/* Camada 2 em ação: filesystem                                        */
/* ------------------------------------------------------------------ */

test("script que lê arquivo dentro do workdir passa", async () => {
  const ws = await workspace({
    "dados.txt": "conteudo interno\n",
    "le.mjs": 'import fs from "node:fs";\nconsole.log(fs.readFileSync("dados.txt", "utf8").trim());\n',
  });
  const r = await run({ script: "le.mjs", workdir: ws });

  assert.equal(r.ok, true, `stderr=${r.stderr}`);
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout.trim(), "conteudo interno");
  assert.equal(r.timedOut, false);
});

test("script que lê arquivo fora do workdir falha com ERR_ACCESS_DENIED", async () => {
  const alvo = path.join(REPO, "package.json"); // dentro do repositório, fora do workdir
  assert.ok(await stat(alvo), "o alvo precisa existir para o teste valer");

  const ws = await workspace({
    "fora.mjs": 'import fs from "node:fs";\nconsole.log(fs.readFileSync(process.argv[2], "utf8"));\n',
  });
  const r = await run({ script: "fora.mjs", workdir: ws, args: [alvo] });

  assert.equal(r.ok, false);
  assert.notEqual(r.exitCode, 0, "tem de sair com erro");
  assert.match(r.stderr, /ERR_ACCESS_DENIED/, `stderr=${r.stderr}`);
  assert.doesNotMatch(r.stdout, /selfevopi|"name"/, "não pode ter vazado o conteúdo do arquivo");
});

test("escrever dentro do workdir depende de allowWrite", async () => {
  const ws = await workspace({
    "escreve.mjs": 'import fs from "node:fs";\nfs.writeFileSync("novo.txt", "x");\nconsole.log("WRITE OK");\n',
  });

  const negado = await run({ script: "escreve.mjs", workdir: ws });
  assert.equal(negado.ok, false);
  assert.match(negado.stderr, /ERR_ACCESS_DENIED/);

  const liberado = await run({ script: "escreve.mjs", workdir: ws, allowWrite: true });
  assert.equal(liberado.ok, true, `stderr=${liberado.stderr}`);
  assert.match(liberado.stdout, /WRITE OK/);
  assert.equal(await readFile(path.join(ws, "novo.txt"), "utf8"), "x");
});

/* ------------------------------------------------------------------ */
/* Camada 2 em ação: rede                                              */
/* ------------------------------------------------------------------ */

const FORMAS_DE_REDE = {
  fetch: 'await fetch("https://example.com");\n',
  "net.connect": 'import net from "node:net";\nnet.connect(443, "example.com");\n',
  "https.get": 'import https from "node:https";\nhttps.get("https://example.com");\n',
};

for (const [nome, corpo] of Object.entries(FORMAS_DE_REDE)) {
  test(`rede por ${nome} falha em runtime (precheck desligado para isolar a camada 2)`, async () => {
    const ws = await workspace({ "rede.mjs": `${corpo}console.log("PASSOU");\n` });
    const r = await run({ script: "rede.mjs", workdir: ws, precheck: false });

    assert.equal(r.ok, false, `${nome} não deveria passar`);
    assert.match(r.stderr, /ERR_ACCESS_DENIED/, `stderr=${r.stderr}`);
    assert.doesNotMatch(r.stdout, /PASSOU/, "não pode ter chegado ao fim do script");
  });
}

test("fetch é barrado pelo gate antes de existir qualquer processo", async () => {
  const ws = await workspace({
    "rede-gate.mjs": 'console.log("EXECUTOU");\nawait fetch("https://example.com");\n',
  });
  const r = await run({ script: "rede-gate.mjs", workdir: ws });

  assert.equal(r.blocked, true);
  assert.equal(r.decision ?? r.gate.decision, "block");
  assert.ok(r.gate.blockingRules.includes("network-access"), `regras=${r.gate.blockingRules}`);
  assert.equal(r.pid, null, "o gate reprovou antes de spawnar");
  assert.equal(r.stdout, "", "nada do script pode ter rodado");
});

/* ------------------------------------------------------------------ */
/* Camada 2 em ação: processo filho e timeout                          */
/* ------------------------------------------------------------------ */

test("child_process é barrado pelo gate antes de executar", async () => {
  const ws = await workspace({
    "cp.mjs": 'import { execSync } from "node:child_process";\nconsole.log(execSync("echo oi").toString());\n',
  });
  const r = await run({ script: "cp.mjs", workdir: ws });

  assert.equal(r.blocked, true);
  assert.ok(r.gate.blockingRules.includes("child-process"));
  assert.equal(r.pid, null);
});

test("sem precheck, child_process é bloqueado pelo Permission Model", async () => {
  const ws = await workspace({
    "cp2.mjs": 'import { execSync } from "node:child_process";\nexecSync("echo oi");\n',
  });
  const r = await run({ script: "cp2.mjs", workdir: ws, precheck: false });

  assert.equal(r.ok, false);
  assert.match(r.stderr, /ERR_ACCESS_DENIED/, `stderr=${r.stderr}`);
});

test("timeout devolve timedOut e mata o processo", async () => {
  const ws = await workspace({ "sono.mjs": 'setTimeout(() => {}, 60_000);\n' });
  const r = await run({ script: "sono.mjs", workdir: ws, timeoutMs: 700 });

  assert.equal(r.timedOut, true);
  assert.equal(r.ok, false);
  assert.ok(r.durationMs < 5_000, `demorou ${r.durationMs}ms`);
  assert.ok(
    r.exitCode === null || r.exitCode !== 0,
    `processo morto não deveria sair 0 (exitCode=${r.exitCode}, signal=${r.signal})`
  );
  assert.equal(isAlive(r.pid), false, `o pid ${r.pid} continua vivo`);
});

test("um script rápido termina antes do timeout e devolve ok", async () => {
  const ws = await workspace({ "rapido.mjs": 'console.log("fim");\n' });
  const r = await run({ script: "rapido.mjs", workdir: ws, timeoutMs: 5_000 });

  assert.equal(r.timedOut, false);
  assert.equal(r.ok, true);
  assert.equal(r.stdout.trim(), "fim");
  assert.equal(isAlive(r.pid), false, "o processo já terminou");
});

/* ------------------------------------------------------------------ */
/* Limites de saída                                                    */
/* ------------------------------------------------------------------ */

test("saída é limitada por fluxo e sinaliza truncamento", async () => {
  const ws = await workspace({ "barulho.mjs": 'process.stdout.write("x".repeat(200_000));\n' });
  const r = await run({ script: "barulho.mjs", workdir: ws, maxOutputBytes: 1_024 });

  assert.equal(r.ok, true, r.stderr);
  assert.ok(r.stdout.length <= 1_024, `stdout com ${r.stdout.length} bytes`);
  assert.equal(r.truncated, true);
  assert.ok(MAX_OUTPUT_BYTES >= 1_024, "o teto padrão é o publicado");
});

test("argumentos chegam ao script", async () => {
  const ws = await workspace({
    "args.mjs": 'console.log(JSON.stringify(process.argv.slice(2)));\n',
  });
  const r = await run({ script: "args.mjs", workdir: ws, args: ["um", "dois"] });

  assert.equal(r.ok, true, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim()), ["um", "dois"]);
});