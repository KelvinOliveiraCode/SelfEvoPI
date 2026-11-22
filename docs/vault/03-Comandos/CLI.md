---
tags: [comandos, CLI]
created: 2026-11-19
updated: 2026-11-20
---

# Comandos da CLI

> Comandos que o usuário digita no prompt da CLI. Extraídos de
> `apps/cli.mjs` (lista `COMMANDS`, com `name: "/..."`). A lista é a fonte única:
> o `/help` e a paleta leem dela.

## Comandos de barra (`/`)

Os comandos reais, conforme a lista `COMMANDS` em `apps/cli.mjs` (a fonte
única — `/help` e a paleta leem dela):

### Conversa e sessão

| Comando | O que faz | Onde vive |
|:---|:---|:---|
| `/clear` | Limpa a conversa e começa de novo | `apps/cli.mjs` |
| `/compact` | Compacta o histórico da conversa | `core/agent/compact.mjs` |
| `/sessions [id]` | Lista sessões ou carrega uma | `core/agent/sessions.mjs` |
| `/model [nome]` | Mostra ou troca o modelo da conversa | `core/router/router.mjs` |
| `/effort [off\|low\|medium\|high]` | Esforço de raciocínio do modelo atual | `apps/cli.mjs` |
| `/mode [modo]` | Alterna o modo (plan, build, manual, ask, goal) | `core/governance/modes.mjs` |
| `/theme [tema]` | Tema da interface (12 paletas: padrao, violeta, azul, ciano, verde, esmeralda, laranja, rosa, vermelho, magenta, dourado, grafite; + 3 slots custom) | `apps/cli.mjs`, `core/agent/theme.mjs`, `core/agent/theme-custom.mjs` |
| `/settings` | Visão de tudo que está configurado | `apps/cli.mjs` (`renderSettings`) |
| `/fork [nome]` | Bifurca a sessão preservando a original | `core/agent/sessions.mjs` |
| `/export [md\|json]` | Exporta a conversa | `apps/cli.mjs` |
| `/undo` / `/redo` | Desfaz/refaz a última troca | `apps/cli.mjs` |
| `/diff` | Mostra mudanças git no workspace | `apps/cli.mjs` |
| `/language [en\|pt]` | Idioma da interface (inglês por padrão) | `core/agent/i18n.mjs` |
| `/history [n\|clear]` | Trilha da sessão: tools, resultados, raciocínio, respostas | `apps/cli.mjs` |
| `/resume [id]` | Retoma sessão salva (nova é o padrão na abertura) | `apps/cli.mjs`, `core/agent/pi-rpc.mjs` |
| `/verbosity [nível]` | Quanto feedback aparece no turno | `core/agent/verbosity.mjs` |
| `/paste` / `/attach` / `/images` | Anexos de imagem | `core/agent/attachments.mjs` |

### Diagnóstico

| Comando | O que faz | Onde vive |
|:---|:---|:---|
| `/cost` | Tokens e custo da sessão | `apps/cli.mjs` (ledger) |
| `/context` | Quanto da janela de contexto está em uso | `apps/cli.mjs` |
| `/status` | Estado da sessão, modelo e modo | `apps/cli.mjs` |
| `/mcp` | Servidores MCP configurados no settings global | `apps/cli.mjs` (`runMcp`), `core/agent/mcp-probe.mjs` |
| `/plugins [nome\|test]` | Lista os plugins (MCP) ativos; com `nome` sonda um, com `test` sonda todos | `apps/cli.mjs` (`runPlugins`), `core/agent/mcp-probe.mjs` |
| `/skills` | Skills do loop + skills do PC (`~/.pi/skills`) | `apps/cli.mjs`, `core/agent/skills-user.mjs` |
| `/memory <termo>` | Busca na memória (lexical + PPMI) | `core/memory/store.mjs` |
| `/help` | Mostra a lista de comandos | `apps/cli.mjs` (`renderHelp`) |

`/mcp` e `/plugins` leem o settings global (`~/.pi/settings.json`, chave `mcpServers`).
`/mcp` lista os servidores com status; `/plugins` faz mais: com um nome, executa o
handshake JSON-RPC e mostra as tools que o servidor expõe; com `test`, sonda todos os
ativos. `/settings` também lê a config global do usuário, não a de outro harness.
`/skills` combina duas fontes: as skills que o loop gerou
(`.pi/harness/memory/skills.jsonl`) e as skills do PC
(`~/.pi/skills/<nome>/SKILL.md`, padrão agentskills.io).

### Modos de permissão (atalhos diretos)

| Comando | O que faz |
|:---|:---|
| `/plan` | Modo plan: lê e propõe, não escreve |
| `/build` | Modo build: escreve e executa no workspace |
| `/ask` | Modo ask: só responde, nunca toca em disco |
| `/goal [condição\|clear]` | Define/limpa a condição de conclusão |

`/mode` alterna entre os cinco modos (plan, build, manual, ask, goal); os
atalhos `/plan`, `/build`, `/ask` e `/goal` vão direto a um modo específico.

Ver [[05-Decisoes/Modos]] para a tabela completa dos 5 modos.

### Auto-evolução

| Comando | O que faz | Onde vive |
|:---|:---|:---|
| `/detect` | Lacunas de ferramenta em aberto | `core/forge/detect.mjs` |
| `/evo <meta>` | Modo principal: o harness evolui/modela a si mesmo rumo à meta | `core/forge/cli.mjs evolve` |
| `/init` | Gera um rascunho de AGENTS.md (pede confirmação) | `core/agent/init.mjs` |
| `/import [importar\|--undo\|--status]` | Traz MCPs e skills para a config própria (pede confirmação) | `core/agent/import.mjs` |

`/evo` substituiu o antigo `/forge` (a função interna ainda se chama `runForge`).
`/evals` e `/gate` saíram da lista de comandos: as funções `runEvals` e `runGate`
ainda existem em `apps/cli.mjs`, mas não estão em `COMMANDS`, então não são mais
digitáveis como `/...`. Para rodar a suíte, use `node evals/run.mjs` e
`node evals/gate.mjs` direto (ver [[04-Features/Features]]).

### Orquestração e workspace

| Comando | O que faz | Onde vive |
|:---|:---|:---|
| `/swarm [n] <tarefa>` | Molda e executa n subagentes (temporários) em round-robin | `core/agent/subagent.mjs`, `core/agent/swarm.mjs` |
| `/subagent <nome> <tarefa> [--provider --model --effort --mode --persistent]` | Subagente moldado: nomeado, persistente ou temporário | `core/agent/subagent.mjs` |
| `/worktree [list\|new\|rm]` | Worktrees git isoladas | `core/agent/worktree.mjs` |
| `/workspace [caminho]` | Troca o diretório de trabalho dos agentes | `core/agent/list-window.mjs` |
| `/explorer` | Abre o explorador do Windows e escolhe a pasta/workspace | `core/agent/file-explorer.mjs` |
| `/providers [list\|add\|rm\|models]` | Registra/remove provedores e seus modelos | `core/agent/providers.mjs` |

`/explorer` abre um seletor de pasta do Windows e ajusta o workspace. O antigo
alias `/pasta` foi removido. `/providers` gerencia a lista de provedores (chave,
base URL, modelos) que o roteador enxerga.

## CLI não-interativa (argumentos de `argv`)

| Comando | O que faz |
|:---|:---|
| `node apps/cli.mjs` | Inicia a conversa |
| `node apps/cli.mjs --help` / `-h` | Mostra a ajuda |
| `node apps/cli.mjs --version` / `-v` | Mostra a versão |
| `node apps/cli.mjs --render conversation` | Mostra um frame de exemplo |
| `node apps/cli.mjs --render help` | Mostra os comandos |
| `node apps/cli.mjs --render banner` | Mostra só o banner + estado |

Variáveis de ambiente: `SELFEOPI_MODEL=provedor/modelo` define o modelo da conversa.
Sair: `q`, `/quit` ou `Ctrl+D`.

## Atalhos

| Tecla | Comportamento |
|:---|:---|
| `Ctrl+C` | Cancela a resposta em curso e devolve a linha |
| `Ctrl+O` | Abre o editor interativo de settings (tema, modo, permissão, modelo, esforço) |
| `Ctrl+K` | Abre a lista de sessões; submenus para abrir ou deletar uma sessão |
| `Ctrl+P` | Abre a lista de atividade (shells e subagentes em execução) |
| `Ctrl+,` | Abre/fecha as configurações estáticas |
| `q` / `/quit` / `Ctrl+D` | Sai |

`Ctrl+K` mostra as sessões; ao escolher uma, abre um submenu com "abrir" e "deletar"
(a exclusão pede confirmação antes de remover o arquivo). `Ctrl+P` lista o que está
rodando; subagente persistente pode ser inspecionado, temporário é read-only (só parar).
Ver [[04-Features/Features]].

## Nota de honestidade

`/resume` e `/rewind` não existem na CLI do SelfEvoPI; são comandos do Claude Code.
A CLI do SelfEvoPI tem os 30 comandos acima, e nada mais. A lista do Claude Code
(76+ comandos) é a referência que inspirou o desenho. Ver
[[07-Inspiracoes/Inspiracoes]] para a comparação.