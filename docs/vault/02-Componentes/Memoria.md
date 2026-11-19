---
tags: [componentes, memória]
created: 2026-11-19
---

# Memória

> Store em 3 níveis, teto de 400 tok/turno.

## Níveis

| Nível | Escopo | Arquivo |
|:---|:---|:---|
| `session` | Sessão atual | `.pi/harness/memory/session.jsonl` |
| `project` | Projeto (persistente) | `.pi/harness/memory/project.jsonl` |
| `skills` | Skills geradas pelo loop | `.pi/harness/memory/skills.jsonl` |

## Arquivo

`core/memory/extension.mjs` — extensão do PI que carrega a memória no prompt.

## Busca

- **Lexical** — tokenização, normalização, stopwords
- **Glossário** — sinônimos cobertos (ex.: "imc" ↔ "indice de massa corporal")
- **PPMI** — co-ocorrência no corpus (sinônimos não cobertos pelo glossário)
- **Embeddings** — não implementado; "semântica" exigiria vetores

## Teto

400 tokens por turno (constante `DEFAULT_MAX_TOKENS = 400` em `core/memory/extension.mjs`; configurável por `--mem-tokens` > `SELFEOPI_MEM_TOKENS` > 400). O `buildMemoryBlock` respeita o teto e mantém as entradas mais recentes primeiro.

## Poda

Linhas corrompidas de JSONL são podadas por condição (não por índice).

Ver [[08-Desempenho/Desempenho]] para o incremento medido (+506 tok no pior caso).