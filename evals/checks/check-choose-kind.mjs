#!/usr/bin/env node
/**
 * Grupo A (codigo) — chooseKind do Forge (core/forge/contract.mjs).
 * Escolhe o kind mais leve que atende às capacidades pedidas, cobre tudo quando
 * possível e, quando nada cobre, devolve o mais leve com menos faltas.
 * Determinístico, sem chamadas de modelo.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { chooseKind, ARTIFACT_KINDS } = await import(pathToFileURL(path.join(ROOT, "core", "forge", "contract.mjs")).href);

const failures = [];

function expectKind(cands, want) {
  const r = chooseKind(cands);
  if (r.kind !== want) failures.push(`chooseKind(${JSON.stringify(cands)}) = "${r.kind}", esperado "${want}"`);
  if (!Array.isArray(r.ranked) || r.ranked.length !== ARTIFACT_KINDS.length) {
    failures.push(`chooseKind(${JSON.stringify(cands)}).ranked incompleto`);
  }
  return r;
}

// 1. "config" e "mcp" são entregues pelo kind mais leve: mcp-config
{
  const r = expectKind(["config"], "mcp-config");
  if (r.missing.length !== 0) failures.push(`config deveria estar coberto, faltas ${r.missing.join(",")}`);
}

// 2. "skill" exige pelo menos o kind skill
expectKind(["skill"], "skill");

// 3. "cli" exige o kind cli
expectKind(["cli"], "cli");

// 4. "server" só o mcp-server entrega
expectKind(["server"], "mcp-server");

// 5. combinação config+cli: o cli cobre tudo e é o mais leve que cobre
{
  const r = expectKind(["config", "cli"], "cli");
  if (r.missing.length !== 0) failures.push(`config+cli deveria estar coberto, faltas ${r.missing.join(",")}`);
}

// 6. capacidade desconhecida: ninguém cobre; devolve o mais leve com a falta
{
  const r = expectKind(["zzz"], "mcp-config");
  if (r.missing.join(",") !== "zzz") failures.push(`faltas ${r.missing.join(",")}, esperado "zzz"`);
}

// 7. entrada string (não array) é aceita
expectKind("config", "mcp-config");

if (failures.length > 0) {
  console.error("falhou:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log(JSON.stringify({ tokens: 0, metrics: { casos: 7 } }));
console.error("ok: chooseKind escolhe o kind mais leve que cobre o pedido");