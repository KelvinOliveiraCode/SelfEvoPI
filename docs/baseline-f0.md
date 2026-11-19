# Baseline Fase 0 — Suíte de evals

Linha de base oficial do harness de evals do SelfEvoPI, medida no PI Coding Agent
sobre os providers configurados (grupos A–C estruturais, grupo D com modelo real).

- **Gerado em:** 2026-11-16T00:01:45Z
- **Gerador:** `evals/gate.mjs --update` (3 execuções da suíte completa)
- **Arquivo de dados:** [`evals/baseline.json`](../evals/baseline.json)
- **Node:** v24 · **SO:** Windows nativo

## Como foi medido

```
node evals/gate.mjs --update        # 3 execuções → grava evals/baseline.json
node evals/gate.mjs                 # compara a suíte atual (3 exec.) contra a baseline
node evals/gate.mjs --runs 1        # compara com 1 execução
```

Cada tarefa roda em workspace temporário. Grupos A–C são estruturais (sem modelo).
O grupo D executa o PI de verdade, mede tokens e valida o código gerado rodando o
arquivo — não olhando para a aparência.

## Resultado por tarefa (3 execuções)

| Tarefa | Grupo | Acerto | Latência média | Tokens (média/run) |
|:---|:---|:---|:---|:---|
| `A1-router-reviewer` | A | 100% (3/3) | 99 ms | 0 |
| `A2-router-backoff` | A | 100% (3/3) | 101 ms | 0 |
| `A3-circuit-breaker` | A | 100% (3/3) | 117 ms | 0 |
| `A4-retry-policy` | A | 100% (3/3) | 109 ms | 0 |
| `B1-providers-present` | B | 100% (3/3) | 99 ms | 0 |
| `B2-models-schema` | B | 100% (3/3) | 98 ms | 0 |
| `B3-import-idempotent` | B | 100% (3/3) | 331 ms | 0 |
| `B4-import-rejects-missing` | B | 100% (3/3) | 183 ms | 0 |
| `C1-gitignore-secrets` | C | 100% (3/3) | 131 ms | 0 |
| `C2-no-secrets-tracked` | C | 100% (3/3) | 181 ms | 0 |
| `C3-router-unit-tests` | C | 100% (3/3) | 363 ms | 0 |
| `C4-docs-present` | C | 100% (3/3) | 109 ms | 0 |
| `D1-cria-soma` | D | 100% (3/3) | 4319 ms | 24.613 |
| `D2-corrige-contador` | D | 100% (3/3) | 8731 ms | 25.299 |

## Totais

| Métrica | Valor |
|:---|:---|
| Acerto | **100%** (42/42 tarefas-execução) |
| Latência média | **1.069 ms** por tarefa |
| Tokens | **49.912** (soma das 3 execuções; só o grupo D consome) |
| Custo | **US$ 0,0000** |

## Ressalvas

- **O grupo D usa modelo real e tem custo/free-tier.** As tarefas D1 e D2 chamam o
  PI de verdade (provedores OpenRouter em plano gratuito). O custo medido é **US$ 0**
  porque os modelos são `:free`, mas há **cota diária gratuita limitada** (50 req/dia
  por conta). Ao esgotar, o provedor responde `429 free-models-per-day` e a tarefa
  falha sem gerar código — **não é regressão de código**, é limite externo. Por isso a
  baseline foi regenerada após o reset diário da cota (00:00 UTC), para refletir a
  capacidade real do modelo e não uma janela de exaustão.
- **Latência e tokens do grupo D oscilam** entre execuções (modelo não determinístico).
  O gate trata esses dois como **informativos**, não como critério de reprovação: só a
  **taxa de acerto** reprova. Latência/tokens aqui são a média de 3 execuções.
- Grupos A–C são determinísticos e não dependem de rede; seus números são estáveis.

## Gate de regressão

`node evals/gate.mjs` roda a suíte N vezes (padrão 3) e sai **1** se qualquer tarefa
cair abaixo da taxa de acerto desta baseline; **0** se mantiver ou melhorar.

```
node evals/gate.mjs                 # 3 execuções, sai 0 contra esta baseline
node evals/gate.mjs --runs 1        # 1 execução, também sai 0
node evals/gate.mjs --group D       # só um grupo
node evals/gate.mjs --update        # regrava a baseline
```

## Overhead fixo do harness

Medido por `node scripts/measure-overhead.mjs` em 2026-11-15 (10 execuções, Windows nativo, `kilo1`).

| Métrica | Medido | Meta | Situação |
|:---|:---|:---|:---|
| Cold start (`pi --version`) | **405 ms** (mediana 396, mín 378, máx 456) | < 500 ms | ✓ |
| Prompt do PI puro | **8.674 tokens** | — | linha de base |
| Prompt com `pi-subagents` | **10.554 tokens** | — | +1.880 de overhead |
| Prompt incremental do SelfEvoPI | — | < 1.500 tokens | pendente (não há extensão própria ainda) |

A meta de 1.500 tokens do plano refere-se ao **incremento** que o SelfEvoPI adiciona — não ao prompt do PI, que já são ~8,7 mil. O número acima é a régua: tudo que o SelfEvoPI injetar entra **sobre** esses 8.674.

> **Nota:** a medição só é honesta com `--approve`. Sem ele o PI ignora os pacotes locais do projeto (`.pi/settings.json`) e mede um harness vazio — foi assim que a primeira medição deu 8.674 mesmo com o `pi-subagents` instalado.

## Time-machine

```
node scripts/checkpoint.mjs status
node scripts/checkpoint.mjs create f0-baseline
node scripts/checkpoint.mjs restore ckpt/f0-baseline --force
node scripts/checkpoint.mjs verify
```

`restore` é destrutivo (`git reset --hard`) e exige `--force`; antes de restaurar, o script cria uma tag de backup do estado atual.