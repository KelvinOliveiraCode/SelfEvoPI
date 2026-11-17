#!/usr/bin/env node
/**
 * selfevopi-modes — modos de permissão do SelfEvoPI.
 *
 * Critério do projeto (docs/research/cli-landscape/modos.md §4): um modo só
 * existe se mudar **ler**, **escrever**, **executar** ou **quando-pergunta**.
 * Se não muda nenhum dos quatro, é decoração — e este módulo se recusa a
 * registrar um modo assim.
 *
 *   resolveMode(name) -> { name, canRead, canWrite, canExec, execScope, ask, base }
 *   guard({ mode, action, path, workspace, code, scan })
 *     -> { decision: "allow" | "ask" | "block", mode, action, reason, questions }
 *
 * Três desfechos, e a diferença importa:
 *  - "allow"  o artefato executa.
 *  - "ask"    não executa ainda; um humano decide e pode liberar.
 *  - "block"  não executa; o modo proíbe. `questions` diz o que destravaria.
 *
 * Integrações:
 *  - `classifyPath` (static-gate) decide dentro/fora do workspace, para não
 *    reimplementar a mesma comparação.
 *  - `reviewApproval` (approval.mjs) entra quando o modo permite a ação mas o
 *    pedido/scan indica que um humano precisa decidir — é a fonte das perguntas.
 *
 * Não existe `/yolo` aqui, e não vai existir: `bypassPermissions`, `yolo` e
 * `danger-full-access` são o que o SelfEvoPI não deve expor.
 */

import { classifyPath } from "../sandbox/static-gate.mjs";
import { reviewApproval } from "./approval.mjs";

const READ = "read";
const WRITE = "write";
const EXEC = "exec";

const ACOES = Object.freeze({
  read: READ,
  readFile: READ,
  edit: WRITE,
  write: WRITE,
  create: WRITE,
  shell: EXEC,
  bash: EXEC,
  exec: EXEC,
});

/* ------------------------------------------------------------------ */
/* Registro de modos                                                   */
/* ------------------------------------------------------------------ */

/**
 * `execScope`:
 *  - "none"       não executa
 *  - "readonly"   executa só o que dá para provar que é leitura
 *  - "workspace"  executa; o alcance é limitado pelo sandbox, não por este modo
 *  - "inherit"    herda do modo base (só `goal`)
 *
 * `ask` descreve **em que momento o modo devolve um "ask"** (pause para humano),
 * não um texto de interface:
 *  - "write"              quando tentam escrever
 *  - "outside-workspace"  quando a escrita é fora do workspace
 *  - null                 nunca pausa por permissão
 */
const REGISTRO = Object.freeze({
  plan: Object.freeze({
    name: "plan",
    canRead: true,
    canWrite: false,
    canExec: true,
    execScope: "readonly",
    ask: "write",
    base: null,
    nota: "lê, roda leitura, propõe; não escreve",
  }),
  build: Object.freeze({
    name: "build",
    canRead: true,
    canWrite: true,
    canExec: true,
    execScope: "workspace",
    ask: "outside-workspace",
    base: null,
    nota: "escreve e executa no workspace; fora dele, pausa",
  }),
  ask: Object.freeze({
    name: "ask",
    canRead: true,
    canWrite: false,
    canExec: false,
    execScope: "none",
    ask: null,
    base: null,
    nota: "responde sobre o código e nunca toca em disco",
  }),
  goal: Object.freeze({
    name: "goal",
    canRead: true,
    canWrite: true,
    canExec: true,
    execScope: "inherit",
    ask: "outside-workspace",
    base: "build",
    nota: "não muda permissão; acrescenta uma condição de conclusão verificada por avaliador separado",
  }),
});

export const MODE_NAMES = Object.freeze(Object.keys(REGISTRO));
export const MODES = REGISTRO;

/** Um modo existe se está no registro. `/yolo` não está, e é erro explícito. */
export function isMode(name) {
  return typeof name === "string" && Object.hasOwn(REGISTRO, name);
}

function recusar(name) {
  const sugestao = MODE_NAMES.join(", ");
  throw new Error(
    `modo desconhecido: ${JSON.stringify(name)}. Modos disponiveis: ${sugestao}. ` +
      "Nao existe yolo/bypass: e o que o SelfEvoPI nao deve expor."
  );
}

/* ------------------------------------------------------------------ */
/* resolveMode                                                         */
/* ------------------------------------------------------------------ */

/**
 * @param {string} name  plan | build | ask | goal
 * @param {{base?: "plan"|"build"|"ask"}} [opts]  base do `goal` (default: build)
 * @returns {{name:string, canRead:boolean, canWrite:boolean, canExec:boolean,
 *            execScope:string, ask:(string|null), base:(string|null)}}
 */
export function resolveMode(name, { base = null } = {}) {
  if (!isMode(name)) recusar(name);

  const registro = REGISTRO[name];

  if (registro.execScope !== "inherit") {
    return {
      name: registro.name,
      canRead: registro.canRead,
      canWrite: registro.canWrite,
      canExec: registro.canExec,
      execScope: registro.execScope,
      ask: registro.ask,
      base: registro.base,
    };
  }

  // `goal` não tem permissão própria: herda do modo base.
  // É o que a pesquisa mostrou (Claude Code: "A goal doesn't change your
  // permission mode"), e por isso ela não é decoração — muda o escopo, não a permissão.
  const modoBase = base ?? registro.base;
  if (!isMode(modoBase) || modoBase === "goal") recusar(modoBase);
  const herdado = REGISTRO[modoBase];

  return {
    name: registro.name,
    canRead: herdado.canRead,
    canWrite: herdado.canWrite,
    canExec: herdado.canExec,
    execScope: herdado.execScope,
    ask: herdado.ask,
    base: herdado.name,
  };
}

/* ------------------------------------------------------------------ */
/* Comandos de leitura                                                 */
/* ------------------------------------------------------------------ */

const CMD_LEITURA = new Set([
  "ls", "dir", "cat", "type", "pwd", "cd", "echo", "grep", "findstr", "where",
  "whoami", "hostname", "head", "tail", "wc", "sort", "tree", "stat", "file",
  "date", "ver", "more", "find", "whereis",
]);

/** Subcomandos de `git` que não escrevem nada. */
const GIT_LEITURA = new Set([
  "status", "diff", "log", "show", "branch", "blame", "describe", "rev-parse",
  "ls-files", "ls-tree", "shortlog", "whatchanged", "remote",
]);

/**
 * Classifica um comando como leitura **provável**.
 *  - true  → dá para provar que é leitura
 *  - false → não dá (pode escrever, ou é desconhecido)
 *
 * Conservador de propósito: na dúvida, `false`. Em `plan`, `false` vira "ask".
 */
export function isReadOnlyCommand(cmd) {
  if (typeof cmd !== "string") return false;
  const tokens = cmd.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;

  const primeiro = tokens[0].toLowerCase();
  const base = primeiro.replace(/^.*[\\/]/, "");

  if (base === "git") {
    const sub = (tokens[1] ?? "").toLowerCase();
    return GIT_LEITURA.has(sub);
  }

  // redirecionar para arquivo é escrever, mesmo com comando de leitura
  if (/[>]/.test(cmd)) return false;

  return CMD_LEITURA.has(base);
}

/* ------------------------------------------------------------------ */
/* guard                                                               */
/* ------------------------------------------------------------------ */

function decidir(modo, action, reason, questions = []) {
  return { decision: "allow", mode: modo.name, action, reason, questions };
}

/**
 * Porta única: dado um modo e uma ação, diz se ela passa, pausa ou é recusada.
 *
 * @param {object} opts
 * @param {string} opts.mode                       plan | build | ask | goal
 * @param {"read"|"write"|"exec"} opts.action      (alias: readFile, edit, create, shell, bash)
 * @param {string} [opts.path]                     alvo da escrita (para decidir dentro/fora)
 * @param {string} [opts.workspace]                raiz do workspace
 * @param {string} [opts.command]                  comando, quando action === "exec"
 * @param {string} [opts.code]                     código proposto (opcional)
 * @param {object} [opts.scan]                     resultado de static-gate.evaluate
 * @param {string} [opts.base]                     base do `goal`
 */
export function guard({ mode, action, path = null, workspace = null, command = null, code = null, scan = null, base = null } = {}) {
  const modo = resolveMode(mode, { base });
  const tipo = ACOES[action] ?? action;

  if (tipo !== READ && tipo !== WRITE && tipo !== EXEC) {
    return {
      decision: "block",
      mode: modo.name,
      action: String(action),
      reason: `ação desconhecida: ${JSON.stringify(action)} (use read, write ou exec)`,
      questions: [],
    };
  }

  const revisao = code || scan ? reviewApproval({ request: { mode: modo.name }, scan }) : null;

  // ---- leitura
  if (tipo === READ) {
    if (modo.canRead) return juntar(decidir(modo, tipo, "modo " + modo.name + " lê"), revisao);
    return {
      decision: "block",
      mode: modo.name,
      action: tipo,
      reason: `o modo ${modo.name} não lê`,
      questions: [],
    };
  }

  // ---- escrita
  if (tipo === WRITE) {
    if (!modo.canWrite) {
      const perguntas =
        modo.name === "plan"
          ? [
              "O plano cobre esta escrita? Se sim, aprove o plano ou troque para build.",
              "A escrita pode esperar o modo build, com o sandbox limitando o alcance?",
            ]
          : [];
      return {
        decision: "block",
        mode: modo.name,
        action: tipo,
        reason:
          modo.name === "plan"
            ? "o modo plan não escreve: a proposta fica retida até a aprovação do plano"
            : `o modo ${modo.name} não escreve`,
        questions: perguntas,
      };
    }

    if (path === null || path === undefined) {
      return juntar(decidir(modo, tipo, "modo " + modo.name + " escreve no workspace"), revisao);
    }

    const onde = classifyPath(path, workspace ?? process.cwd());
    if (onde === "inside") {
      return juntar(decidir(modo, tipo, "dentro do workspace"), revisao);
    }

    // fora (ou não dá para provar): o modo permite escrever, mas não ali
    return {
      decision: "ask",
      mode: modo.name,
      action: tipo,
      reason:
        onde === "outside"
          ? `${path} está fora do workspace (${workspace ?? process.cwd()})`
          : `não deu para provar que ${path} está dentro do workspace`,
      questions: [
        "Qual caminho fora do workspace precisa ser escrito, e por quê?",
        "O artefato pode escrever dentro do workspace e copiar o resultado depois?",
      ],
    };
  }

  // ---- execução
  if (!modo.canExec) {
    return {
      decision: "block",
      mode: modo.name,
      action: tipo,
      reason: `o modo ${modo.name} não executa`,
      questions: [],
    };
  }

  if (modo.execScope === "readonly") {
    if (command === null || command === undefined) {
      return {
        decision: "ask",
        mode: modo.name,
        action: tipo,
        reason: "modo plan só executa leitura; informe o comando para classificar",
        questions: ["Este comando é de leitura? Se sim, rode-o no modo build ou aprove a exceção."],
      };
    }
    if (isReadOnlyCommand(command)) {
      return juntar(decidir(modo, tipo, "comando de leitura"), revisao);
    }
    return {
      decision: "ask",
      mode: modo.name,
      action: tipo,
      reason: `modo plan só executa leitura; não deu para provar que \`${command}\` é leitura`,
      questions: ["Este comando só lê? Se sim, aprove a exceção ou troque para build."],
    };
  }

  return juntar(decidir(modo, tipo, "modo " + modo.name + " executa"), revisao);
}

/** Atalho: a porta de escrita, que é o caso que o modo precisa barrar antes de executar. */
export function guardWrite({ mode, path = null, workspace = null, code = null, scan = null, base = null } = {}) {
  return guard({ mode, action: WRITE, path, workspace, code, scan, base });
}

/* ------------------------------------------------------------------ */
/* Composição com approval.mjs                                         */
/* ------------------------------------------------------------------ */

/**
 * Se o modo deixa passar mas a aprovação acha que precisa de humano, o desfecho
 * vira "ask" e as perguntas vêm de lá. Nunca transforma um "block" em "ask":
 * proibição do modo não é negociável.
 */
function juntar(resultado, revisao) {
  if (!revisao) return resultado;
  if (revisao.needsHuman && resultado.decision === "allow") {
    return {
      ...resultado,
      decision: "ask",
      reason: revisao.reasons.join("; ") || "aprovação humana necessária",
      questions: revisao.questions,
    };
  }
  if (resultado.decision === "allow" && revisao.questions.length > 0) {
    return { ...resultado, questions: revisao.questions };
  }
  return resultado;
}

/* ------------------------------------------------------------------ */
/* Auto-verificação do registro                                        */
/* ------------------------------------------------------------------ */

/**
 * A regra de ouro em código: nenhum modo pode ser decorativo.
 * Um modo se justifica se diferir de outro em permissão, ou se declarar `base`
 * (caso do `goal`, que muda o escopo — persistência — e não a permissão).
 *
 * Lança no import se o registro encolher a um só comportamento.
 */
function assertRegistroTemSentido() {
  const nomes = Object.keys(REGISTRO);

  for (const nome of nomes) {
    const r = REGISTRO[nome];
    const temBase = r.base !== null || r.execScope === "inherit";
    const difereDeAlguem = nomes.some((outro) => {
      if (outro === nome) return false;
      const o = REGISTRO[outro];
      return (
        o.canRead !== r.canRead ||
        o.canWrite !== r.canWrite ||
        o.canExec !== r.canExec ||
        o.execScope !== r.execScope ||
        o.ask !== r.ask
      );
    });

    if (!temBase && !difereDeAlguem) {
      throw new Error(
        `modo decorativo: "${nome}" não muda ler/escrever/executar/quando-pergunta ` +
          "em relação a nenhum outro modo. Um modo tem de mudar pelo menos um."
      );
    }
  }
}
assertRegistroTemSentido();

/** Tabela pronta para relatório/CLI, com a justificativa de cada modo. */
export function describeModes() {
  return MODE_NAMES.map((nome) => {
    const r = REGISTRO[nome];
    const m = resolveMode(nome);
    return {
      name: m.name,
      canRead: m.canRead,
      canWrite: m.canWrite,
      canExec: m.canExec,
      execScope: m.execScope,
      ask: m.ask,
      base: m.base,
      nota: r.nota,
    };
  });
}

/** Modos que existem, em uma linha: "plan, build, ask, goal". */
export function modeList() {
  return MODE_NAMES.join(", ");
}