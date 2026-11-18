/**
 * selfevopi-forge-generate-skill — gera o artefato mais leve da hierarquia.
 *
 * Sem dependencias externas (só node:fs, node:path). Dado um pedido de
 * artefato válido (createArtifactRequest) de kind "skill", escreve em outDir:
 *   - SKILL.md   (frontmatter name/description + objetivo, entradas, saídas,
 *                 o que NÃO pode fazer, e como verificar)
 *   - verify.mjs (script executável que roda request.tests e sai 0 só se
 *                 todos passarem — a evidência que o gatekeeper exige)
 *
 * Não executa o verify aqui; devolve o comando para o chamador rodar.
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** "Detecção de mudanças" -> "detecao-de-mudancas" (slug estável, ASCII). */
function slugify(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Primeira linha/frase do goal, para a descrição do frontmatter. */
function describe(goal) {
  const oneLine = String(goal).replace(/\s+/g, " ").trim();
  return oneLine.length > 140 ? `${oneLine.slice(0, 137)}...` : oneLine;
}

function renderList(items) {
  if (!items || items.length === 0) return "_nenhum_";
  return items.map((i) => `- ${i}`).join("\n");
}

function renderMap(map) {
  const entries = Object.entries(map ?? {});
  if (entries.length === 0) return "_nenhum_";
  return entries.map(([k, v]) => `- \`${k}\` — ${v}`).join("\n");
}

/* ------------------------------------------------------------------ */
/* SKILL.md                                                            */
/* ------------------------------------------------------------------ */

function renderSkillMd(request) {
  const name = slugify(request.goal) || "skill";
  const description = describe(request.goal);

  return `---
name: ${name}
description: ${description}
---

# ${description}

## Objetivo

${request.goal}

## Entradas

${renderMap(request.inputs)}

## Saídas

${renderMap(request.outputs)}

## O que NÃO pode fazer

${renderList(request.forbidden)}

## Verificação

Execute \`node verify.mjs\`. Ele sai 0 somente se todos os testes passarem:

${renderList(request.tests.map((t) => `\`${t.name}\` — \`${t.command}\``))}
`;
}

/* ------------------------------------------------------------------ */
/* verify.mjs                                                          */
/* ------------------------------------------------------------------ */

// O verify.mjs é o mesmo dos outros geradores: um só renderizador, para que o
// comportamento (rodar no diretório do artefato, casar `expect` na saída) não
// possa divergir entre kinds. Antes havia duas cópias, e a daqui não tinha `cwd`.
import { renderVerify } from "./generate-cli.mjs";

/* ------------------------------------------------------------------ */
/* generateSkill                                                       */
/* ------------------------------------------------------------------ */

/**
 * Gera uma skill em outDir a partir de um request de kind "skill".
 *
 * @param {object} request  request de createArtifactRequest (kind "skill")
 * @param {string} outDir   diretório de saída (criado se não existir)
 * @returns {{ path: string, files: string[], verifyCommand: string }}
 */
export async function generateSkill(request, outDir) {
  if (!request || typeof request !== "object") {
    throw new Error("forge-generate-skill: request inválido");
  }
  if (request.kind !== "skill") {
    throw new Error(`forge-generate-skill: kind deve ser "skill", veio "${request.kind}"`);
  }
  if (!outDir || typeof outDir !== "string") {
    throw new Error("forge-generate-skill: outDir é obrigatório");
  }

  const skillPath = join(outDir, "SKILL.md");
  if (await exists(skillPath)) {
    throw new Error(`forge-generate-skill: já existe SKILL.md em ${outDir} (recusa sobrescrever)`);
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(skillPath, renderSkillMd(request), "utf8");

  const verifyPath = join(outDir, "verify.mjs");
  await writeFile(verifyPath, renderVerify(request), "utf8");

  return {
    path: outDir,
    files: ["SKILL.md", "verify.mjs"],
    verifyCommand: `node ${verifyPath}`,
  };
}