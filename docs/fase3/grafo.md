# Grafo de execução

O grafo descreve uma execução multi-agente como nós e arestas. Cada nó é uma
etapa (`task`, `human`, `agent`), cada aresta é um handoff de dados. A ordem
topológica é validada antes de executar.

## Módulos

| Arquivo | Papel |
|:--|:--|
| `core/graph/model.mjs` | modelo, validação, ordem topológica |
| `core/graph/executor.mjs` | execução com timeout e gate humano |
| `core/graph/runtime.mjs` | checkpoint por nó, pausa e retomada |
| `core/graph/harness-state.mjs` | formato git-nativo do estado |
| `core/graph/harness-store.mjs` | persistência em `.pi/harness/graph/` |
| `core/graph/panel.mjs` | leitura ASCII e HTML do grafo |

## Checkpoints

Cada execução vira um JSON em `.pi/harness/graph/<runId>.json` mais um
`index.json` com a lista de runs. O estado inclui `sha`/`label` de Git, o que
amarra cada nó a um commit verificável. Pausar e retomar não reexecuta o que já
passou.

## Verificação

```powershell
node --test core/graph/*.test.mjs
```
