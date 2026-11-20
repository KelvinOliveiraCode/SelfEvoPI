import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { realRunEvals } from "./cli.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "cli.mjs");

function run(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd: path.resolve(HERE, "..", "..") });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function lastJson(stdout) {
  const lines = stdout.trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
}

test("cli detect --json devolve JSON com gaps", () => {
  const r = run(["detect", "--json"]);
  assert.equal(r.status, 0);
  const j = lastJson(r.stdout);
  assert.equal(j.ok, true);
  assert.ok(typeof j.scanned === "number" && j.scanned > 0);
  assert.ok(j.counts && typeof j.counts === "object");
  assert.ok(Array.isArray(j.gaps));
});

test("cli detect sem --json imprime texto curto", () => {
  const r = run(["detect"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /scanned:/);
  assert.match(r.stdout, /gaps:/);
});

test("cli evolve --task D1-cria-soma --dry-run produz LoopReport coerente", () => {
  const r = run(["evolve", "--task", "D1-cria-soma", "--dry-run", "--json"]);
  assert.equal(r.status, 0);
  const j = lastJson(r.stdout);
  const rep = j.report;
  assert.equal(j.ok, true);
  assert.ok(rep, "tem report");
  assert.ok(["promoted", "needs-human", "rejected"].includes(rep.outcome), `outcome=${rep.outcome}`);
  // coerência: dry-run não promove de fato, mas chega a uma decisão.
  // O kind sai do contrato (um dos cinco), não mais só cli/skill.
  assert.ok(["mcp-config", "skill", "cli", "extension", "mcp-server"].includes(rep.kind), `kind=${rep.kind}`);
  assert.ok("decision" in rep);
});

test("cli evolve sem --task falha com exit 2", () => {
  const r = run(["evolve", "--json"]);
  assert.equal(r.status, 2);
  const j = lastJson(r.stdout);
  assert.equal(j.ok, false);
});

test("cli gate sem argumentos falha com exit 2", () => {
  const r = run(["gate", "--json"]);
  assert.equal(r.status, 2);
  const j = lastJson(r.stdout);
  assert.equal(j.ok, false);
});

test("cli status imprime estado do harness", () => {
  const r = run(["status"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /last-known-good:/);
  assert.match(r.stdout, /baseline:/);
});

test("cli skills lista e busca na memoria sem quebrar", () => {
  const list = run(["skills"]);
  assert.equal(list.status, 0);
  assert.match(list.stdout, /memória \(skills\)/);

  const json = run(["skills", "qualquer termo", "--json"]);
  assert.equal(json.status, 0);
  const j = lastJson(json.stdout);
  assert.equal(j.ok, true);
  assert.ok(Array.isArray(j.terms));
  assert.ok(Array.isArray(j.results));
  assert.equal(typeof j.count, "number");

  const vazio = run(["skills", "a o de", "--json"]);
  assert.equal(vazio.status, 0, "consulta sem termo nao pode falhar");
  assert.equal(lastJson(vazio.stdout).count, 0);
});

test("cli comando desconhecido sai 2", () => {
  const r = run(["--json", "nada"]);
  assert.equal(r.status, 2);
});

test("cli evolve dry-run --json tem exit 0 mesmo quando promove", () => {
  // o dry-run é determinístico: stub de eval, sem modelo real
  const r = run(["evolve", "--task", "D1-cria-soma", "--dry-run", "--json"]);
  assert.equal(r.status, 0);
  const j = lastJson(r.stdout);
  assert.equal(j.report.outcome, "promoted");
});

/* ------------------------------------------------------------------ */
/* realRunEvals: tokens reais do stdout do eval (bug #1)                */
/* ------------------------------------------------------------------ */

test("realRunEvals devolve tokens reais quando o eval imprime a linha resultado", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "forge-runevals-"));
  try {
    await writeFile(path.join(dir, "T1.json"), JSON.stringify({ id: "T1" }), "utf8");
    // runner falso: imprime exatamente o formato de evals/run.mjs:241
    const exec = async () => ({
      stdout: "Executando 1 tarefa(s)\n  \u2713 T1  10 ms  123 tok\n\n  resultado: 1/1  \u00b7  10 ms  \u00b7  123 tokens\n",
      stderr: "",
    });
    const out = await realRunEvals({ taskId: "T1", runs: 1 }, { tasksDir: dir, exec });
    assert.equal(out.length, 1);
    assert.equal(out[0].passed, true);
    assert.equal(out[0].tokens, 123, "tokens deve vir do stdout, nao 0 fixo");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("realRunEvals: tokens 0 com aviso quando nao ha linha de tokens", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "forge-runevals-"));
  try {
    await writeFile(path.join(dir, "T2.json"), JSON.stringify({ id: "T2" }), "utf8");
    const exec = async () => ({ stdout: "Executando 1 tarefa(s)\n  \u2713 T2  10 ms\n", stderr: "" });
    const out = await realRunEvals({ taskId: "T2", runs: 1 }, { tasksDir: dir, exec });
    assert.equal(out[0].passed, true);
    assert.equal(out[0].tokens, 0);
    assert.match(out[0].tokenWarning ?? "", /linha de tokens ausente/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("realRunEvals: tarefa inexistente => skipped (nao reprova)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "forge-runevals-"));
  try {
    const out = await realRunEvals({ taskId: "NaoExiste", runs: 1 }, { tasksDir: dir, exec: async () => ({ stdout: "" }) });
    assert.equal(out.length, 1);
    assert.equal(out[0].skipped, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});