#!/usr/bin/env node
// Sonda do artefato CLI (gerada pelo Forge).
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));



const r = spawnSync(process.execPath, ["cli.mjs", "--a", "1", "--b", "1"], {
  cwd: AQUI,
  encoding: "utf8",
  timeout: 20000,
});

let json = null;
try {
  json = JSON.parse(String(r.stdout ?? "").trim().split("\n").pop());
} catch {
  json = null;
}

if (r.status !== 0 || json === null) {
  console.error("  saida nao e JSON com exit 0 (exit " + r.status + ")");
  if (r.stderr) console.error("  " + String(r.stderr).trim().split("\n")[0]);
  process.exit(1);
}

// As chaves podem estar no topo ou dentro de "outputs" (convenicao do gerador de template).
const alvo = json && typeof json === "object" && json.outputs && typeof json.outputs === "object" ? json.outputs : json;
const faltando = ["soma"].filter((k) => !(k in alvo));
     if (faltando.length > 0) {
       console.error("  faltando chave(s): " + faltando.join(", "));
       process.exit(1);
     }
