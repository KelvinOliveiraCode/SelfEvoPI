---
tags: [comandos, CLI]
created: 2026-11-19
---

# Comandos da CLI

> Comandos que o usuário digita no prompt da CLI ou desktop. Extraídos de
> `apps/cli.mjs` (lista `COMMANDS`, com `name: "/..."`).

## Comandos de barra (`/`)

Os **25 comandos reais**, conforme `apps/cli.mjs`:

### Conversa e sessão

| Comando | O que faz | Onde vive |
|:---|:---|:---|
| `/clear` | Limpa a conversa e começa de novo | `apps/cli.mjs` |
| `/compact` | Compacta o histórico da conversa | `core/agent/compact.mjs` |
| `/sessions [id]` | Lista sessões ou carrega uma | `core/agent/sessions.mjs` |
| `/model [nome]` | Mostra ou troca o modelo da conversa | `core/router/router.mjs` |
| `/effort [off\|low\|medium\|high]` | Esforço de raciocínio do modelo atual | `apps/cli.mjs` |
| `/mode [modo]` | Alterna o modo (plan → build → manual → ask → goal) | `core/governance/modes.mjs` |
| `/theme [escuro\|claro\|alto-contraste]` | Tema da interface | `apps/cli.mjs` |
| `/settings` | Visão de tudo que está configurado | `apps/cli.mjs` (`renderSettings`) |

### Diagnóstico

| Comando | O que faz | Onde vive |
|:---|:---|:---|
| `/cost` | Tokens e custo da sessão | `apps/cli.mjs` (ledger) |
| `/context` | Quanto da janela de contexto está em uso | `apps/cli.mjs` |
| `/status` | Estado da sessão, modelo e modo | `apps/cli.mjs` |
| `/mcp` | Servidores MCP declarados | `apps/cli.mjs` (lê config própria) |
| `/skills` | Skills do loop + skills do PC (`~/.pi/skills`) | `apps/cli.mjs` + `core/agent/skills-pc.mjs` |
| `/memory <termo>` | Busca na memória (lexical + PPMI) | `core/memory/extension.mjs` |
| `/help` | Mostra a lista de comandos | `apps/cli.mjs` |

`/mcp` e `/settings` leem a config **global do usuário** (`~/.pi/settings.json`,
chave `mcpServers`), não a config de outro harness. `/skills` combina duas fontes:
as skills que o loop gerou (`.pi/harness/memory/skills.jsonl`) e as skills do PC
(`~/.pi/skills/<nome>/SKILL.md`, padrão agentskills.io) — antes só a primeira aparecia.

### Modos de permissão (atalhos diretos)

| Comando | O que faz |
|:---|:---|
| `/plan` | Modo plan: lê e propõe, não escreve |
| `/build` | Modo build: escreve e executa no workspace |
| `/ask` | Modo ask: só responde, nunca toca em disco |
| `/goal [condição\|clear]` | Define/limpa a condição de conclusão |

`/mode` alterna entre os cinco modos (plan → build → manual → ask → goal); os
atalhos `/plan` `/build` `/ask` `/goal` vão direto a um modo específico.

Ver [[05-Decisoes/Modos]] para a tabela completa dos 5 modos.

### Auto-evolução

| Comando | O que faz | Onde vive |
|:---|:---|:---|
| `/detect` | Lacunas de ferramenta em aberto | `core/forge/detect.mjs` |
| `/forge <meta>` | Inicia um ciclo evolutivo rumo à meta | `core/forge/loop.mjs` |
| `/evals` | Roda os grupos A/B/C (estruturais) | `evals/run.mjs` |
| `/gate` | Gate completo (usa modelo; pode demorar) | `evals/gate.mjs` |
| `/init` | Gera um rascunho de AGENTS.md (pede confirmação) | `core/agent/init.mjs` |

### Orquestração

| Comando | O que faz | Onde vive |
|:---|:---|:---|
| `/swarm [n] <tarefa>` | Orquestra n subagentes rumo à tarefa | `apps/cli.mjs` (`runSwarm`) |

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
| `Ctrl+O` | Abre/fecha o painel de estado (modo, permissão, modelo) |
| `Ctrl+K` | Abre/fecha a lista de sessões (mesma tecla do desktop) |
| `Ctrl+,` | Abre/fecha as configurações (mesma tecla do desktop) |
| `q` / `/quit` / `Ctrl+D` | Sai |

## Nota de honestidade

`/resume` e `/rewind` **não existem** na CLI do SelfEvoPI — são comandos do Claude Code.
A CLI do SelfEvoPI tem os 25 comandos acima, e nada mais. A lista do Claude Code
(76+ comandos) é a referência que inspirou o desenho. Ver
[[07-Inspiracoes/Inspiracoes]] para a comparação.