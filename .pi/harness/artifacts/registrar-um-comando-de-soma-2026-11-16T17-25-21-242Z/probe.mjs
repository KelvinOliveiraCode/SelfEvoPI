#!/usr/bin/env node
// Sonda do artefato de extensão (gerada pelo Forge).
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));

const registrados = [];
const pi = {
  on() {},
  registerFlag() {},
  registerCommand(nome, def) {
    registrados.push({ nome, def });
  },
};

const mod = await import(pathToFileURL(join(AQUI, "index.mjs")).href);
const factory = mod.default;
if (typeof factory !== "function") {
  console.error("  index.mjs não exporta uma função de extensão");
  process.exit(1);
}
factory(pi);

if (registrados.length === 0) {
  console.error("  nenhum comando registrado");
  process.exit(1);
}

const cmd = registrados[0];
if (typeof cmd.def?.handler !== "function") {
  console.error("  comando sem handler");
  process.exit(1);
}
// O handler de verdade usa ctx.ui: um ctx minimo evita que uma extensao honesta
// falhe so porque a sonda nao tem interface.
const avisos = [];
const ctx = {
  ui: {
    notify: (m) => avisos.push(String(m)),
    prompt: async () => "",
    confirm: async () => true,
    select: async () => null,
  },
  cwd: AQUI,
};
await cmd.def.handler("", ctx);
console.log("  comando " + cmd.nome + " respondeu " + avisos.length + " aviso(s)");
