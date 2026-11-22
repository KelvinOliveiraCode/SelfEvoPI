# Suíte de evals

A suíte é o ativo central do SelfEvoPI: é ela que decide se um artefato gerado pelo loop evolutivo entra ou volta.

## Como funciona

```
evals/tasks/*.json   →  definição da tarefa (id, grupo, checker)
evals/checks/*.mjs   →  verificador determinístico (exit 0 = passou)
evals/run.mjs        →  executor: workspace temporário + ledger JSONL
evals/report.mjs     →  relatório de acerto, latência, tokens e custo
```

Cada tarefa roda em um **workspace temporário** (não no repo), com `EVAL_WORKDIR` e `EVAL_TASK_ID` no ambiente. O checker imprime uma linha JSON com métricas e sai 0 ou 1.

## Grupos

| Grupo | O que mede | Exemplos |
|:---|:---|:---|
| **A** | código: roteador, retry, circuit breaker | `A1-router-reviewer` |
| **B** | lacunas de ferramenta resolvidas | `B1-providers-present` |
| **C** | regressão: nada essencial pode degradar | `C1-gitignore-secrets` |
| **D** | modelo real: gera e corrige código | `D1-cria-soma`, `D2-corrige-contador` |

Os grupos A–C são **estruturais**: verificam a integridade do projeto sem chamar modelo. O grupo D é o único que **executa o PI de verdade**, mede tokens e depois valida o código gerado rodando o arquivo — não olhando para a aparência dele.

## Ledger

`.pi/harness/ledger/evals.jsonl` — append-only, uma linha por execução:

```json
{"at":"...","taskId":"A1-router-reviewer","group":"A","passed":true,"durationMs":105,"tokens":0,"costUsd":0}
```

Append-only é proposital: a trilha é a fonte de verdade para auditoria e regressão. Nada de sobrescrever histórico.

## Executando

```powershell
node evals/run.mjs                  # todas
node evals/run.mjs --group A        # um grupo
node evals/run.mjs --task A1-...    # uma tarefa
node evals/run.mjs --no-ledger      # dry-run
node evals/report.mjs               # relatório
node evals/report.mjs --last 20     # janela
```

## Escrevendo um checker

```js
#!/usr/bin/env node
import path from "node:path";
const ROOT = path.resolve(import.meta.dirname, "..", "..");

const problemas = [];
if (algoErrado) problemas.push("descrição do problema");

if (problemas.length > 0) {
  console.error(problemas.join("\n"));
  process.exit(1);
}
console.log(JSON.stringify({ tokens: 0, metrics: { verificacoes: 1 } }));
```

Regras:

1. Determinístico — sem rede, sem relógio, sem aleatoriedade não injetada.
2. Uma verificação por conceito; falhe com uma linha por problema.
3. Nunca imprima chaves ou segredos.
4. Métricas vão no JSON de stdout, não no texto de erro.

## Estado atual

14 tarefas, 11 checkers, 14/14 nesta execução (~6,2 s).

| Grupo | Tarefas | Cobre |
|:---|:---|:---|
| A | A1–A4 | roteador: reviewer, backoff, circuit breaker, retry |
| B | B1–B4 | providers: presença, schema, idempotência, rejeição |
| C | C1–C4 | regressão: segredos, testes unitários, documentação |
| D | D1–D2 | modelo real: geração de código e correção de bug |

Medição real por tarefa do grupo D (exemplo): D1 = 5,4 s / 8.167 tokens; D2 = 7,3 s / 8.360 tokens.

## Armadilhas de Windows que o executor resolveu

1. **`pi` é um shim `.cmd`** — `execFile` não executa esse formato. A solução é rodar `dist/bundle/cli.js` com o próprio Node.
2. **O processo filho congela até o timeout** quando a stdout vai para um pipe e o pai tem event loop ativo. A saída vai para arquivo temporário e o stdin é fechado (`ignore`).

Sem esses dois, nenhuma tarefa de modelo real funciona.

## Meta

30–50 tarefas com verificador automático. O valor não está no número: está em cada tarefa provar algo que, se quebrar, o projeto perde. Uma tarefa decorativa é pior que nenhuma — ela dá sensação de cobertura sem dar cobertura.

## Pendências

- [ ] Gatekeeper: rodar a suíte com e sem o artefato e exigir zero regressão.
- [ ] Baseline oficial no PI puro (baseline versionada em `evals/baseline.json`).
- [ ] Mais tarefas do grupo D cobrindo refatoração e leitura de código.
- [ ] Bloqueio por regressão no gate de merge.