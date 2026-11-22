#!/usr/bin/env node
/**
 * check-models.mjs — varredura de todos os modelos configurados.
 *
 * Sem --prompt: checa apenas capacidades (o que o motor declara) contra o
 * models.json: níveis de esforço, modalidade de imagem e modelo corrente.
 * Com --prompt: além disso, envia um prompt mínimo a cada modelo e mede se
 * responde. Nunca imprime chaves de API.
 */

import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const { createPiClient, listConfiguredModels } = await import(
  pathToFileURL(path.join(ROOT, "core", "agent", "pi-rpc.mjs")).href
);
const { effortLevelsFor, supportsImage } = await import(
  pathToFileURL(path.join(ROOT, "core", "agent", "model-metadata.mjs")).href
);

const withPrompt = process.argv.includes("--prompt");
const onlyProvider = (() => {
  const i = process.argv.indexOf("--provider");
  return i >= 0 ? process.argv[i + 1] : null;
})();
const limitArg = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Number(process.argv[i + 1]) : null;
})();

const all = listConfiguredModels().filter((m) => !onlyProvider || m.provider === onlyProvider);
const models = Number.isFinite(limitArg) && limitArg > 0 ? all.slice(0, limitArg) : all;

if (models.length === 0) {
  console.error("Nenhum modelo configurado encontrado.");
  process.exit(2);
}

console.log(`Modelos: ${models.length} · prompt real: ${withPrompt ? "sim" : "não (só capacidades)"}\n`);

const pi = await createPiClient({ cwd: ROOT, session: "ephemeral" }).catch((err) => {
  console.error(`Falha ao iniciar o motor: ${err.message}`);
  process.exit(2);
});

function waitSettled(timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const off = pi.on("settled", () => {
      if (done) return;
      done = true;
      off();
      resolve("settled");
    });
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      off();
      resolve("timeout");
    }, timeoutMs);
    t.unref?.();
  });
}

const results = [];
let engineModels = [];
try {
  engineModels = (await pi.getAvailableModels()) || [];
} catch {
  /* alguns motores não expõem a lista; seguimos sem ela */
}

function engineEntry(provider, id) {
  if (!Array.isArray(engineModels)) return null;
  return (
    engineModels.find((m) => m?.provider === provider && (m.id === id || m.name === id)) ||
    engineModels.find((m) => m?.id === id) ||
    null
  );
}

for (const m of models) {
  const row = {
    provider: m.provider,
    id: m.id,
    config: null,
    engine: null,
    imageConfig: null,
    imageEngine: null,
    status: "ok",
    note: "",
  };
  try {
    await pi.setModel(m.provider, m.id);
    const levels = await pi._rpc?.getAvailableThinkingLevels?.();
    row.engine = Array.isArray(levels) ? levels.join(",") : String(levels ?? "—");
    row.config = (effortLevelsFor(m.provider, m.id) || []).join(",") || "—";
    row.imageConfig = supportsImage(m.provider, m.id) ? "sim" : "não";

    const entry = engineEntry(m.provider, m.id);
    const input = entry?.input;
    row.imageEngine = Array.isArray(input) ? (input.includes("image") ? "sim" : "não") : "—";
    const state = await pi.getState().catch(() => ({}));
    const current = state?.model;
    if (!current || current.id !== m.id || current.provider !== m.provider) {
      row.status = "FALHA";
      row.note = "modelo não ficou ativo após setModel";
    }

    const engineLevels = String(row.engine || "").split(",").filter(Boolean);
    const configLevels = String(row.config || "").split(",").filter(Boolean);
    if (
      row.status === "ok" &&
      configLevels.length > 0 &&
      engineLevels.length > 0 &&
      configLevels.join("|") !== engineLevels.join("|")
    ) {
      row.status = "DIVERGE";
      row.note = `config=[${row.config}] motor=[${row.engine}]`;
    }
    if (row.status === "ok" && row.imageEngine !== "—" && row.imageConfig !== row.imageEngine) {
      row.status = "DIVERGE";
      row.note = `imagem config=${row.imageConfig} motor=${row.imageEngine}`;
    }

    if (withPrompt && row.status === "ok") {
      const settled = waitSettled(25_000);
      let answer = "";
      const off = pi.on("text", (d) => (answer += String(d)));
      const t0 = Date.now();
      await pi.prompt("Responda apenas: OK").catch((err) => {
        row.status = "ERRO";
        row.note = String(err.message || err).slice(0, 90);
      });
      const fim = await settled;
      off();
      if (!answer.trim() && fim === "settled" && typeof pi.getLastAssistantText === "function") {
        answer = String((await pi.getLastAssistantText().catch(() => "")) || "");
      }
      row.note = row.note || `${fim} · ${Date.now() - t0}ms · ${answer.trim().slice(0, 18)}`;
      if (!answer.trim()) {
        row.status = row.status === "ok" ? "SEM_TEXTO" : row.status;
      }
      // Um timeout deixa o motor processando; sem abort o próximo modelo
      // herda o erro "Agent is already processing" e a varredura vira ruído.
      if (fim === "timeout" || row.status === "ERRO") {
        await pi.abort().catch(() => {});
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  } catch (err) {
    row.status = "ERRO";
    row.note = String(err.message || err).slice(0, 100);
  }
  results.push(row);
  const mark = row.status === "ok" ? "✓" : "✗";
  console.log(
    `${mark} ${row.provider.padEnd(6)} ${row.id.padEnd(46)} efforts=${String(row.engine).padEnd(24)} img=${String(row.imageEngine).padEnd(3)} ${row.status}${row.note ? " · " + row.note : ""}`,
  );
}

await pi.close().catch(() => {});

const bad = results.filter((r) => r.status !== "ok");
console.log(`\nTotal: ${results.length} · ok: ${results.length - bad.length} · divergências/falhas: ${bad.length}`);
if (bad.length) {
  console.log("\nProblemas:");
  for (const r of bad) console.log(`  ${r.provider}/${r.id}: ${r.status} ${r.note}`);
}
process.exit(bad.length ? 1 : 0);
