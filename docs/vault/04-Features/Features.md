---
tags: [features]
created: 2026-11-19
---

# Features

> O que existe e como usar.

## Auto-evolução

O loop detecta lacunas, gera artefatos e promove sem regressão.

```bash
node core/forge/cli.mjs detect --json
node core/forge/cli.mjs evolve --goal "calcular o IMC" --kind cli --llm
node core/forge/cli.mjs status
```

Ver [[02-Componentes/Forge]].

## Roteador multi-provider

Escolhe qual conta e modelo atende cada tarefa.

```bash
node core/router/cli.mjs --profile worker
node core/router/cli.mjs --snapshot
```

Ver [[02-Componentes/Roteador]].

## Memória persistente

3 níveis (session/project/skills), teto de 400 tok/turno.

Ver [[02-Componentes/Memoria]].

## Sandbox

Gate estático + Node Permission Model.

Ver [[02-Componentes/Sandbox]].

## Grafo de execução

DAG com nós human, checkpoints, retomada.

Ver [[02-Componentes/Grafo]].

## Rotina diária

Diagnóstico → apply (com autogate) → relatório.

```bash
node scripts/daily.mjs --dry-run
node scripts/daily.mjs
node scripts/schedule.mjs --status
```

Agendamento: `SelfEvoPI-Daily` (07:00, Windows Task Scheduler).

## Desktop

Janela webview com chat, sessões, configurações.

Ver [[02-Componentes/Desktop]].

## Settings view (TUI)

Visão do estado em linhas ≤ 72 colunas.

Ver [[03-Comandos/CLI]] para `/settings`.

## Temas

A TUI tem **3 temas embutidos** (`escuro`, `violeta`, `alto-contraste`) e **3 slots
custom** editáveis pelo usuário (`custom:1`..`custom:3`).

- `/theme` abre o seletor: 3 built-in + os 3 slots + "gerenciar temas custom…".
- Cada tema define **11 papéis de cor** semânticos: `fg`, `muted`, `accent`, `ok`,
  `warn`, `fail`, `code`, `tool`, `link`, `rule`, `bg`.
- "gerenciar temas custom…" abre o editor: modo **geral** (5 papéis, fg, accent,
  ok, warn, fail) ou **detalhado** (os 11 papéis + bg), com paleta de 12 cores
  prontas ou hex livre. Os slots vivem em `~/.pi/agent/custom-themes.json`.
- **Fallback ANSI-256**: sem truecolor (`COLORTERM` ausente, `TERM=dumb`), a paleta
  vira `\x1b[38;5;Nm` (ANSI-256), funciona em todo terminal moderno, inclusive o
  console clássico do Windows, sem o bug de "nada muda".

Ver `core/agent/theme.mjs` e `core/agent/theme-custom.mjs`.

## Subagentes

Filosofia dsh: o modelo principal **molda** subagentes (provider/modelo/esforço/modo)
e os distribui. Dois sabores:

- **Temporário** (default): roda a tarefa e morre.
- **Persistente** (`--persistent`): mantém sessão própria entre chamadas, reutilizável.

```bash
# n subagentes temporários em round-robin, executados e sintetizados
node apps/cli.mjs    # /swarm [n] <tarefa>

# subagente nomeado, moldado, persistente
node apps/cli.mjs    # /subagent <nome> <tarefa> [--provider p --model m --effort e --mode m --persistent]
```

- **A2A** (`sendA2A` em `core/agent/subagent.mjs`): um subagente **persistente** manda
  mensagem para outro persistente, ou para `@orquestrador`/`main` (o chamador injeta a
  mensagem no turno principal). Temporários não são endereçáveis.

## Painel de atividade (Ctrl+P)

Lista o que está rodando, shells e subagentes, com status (`●`/`✓`/`✗`/`○`) e
meta (persistente/temporário, provider/modelo, effort).

- Subagente **persistente**: pode ser inspecionado/interagido.
- Subagente **temporário**: read-only (só parar).

Ver `core/agent/activity.mjs` e `startActivityPanel` em `apps/cli.mjs`.

## Provedores e workspace

- `/providers [list|add|rm|models]`, registra/remove provedores e seus modelos
  (`core/agent/providers.mjs`), que o roteador passa a enxergar.
- `/worktree [list|new|rm]`, worktrees git isoladas (`core/agent/worktree.mjs`).
- `/workspace [caminho]`, `/explorer`, `/pasta`, trocam o diretório de trabalho;
  `/explorer` e `/pasta` abrem o seletor de pasta do Windows (`core/agent/file-explorer.mjs`).

## Esforço (effort)

`/effort` consulta o modelo em uso (`get_available_thinking_levels`). Modelos que só
expõem `"none"` (sem raciocínio) agora mostram os **níveis padrão**
(`off/low/medium/high`) em vez de um seletor inútil de 1 item, o modelo pode ignorá-los,
mas o usuário tem o que escolher. `EFFORT_FALLBACK` em `apps/cli.mjs`.

## Medições

```bash
node scripts/measure-overhead.mjs --runs 5
node scripts/measure-selfevopi-overhead.mjs --runs 3
```

Ver [[08-Desempenho/Desempenho]] para números.

## Verificação

```bash
npm test
npm run verify
node evals/gate.mjs
```