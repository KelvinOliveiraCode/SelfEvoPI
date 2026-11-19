---
tags: [componentes, grafo]
created: 2026-11-19
---

# Grafo de Execução

> Executor de DAG com nós human, checkpoints, retomada.

## Arquivos

| Arquivo | O que faz |
|:---|:---|
| `core/graph/model.mjs` | Grafo, validação, ordem topológica |
| `core/graph/executor.mjs` | Executor com timeout, gate humano, pausa cooperativa |
| `core/graph/runtime.mjs` | Checkpoint por nó, pausa e retomada |
| `core/graph/harness-state.mjs` | Formato da ponte git-nativa |
| `core/graph/harness-store.mjs` | Persistência (um arquivo por run + index.json) |
| `core/graph/panel.mjs` | Painel ASCII e HTML autocontido |

## Nós

| Tipo | Comportamento |
|:---|:---|
| `task` | Executa `runNode` |
| `human` | Pausa e espera aprovação (autoApprove ou fila) |

## Estados

`pending` → `running` → `done` | `failed` | `blocked` | `waiting-human` | `skipped`

## Checkpoints

Cada nó salva checkpoint antes de executar. `resume()` retoma sem re-rodar os `done`.

## Ponte desktop

O `harness-state.mjs` produz o formato que o desktop lê. Git-nativo: cada run é um JSON em `.pi/harness/graph/<runId>.json` + `index.json`.

Ver [[09-Replicacao/Replicacao]] para como montar.