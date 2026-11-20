---
tags: [componentes, CLI]
created: 2026-11-19
---

# CLI (TUI)

> A interface de linha de comando do SelfEvoPI.

## Arquivo

`apps/cli.mjs`, ponto de entrada da CLI. Conversa com o motor (PI Coding Agent), lê
e escreve a pasta de sessões e expõe os comandos de barra.

## Comandos

Os 30 comandos reais, conforme `apps/cli.mjs` (`name: "/..."`):

| Comando | O que faz |
|:---|:---|
| `/model [nome]` | Mostra ou troca o modelo da conversa |
| `/effort [off\|low\|medium\|high]` | Esforço de raciocínio do modelo atual |
| `/mode [modo]` | Alterna o modo (plan → build → manual → ask → goal) |
| `/theme [escuro\|violeta\|alto-contraste]` | Tema da interface (3 built-in + 3 slots custom) |
| `/settings` | Visão de tudo que está configurado |
| `/sessions [id]` | Lista sessões ou carrega uma |
| `/cost` | Tokens e custo da sessão |
| `/context` | Quanto da janela de contexto está em uso |
| `/status` | Estado da sessão, modelo e modo |
| `/mcp` | Servidores MCP declarados (config global `~/.pi/settings.json`) |
| `/skills` | Skills do loop + skills do PC (`~/.pi/skills`) |
| `/memory <termo>` | Busca na memória (lexical + PPMI) |
| `/detect` | Lacunas de ferramenta em aberto |
| `/evo <meta>` | **Modo principal**, o harness evolui/modela a si mesmo rumo à meta (substituiu `/forge`) |
| `/init` | Gera um rascunho de AGENTS.md (pede confirmação) |
| `/import [importar\|--undo\|--status]` | Traz MCPs e skills para a config própria |
| `/plan` | Modo plan: lê e propõe, não escreve |
| `/build` | Modo build: escreve e executa no workspace |
| `/ask` | Modo ask: só responde, nunca toca em disco |
| `/goal [condição\|clear]` | Define/limpa a condição de conclusão |
| `/swarm [n] <tarefa>` | Molda e executa n subagentes (temporários) |
| `/subagent <nome> <tarefa> [...] ` | Subagente moldado (persistente ou temporário) |
| `/worktree [list\|new\|rm]` | Worktrees git isoladas |
| `/workspace [caminho]` | Troca o diretório de trabalho |
| `/explorer` `/pasta` | Abre o explorador do Windows e escolhe a pasta |
| `/providers [list\|add\|rm\|models]` | Registra/remove provedores e modelos |
| `/clear` | Limpa a conversa e começa de novo |
| `/compact` | Compacta o histórico da conversa |
| `/help` | Mostra a lista de comandos |

> `/evals` e `/gate` **saíram** de `COMMANDS` (as funções existem, mas não são mais
> digitáveis). Use `node evals/run.mjs` e `node evals/gate.mjs`.

Ver [[03-Comandos/CLI]] para detalhes e atalhos.

## Banner

Logo ASCII na inicialização. `core/agent/banner.mjs`.

## Settings view

A visão de estado (`renderSettings`) vive em `apps/cli.mjs` (não em
`core/agent/settings-view.mjs`). Devolve linhas ≤ 72 colunas com modo, permissão,
modelo, esforço, tema, custo e contexto. Abre com `Ctrl+,` (mesma tecla do desktop).

## Truncamento de linha (`capLinhas`)

Linhas da TUI são truncadas em 72 colunas. Uma linha totalmente colorida que é cortada
agora fecha com `\x1b[0m` antes da reticência, para não vazar cor para o resto da
tela (correção do 1.1.1, `apps/cli.mjs`).

## Ver também

- [[02-Componentes/Agent]], o harness por trás da CLI (sessões, banner, inspect).
- [[02-Componentes/Roteador]], quem escolhe o modelo que a CLI usa.