---
tags: [handoff, estado, cli]
updated: 2026-11-21
---

# Estado atual — 1.2.5

> Uma superfície: a CLI. Inglês por padrão, `/language pt` para português.

## O que está pronto

### Conversa e interface

- REPL com streaming, markdown renderizado e atividade de ferramenta
  (`⏺ nome` + `⎿ N linhas (X KB)`), com falha visível.
- Raciocínio em bloco discreto, `Alt+T` para ocultar/mostrar, linha de resumo
  quando oculto.
- Barra de estado com modo, permissão, modelo, esforço, % de contexto e branch;
  `Ctrl+O` mostra o estado detalhado.
- Paleta com filtro por prefixo e fuzzy; `/help` e paleta leem a mesma fonte.
- `Ctrl+,` editor de configuração (tema, modo, permissão, modelo, esforço,
  idioma); `/settings` é a leitura estática.
- `Ctrl+K` sessões com busca e prévia; `Ctrl+P` atividade; `Ctrl+T` tarefas.
- Mensagens enfileiradas: digitar enquanto o agente trabalha não perde texto.
- `!comando` executa shell no workspace; `@arquivo` injeta arquivo no prompt.

### Feedback controlável

`/verbosity` (`minimal` / `tools` / `reasoning` / `full` / `verbose`) escolhe o
que aparece durante o turno; `Alt+T` alterna o raciocínio só na sessão. Linhas de
ferramenta mostram o arquivo-alvo, não o conteúdo escrito.

### Comandos de sessão e inspeção

`/fork`, `/diff`, `/export`, `/undo`, `/redo`, `/copy`, `/reload`, `/compact`,
`/cost`, `/status`, `/context`, `/mcp`, `/plugins`, `/init`, `/import`,
`/providers`, `/worktree`, `/workspace`, `/explorer`, `/swarm`, `/subagent`,
`/goal`, `/evo`, `/detect`, `/memory`, `/skills`, `/model`, `/effort`, `/mode`,
`/theme`, `/language`, `/settings`, `/clear`, `/help`.

### Núcleo auto-evolutivo

`detect → specify → generate → verify → gate → promote/revert`, com sonda de
interface por kind de artefato. Áreas protegidas: `evals/` e `core/governance/`.

### Verificação

```
npm test        # 1043 testes, 1042 passam, 1 skip
npm run verify  # exit 0
```

## Limites honestos

- `/btw`, keybindings customizáveis, hooks e barra de progresso no título: não
  implementados; exigem roteamento de modelo auxiliar ou camada de config ainda
  inexistente.
- Recuperação de skills é lexical (sem embeddings).
- Auto-disparo do loop evolutivo existe via `core/forge/auto.mjs` (`--watch`,
  dry-run por padrão), mas ainda não reage a eventos externos como webhooks.

## Índice de código

| Arquivo | Papel |
|:--|:--|
| `apps/cli.mjs` | REPL, paleta, comandos, renderização da TUI |
| `core/agent/i18n.mjs` | idioma da interface, padrão inglês |
| `core/agent/pi-rpc.mjs` | cliente do motor, eventos normalizados |
| `core/agent/sessions.mjs` | sessões, fork, lineage |
| `core/agent/theme*.mjs` | paleta e slots custom |
| `core/agent/activity.mjs` | lista de atividade (Ctrl+P) |
| `core/forge/` | loop evolutivo e sondas |
| `core/router/` | roteador multi-provider |
| `core/sandbox/`, `core/governance/` | isolamento e rollback |
| `evals/` | suíte determinística e gate |

Ver [[00-Mapa]] para navegar pela vault.
