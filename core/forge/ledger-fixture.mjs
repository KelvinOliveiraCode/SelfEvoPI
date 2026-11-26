/**
 * ledger-fixture.mjs - caminho de ledger para testes.
 *
 * Usa o ledger real quando ele existe (repositório de desenvolvimento).
 * Quando o release público não traz esse registro, devolve um JSONL mínimo
 * com três falhas de D1-cria-soma, suficiente para exercitar as mesmas regras
 * de detecção e agregação. Nenhum segredo ou dado de execução real é copiado.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function ledgerForTests(root = process.cwd()) {
  const real = path.join(root, ".pi", "harness", "ledger", "evals.jsonl");
  if (existsSync(real)) return real;
  const dir = path.join(os.tmpdir(), "selfevopi-ledger-fixture");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "evals.jsonl");
  const linhas = [1, 2, 3].map((i) => JSON.stringify({
    at: `2026-01-0${i}T00:00:00.000Z`,
    taskId: "D1-cria-soma",
    group: "D",
    passed: false,
    durationMs: 1000,
    tokens: 100,
  }));
  writeFileSync(file, `${linhas.join("\n")}\n`, "utf8");
  return file;
}

export default { ledgerForTests };
