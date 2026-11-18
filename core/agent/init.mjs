/**
 * core/agent/init.mjs — gera o rascunho de um AGENTS.md.
 *
 * Existe para responder `/init`: "escreva o contexto deste projeto num
 * arquivo que um agente leia antes de trabalhar". O que este módulo faz é
 * **montar a string**; quem grava é o chamador, depois de um humano revisar.
 *
 * Duas decisões que definem o módulo:
 *
 *   1. É função pura. Não lê disco, não escreve arquivo, não olha relógio.
 *      Entrada igual → saída byte a byte igual. Isso é o que torna o módulo
 *      testável sem I/O e seguro para rodar em CI.
 *   2. O texto gerado se declara **rascunho** na primeira linha útil. Um
 *      AGENTS.md é instrução permanente; ninguém deveria transformar um
 *      texto de máquina em instrução permanente sem passar por uma pessoa.
 *
 * Interface pública:
 *
 *   import { renderAgentDoc } from "./core/agent/init.mjs";
 *
 *   const markdown = renderAgentDoc({
 *     project: { name: "SelfEvoPI", description: "Harness auto-evolutivo..." },
 *   });
 *   // ... revisão humana ...
 *   await writeFile("AGENTS.md", markdown);
 *
 * Campos aceitos em `project` (todos opcionais; o que faltar usa o default
 * do SelfEvoPI, para que `/init` já entregue algo útil):
 *
 *   name, description, version
 *   verify       comando de verificação completo       (default "npm run verify")
 *   test         comando só dos testes                 (default "npm test")
 *   folders      [{ path, purpose }]                   (default: estrutura do SelfEvoPI)
 *   protected    [{ path, why }]                       (default: áreas protegidas)
 *   conventions  [string]                              (default: convenções do projeto)
 */

/* ------------------------------------------------------------------ */
/* Defaults — o formato do SelfEvoPI, para `/init` já sair útil        */
/* ------------------------------------------------------------------ */

const DEFAULT_VERIFY = "npm run verify";
const DEFAULT_TEST = "npm test";

const DEFAULT_FOLDERS = [
  { path: "core/", purpose: "o harness: roteador, forge, grafo, governança, sandbox, memória, agente" },
  { path: "evals/", purpose: "a suíte de evals e seus verificadores determinísticos" },
  { path: "scripts/", purpose: "ferramentas de operação e verificação" },
  { path: "docs/", purpose: "estado do projeto, pesquisa, decisões e relatórios" },
];

const DEFAULT_PROTECTED = [
  { path: "evals/", why: "é o juiz. Um juiz que pode ser editado pelo réu não julga nada" },
  { path: "core/governance/", why: "rollback e aprovação. Alterar isso remove o próprio freio" },
  { path: "scripts/verify-urls.mjs", why: "gate de integridade das fontes citadas" },
];

const DEFAULT_CONVENTIONS = [
  "Commits em Conventional Commits, com escopo (ex.: `feat(forge): ...`).",
  "Nenhum segredo, token ou caminho pessoal em commit, log ou relatório.",
  "Mudança de comportamento exige atualizar a baseline de evals com justificativa no arquivo — nunca afrouxar o verificador.",
  "`npm run verify` tem que passar antes de abrir um pull request.",
];

const DEFAULT_NAME = "SelfEvoPI";
const DEFAULT_DESCRIPTION =
  "harness de agente de código, leve e auto-evolutivo, construído sobre o PI Coding Agent";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function asNonEmptyString(value, fallback) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

function normalizeFolders(folders) {
  if (!Array.isArray(folders) || folders.length === 0) return DEFAULT_FOLDERS;
  return folders
    .filter((f) => f && typeof f.path === "string" && f.path.trim() !== "")
    .map((f) => ({
      path: f.path.trim(),
      purpose: typeof f.purpose === "string" ? f.purpose.trim() : "",
    }));
}

function normalizeProtected(protectedAreas) {
  if (!Array.isArray(protectedAreas) || protectedAreas.length === 0) return DEFAULT_PROTECTED;
  return protectedAreas
    .filter((p) => p && typeof p.path === "string" && p.path.trim() !== "")
    .map((p) => ({
      path: p.path.trim(),
      why: typeof p.why === "string" ? p.why.trim() : "",
    }));
}

function normalizeConventions(conventions) {
  if (!Array.isArray(conventions)) return DEFAULT_CONVENTIONS;
  const list = conventions.filter((c) => typeof c === "string" && c.trim() !== "");
  return list.length > 0 ? list : DEFAULT_CONVENTIONS;
}

/* ------------------------------------------------------------------ */
/* renderAgentDoc                                                      */
/* ------------------------------------------------------------------ */

/**
 * Monta o conteúdo do AGENTS.md.
 *
 * @param {{ project?: object }} [options]
 * @returns {string} markdown pronto para gravar
 */
export function renderAgentDoc({ project = {} } = {}) {
  const source = project && typeof project === "object" ? project : {};

  const name = asNonEmptyString(source.name, DEFAULT_NAME);
  const description = asNonEmptyString(source.description, DEFAULT_DESCRIPTION);
  const version = asNonEmptyString(source.version, "");
  const verify = asNonEmptyString(source.verify, DEFAULT_VERIFY);
  const test = asNonEmptyString(source.test, DEFAULT_TEST);
  const folders = normalizeFolders(source.folders);
  const protectedAreas = normalizeProtected(source.protected);
  const conventions = normalizeConventions(source.conventions);

  const lines = [];

  lines.push(`# AGENTS.md — ${name}`);
  lines.push("");
  lines.push(
    "> **RASCUNHO GERADO — REVISO HUMANO OBRIGATÓRIO.** Este arquivo foi montado",
  );
  lines.push(
    "> por `core/agent/init.mjs` a partir do que o projeto declara sobre si. Ele",
  );
  lines.push(
    "> **não** é instrução permanente: cada linha abaixo precisa ser lida e",
  );
  lines.push(
    "> aprovada por uma pessoa antes de virar regra. O que estiver errado, apague;",
  );
  lines.push(
    "> o que faltar, acrescente. Um agente que segue um rascunho não revisado está",
  );
  lines.push("> seguindo um palpite.");
  lines.push("");

  lines.push("## O que é");
  lines.push("");
  lines.push(
    `**${name}** — ${description.charAt(0).toLowerCase()}${description.slice(1)}.`,
  );
  if (version) {
    lines.push("");
    lines.push(`Versão declarada: \`${version}\`.`);
  }
  lines.push("");

  lines.push("## Como rodar");
  lines.push("");
  lines.push("```powershell");
  lines.push(verify);
  lines.push("```");
  lines.push("");
  lines.push(
    "É a verificação completa — a mesma que a integração contínua executa. " +
      "Rode antes de abrir um pull request.",
  );
  if (verify !== test) {
    lines.push("");
    lines.push("Só os testes, quando a verificação completa é lenta demais:");
    lines.push("");
    lines.push("```powershell");
    lines.push(test);
    lines.push("```");
  }
  lines.push("");

  lines.push("## Estrutura");
  lines.push("");
  lines.push("| Caminho | O que tem |");
  lines.push("|:---|:---|");
  for (const folder of folders) {
    const purpose = folder.purpose ? ` — ${folder.purpose}` : "";
    lines.push(`| \`${folder.path}\` | ${folder.purpose || "—"} |`);
  }
  lines.push("");

  lines.push("## Áreas protegidas");
  lines.push("");
  lines.push(
    "Ninguém toca nestes caminhos — nem agente, nem orquestrador, nem o loop " +
      "evolutivo:",
  );
  lines.push("");
  lines.push("| Caminho | Por quê |");
  lines.push("|:---|:---|");
  for (const area of protectedAreas) {
    lines.push(`| \`${area.path}\` | ${area.why || "—"} |`);
  }
  lines.push("");

  lines.push("## Convenções");
  lines.push("");
  for (const convention of conventions) {
    lines.push(`- ${convention}`);
  }
  lines.push("");

  return lines.join("\n");
}