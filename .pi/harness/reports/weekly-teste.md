# Relatório semanal — SelfEvoPI

- gerado em: 2026-11-16T13:35:50.856Z
- execuções no ledger: 136

## Taxa de sucesso

| grupo | execuções | acertos | taxa |
|:---|:---|:---|:---|
| A | 37 | 36 | 97.3% |
| B | 37 | 37 | 100.0% |
| C | 37 | 37 | 100.0% |
| D | 25 | 20 | 80.0% |
| **total** | 136 | 130 | **95.6%** |

## Tokens por tarefa

| tarefa | grupo | execuções | taxa | tokens média | tokens pior caso | latência média |
|:---|:---|:---|:---|:---|:---|:---|
| `A1-router-reviewer` | A | 10 | 90.0% | 0 | 0 | 115 ms |
| `A2-router-backoff` | A | 9 | 100.0% | 0 | 0 | 117 ms |
| `A3-circuit-breaker` | A | 9 | 100.0% | 0 | 0 | 111 ms |
| `A4-retry-policy` | A | 9 | 100.0% | 0 | 0 | 121 ms |
| `B1-providers-present` | B | 10 | 100.0% | 0 | 0 | 118 ms |
| `B2-models-schema` | B | 9 | 100.0% | 0 | 0 | 117 ms |
| `B3-import-idempotent` | B | 9 | 100.0% | 0 | 0 | 351 ms |
| `B4-import-rejects-missing` | B | 9 | 100.0% | 0 | 0 | 217 ms |
| `C1-gitignore-secrets` | C | 10 | 100.0% | 0 | 0 | 171 ms |
| `C2-no-secrets-tracked` | C | 9 | 100.0% | 0 | 0 | 207 ms |
| `C3-router-unit-tests` | C | 9 | 100.0% | 0 | 0 | 368 ms |
| `C4-docs-present` | C | 9 | 100.0% | 0 | 0 | 115 ms |
| `D1-cria-soma` | D | 15 | 73.3% | 6499 | 10680 | 6694 ms |
| `D2-corrige-contador` | D | 10 | 90.0% | 8100 | 10846 | 11885 ms |

**Resumo:** tokens média 1312 · pior caso 10846 · latência média 1756 ms

## Lacunas e reversões

- lacunas resolvidas (artefatos promovidos em `skills`): 0
- reversões (rollbacks): 0

