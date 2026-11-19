---
tags: [componentes, CLI]
created: 2026-11-19
---

# CLI (TUI)

> A interface de linha de comando do SelfEvoPI.

## Arquivo

`apps/cli.mjs` — ponto de entrada da CLI. Conversa com o motor (PI Coding Agent), lê
e escreve a pasta de sessões e expõe os comandos de barra.

## Comandos

Os 25 comandos reais, conforme `apps/cli.mjs` (`name: "/..."`):

| Comando | O que faz |
|:---|:---|
| `/model [nome]` | Mostra ou troca o modelo da conversa |
| `/effort [off\|low\|medium\|high]` | Esforço de raciocínio do modelo atual |
| `/mode [modo]` | Alterna o modo (plan → build → manual → ask → goal) |
| `/theme [escuro\|claro\|alto-contraste]` | Tema da interface |
| `/settings` | Visão de tudo que está configurado |
| `/sessions [id]` | Lista sessões ou carrega uma |
| `/cost` | Tokens e custo da sessão |
| `/context` | Quanto da janela de contexto está em uso |
| `/status` | Estado da sessão, modelo e modo |
| `/mcp` | Servidores MCP declarados (config global `~/.pi/settings.json`) |
| `/skills` | Skills do loop + skills do PC (`~/.pi/skills`) |
| `/memory <termo>` | Busca na memória (lexical + PPMI) |
| `/evals` | Roda os grupos A/B/C (estruturais) |
| `/gate` | Gate completo (usa modelo; pode demorar) |
| `/detect` | Lacunas de ferramenta em aberto |
| `/forge <meta>` | Inicia um ciclo evolutivo rumo à meta |
| `/init` | Gera um rascunho de AGENTS.md (pede confirmação) |
| `/plan` | Modo plan: lê e propõe, não escreve |
| `/build` | Modo build: escreve e executa no workspace |
| `/ask` | Modo ask: só responde, nunca toca em disco |
| `/goal [condição\|clear]` | Define/limpa a condição de conclusão |
| `/swarm [n] <tarefa>` | Orquestra n subagentes rumo à tarefa |
| `/clear` | Limpa a conversa e começa de novo |
| `/compact` | Compacta o histórico da conversa |
| `/help` | Mostra a lista de comandos |

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

- [[02-Componentes/Agent]] — o harness por trás da CLI (sessões, banner, inspect).
- [[02-Componentes/Roteador]] — quem escolhe o modelo que a CLI usa.