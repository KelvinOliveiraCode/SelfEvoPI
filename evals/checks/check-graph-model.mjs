#!/usr/bin/env node
/**
 * Grupo C (regressão) — validação do grafo (core/graph/model.mjs).
 * Comportamento fundamental que nunca pode degradar: um grafo inválido tem de
 * ser recusado, com o código de erro certo. Verifica id duplicado, dependência
 * desconhecida, ciclo, humano sem tarefa anterior, e que createGraph lança
 * GraphError; e que a ordem topológica respeita dependsOn.
 * Determinístico, sem chamadas de modelo.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { validate, createGraph, topologicalOrder, GraphError } = await import(
  pathToFileURL(path.join(ROOT, "core", "graph", "model.mjs")).href
);

const failures = [];
const hasCode = (result, code) => result.errors.some((e) => e.code === code);

// 1. grafo válido passa
{
  const r = validate({ nodes: [{ id: "a", kind: "task" }, { id: "b", kind: "task", dependsOn: ["a"] }], edges: [] });
  if (!r.ok) failures.push(`grafo válido reprovado: ${r.errors.map((e) => e.code).join(",")}`);
}

// 2. id duplicado
{
  const r = validate({ nodes: [{ id: "a" }, { id: "a" }], edges: [] });
  if (r.ok || !hasCode(r, "duplicate-id")) failures.push("id duplicado não gerou 'duplicate-id'");
}

// 3. dependência desconhecida
{
  const r = validate({ nodes: [{ id: "a", dependsOn: ["zzz"] }], edges: [] });
  if (r.ok || !hasCode(r, "unknown-dependency")) failures.push("dependência desconhecida não gerou 'unknown-dependency'");
}

// 4. ciclo
{
  const r = validate({ nodes: [{ id: "a", dependsOn: ["b"] }, { id: "b", dependsOn: ["a"] }], edges: [] });
  if (r.ok || !hasCode(r, "cycle")) failures.push("ciclo não gerou 'cycle'");
}

// 5. humano sem tarefa anterior
{
  const r = validate({ nodes: [{ id: "h", kind: "human" }], edges: [] });
  if (r.ok || !hasCode(r, "human-without-task")) failures.push("humano sem tarefa não gerou 'human-without-task'");
}

// 6. createGraph lança GraphError em grafo inválido
{
  let ok = false;
  try {
    createGraph({ nodes: [{ id: "a" }, { id: "a" }], edges: [] });
  } catch (err) {
    ok = err instanceof GraphError;
  }
  if (!ok) failures.push("createGraph não lançou GraphError em grafo inválido");
}

// 7. ordem topológica respeita dependsOn
{
  const g = createGraph({
    nodes: [{ id: "a" }, { id: "b", dependsOn: ["a"] }, { id: "c", dependsOn: ["b"] }],
    edges: [],
  });
  const order = topologicalOrder(g);
  if (order.join(",") !== "a,b,c") failures.push(`ordem topológica ${order.join(",")}, esperado a,b,c`);
}

if (failures.length > 0) {
  console.error("falhou:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { casos: 7 } }));
console.error("ok: validate recusa grafo inválido com o código certo e topologia ordena");