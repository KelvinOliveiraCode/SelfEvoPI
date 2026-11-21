/**
 * core/agent/i18n.mjs — idioma da interface da CLI.
 *
 * Inglês é o padrão. A preferência vive em ~/.pi/agent/cli-locale.json, fora do
 * repositório, e pode ser sobrescrita por SELFEOPI_LOCALE (útil em testes e CI).
 * Nenhuma chave de API ou segredo passa por aqui: só strings de interface.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_LOCALE = "en";
export const SUPPORTED = ["en", "pt"];

/** Caminho da preferência. SELFEOPI_LOCALE_FILE permite isolar testes/CI. */
function localeFile() {
  const custom = String(process.env.SELFEOPI_LOCALE_FILE || "").trim();
  return custom
    ? path.resolve(custom)
    : path.join(os.homedir(), ".pi", "agent", "cli-locale.json");
}

export const LABELS = { en: "English", pt: "Português" };

/* ------------------------------------------------------------------ */
/* Dicionário. Uma chave por string de interface; {var} é substituído.  */
/* ------------------------------------------------------------------ */

const en = {
  /* comandos (a paleta e /help leem daqui) */
  "cmd.detect": "open capability gaps",
  "cmd.evo": "MAIN MODE: the harness evolves and shapes itself toward the goal",
  "cmd.memory": "search memory (lexical + PPMI)",
  "cmd.skills": "artifacts the loop generated and registered",
  "cmd.model": "model picker, or switch directly",
  "cmd.effort": "reasoning effort of the current model",
  "cmd.mode": "cycle modes (plan → build → manual → ask → goal)",
  "cmd.clear": "clear the conversation and start over",
  "cmd.compact": "compact the conversation history",
  "cmd.sessions": "list sessions or load one",
  "cmd.cost": "session tokens and cost",
  "cmd.status": "session, model and mode state",
  "cmd.context": "how much of the context window is in use",
  "cmd.mcp": "declared MCP servers",
  "cmd.plugins": "list active MCP plugins; probe one or all",
  "cmd.init": "draft an AGENTS.md (asks for confirmation)",
  "cmd.import": "bring MCPs and skills into own config (asks first)",
  "cmd.plan": "plan mode: reads and proposes, never writes",
  "cmd.build": "build mode: writes and runs inside the workspace",
  "cmd.ask": "ask mode: answers only, never touches disk",
  "cmd.goal": "set or clear the completion condition",
  "cmd.settings": "everything that is currently configured",
  "cmd.theme": "interface theme",
  "cmd.swarm": "shape and run n subagents toward a task",
  "cmd.subagent": "shaped named subagent (persistent or one-shot)",
  "cmd.worktree": "isolated git worktrees",
  "cmd.workspace": "where agents act (changes the working directory)",
  "cmd.explorer": "open Windows Explorer and pick the workspace",
  "cmd.providers": "register/remove providers and their models",
  "cmd.help": "show this list",
  "cmd.language": "switch the CLI language (English by default)",
  "cmd.fork": "fork the current session, keeping the original",
  "cmd.diff": "show git changes in the workspace",
  "cmd.export": "export the conversation as markdown or JSON",
  "cmd.undo": "undo the last exchange",
  "cmd.redo": "redo the last undone exchange",
  "cmd.copy": "copy the last answer to the clipboard",
  "cmd.reload": "reload configuration without restarting",
  "prov.none": "no provider configured yet",
  "prov.discoverUsage": "usage: /providers discover <baseUrl> [API_KEY_ENV]",
  "prov.discovered": "{n} model(s) discovered at {endpoint}",
  "prov.setupHint": "to save: node scripts/providers-setup.mjs --base-url <url> --api-key-env <VAR> --apply",
  "cmd.paste": "attach an image from the clipboard",
  "cmd.attach": "attach an image file to the next message",
  "cmd.images": "show or clear attached images",
  "cmd.verbosity": "choose how much feedback the CLI shows",
  "verb.title": "verbosity",
  "verb.current": "current:",
  "verb.levels": "levels:",
  "verb.set": "verbosity: {level}",
  "verb.invalid": "unsupported verbosity: {value}",
  "verb.hint": "enter chooses · esc cancels",
  "verb.minimal": "final answer only",
  "verb.tools": "tool calls + final answer",
  "verb.reasoning": "reasoning + final answer",
  "verb.full": "reasoning + tools + final answer",
  "verb.verbose": "everything, with timer and tokens",
  "img.attached": "attached: {file}",
  "img.none": "no image in the clipboard",
  "img.unavailable": "could not read the clipboard image",
  "img.cleared": "attached images cleared",
  "img.list": "attached images ({n})",
  "img.notImage": "not a supported image: {file}",
  "img.noVision": "the current model does not declare image input; use a vision-capable model",

  /* ajuda */
  "help.commands": "COMMANDS",
  "help.conversation": "CONVERSATION",
  "help.write": "write and press Enter to talk; the answer streams in.",
  "help.cancel": "cancels the current answer and restores the prompt.",
  "help.openPanel": "opens/closes the status panel.",
  "help.openSessions": "opens/closes the session list.",
  "help.openConfig": "opens/closes the configuration editor.",
  "help.activity": "opens the activity list (running shells and subagents).",
  "help.quit": "quit.",

  /* paleta e dicas de teclado */
  "palette.empty": "no command",
  "palette.nav": "↑↓ navigate  enter select  esc close  ctrl+o panel",
  "hints.idle": "enter send · / commands · ctrl+o panel · ctrl+k sessions · q quit",
  "hints.panel": "ctrl+o close · enter send · q quit",
  "hints.palette": "↑↓ navigate  enter select  esc close  ctrl+o panel",

  /* painel, configurações, barra de estado */
  "panel.title": "status",
  "panel.mode": "mode:",
  "panel.permission": "permission:",
  "panel.model": "model:",
  "panel.reasoning": "reasoning:",
  "panel.context": "context:",
  "panel.session": "session:",
  "panel.baseline": "baseline:",
  "panel.turns": "turns",
  "panel.close": "ctrl+o closes",
  "settings.title": "settings",
  "settings.model": "model:",
  "settings.mode": "mode:",
  "settings.permission": "permission:",
  "settings.reasoning": "reasoning:",
  "settings.context": "context:",
  "settings.sessions": "sessions:",
  "settings.commands": "commands:",
  "settings.notResolved": "(not resolved)",
  "settings.close": "ctrl+, closes",

  /* motor e erros */
  "engine.missing1": "I could not find the agent engine on this machine.",
  "engine.missing2": "chat is disabled; / commands still work.",
  "engine.missing3": "reinstall SelfEvoPI to restore chat.",
  "engine.auth1": "I could not reach the model for this conversation.",
  "engine.auth2": "the default model has no active credential on this machine.",
  "engine.generic1": "I could not reach the model right now.",
  "engine.generic2": "it may be the connection or the model being unavailable; try again.",
  "engine.models": "see available models",
  "engine.switch": "switch the model for this conversation",
  "engine.fallback": "the default model did not answer; used {model} for this conversation.",

  /* spinner, raciocínio, ferramentas */
  "spin.thinking": "thinking…",
  "spin.running": "running {name}",
  "spin.elapsed": "{s}s",
  "spin.tokens": "↓ {n} tokens",
  "think.label": "reasoning",
  "think.summary": "reasoning · {s}s",
  "think.show": "reasoning: show",
  "think.hide": "reasoning: hide",
  "tool.result": "{n} lines",
  "tool.resultBytes": "{n} KB",
  "tool.failed": "1 failed",
  "tool.done": "done",

  /* idioma */
  "lang.title": "language",
  "lang.current": "current:",
  "lang.available": "available:",
  "lang.set": "language set to {label}.",
  "lang.invalid": "unsupported language: {value}",
  "lang.hint": "enter chooses · esc cancels",
  "lang.apply": "applies to the interface immediately",

  /* comandos de uso geral */
  "common.usage": "usage:",
  "common.noData": "nothing to show yet",
  "common.notFound": "nothing found for \"{term}\"",
  "common.confirm": "confirm? (y/N)",
  "common.cancelled": "cancelled",
  "common.done": "done",
  "common.unavailable": "unavailable",
  "common.yes": "yes",
  "common.no": "no",

  /* comandos específicos */
  "mode.line": "mode: {name}",
  "goal.set": "goal set: {goal}",
  "goal.active": "goal active: {goal}",
  "goal.clear": "goal cleared",
  "goal.none": "no active goal",
  "compact.done": "history compacted",
  "compact.empty": "there is no conversation to compact yet",
  "clear.done": "conversation cleared",
  "fork.done": "session forked: {id}",
  "fork.none": "no active session to fork",
  "diff.clean": "no changes in the workspace",
  "diff.title": "changes in the workspace",
  "export.done": "conversation exported to {file}",
  "export.none": "no conversation to export yet",
  "undo.none": "nothing to undo",
  "undo.done": "last exchange undone",
  "redo.none": "nothing to redo",
  "redo.done": "last exchange redone",
  "copy.done": "last answer copied",
  "copy.none": "no answer to copy yet",
  "reload.done": "configuration reloaded",
  "queue.hint": "queued: {n}",
  "queue.empty": "message queue is empty",
  "queue.sent": "queued message sent",
  "picker.sessions": "sessions",
  "picker.activity": "activity",
  "picker.preview": "preview",
  "picker.search": "search",
  "picker.open": "open",
  "picker.stop": "stop",
  "picker.back": "back",
  "mcp.status": "MCP servers: {connected} connected, {failed} failed",
  "mcp.connecting": "connecting",
  "mcp.connected": "connected",
  "mcp.failed": "failed",
  "state.ready": "ready",
  "state.cold": "cold start",
  "view.mode": "mode",
  "view.permission": "permission",
  "view.model": "model",
  "view.effort": "effort",
  "view.theme": "theme",
  "view.mcp": "MCP",
  "view.skills": "skills",
  "view.sessions": "sessions",
  "view.servers": "servers",
  "view.fromPc": "from machine",
};

const pt = {
  "cmd.detect": "lacunas de ferramenta em aberto",
  "cmd.evo": "MODO PRINCIPAL: o harness evolui/modela a si mesmo rumo à meta",
  "cmd.memory": "busca na memória (lexical + PPMI)",
  "cmd.skills": "o que o loop já gerou e registrou",
  "cmd.model": "seletor de modelo, ou troca direto",
  "cmd.effort": "esforço de raciocínio do modelo atual",
  "cmd.mode": "alterna o modo (plan → build → manual → ask → goal)",
  "cmd.clear": "limpa a conversa e começa de novo",
  "cmd.compact": "compacta o histórico da conversa",
  "cmd.sessions": "lista sessões ou carrega uma",
  "cmd.cost": "tokens e custo da sessão",
  "cmd.status": "estado da sessão, modelo e modo",
  "cmd.context": "quanto da janela de contexto está em uso",
  "cmd.mcp": "servidores MCP declarados",
  "cmd.plugins": "lista os plugins (MCP) ativos; sonda um ou todos",
  "cmd.init": "gera um rascunho de AGENTS.md (pede confirmação)",
  "cmd.import": "traz MCPs e skills para a config própria (pede confirmação)",
  "cmd.plan": "modo plan: lê e propõe, não escreve",
  "cmd.build": "modo build: escreve e executa no workspace",
  "cmd.ask": "modo ask: só responde, nunca toca em disco",
  "cmd.goal": "define/limpa a condição de conclusão",
  "cmd.settings": "visão de tudo que está configurado",
  "cmd.theme": "tema da interface",
  "cmd.swarm": "molda e executa n subagentes rumo à tarefa",
  "cmd.subagent": "subagente moldado (nomeado, persistente ou temporário)",
  "cmd.worktree": "worktrees git isoladas",
  "cmd.workspace": "onde os agentes agem (troca o diretório de trabalho)",
  "cmd.explorer": "abre o explorador do Windows e escolhe a pasta/workspace",
  "cmd.providers": "registra/remove provedores e seus modelos",
  "cmd.help": "mostra esta lista",
  "cmd.language": "troca o idioma da CLI (inglês por padrão)",
  "cmd.fork": "bifurca a sessão atual, preservando a original",
  "cmd.diff": "mostra as mudanças git no workspace",
  "cmd.export": "exporta a conversa em markdown ou JSON",
  "cmd.undo": "desfaz a última troca",
  "cmd.redo": "refaz a última troca desfeita",
  "cmd.copy": "copia a última resposta para a área de transferência",
  "cmd.reload": "recarrega a configuração sem reiniciar",
  "prov.none": "nenhum provedor registrado ainda",
  "prov.discoverUsage": "uso: /providers discover <baseUrl> [ENV_DA_CHAVE]",
  "prov.discovered": "{n} modelo(s) descoberto(s) em {endpoint}",
  "prov.setupHint": "para gravar: node scripts/providers-setup.mjs --base-url <url> --api-key-env <VAR> --apply",
  "cmd.paste": "anexa uma imagem da área de transferência",
  "cmd.attach": "anexa um arquivo de imagem à próxima mensagem",
  "cmd.images": "mostra ou limpa as imagens anexadas",
  "cmd.verbosity": "escolhe quanto feedback a CLI mostra",
  "verb.title": "detalhamento",
  "verb.current": "atual:",
  "verb.levels": "níveis:",
  "verb.set": "detalhamento: {level}",
  "verb.invalid": "detalhamento não suportado: {value}",
  "verb.hint": "enter escolhe · esc cancela",
  "verb.minimal": "só a resposta final",
  "verb.tools": "ferramentas + resposta final",
  "verb.reasoning": "raciocínio + resposta final",
  "verb.full": "raciocínio + ferramentas + resposta final",
  "verb.verbose": "tudo, com tempo e tokens",
  "img.attached": "anexada: {file}",
  "img.none": "nenhuma imagem na área de transferência",
  "img.unavailable": "não consegui ler a imagem da área de transferência",
  "img.cleared": "imagens anexadas removidas",
  "img.list": "imagens anexadas ({n})",
  "img.notImage": "imagem não suportada: {file}",
  "img.noVision": "o modelo atual não declara entrada de imagem; use um modelo com visão",

  "help.commands": "COMANDOS",
  "help.conversation": "CONVERSA",
  "help.write": "escreva e Enter para falar; a resposta aparece em streaming.",
  "help.cancel": "cancela a resposta em curso e devolve a linha.",
  "help.openPanel": "abre/fecha o painel de estado.",
  "help.openSessions": "abre/fecha a lista de sessões.",
  "help.openConfig": "abre/fecha o editor de configurações.",
  "help.activity": "abre a lista de atividade (shells e subagentes).",
  "help.quit": "saem.",

  "palette.empty": "nenhum comando",
  "palette.nav": "↑↓ navegar  enter escolher  esc fechar  ctrl+o painel",
  "hints.idle": "enter enviar · / comandos · ctrl+o painel · ctrl+k sessões · q sair",
  "hints.panel": "ctrl+o fechar · enter enviar · q sair",
  "hints.palette": "↑↓ navegar  enter escolher  esc fechar  ctrl+o painel",

  "panel.title": "painel",
  "panel.mode": "modo:",
  "panel.permission": "permissão:",
  "panel.model": "modelo:",
  "panel.reasoning": "raciocínio:",
  "panel.context": "contexto:",
  "panel.session": "sessão:",
  "panel.baseline": "baseline:",
  "panel.turns": "turnos",
  "panel.close": "ctrl+o fecha",
  "settings.title": "configurações",
  "settings.model": "modelo:",
  "settings.mode": "modo:",
  "settings.permission": "permissão:",
  "settings.reasoning": "raciocínio:",
  "settings.context": "contexto:",
  "settings.sessions": "sessões:",
  "settings.commands": "comandos:",
  "settings.notResolved": "(não resolvido)",
  "settings.close": "ctrl+, fecha",

  "engine.missing1": "não encontrei o motor do SelfEvoPI nesta máquina.",
  "engine.missing2": "a conversa fica desativada; os comandos / continuam funcionando.",
  "engine.missing3": "para reativar a conversa, reinstale o SelfEvoPI.",
  "engine.auth1": "não consegui falar com o modelo desta conversa.",
  "engine.auth2": "o modelo padrão não tem credencial ativa nesta máquina.",
  "engine.generic1": "não consegui falar com o modelo agora.",
  "engine.generic2": "pode ser conexão ou o modelo estar indisponível; tente de novo.",
  "engine.models": "ver os modelos disponíveis",
  "engine.switch": "trocar o modelo desta conversa",
  "engine.fallback": "o modelo padrão não respondeu; usei {model} nesta conversa.",

  "spin.thinking": "pensando…",
  "spin.running": "executando {name}",
  "spin.elapsed": "{s}s",
  "spin.tokens": "↓ {n} tokens",
  "think.label": "raciocínio",
  "think.summary": "raciocínio · {s}s",
  "think.show": "raciocínio: mostrar",
  "think.hide": "raciocínio: ocultar",
  "tool.result": "{n} linhas",
  "tool.resultBytes": "{n} KB",
  "tool.failed": "1 falha",
  "tool.done": "concluído",

  "lang.title": "idioma",
  "lang.current": "atual:",
  "lang.available": "disponíveis:",
  "lang.set": "idioma definido para {label}.",
  "lang.invalid": "idioma não suportado: {value}",
  "lang.hint": "enter escolhe · esc cancela",
  "lang.apply": "vale para a interface na hora",

  "common.usage": "uso:",
  "common.noData": "nada a mostrar ainda",
  "common.notFound": "nada encontrado para \"{term}\"",
  "common.confirm": "confirmar? (s/N)",
  "common.cancelled": "cancelado",
  "common.done": "concluído",
  "common.unavailable": "indisponível",
  "common.yes": "sim",
  "common.no": "não",

  "mode.line": "modo: {name}",
  "goal.set": "meta definida: {goal}",
  "goal.active": "meta ativa: {goal}",
  "goal.clear": "meta limpa",
  "goal.none": "nenhuma meta ativa",
  "compact.done": "histórico compactado",
  "compact.empty": "não há conversa para compactar ainda",
  "clear.done": "conversa limpa",
  "fork.done": "sessão bifurcada: {id}",
  "fork.none": "nenhuma sessão ativa para bifurcar",
  "diff.clean": "nenhuma mudança no workspace",
  "diff.title": "mudanças no workspace",
  "export.done": "conversa exportada para {file}",
  "export.none": "não há conversa para exportar ainda",
  "undo.none": "nada para desfazer",
  "undo.done": "última troca desfeita",
  "redo.none": "nada para refazer",
  "redo.done": "última troca refeita",
  "copy.done": "última resposta copiada",
  "copy.none": "nenhuma resposta para copiar ainda",
  "reload.done": "configuração recarregada",
  "queue.hint": "fila: {n}",
  "queue.empty": "a fila de mensagens está vazia",
  "queue.sent": "mensagem da fila enviada",
  "picker.sessions": "sessões",
  "picker.activity": "atividade",
  "picker.preview": "prévia",
  "picker.search": "busca",
  "picker.open": "abrir",
  "picker.stop": "parar",
  "picker.back": "voltar",
  "mcp.status": "servidores MCP: {connected} conectados, {failed} falhos",
  "mcp.connecting": "conectando",
  "mcp.connected": "conectado",
  "mcp.failed": "falhou",
  "state.ready": "pronto",
  "state.cold": "cold start",
  "view.mode": "modo",
  "view.permission": "permissão",
  "view.model": "modelo",
  "view.effort": "esforço",
  "view.theme": "tema",
  "view.mcp": "mcp",
  "view.skills": "skills",
  "view.sessions": "sessões",
  "view.servers": "servidores",
  "view.fromPc": "do pc",
};

const DICTS = { en, pt };

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

let cached = null;

export function isLocale(value) {
  return SUPPORTED.includes(String(value || "").toLowerCase());
}

function readPersisted() {
  try {
    const raw = JSON.parse(readFileSync(localeFile(), "utf8"));
    return isLocale(raw?.locale) ? String(raw.locale).toLowerCase() : null;
  } catch {
    return null;
  }
}

export function getLocale() {
  const env = String(process.env.SELFEOPI_LOCALE || "").trim().toLowerCase();
  if (isLocale(env)) return env;
  if (cached) return cached;
  cached = readPersisted() || DEFAULT_LOCALE;
  return cached;
}

export function setLocale(value) {
  if (!isLocale(value)) return false;
  const locale = String(value).toLowerCase();
  cached = locale;
  // Uma escolha explícita do usuário vence a variável de ambiente: sem isso,
  // /language pareceria não funcionar numa sessão iniciada com SELFEOPI_LOCALE.
  delete process.env.SELFEOPI_LOCALE;
  try {
    const file = localeFile();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ locale }, null, 2) + "\n", "utf8");
  } catch {
    // Preferência em memória continua valendo mesmo sem disco gravável.
  }
  return true;
}

export function listLocales() {
  return SUPPORTED.map((code) => ({ code, label: LABELS[code] }));
}

/** Traduz uma chave, substituindo {var} pelos valores fornecidos. */
export function t(key, vars) {
  const dict = DICTS[getLocale()] || DICTS.en;
  let out = dict[key] ?? DICTS.en[key] ?? key;
  if (vars && typeof vars === "object") {
    for (const [name, value] of Object.entries(vars)) {
      out = out.replaceAll(`{${name}}`, String(value));
    }
  }
  return out;
}

export default { t, getLocale, setLocale, listLocales, isLocale, DEFAULT_LOCALE, SUPPORTED };
