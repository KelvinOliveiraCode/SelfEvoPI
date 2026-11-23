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

## Settings view (TUI)

Visão do estado em linhas ≤ 72 colunas.

Ver [[03-Comandos/CLI]] para `/settings`.

## Temas

A TUI tem **12 temas embutidos** (padrao, violeta, azul, ciano, verde, esmeralda, laranja, rosa, vermelho, magenta, dourado, grafite) e **3 slots
custom** editáveis pelo usuário (`custom:1`..`custom:3`).

- `/theme` abre o seletor: as 12 paletas + os 3 slots + "gerenciar temas custom…".
- Cada tema define **11 papéis de cor** semânticos: `fg`, `muted`, `accent`, `ok`,
  `warn`, `fail`, `code`, `tool`, `link`, `rule`, `bg`.
- "gerenciar temas custom…" abre o editor: modo **geral** (5 papéis, fg, accent,
  ok, warn, fail) ou **detalhado** (os 11 papéis + bg), com paleta de 12 cores
  prontas ou hex livre. Os slots vivem em `~/.pi/agent/custom-themes.json`.
- **Fallback ANSI-256**: sem truecolor (`COLORTERM` ausente, `TERM=dumb`), a paleta
  vira `\x1b[38;5;Nm` (ANSI-256), funciona em todo terminal moderno, inclusive o
  console clássico do Windows, sem o bug de "nada muda".

Ver `core/agent/theme.mjs` e `core/agent/theme-custom.mjs`.

## Hooks de ciclo de vida

Workspaces podem declarar ganchos em `.pi/hooks.json` (arquivo do workspace,
não a config pessoal do agente). Eventos: `turn_start`, `turn_end`,
`tool_start`, `tool_result`, `error` e `compact`. Cada hook recebe um payload
JSON no stdin, roda sem shell, com ambiente mínimo e timeout configurável;
a saída é redigida antes de aparecer. Um hook que falha ou expira é registrado
como observabilidade e **nunca** derruba o turno. `/hooks` mostra a config e os
últimos resultados. Implementação em `core/agent/hooks.mjs`.

## Papéis de modelo e rewind

Nove papéis (`default`, `smol`, `slow`, `plan`, `commit`, `advisor`, `vision`,
`task`, `tiny`) selecionam modelos por contexto, custo, suporte a imagem e
esforço de raciocínio. Há cadeia de fallback, regras por caminho de repositório
e cooldown para modelos que falharam — tudo em `core/router/model-roles.mjs`,
sem tocar no roteador.

`/rewind` recorta a sessão ativa em um **novo** arquivo JSONL, nos modos
`drop-errors`, `last:N` ou `id:<id>`. A sessão original nunca é sobrescrita e o
relatório cabe em 72 colunas sem reticências.

## Interação por clique e resiliência

Em TTY a CLI habilita mouse SGR: clique na paleta executa o comando, no seletor
escolhe o item, na barra de estado abre o seletor de modelo, nas dicas abre
`/help` e no prompt posiciona o cursor. Relatórios de mouse e de posição são
separados do fluxo de comando, então um clique nunca vira texto digitado.

A moldura acompanha `stdout.columns` (com `SIGWINCH`), sem piso fixo de 72 em
TTY; `--render` continua determinístico. Uma chamada ao modelo é tentada até
cinco vezes antes do erro, e a sessão do motor é reiniciada após três falhas —
isso evita a mensagem de erro se repetindo infinitamente mesmo após `/model`.

## Code Mode (opt-in)

Para instalações com muitos servidores MCP, `core/agent/code-mode.mjs` permite
que o modelo escreva um programa curto que encadeia chamadas por
`tools.call(nome, args)`, em vez de fazer uma ida e volta por ferramenta. O
contexto é um `node:vm` sem `process`, `require`, `fetch`, `eval` ou `Function`,
com allowlist, limite de chamadas, prazo e teto de saída.

`scripts/code-mode-mcp.mjs` é o gateway: expõe só `run_code` e descobre servidores
e ferramentas da config **local** em tempo de execução. Nenhum nome de servidor,
comando ou segredo entra no repositório. O registro é local e opt-in, com backup
da config. Ver `docs/agent-guides/hooks-e-seguranca.md`.

## Ledger de segurança

Decisões `block` e `warn` do gate são gravadas em
`.pi/harness/ledger/blocked.jsonl`: timestamp, arquivo relativo ao workspace,
regras, linha e excerpt redigido. A gravação é best-effort — falha de I/O não
altera a decisão do gate nem impede a execução. `/security-log` consulta as
últimas entradas. Implementação em `core/sandbox/telemetry.mjs`, ligada em
`core/sandbox/run-sandboxed.mjs`.

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

## Atividade (Ctrl+P)

Lista o que está rodando, shells e subagentes, com status (`●`/`✓`/`✗`/`○`) e
meta (persistente/temporário, provider/modelo, effort).

- Subagente **persistente**: pode ser inspecionado/interagido.
- Subagente **temporário**: read-only (só parar).

Ver `core/agent/activity.mjs` e `startActivityPanel` em `apps/cli.mjs`.

## Sessões e settings na TUI (Ctrl+K, Ctrl+O)

- `Ctrl+K` abre a lista de sessões. Ao escolher uma, abre um submenu com duas ações:
  abrir a sessão ou deletar o arquivo dela. A exclusão pede confirmação antes de
  remover.
- `Ctrl+O` abre o editor interativo de settings: troca tema, modo, permissão, modelo
  e esforço sem sair da conversa (`startSettingsPicker` em `apps/cli.mjs`).
- `Ctrl+,` continua abrindo as configurações estáticas (a visão em texto).

## Provedores e workspace

- `/providers [list|add|rm|models]`, registra/remove provedores e seus modelos
  (`core/agent/providers.mjs`), que o roteador passa a enxergar.
- `/worktree [list|new|rm]`, worktrees git isoladas (`core/agent/worktree.mjs`).
- `/workspace [caminho]` troca o diretório de trabalho; `/explorer` abre o seletor de
  pasta do Windows (`core/agent/file-explorer.mjs`, `core/agent/list-window.mjs`).
  O antigo alias `/pasta` foi removido.

## Plugins (MCP)

Um "plugin" é um servidor MCP configurado em `~/.pi/settings.json`. Dois comandos
leem essa lista:

- `/mcp` lista os servidores com status (configurado, desabilitado, quebrado) e o
  comando de cada um.
- `/plugins` lista os mesmos e ainda sonda: `/plugins <nome>` faz o handshake JSON-RPC
  e mostra as tools que o servidor expõe; `/plugins test` sonda todos os ativos.

A leitura é a mesma fonte do `/mcp`, o settings global, não a config de outro harness.
Ver `core/agent/mcp-probe.mjs` (`listConfiguredMcp`, `probeMcpServer`).

## Esforço (effort)

`/effort` consulta o modelo em uso (`get_available_thinking_levels`). O nível `"none"`,
que alguns modelos devolvem quando não têm raciocínio, é filtrado em três lugares: na
linha de status (`statusInfo.reasoning` vira `null`, então não aparece `think:none`), no
seletor (`startEffortPicker`) e no próprio `/effort`. Quando o motor só expõe `"none"`,
os três mostram os níveis padrão `off/low/medium/high` (`EFFORT_FALLBACK` em
`apps/cli.mjs`); o modelo pode ignorá-los, mas o usuário tem o que escolher.

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