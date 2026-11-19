#!/usr/bin/env node
/**
 * Grupo C (regressao) — nenhum segredo pode estar versionado no Git.
 *
 * Duas varreduras sobre `git ls-files`:
 *   1. nome do arquivo: *.key, *.pem, *.p12, *.pfx, .env(.local), credentials.json, models.json
 *   2. conteudo: chave privada ("-----BEGIN ... PRIVATE KEY-----") e JWT (eyJ...eyJ...)
 *
 * Determinístico. Nunca imprime o conteúdo do arquivo, apenas o caminho.
 * Sem repositório Git: passa com metrics.git = false (não há o que vazar).
 */
import { readFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

// Nome de arquivo sensível. Mesma regra do check-gitignore-secrets.mjs.
const NAME_RE = /\.(key|pem|p12|pfx)$|(^|\/)\.env($|\.)|credentials\.json$|models\.json$/;

// Padrões de conteúdo. Montados como RegExp para que este próprio arquivo não case
// consigo mesmo (o texto-fonte contém apenas a forma literal, não a casada).
const CONTENT_RES = [
  { label: "chave privada", re: new RegExp("-----BEGIN [A-Z ]*PRIVATE KEY-----") },
  { label: "JWT", re: new RegExp("eyJ[A-Za-z0-9_\\-]{10,}\\.eyJ[A-Za-z0-9_\\-]{10,}") },
];

// Acima disso o arquivo não é lido (evita binários e travamentos); conta em skipped.
const MAX_BYTES = 1_048_576;

function listTracked() {
  try {
    const out = execFileSync("git", ["-C", ROOT, "ls-files", "-z"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 32 * 1024 * 1024,
    });
    return out.split("\0").filter((line) => line.length > 0);
  } catch {
    return null; // sem git
  }
}

const tracked = listTracked();

if (tracked === null) {
  console.log(JSON.stringify({ tokens: 0, metrics: { git: false, trackedFiles: 0 } }));
  console.error("ok: sem repositorio git, nada versionado para vazar");
  process.exit(0);
}

const problems = [];
const byName = [];
const byContent = [];
let skipped = 0;

for (const rel of tracked) {
  if (NAME_RE.test(rel)) {
    byName.push(rel);
    continue;
  }

  const abs = path.join(ROOT, rel);
  let size;
  try {
    size = (await stat(abs)).size;
  } catch {
    continue;
  }
  if (size > MAX_BYTES) {
    skipped++;
    continue;
  }

  let text;
  try {
    text = await readFile(abs, "utf8");
  } catch {
    continue; // binário ou ilegível: nada a inspecionar
  }
  if (text.includes("\0")) continue;

  for (const { label, re } of CONTENT_RES) {
    if (re.test(text)) {
      byContent.push(`${rel} (${label})`);
      break;
    }
  }
}

for (const f of byName) problems.push(`nome sensivel versionado: ${f}`);
for (const f of byContent) problems.push(`conteudo de segredo versionado: ${f}`);

if (problems.length > 0) {
  console.error("segredos versionados no git:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}

console.log(
  JSON.stringify({
    tokens: 0,
    metrics: { git: true, trackedFiles: tracked.length, skipped },
  })
);
console.error(`ok: ${tracked.length} arquivos rastreados, nenhum segredo`);