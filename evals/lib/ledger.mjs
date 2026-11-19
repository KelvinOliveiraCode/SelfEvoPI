/**
 * ledger.mjs — trilha JSONL append-only do SelfEvoPI.
 *
 * Cada linha e um registro de uma tarefa executada. Append-only de proposito:
 * a trilha e a fonte de verdade para auditoria, regressão e custo.
 */

import { appendFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";

export function record({
  taskId,
  group,
  passed,
  durationMs,
  tokens = 0,
  costUsd = 0,
  attempt = 1,
  runner = "local",
  error = null,
  metrics = {},
  at = new Date().toISOString(),
}) {
  return {
    at,
    taskId,
    group,
    passed: Boolean(passed),
    durationMs: Math.round(durationMs ?? 0),
    tokens: Number(tokens) || 0,
    costUsd: Number(costUsd) || 0,
    attempt,
    runner,
    error: error ? String(error).slice(0, 400) : null,
    metrics,
  };
}

export async function append(filePath, entries) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const lines = entries.map((e) => JSON.stringify(e)).join("\n");
  await appendFile(filePath, lines + "\n", "utf8");
}

export async function read(filePath) {
  const text = await readFile(filePath, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch {
        return { parseError: true, line: i + 1, raw: line.slice(0, 200) };
      }
    })
    .filter((r) => !r.parseError);
}