import test from "node:test";
import assert from "node:assert/strict";

import { mkdtemp, mkdir, rm, writeFile, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  scanSource,
  scanTarget,
  planImport,
  applyImport,
  undoImport,
  SOURCE_MCP_FILES,
  TARGET_SETTINGS_SUBDIR,
  TARGET_SKILLS_SUBDIR,
} from "./import.mjs";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const homes = [];

async function novoHome() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "selfevopi-import-"));
  homes.push(dir);
  return dir;
}

/** Escreve a config OpenCode na fonte (~/.config/opencode/opencode.jsonc). */
async function escreverFonteMcp(home, body) {
  const dir = path.join(home, ".config", "opencode");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "opencode.jsonc");
  await writeFile(file, body, "utf8");
  return file;
}

/** Escreve uma skill na fonte OpenCode (~/.config/opencode/skills/<nome>/SKILL.md). */
async function escreverFonteSkill(home, nome, body) {
  const dir = path.join(home, ".config", "opencode", "skills", nome);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "SKILL.md");
  await writeFile(file, body, "utf8");
  return file;
}

/** Escreve ~/.pi/settings.json (alvo). */
async function escreverAlvoSettings(home, doc) {
  const file = path.join(home, TARGET_SETTINGS_SUBDIR);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof doc === "string" ? doc : JSON.stringify(doc, null, 2), "utf8");
  return file;
}

/** Escreve uma skill no alvo (~/.pi/skills/<nome>/SKILL.md). */
async function escreverAlvoSkill(home, nome, body) {
  const dir = path.join(home, TARGET_SKILLS_SUBDIR, nome);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "SKILL.md");
  await writeFile(file, body, "utf8");
  return file;
}

const SKILL_A = `---
name: skill-a
description: descrição A
---

corpo A
`;

const SKILL_B = `---
name: skill-b
description: descrição B
---

corpo B
`;

test.after(async () => {
  for (const dir of homes) await rm(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/* scanSource                                                          */
/* ------------------------------------------------------------------ */

test("scanSource devolve origemExiste false quando não há fonte", async () => {
  const home = await novoHome();
  const src = await scanSource({ home });
  assert.equal(src.origemExiste, false);
  assert.equal(src.configPath, null);
  assert.deepEqual(src.mcpServers, []);
  assert.deepEqual(src.skills, []);
});

test("scanSource lê MCPs e skills da fonte OpenCode", async () => {
  const home = await novoHome();
  await escreverFonteMcp(
    home,
    JSON.stringify({
      mcp: {
        servers: {
          fake: { type: "local", command: ["node", "server.mjs"] },
        },
      },
    })
  );
  await escreverFonteSkill(home, "skill-a", SKILL_A);

  const src = await scanSource({ home });
  assert.equal(src.origemExiste, true);
  assert.equal(src.mcpServers.length, 1);
  assert.equal(src.mcpServers[0].name, "fake");
  assert.equal(src.skills.length, 1);
  assert.equal(src.skills[0].nome, "skill-a");
  assert.equal(src.skills[0].name, "skill-a");
});

test("scanSource não quebra com fonte ausente de skills", async () => {
  const home = await novoHome();
  await escreverFonteMcp(home, JSON.stringify({ mcpServers: { x: { command: "node" } } }));
  const src = await scanSource({ home });
  assert.equal(src.mcpServers.length, 1);
  assert.deepEqual(src.skills, []);
});

/* ------------------------------------------------------------------ */
/* scanTarget                                                          */
/* ------------------------------------------------------------------ */

test("scanTarget devolve conjuntos vazios quando ~/.pi não existe", async () => {
  const home = await novoHome();
  const tgt = await scanTarget({ home });
  assert.equal(tgt.mcpNomes.size, 0);
  assert.equal(tgt.skillNomes.size, 0);
});

test("scanTarget lê MCPs e skills já existentes no alvo", async () => {
  const home = await novoHome();
  await escreverAlvoSettings(home, { mcpServers: { existente: { command: "node" } } });
  await escreverAlvoSkill(home, "skill-a", SKILL_A);

  const tgt = await scanTarget({ home });
  assert.ok(tgt.mcpNomes.has("existente"));
  assert.ok(tgt.skillNomes.has("skill-a"));
});

/* ------------------------------------------------------------------ */
/* planImport                                                          */
/* ------------------------------------------------------------------ */

test("planImport separa adicionar vs manter (existente vence)", async () => {
  const home = await novoHome();
  // fonte tem: mcp1, mcp2, skill-a, skill-b
  await escreverFonteMcp(
    home,
    JSON.stringify({
      mcpServers: {
        mcp1: { type: "local", command: "node" },
        mcp2: { type: "local", command: "node" },
      },
    })
  );
  await escreverFonteSkill(home, "skill-a", SKILL_A);
  await escreverFonteSkill(home, "skill-b", SKILL_B);
  // alvo já tem: mcp1, skill-a
  await escreverAlvoSettings(home, { mcpServers: { mcp1: { command: "node" } } });
  await escreverAlvoSkill(home, "skill-a", SKILL_A);

  const plano = await planImport({ home });
  assert.equal(plano.origemExiste, true);
  // mcp1 já existe → skip; mcp2 novo → add
  assert.deepEqual(plano.mcpAdd.map((s) => s.name), ["mcp2"]);
  assert.deepEqual(plano.mcpSkip.map((s) => s.name), ["mcp1"]);
  // skill-a já existe → skip; skill-b nova → add
  assert.deepEqual(plano.skillsAdd.map((s) => s.nome), ["skill-b"]);
  assert.deepEqual(plano.skillsSkip.map((s) => s.nome), ["skill-a"]);
});

test("planImport origemExiste false quando não há fonte", async () => {
  const home = await novoHome();
  const plano = await planImport({ home });
  assert.equal(plano.origemExiste, false);
  assert.deepEqual(plano.mcpAdd, []);
  assert.deepEqual(plano.skillsAdd, []);
});

/* ------------------------------------------------------------------ */
/* applyImport                                                         */
/* ------------------------------------------------------------------ */

test("applyImport copia MCPs e skills novas e cria manifesto", async () => {
  const home = await novoHome();
  await escreverFonteMcp(
    home,
    JSON.stringify({ mcpServers: { novo: { type: "local", command: "node", args: ["s.mjs"] } } })
  );
  await escreverFonteSkill(home, "skill-nova", SKILL_A);

  const resultado = await applyImport({ home });

  // MCP copiado
  assert.deepEqual(resultado.added.mcp, ["novo"]);
  const settings = JSON.parse(await readFile(path.join(home, TARGET_SETTINGS_SUBDIR), "utf8"));
  assert.ok(settings.mcpServers.novo);
  assert.equal(settings.mcpServers.novo.command, "node");

  // skill copiada
  assert.deepEqual(resultado.added.skills, ["skill-nova"]);
  const skillPath = path.join(home, TARGET_SKILLS_SUBDIR, "skill-nova", "SKILL.md");
  assert.ok(existsSync(skillPath));
  assert.equal(await readFile(skillPath, "utf8"), SKILL_A);

  // manifesto criado
  assert.ok(resultado.manifest);
  assert.ok(existsSync(resultado.manifest));
  const manifesto = JSON.parse(await readFile(resultado.manifest, "utf8"));
  assert.deepEqual(manifesto.mcpAdicionados, ["novo"]);
  assert.deepEqual(manifesto.skillsAdicionadas, ["skill-nova"]);
});

test("applyImport não sobrescreve o que já existe no alvo", async () => {
  const home = await novoHome();
  // fonte: mcp1 (command node), skill-a
  await escreverFonteMcp(
    home,
    JSON.stringify({ mcpServers: { mcp1: { type: "local", command: "node" } } })
  );
  await escreverFonteSkill(home, "skill-a", SKILL_A);
  // alvo já tem mcp1 com command "python" (diferente) e skill-a com outro conteúdo
  await escreverAlvoSettings(home, { mcpServers: { mcp1: { command: "python" } } });
  await escreverAlvoSkill(home, "skill-a", "skill-a original do usuario");

  const resultado = await applyImport({ home });

  // nada adicionado
  assert.deepEqual(resultado.added.mcp, []);
  assert.deepEqual(resultado.added.skills, []);
  // mcp1 mantém command "python" (não sobrescrito)
  const settings = JSON.parse(await readFile(path.join(home, TARGET_SETTINGS_SUBDIR), "utf8"));
  assert.equal(settings.mcpServers.mcp1.command, "python");
  // skill-a mantém conteúdo original
  const skillPath = path.join(home, TARGET_SKILLS_SUBDIR, "skill-a", "SKILL.md");
  assert.equal(await readFile(skillPath, "utf8"), "skill-a original do usuario");
});

test("applyImport faz backup do settings.json existente", async () => {
  const home = await novoHome();
  await escreverFonteMcp(
    home,
    JSON.stringify({ mcpServers: { novo: { type: "local", command: "node" } } })
  );
  // alvo preexistente
  await escreverAlvoSettings(home, { mcpServers: { antigo: { command: "node" } } });

  const resultado = await applyImport({ home });

  assert.ok(resultado.backup);
  assert.ok(existsSync(resultado.backup), "backup deveria existir");
  // o backup tem o conteúdo antigo (só 'antigo', sem 'novo')
  const backupDoc = JSON.parse(await readFile(resultado.backup, "utf8"));
  assert.ok(backupDoc.mcpServers.antigo);
  assert.ok(!backupDoc.mcpServers.novo, "backup é de antes do merge");
});

test("applyImport é idempotente (2ª rodada não duplica)", async () => {
  const home = await novoHome();
  await escreverFonteMcp(
    home,
    JSON.stringify({ mcpServers: { novo: { type: "local", command: "node" } } })
  );
  await escreverFonteSkill(home, "skill-nova", SKILL_A);

  await applyImport({ home });
  const segunda = await applyImport({ home });

  // segunda rodada: tudo já existe, nada adicionado
  assert.deepEqual(segunda.added.mcp, []);
  assert.deepEqual(segunda.added.skills, []);
});

test("applyImport com origem ausente não escreve nada", async () => {
  const home = await novoHome();
  const resultado = await applyImport({ home });
  assert.equal(resultado.backup, null);
  assert.equal(resultado.manifest, null);
  assert.deepEqual(resultado.added.mcp, []);
});

/* ------------------------------------------------------------------ */
/* undoImport                                                          */
/* ------------------------------------------------------------------ */

test("undoImport restaura o backup e apaga as skills criadas", async () => {
  const home = await novoHome();
  // alvo preexistente com mcp antigo
  await escreverAlvoSettings(home, { mcpServers: { antigo: { command: "node" } } });
  // fonte com mcp novo + skill nova
  await escreverFonteMcp(
    home,
    JSON.stringify({ mcpServers: { novo: { type: "local", command: "node" } } })
  );
  await escreverFonteSkill(home, "skill-nova", SKILL_A);

  // importa
  const imp = await applyImport({ home });
  // sanity: settings agora tem antigo + novo; skill-nova existe
  let settings = JSON.parse(await readFile(path.join(home, TARGET_SETTINGS_SUBDIR), "utf8"));
  assert.ok(settings.mcpServers.antigo && settings.mcpServers.novo);
  assert.ok(existsSync(path.join(home, TARGET_SKILLS_SUBDIR, "skill-nova", "SKILL.md")));

  // desfaz
  const undo = await undoImport({ home });
  assert.equal(undo.restaurado, true);
  assert.deepEqual(undo.skillsRemovidas, ["skill-nova"]);

  // settings restaurado: só 'antigo', sem 'novo'
  settings = JSON.parse(await readFile(path.join(home, TARGET_SETTINGS_SUBDIR), "utf8"));
  assert.ok(settings.mcpServers.antigo);
  assert.ok(!settings.mcpServers.novo, "novo foi removido pelo undo");
  // skill apagada
  assert.equal(existsSync(path.join(home, TARGET_SKILLS_SUBDIR, "skill-nova", "SKILL.md")), false);
});

test("undoImport sem manifesto não faz nada", async () => {
  const home = await novoHome();
  const undo = await undoImport({ home });
  assert.equal(undo.restaurado, false);
  assert.deepEqual(undo.skillsRemovidas, []);
  assert.equal(undo.manifesto, null);
});

test("undoImport só reverte o manifesto mais recente não desfeito", async () => {
  const home = await novoHome();
  await escreverFonteMcp(
    home,
    JSON.stringify({ mcpServers: { a: { type: "local", command: "node" } } })
  );
  // primeiro import
  await applyImport({ home });
  // segundo import (fonte ainda tem 'a', mas já existe; nada novo — só pra ter 2 manifestos)
  await applyImport({ home });

  const undo = await undoImport({ home });
  // reverteu o mais recente; ambos os manifestos existem
  assert.ok(undo.manifesto);
  assert.equal(undo.restaurado, true);
});

/* ------------------------------------------------------------------ */
/* Integração: import → settings legível por listOpencodeMcp           */
/* ------------------------------------------------------------------ */

test("settings.json gerado pelo import é legível por listOpencodeMcp", async () => {
  const home = await novoHome();
  await escreverFonteMcp(
    home,
    JSON.stringify({
      mcpServers: {
        fake: { type: "local", command: [process.execPath, "server.mjs"], environment: { X: "1" } },
      },
    })
  );

  await applyImport({ home });

  // listOpencodeMcp lê ~/.pi/settings.json (passo 1b) — tem que enxergar o servidor importado
  const { listOpencodeMcp } = await import("./mcp-opencode.mjs");
  const servidores = await listOpencodeMcp({ home });
  assert.equal(servidores.length, 1);
  assert.equal(servidores[0].name, "fake");
  assert.equal(servidores[0].command, process.execPath);
  assert.deepEqual(servidores[0].environment, { X: "1" });
});