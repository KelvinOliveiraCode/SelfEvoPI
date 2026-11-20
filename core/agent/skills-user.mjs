#!/usr/bin/env node
/**
 * core/agent/skills-user.mjs — reconhecimento das skills do próprio SelfEvoPI.
 *
 * O `/skills` lê `.pi/harness/memory/skills.jsonl` — as skills que o loop
 * evolutivo gerou. Este módulo lista as skills instaladas pelo usuário em
 * `~/.pi/skills/<nome>/SKILL.md` (padrão agentskills.io), que antes não
 * apareciam porque o diretório não existia.
 *
 * Sem dependência (só `node:`). Determinístico. Tolerante: skill com frontmatter
 * quebrado é listada com `error`, não derruba a varredura.
 *
 * Formato do SKILL.md (frontmatter YAML simples entre `---`):
 *
 *   ---
 *   name: accessible-html
 *   description: HTML acessivel em artefatos de design web.
 *   ---
 *
 * `home` é injetável para o teste usar diretório temporário (nunca leia
 * `process.env.HOME` direto no teste).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Diretório padrão das skills do SelfEvoPI, relativo ao home. */
export const DEFAULT_SKILLS_SUBDIR = join(".pi", "skills");

/**
 * Diretórios de skills a varrer (em ordem de precedência):
 *   1. `.pi/skills`       — skills do próprio SelfEvoPI (agentskills.io)
 *   2. `.config/opencode/skills` — skills instaladas pelo OpenCode (as reais)
 *        (mantém compatibilidade com `~/.config/opencode/skills`)
 */
export const DEFAULT_SKILLS_SUBDIRS = [
  join(".pi", "skills"),
  join(".config", "opencode", "skills"),
];

/** Resolve o diretório de skills a partir do home (injetável). */
export function skillsDir(home) {
  const base = home ?? resolveHome();
  return join(base, DEFAULT_SKILLS_SUBDIR);
}

/** Todos os diretórios de skills a varrer, a partir do home (injetável). */
export function skillsDirs(home) {
  const base = home ?? resolveHome();
  return DEFAULT_SKILLS_SUBDIRS.map((sub) => join(base, sub));
}

/** Home do usuário (fallback quando não injetado). */
function resolveHome() {
  return process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
}

/* ------------------------------------------------------------------ */
/* Parser de frontmatter (tolerante)                                   */
/* ------------------------------------------------------------------ */

/**
 * Extrai o bloco de frontmatter de um SKILL.md (entre as duas primeiras `---`).
 * Devolve o texto interno, ou null se não houver frontmatter.
 */
function extractFrontmatter(raw) {
  const lines = String(raw).split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end === -1) return null;
  return lines.slice(1, end).join("\n");
}

/**
 * Parser de YAML mínimo: `chave: valor` e `chave: |` (bloco multilinha até a
 * próxima chave de nível 0). Não é YAML completo — é o que o frontmatter de skills
 * usa. Devolve um objeto `{ chave: valor }`.
 */
export function parseFrontmatter(fmText) {
  const out = {};
  if (!fmText) return out;
  const lines = fmText.split(/\r?\n/);
  let currentKey = null;
  let block = null;

  for (const line of lines) {
    if (block !== null) {
      // continua o bloco até uma linha que pareça nova chave (sem indentação)
      if (/^\s+\S/.test(line) || line.trim() === "") {
        block.push(line.trim());
        continue;
      }
      // fim do bloco
      out[currentKey] = block.join(" ").trim();
      block = null;
      // cai para tratar a linha atual como nova chave
    }

    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const value = m[2].trim();
    if (value === "|" || value === ">") {
      currentKey = key;
      block = [];
    } else {
      out[key] = value;
    }
  }
  if (block !== null) out[currentKey] = block.join(" ").trim();
  return out;
}

/* ------------------------------------------------------------------ */
/* Leitura de uma skill                                                */
/* ------------------------------------------------------------------ */

/**
 * Lê uma skill a partir do seu diretório.
 * @returns {{ name, description, path, dir, error? }}
 */
function readSkill(dir) {
  const path = join(dir, "SKILL.md");
  const fallbackName = dir.split(/[\\/]/).pop();
  try {
    if (!existsSync(path)) {
      return { name: fallbackName, description: "", path, dir, error: "sem SKILL.md" };
    }
    const raw = readFileSync(path, "utf8");
    const fm = extractFrontmatter(raw);
    if (fm === null) {
      return { name: fallbackName, description: "", path, dir, error: "sem frontmatter" };
    }
    const meta = parseFrontmatter(fm);
    if (!meta.name || String(meta.name).trim() === "") {
      // sem name: ignora (não é skill válida), mas reporta o motivo.
      return { name: fallbackName, description: meta.description ?? "", path, dir, error: "sem name" };
    }
    return {
      name: String(meta.name).trim(),
      description: meta.description ? String(meta.description).trim() : "",
      path,
      dir,
    };
  } catch (err) {
    return {
      name: fallbackName,
      description: "",
      path,
      dir,
      error: `falha ao ler: ${err?.message ?? err}`,
    };
  }
}

/* ------------------------------------------------------------------ */
/* API pública                                                         */
/* ------------------------------------------------------------------ */

/**
 * Lista todas as skills do PC.
 *
 * @param {{ home?: string }} [opts]
 * @returns {Array<{ name, description, path, dir, error? }>}
 */
export function listPcSkills({ home } = {}) {
  // Varre todos os diretórios (`.pi/skills` + `.config/opencode/skills`), com
  // dedup por nome (o primeiro diretório vence).
  const seen = new Set();
  const skills = [];
  for (const dir of skillsDirs(home)) {
    if (!existsSync(dir)) continue;
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      let full;
      try {
        full = join(dir, name);
        if (!statSync(full).isDirectory()) continue;
      } catch {
        continue; // entrada que sumiu/ilegível: ignora
      }
      const skill = readSkill(full);
      // "sem name", "sem SKILL.md" e "sem frontmatter" não são skills válidas → pula.
      if (
        skill.error === "sem name" ||
        skill.error === "sem SKILL.md" ||
        skill.error === "sem frontmatter"
      ) {
        continue;
      }
      const key = String(skill.name || "").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      skills.push(skill);
    }
  }

  // Ordena por nome (determinístico, case-insensitive).
  skills.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return skills;
}

/** Normaliza texto para busca: minúsculo, sem acento. */
export function normalizeForSearch(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Busca skills por nome ou descrição (case-insensitive, sem depender de acento).
 *
 * @param {{ termo: string, home?: string }} opts
 * @returns {Array<{ name, description, path, dir, error? }>}
 */
export function findPcSkills({ termo, home } = {}) {
  const term = normalizeForSearch(termo).trim();
  if (!term) return listPcSkills({ home });
  return listPcSkills({ home }).filter((s) => {
    const hay = normalizeForSearch(`${s.name} ${s.description}`);
    return hay.includes(term);
  });
}

export default { listPcSkills, findPcSkills, parseFrontmatter, normalizeForSearch };