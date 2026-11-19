#!/usr/bin/env node
/**
 * Grupo B (ferramenta) — executor do grafo (core/graph/executor.mjs).
 * Percorre o grafo em ordem topológica e executa cada nó. Verifica: ordem
 * respeitando dependsOn, gate humano que para a execução (nós seguintes ficam
 * skipped), autoApprove que passa o humano, e nó que lança marcado failed com
 * dependentes bloqueados.
 * Determinístico, sem chamadas de modelo.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { createGraph } = await import(pathToFileURL(path.join(ROOT, "core", "graph", "model.mjs")).href);
const { createExecutor } = await import(pathToFileURL(path.join(ROOT, "core", "graph", "executor.mjs")).href);

const failures = [];

// 1. ordem topológica, todos done
{
  const graph = createGraph({
    nodes: [
      { id: "a", kind: "task" },
      { id: "b", kind: "task", dependsOn: ["a"] },
      { id: "c", kind: "task", dependsOn: ["b"] },
    ],
  });
  const order = [];
  const res = await createExecutor({ graph, runNode: async (node) => { order.push(node.id); return node.id; } });
  if (res.status !== "completed") failures.push(`status "${res.status}", esperado "completed"`);
  if (order.join(",") !== "a,b,c") failures.push(`ordem ${order.join(",")}, esperado a,b,c`);
  if (!res.nodes.every((n) => n.status === "done")) failures.push("nem todos os nós ficaram done");
}

// 2. gate humano para a execução; nós seguintes ficam skipped
{
  const graph = createGraph({
    nodes: [
      { id: "a", kind: "task" },
      { id: "h", kind: "human", dependsOn: ["a"] },
      { id: "b", kind: "task", dependsOn: ["h"] },
    ],
  });
  const ran = [];
  const res = await createExecutor({ graph, runNode: async (node) => { ran.push(node.id); } });
  if (res.status !== "waiting-human") failures.push(`status "${res.status}", esperado "waiting-human"`);
  if (res.waitingFor !== "h") failures.push(`waitingFor ${res.waitingFor}, esperado "h"`);
  const b = res.nodes.find((n) => n.id === "b");
  if (b?.status !== "skipped") failures.push(`nó b após gate: status ${b?.status}, esperado "skipped"`);
  if (ran.includes("b")) failures.push("nó b rodou depois do gate humano (não deveria)");
}

// 3. autoApprove atravessa o humano e conclui
{
  const graph = createGraph({
    nodes: [
      { id: "a", kind: "task" },
      { id: "h", kind: "human", dependsOn: ["a"] },
      { id: "b", kind: "task", dependsOn: ["h"] },
    ],
  });
  const res = await createExecutor({ graph, runNode: async (node) => node.id, autoApprove: true });
  if (res.status !== "completed") failures.push(`autoApprove: status "${res.status}", esperado "completed"`);
}

// 4. nó que lança: failed, dependente bloqueado
{
  const graph = createGraph({
    nodes: [
      { id: "a", kind: "task" },
      { id: "b", kind: "task", dependsOn: ["a"] },
    ],
  });
  const res = await createExecutor({
    graph,
    runNode: async (node) => {
      if (node.id === "a") throw new Error("boom");
      return node.id;
    },
  });
  if (res.status !== "failed") failures.push(`status "${res.status}", esperado "failed"`);
  const a = res.nodes.find((n) => n.id === "a");
  const b = res.nodes.find((n) => n.id === "b");
  if (a?.status !== "failed") failures.push(`nó a: status ${a?.status}, esperado "failed"`);
  if (b?.status !== "blocked") failures.push(`nó b: status ${b?.status}, esperado "blocked"`);
}

if (failures.length > 0) {
  console.error("falhou:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { casos: 4 } }));
console.error("ok: executor respeita ordem, gate humano, autoApprove e nó que falha");