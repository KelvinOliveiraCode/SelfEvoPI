import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { EVENTS, readHooks, runHooks } from "./hooks.mjs";

function tmp() {
  const root = mkdtempSync(join(tmpdir(), "se-hooks-"));
  mkdirSync(join(root, ".pi"), { recursive: true });
  return root;
}

test("EVENTS cobre o ciclo de vida sem duplicatas", () => {
  assert.deepEqual(EVENTS, ["turn_start", "turn_end", "tool_start", "tool_result", "error", "compact"]);
  assert.equal(new Set(EVENTS).size, EVENTS.length);
});

test("readHooks sem arquivo é ok e vazio (custo zero)", async () => {
  const root = tmp();
  try {
    const r = await readHooks({ root });
    assert.equal(r.ok, true);
    assert.deepEqual(r.hooks, {});
    assert.deepEqual(r.counts, {});
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("readHooks valida evento desconhecido e JSON quebrado", async () => {
  const root = tmp();
  try {
    writeFileSync(join(root, ".pi", "hooks.json"), "{ quebrado", "utf8");
    let r = await readHooks({ root });
    assert.equal(r.ok, false);
    assert.match(r.error, /JSON inválido/);
    writeFileSync(join(root, ".pi", "hooks.json"), JSON.stringify({ version: 1, hooks: { turn_start: "não lista" } }), "utf8");
    r = await readHooks({ root });
    assert.equal(r.ok, false);
    assert.match(r.error, /deve ser lista/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("readHooks rejeita args com metacaracteres de shell", async () => {
  const root = tmp();
  try {
    writeFileSync(join(root, ".pi", "hooks.json"), JSON.stringify({
      version: 1,
      hooks: { tool_start: [{ name: "ruim", command: "node", args: ["a; rm -rf /"] }] },
    }), "utf8");
    const r = await readHooks({ root });
    assert.equal(r.ok, false);
    assert.match(r.error, /metacaracteres/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("runHooks executa hook real e devolve ok/output/duração", async () => {
  const root = tmp();
  const script = join(root, "hook.mjs");
  writeFileSync(script, `let s=""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => { const j=JSON.parse(s); process.stdout.write(j.event + ":" + j.payload.name); });`, "utf8");
  try {
    const cfg = {
      ok: true,
      hooks: { tool_start: [{ name: "sensor", command: process.execPath, args: [script], timeoutMs: 5000 }] },
      counts: { tool_start: 1 },
    };
    const out = await runHooks("tool_start", { name: "read" }, cfg);
    assert.equal(out.length, 1);
    assert.equal(out[0].ok, true);
    assert.match(out[0].output, /tool_start:read/);
    assert.ok(out[0].durationMs >= 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("runHooks redige segredo na saída e não lança em evento inválido", async () => {
  const root = tmp();
  const script = join(root, "hook.mjs");
  writeFileSync(script, `process.stdout.write("apiKey=sk-abcdefghijklmnopqrstuvwxyz");`, "utf8");
  try {
    const cfg = {
      ok: true,
      hooks: { error: [{ name: "log", command: process.execPath, args: [script], timeoutMs: 5000 }] },
    };
    const out = await runHooks("error", {}, cfg);
    assert.equal(out.length, 1);
    assert.ok(!out[0].output.includes("sk-abcdefghijklmnopqrstuvwxyz"), "chave vazou");
    assert.deepEqual(await runHooks("evento-inexistente", {}, cfg), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
