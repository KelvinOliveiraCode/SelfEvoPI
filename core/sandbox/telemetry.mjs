/**
 * core/sandbox/telemetry.mjs — registro append-only de decisões do gate.
 *
 * Não é uma segunda fonte de verdade: o gate continua puro. Este módulo só
 * observa o que ele decidiu e grava o mínimo para auditoria — incluindo
 * recusas, que antes desapareciam depois que o stderr virava texto de erro.
 *
 * Nada de segredo: caminhos são relativos ao workspace, excerpts passam por
 * redação e o arquivo fica em `.pi/harness/ledger/` (não no repositório
 * público, não na config pessoal do usuário).
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export const LOG_REL = ".pi/harness/ledger/blocked.jsonl";
const MAX_LINHAS = 5000;
const MAX_EXCERPT = 160;

function redigir(texto) {
  return String(texto ?? "")
    .replace(/(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*["']?[^\s,"'}]+/gi, "$1=[redacted]")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-[redacted]")
    .replace(/eyJ[A-Za-z0-9_-]{12,}/g, "eyJ[redacted]")
    .slice(0, MAX_EXCERPT);
}

function relativo(caminho, root) {
  if (typeof caminho !== "string" || !caminho) return null;
  const r = path.relative(root, caminho);
  return r && !r.startsWith("..") ? r.split(path.sep).join("/") : "[fora-do-workspace]";
}

export function logPath({ root = process.cwd() } = {}) {
  return path.join(root, LOG_REL);
}

/** Grava uma decisão. Nunca lança: telemetria não pode derrubar o gate. */
export async function recordGateDecision(result, { root = process.cwd(), task = null, source = "gate" } = {}) {
  try {
    if (!result || typeof result !== "object") return false;
    const decisao = String(result.decision || "");
    if (decisao !== "block" && decisao !== "warn") return false;
    const registro = {
      at: new Date().toISOString(),
      source: String(source).slice(0, 40),
      decision: decisao,
      file: relativo(result.file, root),
      task: task == null ? null : String(task).slice(0, 80),
      rules: {
        blocking: (Array.isArray(result.blockingRules) ? result.blockingRules : []).slice(0, 20).map(String),
        warning: (Array.isArray(result.warningRules) ? result.warningRules : []).slice(0, 20).map(String),
      },
      violations: (Array.isArray(result.violations) ? result.violations : [])
        .slice(0, 20)
        .map((v) => ({ rule: String(v?.rule || ""), line: Number(v?.line) || 0, excerpt: redigir(v?.excerpt) })),
    };
    const alvo = logPath({ root });
    await mkdir(path.dirname(alvo), { recursive: true });
    await appendFile(alvo, JSON.stringify(registro) + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

/** Lê os últimos registros. Arquivo ausente devolve lista vazia. */
export async function readGateDecisions({ root = process.cwd(), n = 30 } = {}) {
  try {
    const texto = await readFile(logPath({ root }), "utf8");
    const linhas = texto.split("\n").filter(Boolean).slice(-Math.max(1, Math.min(MAX_LINHAS, Number(n) || 30)));
    const out = [];
    for (const linha of linhas) {
      try { out.push(JSON.parse(linha)); } catch { /* linha corrompida: ignora */ }
    }
    return out;
  } catch {
    return [];
  }
}

export default { LOG_REL, logPath, recordGateDecision, readGateDecisions };
