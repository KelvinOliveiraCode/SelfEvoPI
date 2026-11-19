import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  listPcSkills,
  findPcSkills,
  parseFrontmatter,
  normalizeForSearch,
  DEFAULT_SKILLS_SUBDIR,
} from "./skills-user.mjs";

/* --------------------------- helpers de teste --------------------------- */

/** Cria um home temporário com a estrutura ~/.pi/skills/<nome>/SKILL.md */
function makeHome(skills) {
  const home = mkdtempSync(join(tmpdir(), "selfevopi-pcskills-"));
  const base = join(home, DEFAULT_SKILLS_SUBDIR);
  for (const [dirName, content] of Object.entries(skills)) {
    const dir = join(base, dirName);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), content, "utf8");
  }
  return home;
}

const SKILL_OK = `---
name: accessible-html
description: HTML acessivel em artefatos de design web.
---

# Corpo
`;

const SKILL_MULTILINE = `---
name: ai-film-studio
description: |
---

# Corpo
`;

const SKILL_SEM_NAME = `---
description: so descricao, sem nome.
---
`;

const SKILL_SEM_FRONTMATTER = `# Titulo
sem frontmatter aqui.
`;

/* ------------------------------ listPcSkills ---------------------------- */

test("listPcSkills varre e lê frontmatter (name + description)", () => {
  const home = makeHome({ "accessible-html": SKILL_OK });
  try {
    const skills = listPcSkills({ home });
    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, "accessible-html");
    assert.match(skills[0].description, /HTML acessivel/);
    assert.ok(skills[0].path.endsWith("SKILL.md"));
    assert.ok(skills[0].dir.endsWith("accessible-html"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("listPcSkills ignora skill sem name", () => {
  const home = makeHome({ "sem-nome": SKILL_SEM_NAME });
  try {
    const skills = listPcSkills({ home });
    assert.equal(skills.length, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("listPcSkills tolera frontmatter quebrado (description em bloco vazio)", () => {
  const home = makeHome({ "ai-film-studio": SKILL_MULTILINE });
  try {
    const skills = listPcSkills({ home });
    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, "ai-film-studio");
    assert.equal(skills[0].description, ""); // bloco vazio, sem derrubar
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("listPcSkills não derruba com SKILL.md sem frontmatter", () => {
  const home = makeHome({
    "bom": SKILL_OK,
    "sem-frontmatter": SKILL_SEM_FRONTMATTER,
  });
  try {
    const skills = listPcSkills({ home });
    // a skill boa entra; a sem frontmatter não derruba a varredura
    const names = skills.map((s) => s.name);
    assert.ok(names.includes("accessible-html"));
    assert.equal(skills.length, 1, "só a skill válida entra");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("listPcSkills ordena por nome (determinístico)", () => {
  const home = makeHome({
    "zeta": `---\nname: zeta\ndescription: z\n---\n`,
    "alpha": `---\nname: alpha\ndescription: a\n---\n`,
  });
  try {
    const names = listPcSkills({ home }).map((s) => s.name);
    assert.deepEqual(names, ["alpha", "zeta"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("listPcSkills devolve [] quando o diretório não existe", () => {
  const home = mkdtempSync(join(tmpdir(), "selfevopi-vazio-"));
  try {
    assert.deepEqual(listPcSkills({ home }), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

/* ------------------------------ findPcSkills ---------------------------- */

test("findPcSkills busca por nome (case-insensitive)", () => {
  const home = makeHome({
    "accessible-html": SKILL_OK,
    "agent-stack": `---\nname: agent-stack\ndescription: Docker\n---\n`,
  });
  try {
    const r = findPcSkills({ termo: "HTML", home });
    assert.equal(r.length, 1);
    assert.equal(r[0].name, "accessible-html");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("findPcSkills busca por descrição", () => {
  const home = makeHome({
    "accessible-html": SKILL_OK,
    "agent-stack": `---\nname: agent-stack\ndescription: Docker e WSL2\n---\n`,
  });
  try {
    const r = findPcSkills({ termo: "docker", home });
    assert.equal(r.length, 1);
    assert.equal(r[0].name, "agent-stack");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("findPcSkills não depende de acento", () => {
  const home = makeHome({ "accessible-html": SKILL_OK });
  try {
    assert.equal(findPcSkills({ termo: "acessivel", home }).length, 1);
    assert.equal(findPcSkills({ termo: "acessível", home }).length, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("findPcSkills sem termo lista tudo", () => {
  const home = makeHome({
    "a": `---\nname: a\ndescription: x\n---\n`,
    "b": `---\nname: b\ndescription: y\n---\n`,
  });
  try {
    assert.equal(findPcSkills({ termo: "", home }).length, 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

/* ------------------------------ parser ---------------------------------- */

test("parseFrontmatter lê chave: valor e chave: | (bloco)", () => {
  const fm = parseFrontmatter("name: x\ndescription: |\n  linha 1\n  linha 2\nversion: 1");
  assert.equal(fm.name, "x");
  assert.match(fm.description, /linha 1/);
  assert.equal(fm.version, "1");
});

test("normalizeForSearch remove acento e caixa", () => {
  assert.equal(normalizeForSearch("Ação É"), "acao e");
});