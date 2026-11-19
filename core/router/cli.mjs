#!/usr/bin/env node
/**
 * cli.mjs — consulta o roteador SelfEvoPI.
 *
 * Uso:
 *   node core/router/cli.mjs --profile worker
 *   node core/router/cli.mjs --profile reviewer --exclude kilo1
 *   node core/router/cli.mjs --snapshot
 *   node core/router/cli.mjs --profile orchestrator --min-context 500000
 *
 * Nunca imprime chaves: apenas provider, modelo e ref.
 */

import path from "node:path";
import os from "node:os";
import process from "node:process";

import { fromPiConfig } from "./router.mjs";

const argv = process.argv.slice(2);

function flag(name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : fallback;
}

const file = flag("models", path.join(os.homedir(), ".pi", "agent", "models.json"));
const profile = flag("profile", "worker");
const exclude = (flag("exclude") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const minContextRaw = flag("min-context");
const model = flag("model");

let router;
try {
  router = await fromPiConfig(file, { strategy: flag("strategy", "latency") });
} catch (err) {
  console.error(`✗ nao foi possivel carregar ${file}: ${err.message}`);
  console.error("  gere com: node scripts/import-providers.mjs --apply");
  process.exit(2);
}

if (argv.includes("--snapshot")) {
  console.log("provider  family  modelos  circuit");
  for (const p of router.snapshot()) {
    console.log(`  ${p.id.padEnd(8)} ${p.family.padEnd(7)} ${String(p.models).padStart(7)}  ${p.circuit}`);
  }
  process.exit(0);
}

try {
  const pick = router.pick(profile, {
    exclude,
    minContext: minContextRaw ? Number(minContextRaw) : null,
    model,
  });
  console.log(`perfil    ${profile}`);
  console.log(`provider  ${pick.provider}`);
  console.log(`modelo    ${pick.model}`);
  console.log(`ref       ${pick.ref}`);
  if (pick.baseUrl) console.log(`baseurl   ${pick.baseUrl}`);
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}