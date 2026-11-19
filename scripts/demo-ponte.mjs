/**
 * demo-p ponte — uma execução de verdade passando pela ponte do desktop.
 *
 * Sobe um grafo de 4 nós (com um nó humano no meio), executa com `harness: true`,
 * e mostra o que um desktop leria: o `index.json` e o `harness-state` da execução.
 *
 * Uso: node scripts/demo-ponte.mjs
 */

import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { createGraph } from "../core/graph/model.mjs";
import { createRuntime } from "../core/graph/runtime.mjs";
import { createHarnessStore } from "../core/graph/harness-store.mjs";
import { renderAscii, renderHtml } from "../core/graph/panel.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const RUN_DIR = path.join(ROOT, ".pi", "harness", "graph");

const graph = createGraph({
  nodes: [
    { id: "n1", label: "detectar lacuna", kind: "task" },
    { id: "n2", label: "especificar contrato", kind: "task", dependsOn: ["n1"] },
    { id: "n3", label: "aprovar artefato", kind: "human", dependsOn: ["n2"] },
    { id: "n4", label: "promover", kind: "task", dependsOn: ["n3"] },
  ],
  edges: [],
});

const store = createHarnessStore({ dir: RUN_DIR });

async function main() {
  const rt = createRuntime({
    graph,
    runId: "run-demo-ponte",
    harness: true,
    harnessStore: store,
    harnessMeta: { sha: "0000000", label: "demonstração da ponte" },
    autoApprove: true,
    runNode: async (node, { state }) => {
      state[node.id] = { done: true };
      return { node: node.id, ok: true };
    },
  });

  process.stdout.write("executando o grafo com harness: true...\n");
  const res = await rt.run();
  process.stdout.write(`status: ${res.status}\n\n`);

  process.stdout.write("--- o que o grafo produziu (ASCII) ---\n");
  const snap = {
    runId: "run-demo-ponte",
    status: res.status,
    nodes: {},
    order: [],
    waitingFor: null,
  };
  for (const n of graph.nodes) {
    const rec = rt.status().nodes.find((x) => x.id === n.id);
    snap.nodes[n.id] = { id: n.id, label: n.label, kind: n.kind, status: rec?.status ?? "pending" };
    snap.order.push(n.id);
  }
  process.stdout.write(renderAscii(graph, snap) + "\n");

  const index = await readFile(path.join(RUN_DIR, "index.json"), "utf8");
  process.stdout.write("\n--- index.json (o que um desktop le sem varrer diretorio) ---\n");
  process.stdout.write(JSON.stringify(JSON.parse(index), null, 2) + "\n");

  const state = await readFile(path.join(RUN_DIR, "run-demo-ponte.json"), "utf8");
  process.stdout.write("\n--- harness-state (git-nativo) ---\n");
  process.stdout.write(JSON.stringify(JSON.parse(state), null, 2).slice(0, 1400) + "\n");

  const html = renderHtml({ runs: JSON.parse(index).runs, indexUrl: "./index.json" });
  const out = path.join(RUN_DIR, "painel-demo.html");
  await writeFile(out, html, "utf8");
  process.stdout.write(`\n--- painel HTML (abra no navegador) ---\n${out}\n`);
}

try {
  await main();
} finally {
  // limpa os arquivos de demonstração para não deixar lixo versionado
  for (const f of ["run-demo-ponte.json", "index.json", "painel-demo.html"]) {
    await rm(path.join(RUN_DIR, f), { force: true });
  }
  void mkdtemp;
}