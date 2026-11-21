/**
 * selfevopi-harness-store — persistência da ponte grafo↔desktop (Fase 4).
 *
 * Sem dependências. Node ESM puro. Windows nativo (sem `.sh`).
 *
 * Grava **um arquivo por run** em `.pi/harness/graph/` (formato da ponte,
 * `harness-state.mjs`) e um `index.json` com a lista de runs — é o que a leitura
 * lê sem varrer diretório.
 *
 * Escrita atômica (tmp + rename). JSON indentado, legível.
 *
 * Contrato:
 *   const store = createHarnessStore({ dir })
 *   await store.save(runId, state)   -> grava <dir>/<runId>.json + atualiza index.json
 *   await store.load(runId)          -> doc | null
 *   await store.list()               -> [{ runId, status, startedAt, updatedAt, nodes, progress }]
 */

import { mkdir, readFile, rename, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const VALID_ID = /^[A-Za-z0-9._-]+$/;

function assertId(runId) {
  if (typeof runId !== "string" || !VALID_ID.test(runId)) {
    throw new Error(`harness-store: runId inválido "${runId}" (use letras, números, . _ -)`);
  }
}

/** Escreve um arquivo atomicamente: tmp no mesmo dir + rename. */
async function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
}

/**
 * Cria o store da ponte.
 * @param {object} [opts]
 * @param {string} [opts.dir=".pi/harness/graph"] pasta base (uma pasta por run + index.json)
 */
export function createHarnessStore({ dir = ".pi/harness/graph" } = {}) {
  function runFile(runId) {
    return join(dir, `${runId}.json`);
  }

  async function ensureDir() {
    await mkdir(dir, { recursive: true });
  }

  /** Resumo de um doc para o index.json (sem o corpo completo dos nós). */
  function summarize(runId, doc) {
    const nodes = Array.isArray(doc?.nodes) ? doc.nodes : [];
    const total = nodes.length;
    const done = nodes.filter((n) => n.status === "done").length;
    const failed = nodes.filter((n) => n.status === "failed").length;
    const skipped = nodes.filter((n) => n.status === "skipped" || n.status === "blocked").length;
    return {
      runId,
      status: doc?.status ?? "pending",
      startedAt: doc?.startedAt ?? null,
      updatedAt: doc?.updatedAt ?? null,
      nodes: total,
      progress: total > 0 ? done / total : 0,
      done,
      failed,
      skipped,
    };
  }

  async function readIndex() {
    const raw = await readFile(join(dir, "index.json"), "utf8").catch(() => null);
    if (!raw) return { version: 1, runs: [] };
    try {
      const doc = JSON.parse(raw);
      if (!Array.isArray(doc.runs)) doc.runs = [];
      return doc;
    } catch {
      return { version: 1, runs: [] };
    }
  }

  async function writeIndex(index) {
    // mantém o index ordenado por updatedAt desc (mais recente primeiro)
    index.runs.sort((a, b) => Date.parse(b.updatedAt ?? 0) - Date.parse(a.updatedAt ?? 0));
    await writeAtomic(join(dir, "index.json"), JSON.stringify(index, null, 2) + "\n");
  }

  /**
   * Salva um run e atualiza o index.json.
   * @param {string} runId
   * @param {object} doc  documento da ponte (harness-state)
   */
  async function save(runId, doc) {
    assertId(runId);
    await ensureDir();
    await writeAtomic(runFile(runId), JSON.stringify(doc, null, 2) + "\n");

    const index = await readIndex();
    const entry = summarize(runId, doc);
    const at = index.runs.findIndex((r) => r.runId === runId);
    if (at >= 0) index.runs[at] = entry;
    else index.runs.push(entry);
    await writeIndex(index);
    return entry;
  }

  /** Carrega um run (doc da ponte) ou null. */
  async function load(runId) {
    assertId(runId);
    const raw = await readFile(runFile(runId), "utf8").catch(() => null);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /** Lista os runs (do index.json). */
  async function list() {
    const index = await readIndex();
    return index.runs;
  }

  /** Lista os runIds que têm arquivo (varre o diretório; útil p/ reparar index). */
  async function listFiles() {
    const entries = await readdir(dir).catch(() => []);
    return entries.filter((f) => f.endsWith(".json") && f !== "index.json").map((f) => f.replace(/\.json$/, ""));
  }

  return { dir, save, load, list, listFiles };
}