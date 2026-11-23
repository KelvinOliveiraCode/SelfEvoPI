import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = "C:/Users/Kelvin/Desktop/SelfEvoPI";

function sessaoFake() {
  const ev = (o) => JSON.stringify(o);
  return [
    ev({ type: "session", version: 3, id: "sessao-original", timestamp: new Date().toISOString(), cwd: ROOT }),
    ev({ type: "message", id: "m1", parentId: null, message: { role: "user", content: "oi" } }),
    ev({ type: "message", id: "e1", parentId: "m1", message: { role: "assistant", stopReason: "error", content: [] } }),
    ev({ type: "context_edit", id: "c1", parentId: "e1" }),
    ev({ type: "message", id: "m2", parentId: "c1", message: { role: "user", content: "tente de novo" } }),
    ev({ type: "message", id: "a1", parentId: "m2", message: { role: "assistant", stopReason: "stop", content: "ok" } }),
  ].join("\n") + "\n";
}

function rodarCli(dir, linhas) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["apps/cli.mjs"], {
      cwd: ROOT,
      env: {
        ...process.env,
        SELFEOPI_SESSIONS_DIR: dir,
        SELFEOPI_FORCE_NO_ENGINE: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { out += d; });
    const timer = setTimeout(() => p.kill("force"), 60_000);
    p.on("close", (code) => { clearTimeout(timer); resolve({ code, out }); });
    p.stdin.write(linhas.join("\n") + "\nq\n");
    p.stdin.end();
  });
}

test("/rewind drop-errors cria nova sessão sem apagar a original", { timeout: 90_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "se-rewind-cli-"));
  const original = join(dir, "2026-11-23T00-00-00-000Z_sessao-original.jsonl");
  writeFileSync(original, sessaoFake(), "utf8");
  try {
    const r = await rodarCli(dir, ["/rewind drop-errors"]);
    const limpo = r.out.replace(/\x1b\[[0-9;]*m/g, "");
    assert.equal(r.code, 0);
    assert.match(limpo, /Rewind:/);
    assert.match(limpo, /nova sessão:/);

    const arquivos = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    assert.equal(arquivos.length, 2, "original + nova sessão");
    const conteudoOriginal = readFileSync(original, "utf8");
    assert.match(conteudoOriginal, /stopReason":"error"/, "original intacta");

    const novo = arquivos.find((f) => f !== "2026-11-23T00-00-00-000Z_sessao-original.jsonl");
    const conteudoNovo = readFileSync(join(dir, novo), "utf8");
    assert.doesNotMatch(conteudoNovo, /stopReason":"error"/);
    assert.doesNotMatch(conteudoNovo, /"type":"context_edit"/);
    assert.match(conteudoNovo, /tente de novo/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
