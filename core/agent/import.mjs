#!/usr/bin/env node
/**
 * core/agent/import.mjs — traz a configuração do OpenCode para o SelfEvoPI,
 * uma vez, com consentimento.
 *
 * Depois que o SelfEvoPI passou a ler a própria config (`~/.pi/settings.json`
 * e `~/.pi/skills/`), quem já tinha MCPs e skills no OpenCode veria
 * `/settings` e `/skills` vazios. Este módulo faz a migração pontual:
 *
 *   scanSource({ home })        -> o que existe na fonte OpenCode (só leitura)
 *   scanTarget({ home })        -> o que já existe no alvo ~/.pi (só leitura)
 *   planImport({ home })        -> diff puro: adicionar vs manter
 *   applyImport({ home, plan }) -> backup + merge + manifesto (escrita atômica)
 *   undoImport({ home })        -> restaura o backup e apaga skills criadas
 *
 * Princípios do desenho do import:
 *
 *  1. **Merge, não overwrite.** "O que já existe vence." Nome que já está no
 *     alvo é mantido, não sobrescrito. Torna o import idempotente.
 *  2. **Reversível.** Backup do settings.json + manifesto do que foi criado.
 *     `undoImport` restaura o backup e apaga as skills listadas.
 *  3. **Só leitura da fonte.** O OpenCode nunca é escrito; o import só lê de lá.
 *  4. **Verbatim nas skills.** O SKILL.md do usuário é copiado como está — o
 *     conteúdo é dele, não nosso.
 *
 * A dependência do OpenCode fica isolada aqui (fonte de importação), que é
 * onde é legítima: importar de outro produto é ato explícito do usuário.
 */

import { lstatSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  normalizeServerEntry,
  statusOf,
  stripJsonc,
  stripTrailingCommas,
} from "./mcp-probe.mjs";
import { parseFrontmatter } from "./skills-user.mjs";

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

/** Onde o OpenCode guarda a config global (fonte de importação). */
export const SOURCE_MCP_FILES = [
  path.join(".config", "opencode", "opencode.jsonc"),
  path.join(".config", "opencode", "opencode.json"),
  path.join(".opencode", "opencode.jsonc"),
];

/** Diretório das skills do OpenCode, relativo ao home. */
export const SOURCE_SKILLS_SUBDIR = path.join(".config", "opencode", "skills");

/** Config global do SelfEvoPI (alvo). */
export const TARGET_SETTINGS_SUBDIR = path.join(".pi", "settings.json");

/** Skills do SelfEvoPI (alvo). */
export const TARGET_SKILLS_SUBDIR = path.join(".pi", "skills");

/** Diretório do manifesto de importação. */
const LEDGER_SUBDIR = path.join(".pi", "harness", "ledger");

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Home do usuário, injetável para teste. */
function resolveHome(home) {
  if (typeof home === "string" && home.trim() !== "") return path.resolve(home);
  return path.resolve(process.env.HOME ?? process.env.USERPROFILE ?? ".");
}

/** O caminho existe e é arquivo? (lstat, não existsSync — alias do Store conta.) */
function presente(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Lê JSON sem lançar. Devolve { ok, value } ou { ok, error }. */
async function lerJson(absPath) {
  let raw;
  try {
    raw = await readFile(absPath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return { ok: true, value: null, exists: false };
    return { ok: false, exists: true, error: `não consegui ler: ${err?.message ?? err}` };
  }
  try {
    return { ok: true, value: JSON.parse(raw), exists: true };
  } catch (err) {
    return { ok: false, exists: true, error: `JSON inválido: ${err?.message ?? err}` };
  }
}

/** Extrai o mapa de servidores de um doc: mcpServers ou mcp.servers. */
function mapaDeServidores(doc) {
  if (!doc || typeof doc !== "object") return {};
  if (doc.mcpServers && typeof doc.mcpServers === "object") return doc.mcpServers;
  if (doc.mcp && typeof doc.mcp === "object" && doc.mcp.servers) return doc.mcp.servers;
  return {};
}

/** Carimbo de tempo seguro para nome de arquivo. */
function carimbo() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/* ------------------------------------------------------------------ */
/* scanSource — o que existe na fonte OpenCode (só leitura)            */
/* ------------------------------------------------------------------ */

/**
 * Lê a config do OpenCode e devolve servidores MCP + skills encontrados.
 *
 * Não lança por ausência: se a fonte não existe, `origemExiste` é false e as
 * listas vêm vazias. Lança só se o arquivo existe mas está corrompido.
 *
 * @param {{ home?: string }} [opts]
 * @returns {Promise<{ origemExiste: boolean, configPath: string|null, mcpServers: Array, skills: Array }>}
 */
export async function scanSource({ home } = {}) {
  const base = resolveHome(home);

  // --- MCPs ---
  let configPath = null;
  for (const rel of SOURCE_MCP_FILES) {
    const abs = path.join(base, rel);
    if (presente(abs)) {
      configPath = abs;
      break;
    }
  }

  let mcpServers = [];
  if (configPath) {
    let raw;
    try {
      raw = await readFile(configPath, "utf8");
    } catch (err) {
      throw new Error(`não consegui ler ${configPath}: ${err?.message ?? err}`);
    }
    let doc;
    try {
      doc = JSON.parse(stripTrailingCommas(stripJsonc(raw).text));
    } catch (err) {
      throw new Error(`configuração inválida em ${configPath}: ${err?.message ?? err}`);
    }
    const mapa = mapaDeServidores(doc);
    mcpServers = Object.entries(mapa)
      .map(([name, raw2]) => {
        const s = normalizeServerEntry(name, raw2);
        return {
          name: s.name,
          type: s.type,
          command: s.command,
          args: s.args,
          cwd: s.cwd,
          environment: s.environment,
          timeout: s.timeout,
          disabled: s.disabled,
          status: statusOf(s, { home: base }),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // --- skills ---
  const skills = await scanSkillsSource(base);

  return {
    origemExiste: configPath !== null || skills.length > 0,
    configPath,
    mcpServers,
    skills,
  };
}

/** Varre ~/.config/opencode/skills/<nome>/SKILL.md (só leitura). */
async function scanSkillsSource(base) {
  const dir = path.join(base, SOURCE_SKILLS_SUBDIR);
  if (!presente(dir)) return [];

  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const skills = [];
  for (const nome of entries) {
    const full = path.join(dir, nome);
    let st;
    try {
      st = await stat(full);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;

    const skillPath = path.join(full, "SKILL.md");
    if (!presente(skillPath)) continue;

    let raw;
    try {
      raw = await readFile(skillPath, "utf8");
    } catch {
      continue;
    }
    const fm = extractFrontmatter(raw);
    const meta = fm ? parseFrontmatter(fm) : {};
    skills.push({
      // CHAVE ÚNICA = nome do diretório (não o `name:` do frontmatter).
      // É o que o rollback apaga, o que o listPcSkills varre, e o que decide
      // colisão no alvo. O `name:` do frontmatter pode divergir do diretório
      // (usuário renomeou a pasta, ou copiou skill de outro lugar) — a
      // identidade da skill para o SelfEvoPI é o diretório.
      nome,
      name: meta.name ? String(meta.name).trim() : nome,
      description: meta.description ? String(meta.description).trim() : "",
      sourcePath: skillPath,
    });
  }

  skills.sort((a, b) => a.nome.localeCompare(b.nome));
  return skills;
}

/** Extrai o bloco de frontmatter (entre as duas primeiras `---`). */
function extractFrontmatter(raw) {
  const lines = String(raw).split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end === -1) return null;
  return lines.slice(1, end).join("\n");
}

/* ------------------------------------------------------------------ */
/* scanTarget — o que já existe no alvo ~/.pi (só leitura)             */
/* ------------------------------------------------------------------ */

/**
 * Lê o que já existe no SelfEvoPI: servidores em ~/.pi/settings.json e
 * diretórios em ~/.pi/skills.
 *
 * @param {{ home?: string }} [opts]
 * @returns {Promise<{ settingsPath: string, mcpNomes: Set<string>, skillNomes: Set<string> }>}
 */
export async function scanTarget({ home } = {}) {
  const base = resolveHome(home);
  const settingsPath = path.join(base, TARGET_SETTINGS_SUBDIR);

  const parsed = await lerJson(settingsPath);
  let mcpNomes = new Set();
  if (parsed.ok && parsed.value) {
    mcpNomes = new Set(Object.keys(mapaDeServidores(parsed.value)));
  }

  let skillNomes = new Set();
  const skillsDir = path.join(base, TARGET_SKILLS_SUBDIR);
  if (presente(skillsDir)) {
    try {
      const entries = await readdir(skillsDir);
      for (const nome of entries) {
        const full = path.join(skillsDir, nome);
        try {
          if ((await stat(full)).isDirectory()) skillNomes.add(nome);
        } catch {
          /* segue */
        }
      }
    } catch {
      /* dir ilido: vazio */
    }
  }

  return { settingsPath, mcpNomes, skillNomes };
}

/* ------------------------------------------------------------------ */
/* planImport — diff puro (sem escrita)                                */
/* ------------------------------------------------------------------ */

/**
 * Decide o que adicionar vs manter, comparando fonte e alvo.
 *
 * @param {{ home?: string }} [opts]
 * @returns {Promise<{ origemExiste, mcpAdd, mcpSkip, skillsAdd, skillsSkip }>}
 */
export async function planImport({ home } = {}) {
  const source = await scanSource({ home });
  const target = await scanTarget({ home });

  const mcpAdd = source.mcpServers.filter((s) => !target.mcpNomes.has(s.name));
  const mcpSkip = source.mcpServers.filter((s) => target.mcpNomes.has(s.name));

  const skillsAdd = source.skills.filter((s) => !target.skillNomes.has(s.nome));
  const skillsSkip = source.skills.filter((s) => target.skillNomes.has(s.nome));

  return {
    origemExiste: source.origemExiste,
    mcpAdd,
    mcpSkip,
    skillsAdd,
    skillsSkip,
  };
}

/* ------------------------------------------------------------------ */
/* applyImport — backup + merge + manifesto (escrita atômica)          */
/* ------------------------------------------------------------------ */

/**
 * Aplica o plano: backup do settings.json, merge dos MCPs (existente vence),
 * cópia das skills novas, e manifesto do que foi criado.
 *
 * @param {{ home?: string, plan?: object }} [opts]
 * @returns {Promise<{ added, skipped, backup, manifest }>}
 */
export async function applyImport({ home, plan } = {}) {
  const base = resolveHome(home);
  const plano = plan ?? (await planImport({ home: base }));

  if (!plano.origemExiste) {
    return { added: { mcp: [], skills: [] }, skipped: { mcp: [], skills: [] }, backup: null, manifest: null };
  }

  const settingsPath = path.join(base, TARGET_SETTINGS_SUBDIR);
  const skillsTargetDir = path.join(base, TARGET_SKILLS_SUBDIR);
  const stamp = carimbo();

  // --- backup do settings.json (se existir) ---
  let backup = null;
  if (presente(settingsPath)) {
    backup = `${settingsPath}.bak-${stamp}`;
    await copyFile(settingsPath, backup);
  }

  // --- merge dos MCPs (existente vence) ---
  const parsed = await lerJson(settingsPath);
  const doc = parsed.ok && parsed.value && typeof parsed.value === "object" ? parsed.value : {};
  const mapa = mapaDeServidores(doc);

  const mcpAdicionados = [];
  const avisos = []; // caminho não resolveu, ou command relativo sem cwd
  for (const s of plano.mcpAdd) {
    if (mapa[s.name]) continue; // já existe (segurança extra): mantém
    const { entry, aviso } = resolverCaminhoServidor(s, base);
    if (aviso) avisos.push({ nome: s.name, aviso });
    mapa[s.name] = entry;
    mcpAdicionados.push(s.name);
  }

  // escreve settings.json atômico (tmp + rename)
  const novoDoc = { ...doc, mcpServers: mapa };
  await mkdir(path.dirname(settingsPath), { recursive: true });
  const tmpPath = `${settingsPath}.tmp-${stamp}`;
  await writeFile(tmpPath, JSON.stringify(novoDoc, null, 2) + "\n", "utf8");
  await rename(tmpPath, settingsPath);

  // --- copia skills novas (existente vence) ---
  await mkdir(skillsTargetDir, { recursive: true });
  const skillsAdicionadas = [];
  for (const sk of plano.skillsAdd) {
    const destDir = path.join(skillsTargetDir, sk.nome);
    if (presente(destDir)) continue; // já existe: mantém
    await mkdir(destDir, { recursive: true });
    await copyFile(sk.sourcePath, path.join(destDir, "SKILL.md"));
    skillsAdicionadas.push(sk.nome);
  }

  // --- manifesto ---
  const manifest = {
    quando: new Date().toISOString(),
    origem: {
      configPath: (await scanSource({ home: base })).configPath,
      skillsDir: path.join(base, SOURCE_SKILLS_SUBDIR),
    },
    backup,
    mcpAdicionados,
    skillsAdicionadas,
    avisos, // caminhos que não resolveram, ou command relativo sem cwd
    desfeito: false,
  };

  const ledgerDir = path.join(base, LEDGER_SUBDIR);
  await mkdir(ledgerDir, { recursive: true });
  const manifestPath = path.join(ledgerDir, `import-${stamp}.json`);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  return {
    added: { mcp: mcpAdicionados, skills: skillsAdicionadas },
    skipped: { mcp: plano.mcpSkip.map((s) => s.name), skills: plano.skillsSkip.map((s) => s.nome) },
    avisos,
    backup,
    manifest: manifestPath,
  };
}

/** Formata um servidor normalizado para o formato mcpServers do settings.json. */
function formatarServidorParaSettings(s) {
  const entry = {
    type: s.type,
    command: s.command,
    args: s.args,
  };
  if (s.cwd) entry.cwd = s.cwd;
  if (s.environment && Object.keys(s.environment).length > 0) entry.environment = s.environment;
  if (s.timeout && Object.keys(s.timeout).length > 0) entry.timeout = s.timeout;
  if (s.disabled) entry.disabled = true;
  return entry;
}

/**
 * Resolve o `command` do servidor antes de gravar no settings.json.
 *
 * O OpenCode pode declarar `command` relativo (ex: `"server.mjs"`) ou com `~`
 * (ex: `"~/bin/server"`). Se o SelfEvoPI gravar isso cru, o `statusOf` do
 * probe pode devolver `broken` (não acha o executável) e o usuário vê
 * "configurado" no import e "quebrado" no probe.
 *
 * Resolução:
 *  - `~` no início → expande contra o home.
 *  - caminho relativo com barra/backslash ou começando com `.` → resolve contra
 *    o `cwd` do entry, se houver; senão contra o home.
 *  - comando sem barra (ex: `node`, `npx`, `python`) → é comando do PATH, não
 *    caminho de arquivo; não resolve (seria errado transformar `node` em
 *    `/home/node`). Passa direto.
 *  - se depois de resolver o arquivo não existe, devolve `aviso` (não falha —
 *    importa com aviso, o usuário decide o que fazer).
 *
 * @param {object} s servidor normalizado
 * @param {string} home home do usuário (para expandir ~ e resolver relativos)
 * @returns {{ entry: object, aviso: string|null }}
 */
function resolverCaminhoServidor(s, home) {
  const entry = formatarServidorParaSettings(s);
  const base = home ?? resolveHome();
  let aviso = null;

  if (!entry.command || typeof entry.command !== "string") {
    return { entry, aviso: "sem command" };
  }

  let cmd = entry.command;

  // expande ~ no início
  if (cmd === "~" || cmd.startsWith("~/") || cmd.startsWith("~\\")) {
    cmd = path.join(base, cmd.slice(2));
  } else if (!path.isAbsolute(cmd) && !/^[A-Za-z]:[\\/]/.test(cmd)) {
    // só resolve como caminho se tem barra/backslash, começa com ponto,
    // ou tem extensão de arquivo (ex: "server.mjs", "script.py")
    // (senão é comando do PATH, ex: "node", "npx", "python")
    const temExtensao = /\.[a-z0-9]+$/i.test(cmd);
    if (cmd.includes("/") || cmd.includes("\\") || cmd.startsWith(".") || temExtensao) {
      const cwdBase = entry.cwd ? path.resolve(entry.cwd) : base;
      cmd = path.resolve(cwdBase, cmd);
    }
  }

  // se cwd é relativo, resolve contra home
  if (entry.cwd && !path.isAbsolute(entry.cwd) && !/^[A-Za-z]:[\\/]/.test(entry.cwd)) {
    entry.cwd = path.resolve(base, entry.cwd);
  }

  entry.command = cmd;

  // se não existe e não é comando do PATH, avisa
  const ehComandoPath = !cmd.includes("/") && !cmd.includes("\\") && !path.isAbsolute(cmd);
  if (!ehComandoPath && !presente(cmd)) {
    return { entry, aviso: `command não encontrado: ${cmd}` };
  }

  return { entry, aviso };
}

/* ------------------------------------------------------------------ */
/* undoImport — restaura o manifesto mais recente                      */
/* ------------------------------------------------------------------ */

/**
 * Reverte o import mais recente: remove do settings.json atual APENAS as chaves
 * que o import adicionou (mcpAdicionados), preservando qualquer coisa que o
 * usuário tenha feito depois do import; apaga os diretórios de skill listados
 * (skillsAdicionadas); marca o manifesto como desfeito (não apaga, para
 * auditoria). O .bak fica para auditoria, mas NÃO é o caminho de rollback —
 * restaurar o .bak inteiro apagaria o que o usuário fez entre import e undo.
 *
 * @param {{ home?: string }} [opts]
 * @returns {Promise<{ restaurado: boolean, mcpRemovidos: string[], skillsRemovidas: string[], manifesto: string|null }>}
 */
export async function undoImport({ home } = {}) {
  const base = resolveHome(home);
  const ledgerDir = path.join(base, LEDGER_SUBDIR);

  if (!presente(ledgerDir)) {
    return { restaurado: false, mcpRemovidos: [], skillsRemovidas: [], manifesto: null };
  }

  let entries;
  try {
    entries = await readdir(ledgerDir);
  } catch {
    return { restaurado: false, mcpRemovidos: [], skillsRemovidas: [], manifesto: null };
  }

  // manifesto mais recente que ainda não foi desfeito
  const manifestos = entries
    .filter((n) => n.startsWith("import-") && n.endsWith(".json"))
    .sort()
    .reverse();

  let alvo = null;
  let alvoPath = null;
  for (const nome of manifestos) {
    const p = path.join(ledgerDir, nome);
    try {
      const m = JSON.parse(await readFile(p, "utf8"));
      if (!m.desfeito) {
        alvo = m;
        alvoPath = p;
        break;
      }
    } catch {
      /* manifesto corrompido: pula */
    }
  }

  if (!alvo) {
    return { restaurado: false, mcpRemovidos: [], skillsRemovidas: [], manifesto: null };
  }

  // --- rollback seletivo dos MCPs: remove só as chaves que o import adicionou ---
  let restaurado = false;
  const mcpRemovidos = [];
  const settingsPath = path.join(base, TARGET_SETTINGS_SUBDIR);
  if (Array.isArray(alvo.mcpAdicionados) && alvo.mcpAdicionados.length > 0 && presente(settingsPath)) {
    const parsed = await lerJson(settingsPath);
    if (parsed.ok && parsed.value && typeof parsed.value === "object") {
      const doc = parsed.value;
      const mapa = mapaDeServidores(doc);
      let mexeu = false;
      for (const nome of alvo.mcpAdicionados) {
        if (mapa[nome]) {
          delete mapa[nome];
          mcpRemovidos.push(nome);
          mexeu = true;
        }
      }
      if (mexeu) {
        const novoDoc = { ...doc, mcpServers: mapa };
        const stamp = carimbo();
        await mkdir(path.dirname(settingsPath), { recursive: true });
        const tmpPath = `${settingsPath}.tmp-${stamp}`;
        await writeFile(tmpPath, JSON.stringify(novoDoc, null, 2) + "\n", "utf8");
        await rename(tmpPath, settingsPath);
        restaurado = true;
      }
    }
  }

  // apaga skills criadas (diretório é a chave única)
  const skillsRemovidas = [];
  const skillsTargetDir = path.join(base, TARGET_SKILLS_SUBDIR);
  for (const nome of alvo.skillsAdicionadas ?? []) {
    const dir = path.join(skillsTargetDir, nome);
    if (presente(dir)) {
      await rm(dir, { recursive: true, force: true });
      skillsRemovidas.push(nome);
    }
  }

  // marca manifesto como desfeito
  alvo.desfeito = true;
  alvo.desfeitoEm = new Date().toISOString();
  await writeFile(alvoPath, JSON.stringify(alvo, null, 2) + "\n", "utf8");

  return { restaurado, mcpRemovidos, skillsRemovidas, manifesto: alvoPath };
}

export default {
  scanSource,
  scanTarget,
  planImport,
  applyImport,
  undoImport,
};