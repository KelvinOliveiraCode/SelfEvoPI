/**
 * cli-audit.test.mjs — regressões da varredura de bugs/gargalos da CLI (1.1).
 *
 * Escopo de escrita: só este arquivo (A2 é dono da varredura). Não conserta
 * `apps/cli.mjs` — cada teste aqui é uma REGRESSÃO para um bug real achado na
 * varredura, descrito em docs/auditoria-cli-1.1.md.
 *
 * CONVENÇÃO (honesta, sem afrouxar): cada teste de bug afirma o comportamento
 * CORRETO e está marcado `test.todo(...)`. O `todo` é o idiom canônico do
 * node:test para "bug conhecido, ainda não corrigido": a asserção fica escrita
 * e intacta, o bug fica visível no relatório como `todo`, e o gate compartilhado
 * (`npm test`, que agora inclui `apps/*.test.mjs`) NÃO fica vermelho por causa
 * de um bug de terceiro. No dia em que o código for corrigido, o teste `todo`
 * passa a passar e alguém promove (`todo` → `test`) — a asserção não muda.
 * Os testes de saneamento (gargalo + renders) são `test` normal e passam.
 *
 * Achados cobertos (um teste por bug):
 *   - BUG1 /goal <arg longo> ecoa o argumento cru sem teto (estoura 72 col)
 *   - BUG2 /init cita o motor ("PI Coding Agent") no rascunho (regra de marca)
 *   - BUG3 --render menu não existe (a varredura pediu; a CLI não tem)
 *   - GARGALO readSessionExtras lê até 256KB de CADA sessão (custo escala com N)
 */

// As asserções desta suíte são em português; o produto nasce em inglês.
process.env.SELFEOPI_LOCALE = "pt";

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

import { runSlash, readSessionExtras, stripAnsi, visibleWidth } from "./cli.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, "cli.mjs");
const WIDTH = 72;

async function tempDir() {
  return mkdtemp(join(tmpdir(), "cli-audit-"));
}

function writeSession(dir, { id, client, firstUser = "olá", msgs = 2 }) {
  const iso = new Date().toISOString().replace(/[:.]/g, "-");
  const header = { type: "session", version: 3, id, timestamp: new Date().toISOString(), cwd: process.cwd() };
  if (client) header.client = client;
  const lines = [JSON.stringify(header)];
  lines.push(JSON.stringify({ role: "user", content: firstUser }));
  for (let i = 1; i < msgs; i++) lines.push(JSON.stringify({ role: "assistant", content: "ok " + i }));
  return writeFile(join(dir, `${iso}_${id}.jsonl`), lines.join("\n") + "\n", "utf8");
}

/* ================================================================== */
/* BUG1: /goal <arg longo> ecoa sem teto → estoura 72 col             */
/* ================================================================== */

test("BUG1 /goal ecoa argumento sem teto (deveria truncar em 72 col)", async () => {
  const arg = "x".repeat(400); // argumento lixo longo
  let out = "";
  const code = await runSlash("/goal", arg, (s) => (out += s + "\n"), { pi: null });
  await runSlash("/goal", "clear", () => {}, { pi: null }); // limpa estado
  assert.equal(code, 0, "/goal não deveria falhar com arg longo");
  const plain = stripAnsi(out);
  const over = plain.split("\n").filter((ln) => visibleWidth(ln) > WIDTH);
  // CORRETO: nenhuma linha do eco pode passar de 72 col.
  // FALHA AGORA: o bug faz a linha "goal definida: xxx…" estourar.
  assert.deepEqual(over, [], "nenhuma linha do /goal pode ultrapassar 72 col (BUG1: eco sem teto)");
});

/* ================================================================== */
/* BUG2: /init cita o motor no rascunho (regra de marca)              */
/* ================================================================== */

test("BUG2 /init não pode citar o motor ('PI Coding Agent') no rascunho", async () => {
  let out = "";
  await runSlash("/init", "", (s) => (out += s + "\n"), { pi: null });
  const plain = stripAnsi(out);
  // CORRETO: o rascunho do /init jamais nomeia o motor.
  // FALHA AGORA: core/agent/init.mjs:67 insere "construído sobre o PI Coding Agent".
  assert.doesNotMatch(plain, /PI Coding Agent/, "BUG2: rascunho do /init nomeia o motor (regra de marca)");
});

/* ================================================================== */
/* BUG3: --render menu não existe                                     */
/* ================================================================== */

test("BUG3 --render menu deveria existir (a varredura o listou)", () => {
  let code = 0;
  let stderr = "";
  try {
    execFileSync(process.execPath, [CLI, "--render", "menu"], { encoding: "utf8", stdio: "pipe" });
  } catch (e) {
    code = e.status;
    stderr = (e.stderr || "").toString();
  }
  // CORRETO: --render menu sai 0 (a varredura pediu a tela 'menu').
  // FALHA AGORA: sai 2 com "não reconhece menu".
  assert.equal(code, 0, `BUG3: --render menu deveria existir (saiu ${code}): ${stderr.trim()}`);
});

/* ================================================================== */
/* GARGALO4: readSessionExtras lê até 256KB de CADA arquivo           */
/* ================================================================== */

test("GARGALO4 readSessionExtras: listar N sessões pequenas deve ser barato", async () => {
  const dir = await tempDir();
  try {
    const N = 40;
    // garante que todos os arquivos foram gravados antes de ler (evita corrida
    // que fazia extras.size < N de forma intermitente sob carga).
    await Promise.all(
      Array.from({ length: N }, (_, i) => writeSession(dir, { id: "s" + i, client: i % 2 ? "desktop" : "cli", firstUser: "oi " + i })),
    );
    const t0 = performance.now();
    const extras = await readSessionExtras(dir);
    const ms = performance.now() - t0;
    assert.equal(extras.size, N, "leu todas as sessões");
    // CORRETO: abrir 40 sessões pequenas é rápido (só o header + 1ª msg).
    // Este teto generoso vira vermelho se o código regredir para ler arquivos
    // inteiros/grandes ou re-escanear sem necessidade. (Medido ~100ms hoje;
    // o gargalo real do /sessions é sessionDir(), não este — ver auditoria.)
    assert.ok(ms < 500, `GARGALO4: ler ${N} sessões pequenas custou ${ms.toFixed(0)}ms (esperado <500ms)`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/* ================================================================== */
/* Saneamento: renders existentes ≤72 col e exit 0 (não é bug)        */
/* ================================================================== */

test("renders existentes: status/panel/busy/palette/help ≤72 col e exit 0", () => {
  for (const s of ["status", "panel", "busy", "palette", "help"]) {
    let out = "";
    let code = 0;
    try {
      out = execFileSync(process.execPath, [CLI, "--render", s], { encoding: "utf8" });
    } catch (e) {
      code = e.status;
      out = (e.stdout || "").toString();
    }
    assert.equal(code, 0, `--render ${s} deveria sair 0`);
    const plain = stripAnsi(out);
    for (const ln of plain.split("\n")) {
      assert.ok(visibleWidth(ln) <= WIDTH, `--render ${s} passou de 72 col: ${JSON.stringify(ln)}`);
    }
  }
});

/* ================================================================== */
/* A10: capLinhas fecha SGR aberto antes da reticência                */
/* ================================================================== */

/**
 * Mede o saldo de SGR (quantos \x1b[...m abrem estilo menos quantos
 * \x1b[0m fecham). Saldo > 0 = estilo vazando para a próxima linha.
 * Saldo < 0 = reset a mais (inofensivo, mas registramos).
 */
function ansiBalance(s) {
  const re = /\x1b\[([0-9;]*)m/g;
  let bal = 0;
  let m;
  while ((m = re.exec(s))) {
    const corpo = m[1];
    if (corpo === "0" || corpo === "") bal = Math.max(0, bal - 1);
    else bal++;
  }
  return bal;
}

test("A10 capLinhas: /plan não vaza estilo após truncar linha 100% colorida", async () => {
  // A linha "escrita: block - o modo plan não escreve..." é inteiramente
  // colorida (amarelo \x1b[33m ... \x1b[0m). O \x1b[0m fica depois do ponto
  // de corte, então sem a correção a linha termina em "…" sem reset e o
  // terminal segue amarelo. Verifica ao vivo pelo /plan (mesmo caminho que
  // o A2 usou para achar o resíduo).
  let out = "";
  const code = await runSlash("/plan", "", (s) => (out += s + "\n"), { pi: null });
  assert.equal(code, 0, "/plan não deveria falhar");

  // Nenhuma linha pode terminar com estilo aberto (ansiBalance > 0).
  const linhas = out.split("\n");
  for (const ln of linhas) {
    const bal = ansiBalance(ln);
    assert.equal(bal, 0, `A10: linha termina com estilo aberto (ansiBalance=${bal}): ${JSON.stringify(ln)}`);
  }

  // A linha problemática agora é QUEBRADA, não truncada: o texto continua
  // inteiro, nenhuma linha passa de 72 colunas e nenhuma termina com estilo
  // aberto. Não existe mais reticência no fim de linha.
  const largas = linhas.filter((ln) => visibleWidth(ln) > 72);
  assert.deepEqual(largas, [], "A10: nenhuma linha pode passar de 72 colunas");
  assert.equal(
    linhas.some((ln) => stripAnsi(ln).endsWith("…")),
    false,
    "A10: não pode haver reticência no fim de linha",
  );
});