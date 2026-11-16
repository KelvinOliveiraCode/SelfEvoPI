/**
 * selfevopi-memory / extension — liga a memória em 3 níveis ao PI Coding Agent.
 *
 * A extensão (default export) é uma função `(pi) => void`, o formato que o PI
 * carrega (docs/extensions.md). O núcleo é puro e testável sem o PI:
 *   - buildMemoryBlock(entries, { maxTokens }) → bloco de contexto dentro do orçamento
 *   - createMemoryController({ store, maxTokens }) → operações (load/add/promote/list)
 *
 * O default export NÃO importa nada do pacote do PI no top-level (só usa o objeto
 * `pi` recebido), então `node --test` importa este arquivo sem o PI instalado.
 *
 * Orçamento: nunca injeta mais que `maxTokens` (padrão 400). Estimativa ≈ 4 chars/token.
 *
 * Caminho do store: `<cwd>/.pi/harness/memory` (nível `project` espelha `.pi/harness/`).
 * Configuração do teto (precedência): flag `--mem-tokens` > env `SELFEOPI_MEM_TOKENS` > 400.
 */

import { join } from "node:path";
import { openStore } from "./store.mjs";

export const DEFAULT_MAX_TOKENS = 400;

/** Estimativa de tokens (≈ 4 caracteres por token). Determinística. */
export function estimateTokens(text) {
  return Math.ceil(String(text ?? "").length / 4);
}

/**
 * Monta o bloco de contexto da memória respeitando o teto de tokens.
 * Entradas são ordenadas das mais recentes para as mais antigas; corta quando
 * o próximo item estouraria o orçamento.
 *
 * @param {Array<{id:string,at?:string,text:string,tags?:string[]}>} entries
 * @param {{ maxTokens?: number, header?: string }} opts
 * @returns {{ block: string, usedTokens: number, truncated: boolean, count: number }}
 */
export function buildMemoryBlock(entries, { maxTokens = DEFAULT_MAX_TOKENS, header = "MEMÓRIA DO PROJETO (SelfEvoPI)" } = {}) {
  const budget = Number.isFinite(maxTokens) && maxTokens > 0 ? Math.floor(maxTokens) : DEFAULT_MAX_TOKENS;
  const sorted = [...(Array.isArray(entries) ? entries : [])]
    .filter((e) => e && typeof e.text === "string" && e.text.trim() !== "")
    .sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));

  const lines = [];
  let used = 0;
  let truncated = false;

  for (const entry of sorted) {
    const tags = Array.isArray(entry.tags) && entry.tags.length > 0 ? ` (${entry.tags.join(",")})` : "";
    const line = `- [${entry.id}] ${entry.text}${tags}`;
    const cost = estimateTokens(line);
    // +1 do separador de linha por item.
    if (used + cost + 1 > budget) {
      truncated = true;
      break;
    }
    lines.push(line);
    used += cost + 1;
  }

  const body = lines.length > 0 ? lines.join("\n") : "(sem memória de projeto)";
  const block = `${header}\n${body}`;
  return { block, usedTokens: used, truncated, count: lines.length };
}

/* ------------------------------------------------------------------ */
/* Controlador (núcleo puro, injetável)                                */
/* ------------------------------------------------------------------ */

/**
 * Cria o controlador de memória usado pelos handlers do PI.
 *
 * @param {{ store: ReturnType<typeof import("./store.mjs").openStore>, maxTokens?: number }} deps
 */
export function createMemoryController({ store, maxTokens = DEFAULT_MAX_TOKENS } = {}) {
  if (!store || typeof store.query !== "function") {
    throw new Error("extension: informe um store válido (openStore)");
  }
  const budget = Number.isFinite(maxTokens) && maxTokens > 0 ? Math.floor(maxTokens) : DEFAULT_MAX_TOKENS;

  /** Lê entradas do nível project (mais recentes primeiro). */
  function projectEntries() {
    return store.query({ level: "project" });
  }

  return {
    store,
    maxTokens: budget,

    /** Carrega os fatos do projeto e monta o bloco de contexto (respeita o teto). */
    load() {
      const entries = projectEntries();
      return buildMemoryBlock(entries, { maxTokens: budget });
    },

    /** Acrescenta uma entrada ao nível `project` (append-only, já persistido). */
    add(text, { tags = [], source = "mem-cmd" } = {}) {
      const clean = String(text ?? "").trim();
      if (clean === "") throw new Error("extension: `/mem add` precisa de texto");
      return store.append("project", { text: clean, tags, source });
    },

    /** Lista entradas do projeto (mais recentes primeiro). */
    list() {
      return projectEntries();
    },

    /**
     * Promove uma entrada de nível. Padrão: `project` → `skills`.
     * @returns {object|null} a entrada promovida, ou null se o id não existir na origem
     */
    promote(id, from = "project", to = "skills") {
      return store.promote(id, from, to);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Extensão PI (default export)                                        */
/* ------------------------------------------------------------------ */

/**
 * Fábrica da extensão do PI. Recebe o objeto `pi` (ExtensionAPI).
 *
 * Handlers:
 *  - session_start      : carrega fatos do projeto, monta o bloco e avisa o usuário
 *  - before_agent_start : injeta o bloco como mensagem de contexto (dentro do teto)
 *  - session_shutdown   : confirma a persistência das entradas novas
 *  - comando /mem       : listar | add <texto> | promote <id>
 */
export default function memoryExtension(pi) {
  if (!pi || typeof pi.on !== "function" || typeof pi.registerCommand !== "function") {
    throw new Error("extension: objeto `pi` inválido (ExtensionAPI esperado)");
  }

  let controller = null;
  let maxTokens = readMaxTokens(pi);
  let pendingAdds = 0; // entradas acrescentadas nesta sessão (já persistidas)

  // Registra a flag de teto, quando a API suportar (mock de teste pode não ter).
  try {
    if (typeof pi.registerFlag === "function") {
      pi.registerFlag("mem-tokens", {
        description: "Teto de tokens de memória injetada por turno (padrão 400)",
        type: "number",
        default: DEFAULT_MAX_TOKENS,
      });
    }
  } catch {
    // API antiga sem registerFlag: segue com env + padrão.
  }

  /** Cria o store/controller sob demanda, usando o cwd da sessão. */
  function ensure(ctx) {
    if (controller) return controller;
    const cwd = ctx?.cwd ?? process.cwd();
    const root = process.env.SELFEOPI_MEMORY_DIR ?? join(cwd, ".pi", "harness", "memory");
    // Import dinâmico: mantém o top-level livre de dependências locais e evita
    // que o teste precise do store em disco antes de abrir a sessão.
    const store = openStore({ root });
    controller = createMemoryController({ store, maxTokens });
    return controller;
  }

  /** Reaplica o teto caso a flag/env tenha mudado. */
  function refreshMaxTokens() {
    const next = readMaxTokens(pi);
    if (next !== maxTokens) {
      maxTokens = next;
      if (controller) controller = createMemoryController({ store: controller.store, maxTokens });
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    refreshMaxTokens();
    const ctrl = ensure(ctx);
    const { count, usedTokens, truncated } = ctrl.load();
    pendingAdds = 0;
    if (ctx?.ui?.notify) {
      const extra = truncated ? ` (teto de ${maxTokens} tokens atingido)` : "";
      ctx.ui.notify(`Memória: ${count} fato(s), ~${usedTokens}/${maxTokens} tokens${extra}`, "info");
    }
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    const ctrl = ensure(ctx);
    const { block } = ctrl.load();
    if (!block) return;
    return {
      message: {
        customType: "selfevopi-memory",
        content: block,
        display: false,
      },
    };
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    // As entradas são gravadas no append imediatamente; aqui apenas confirmamos.
    if (pendingAdds > 0 && ctx?.ui?.notify) {
      ctx.ui.notify(`Memória: ${pendingAdds} entrada(s) nova(s) persistida(s) no JSONL.`, "info");
    }
    pendingAdds = 0;
    controller = null;
  });

  pi.registerCommand("mem", {
    description: "Memória do SelfEvoPI: /mem | /mem add <texto> | /mem promote <id>",
    handler: async (args, ctx) => {
      const ctrl = ensure(ctx);
      const raw = String(args ?? "").trim();

      if (raw === "") {
        const entries = ctrl.list();
        if (entries.length === 0) {
          ctx?.ui?.notify?.("Memória do projeto vazia.", "info");
          return;
        }
        const lines = entries.map((e) => `${e.id}\t${e.text}`);
        ctx?.ui?.notify?.(`Memória do projeto (${entries.length}):\n${lines.join("\n")}`, "info");
        return;
      }

      if (raw.startsWith("add ")) {
        const text = raw.slice(4).trim();
        try {
          const entry = ctrl.add(text);
          pendingAdds += 1;
          ctx?.ui?.notify?.(`Memória: adicionado ${entry.id}`, "info");
        } catch (err) {
          ctx?.ui?.notify?.(`Memória: ${err.message}`, "error");
        }
        return;
      }

      if (raw.startsWith("promote ")) {
        const id = raw.slice(8).trim();
        try {
          const entry = ctrl.promote(id, "project", "skills");
          if (!entry) {
            ctx?.ui?.notify?.(`Memória: id ${id} não encontrado em project`, "error");
            return;
          }
          ctx?.ui?.notify?.(`Memória: promovido ${id} (project → skills)`, "info");
        } catch (err) {
          ctx?.ui?.notify?.(`Memória: ${err.message}`, "error");
        }
        return;
      }

      ctx?.ui?.notify?.("Uso: /mem | /mem add <texto> | /mem promote <id>", "info");
    },
  });
}

/* ------------------------------------------------------------------ */
/* Helpers de configuração                                             */
/* ------------------------------------------------------------------ */

/** Lê o teto de tokens: flag `--mem-tokens` > env `SELFEOPI_MEM_TOKENS` > padrão. */
function readMaxTokens(pi) {
  let flagValue = null;
  try {
    if (typeof pi?.getFlag === "function") flagValue = pi.getFlag("mem-tokens");
  } catch {
    flagValue = null;
  }
  const raw = flagValue ?? process.env.SELFEOPI_MEM_TOKENS ?? DEFAULT_MAX_TOKENS;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_TOKENS;
}

/* ------------------------------------------------------------------ */
/* Store (import direto de ./store.mjs)                                */
/* ------------------------------------------------------------------ */

// openStore vem de ./store.mjs no topo. Mantém o default export carregável
// sem o PI instalado, pois store.mjs só usa builtins do Node.