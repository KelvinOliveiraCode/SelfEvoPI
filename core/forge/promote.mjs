#!/usr/bin/env node
/**
 * selfevopi-forge-promote — promoção real de um artefato aprovado.
 *
 * O loop (A5) decide; o gate (A6) aprova; **este módulo efetiva**:
 *
 *   1. copia o artefato do diretório temporário para `.pi/harness/artifacts/<tarefa>-<timestamp>/`
 *   2. faz um commit atômico vinculado à lacuna de origem
 *   3. grava `last-known-good.json` — mas **só** se `verify()` passar
 *
 * Sem `verify()` não há checkpoint: um artefato promovido sem evidência de teste
 * não vira estado verde. Isso é deliberado — a alternativa seria gravar um
 * "último estado bom" que ninguém verificou.
 *
 * Segurança:
 *  - git é chamado com array de argumentos (sem shell, sem interpolação).
 *  - `taskId` e `ref` nunca viram flag: um nome começando com "-" é recusado.
 *  - cópia recusa sobrescrever destino existente.
 */

import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { checkpointGood, git, headSha } from "../governance/rollback.mjs";
import { openStore } from "../memory/store.mjs";

const DEFAULT_ARTIFACTS_REL = path.join(".pi", "harness", "artifacts");
const DEFAULT_MEMORY_REL = path.join(".pi", "harness", "memory");
/** Arquivo do nível `skills` no store de memória (mesmo nome do store). */
const SKILLS_FILE = "skills.jsonl";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Nome de diretório seguro: sem separador, sem "..", sem começar com "-". */
function safeSegment(value, field) {
  const s = String(value ?? "").trim();
  if (s === "") return null;
  if (s.startsWith("-")) return null;
  if (s.includes("/") || s.includes("\\") || s.includes("..")) return null;
  if (/[<>:"|?*\u0000-\u001f]/.test(s)) return null;
  return s;
}

function stamp(now = () => new Date()) {
  return now().toISOString().replace(/[:.]/g, "-");
}

/** O diretório tem algum arquivo? (diretório vazio não é artefato) */
async function hasFiles(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.some((e) => e.isFile() || e.isDirectory());
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Registro na memória (Voyager: skill só existe se for recuperável)   */
/* ------------------------------------------------------------------ */

/**
 * Registra o artefato promovido no nível `skills` da memória.
 *
 * Sem isso, o artefato existe em disco mas ninguém o encontra: a próxima sessão
 * não sabe que a capacidade foi criada, e o loop re-gera a mesma coisa. É a
 * diferença entre "arquivar" e "aprender".
 *
 * A identidade é a **tarefa** (`tarefa:<taskId>`), não o caminho. Quando a
 * tarefa já está registrada e o destino mudou (re-promoção de um artefato
 * melhorado), a entrada existente é **atualizada** com o novo destino em vez de
 * duplicar ou continuar apontando para o diretório antigo.
 *
 * @returns {{ registered: boolean, id?: string, reason?: string, updated?: boolean }}
 */
async function registerInMemory({ repoRoot, dest, taskId, request, memoryRoot = null } = {}) {
  const root = memoryRoot ?? path.join(repoRoot, DEFAULT_MEMORY_REL);
  let store;
  try {
    store = openStore({ root });
  } catch (err) {
    return { registered: false, reason: `memória indisponível: ${err?.message ?? err}` };
  }

  const rel = path.relative(repoRoot, dest).split(path.sep).join("/");
  const tag = `tarefa:${taskId}`;
  const capability = request?.goal ?? taskId;
  const kindTag = request?.kind ?? "cli";
  const text = `${capability} — artefato em \`${rel}\` (gerado a partir da lacuna "${taskId}")`;
  const tags = ["artefato", kindTag, tag];

  const existing = store.query({ level: "skills" });
  const dupe = existing.find(
    (e) => !e.invalid && Array.isArray(e.tags) && e.tags.includes(tag),
  );

  if (dupe) {
    // Já aponta para este destino: idempotente, nada a fazer.
    if (String(dupe.text).includes(rel)) {
      return { registered: false, reason: `já registrado (tarefa ${taskId})`, id: dupe.id };
    }
    // Re-promoção da mesma tarefa: atualiza o destino da entrada existente.
    const updated = await updateSkillEntry({ root, id: dupe.id, text, tags, tag });
    if (updated.ok) {
      return { registered: true, updated: true, id: dupe.id, reason: `registro atualizado (tarefa ${taskId})` };
    }
    // Se a reescrita falhar, não perde o registro: anexa uma nova entrada.
  }

  try {
    const entry = store.append("skills", { text, tags, source: "evo" });
    return { registered: true, id: entry.id };
  } catch (err) {
    return { registered: false, reason: `falha ao registrar: ${err?.message ?? err}` };
  }
}

/**
 * Reescreve a entrada `id` no `skills.jsonl` com novo `text`/`tags`, preservando
 * as demais linhas (inclusive corrompidas) e o id/at/source originais.
 */
async function updateSkillEntry({ root, id, text, tags, tag }) {
  const file = path.join(root, SKILLS_FILE);
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return { ok: false };
  }
  const lines = raw.split(/\r?\n/);
  const out = [];
  let changed = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      out.push(line);
      continue;
    }
    let e;
    try {
      e = JSON.parse(trimmed);
    } catch {
      out.push(line); // preserva linha corrompida verbatim
      continue;
    }
    if (!e.invalid && e.id === id && Array.isArray(e.tags) && e.tags.includes(tag)) {
      e.text = text;
      e.tags = tags;
      out.push(JSON.stringify(e));
      changed = true;
    } else {
      out.push(line);
    }
  }
  if (!changed) return { ok: false };
  const trailing = raw.endsWith("\n") ? "\n" : "";
  try {
    await writeFile(file, out.join("\n") + trailing, "utf8");
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/* ------------------------------------------------------------------ */
/* promoteArtifact                                                     */
/* ------------------------------------------------------------------ */

/**
 * Promove um artefato aprovado.
 *
 * @param {object} opts
 * @param {string} opts.artifactDir   diretório temporário com o artefato gerado
 * @param {string} opts.taskId        tarefa-alvo (vira parte do nome e do vínculo)
 * @param {object} [opts.gap]         lacuna de origem (registrada no corpo do commit)
 * @param {string} [opts.repoRoot]    raiz do repositório (default: cwd)
 * @param {string} [opts.artifactsRoot] destino (default <repo>/.pi/harness/artifacts)
 * @param {Function} [opts.verify]    verificação pós-cópia; sem ela, não há checkpoint
 * @param {string} [opts.message]     assunto do commit
 * @param {boolean} [opts.checkpoint=true] grava last-known-good.json
 * @param {boolean} [opts.commit=true]     faz o commit
 * @param {boolean} [opts.register=true]   registra o artefato na memória (nível skills)
 * @param {string|null} [opts.memoryRoot]  raiz da memória (default <repo>/.pi/harness/memory)
 * @param {Function} [opts.now]       relógio
 * @returns {Promise<{ok:boolean, path?:string, commit?:string|null, checkpointed?:boolean, registered?:object, reasons:string[]}>}
 */
export async function promoteArtifact({
  artifactDir,
  taskId,
  gap = null,
  request = null,
  repoRoot = process.cwd(),
  artifactsRoot = null,
  verify = null,
  message = null,
  checkpoint = true,
  commit = true,
  register = true,
  memoryRoot = null,
  now = () => new Date(),
} = {}) {
  const reasons = [];

  // 1. valida entrada -------------------------------------------------
  if (!artifactDir || typeof artifactDir !== "string") {
    return { ok: false, reasons: ["informe artifactDir"] };
  }
  const info = await stat(artifactDir).catch(() => null);
  if (!info || !info.isDirectory()) {
    return { ok: false, reasons: [`artifactDir não é diretório: ${artifactDir}`] };
  }
  if (!(await hasFiles(artifactDir))) {
    return { ok: false, reasons: ["artifactDir vazio (nada a promover)"] };
  }

  const seg = safeSegment(taskId, "taskId") ?? "sem-tarefa";
  const destRoot = artifactsRoot
    ? path.resolve(artifactsRoot)
    : path.join(repoRoot, DEFAULT_ARTIFACTS_REL);
  const dest = path.join(destRoot, `${seg}-${stamp(now)}`);

  // 2. copia ----------------------------------------------------------
  try {
    await mkdir(destRoot, { recursive: true });
    await cp(artifactDir, dest, { recursive: true, errorOnExist: true, force: false });
  } catch (err) {
    return { ok: false, reasons: [`falha ao copiar artefato: ${err?.message ?? err}`] };
  }

  // 3. commit atômico -------------------------------------------------
  let commitSha = null;
  if (commit) {
    const subject = (message ?? `evo(${seg}): artefato aprovado pelo gate`).slice(0, 72);
    const body = [
      `tarefa: ${seg}`,
      gap ? `lacuna: [${gap.kind}] ${gap.capability ?? gap.goal ?? ""}`.trim() : null,
      `origem: ${path.relative(repoRoot, artifactDir) || artifactDir}`,
      "",
      "Promovido automaticamente pelo loop evolutivo (SelfEvoPI).",
    ]
      .filter((l) => l !== null)
      .join("\n");

    const rel = path.relative(repoRoot, dest).split(path.sep).join("/");
    const add = git(repoRoot, ["add", "--", rel], { allowFail: true });
    if (!add.ok) {
      return { ok: false, path: dest, commit: null, reasons: [`git add falhou: ${add.stderr}`] };
    }
    const commitRes = git(repoRoot, ["commit", "-m", subject, "-m", body], { allowFail: true });
    if (!commitRes.ok) {
      // nada a commitar não é erro: o conteúdo já pode estar versionado.
      if (/nothing to commit|no changes added/i.test(commitRes.stderr)) {
        reasons.push("commit: nada a registrar (conteúdo já versionado)");
      } else {
        return { ok: false, path: dest, commit: null, reasons: [`git commit falhou: ${commitRes.stderr}`] };
      }
    } else {
      commitSha = headSha(repoRoot).slice(0, 7);
    }
  }

  // 4. checkpoint (só com evidência) ----------------------------------
  let checkpointed = false;
  if (checkpoint) {
    if (typeof verify !== "function") {
      reasons.push("checkpoint: sem verify() — last-known-good não foi gravado");
    } else {
      const ck = await checkpointGood({
        repoRoot,
        verify,
        label: `promoção de ${seg}`,
        notes: `artefato promovido para ${path.relative(repoRoot, dest)}`,
      });
      if (ck.ok) checkpointed = true;
      else reasons.push(`checkpoint falhou: ${ck.error ?? "verify() não passou"}`);
    }
  }

  // 5. registro na memória: o artefato precisa ser encontrável na próxima sessão.
  let registered = null;
  if (register) {
    registered = await registerInMemory({
      repoRoot,
      dest,
      taskId: seg,
      request,
      memoryRoot,
    });
    if (registered.registered === false && registered.reason && !/já registrado/.test(registered.reason)) {
      reasons.push(`memória: ${registered.reason}`);
    }
  }

  return {
    ok: true,
    path: dest,
    commit: commitSha,
    checkpointed,
    registered,
    reasons: reasons.length > 0 ? reasons : undefined,
  };
}

export default { promoteArtifact };