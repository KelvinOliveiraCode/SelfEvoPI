#!/usr/bin/env node
// Sonda do artefato CLI (gerada pelo Forge).
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));



const r = spawnSync(process.execPath, ["cli.mjs"], {
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


