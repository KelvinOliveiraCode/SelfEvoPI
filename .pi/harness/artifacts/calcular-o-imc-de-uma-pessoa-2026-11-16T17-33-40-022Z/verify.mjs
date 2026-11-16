#!/usr/bin/env node
/**
 * verify.mjs — verificação autogerada pelo Forge.
 * Roda cada teste do pedido e sai 0 só se todos passarem.
 * Quando o teste traz "expect", a saída também precisa casar (substring ou regex).
 */
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Os comandos do pedido são relativos ao artefato, não ao diretório de onde
// o verify foi chamado.
const AQUI = dirname(fileURLToPath(import.meta.url));

const tests = [
  {
    "name": "a skill existe e descreve a capacidade",
    "command": "node -e \"const fs=require('fs');const t=fs.readFileSync('SKILL.md','utf8');if(t.length<40)process.exit(1)\"",
    "expect": null
  }
];

function matchesExpect(stdout, expect) {
  if (!expect) return true;
  const out = String(stdout ?? "");
  try {
    return new RegExp(expect).test(out);
  } catch {
    return out.includes(expect);
  }
}

let failed = 0;
for (const t of tests) {
  const r = spawnSync(t.command, { shell: true, encoding: "utf8", cwd: AQUI });
  const ok = r.status === 0 && matchesExpect(r.stdout, t.expect);
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
