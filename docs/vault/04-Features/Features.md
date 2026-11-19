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