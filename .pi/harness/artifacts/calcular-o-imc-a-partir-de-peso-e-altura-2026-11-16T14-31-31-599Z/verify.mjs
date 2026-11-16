#!/usr/bin/env node
/**
 * verify.mjs — verificação autogerada pelo Forge.
 * Roda cada teste do pedido e sai 0 só se todos passarem.
 */
import { spawnSync } from "node:child_process";

const tests = [
  {
    "name": "smoke",
    "command": "node -e \"process.exit(0)\"",
    "expect": null
  }
];

let failed = 0;
for (const t of tests) {
  const r = spawnSync(t.command, { shell: true, encoding: "utf8" });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log((ok ? "PASS " : "FAIL ") + t.name + "  (" + t.command + ")");
  if (!ok) {
    if (r.stdout && r.stdout.trim()) console.log("  stdout: " + r.stdout.trim());
    if (r.stderr && r.stderr.trim()) console.log("  stderr: " + r.stderr.trim());
    if (t.expect) console.log("  esperado: " + t.expect);
  }
}

if (failed > 0) {
  console.error("\n" + failed + " de " + tests.length + " teste(s) falharam");
  process.exit(1);
}
console.log("\nTodos os " + tests.length + " teste(s) passaram");
