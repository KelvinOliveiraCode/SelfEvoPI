---
tags: [componentes, roteador]
created: 2026-11-19
---

# Roteador

> Camada 2 — escolhe qual conta e modelo atende cada tarefa.

## Arquivo

`core/router/router.mjs` — sem dependências.

## Responsabilidades

- **Perfis** (orchestrator / worker / reviewer) sobre o pool de contas
- **Circuit breaker** por provider (closed → open → halfOpen → closed)
- **Retry** com backoff exponencial e jitter
- **Teto de tokens** por tarefa (`budget.mjs`)
- **Reviewer** obrigatoriamente em provider diferente do autor

## Perfis

| Perfil | Família preferida | Contexto mínimo | Regra |
|:---|:---|:---:|:---|
| `orchestrator` | `kilo` | 200k | planeja e coordena |
| `worker` | `kilo` | 32k | implementa |
| `reviewer` | `kilo` | 32k | **nunca o provider do autor** |

## Famílias desativadas

`DISABLED_FAMILIES = ["or"]` — OpenRouter free tier responde exit 0 com corpo vazio ao esgotar a cota.

## Estratégias

| Estratégia | Comportamento |
|:---|:---|
| `roundRobin` | distribui em ordem |
| `latency` | escolhe o menor EWMA |
| `random` | sorteio entre saudáveis |

## Interface

- `pick(profile, opts)` → `{ provider, model, ref, baseUrl }`
- `pickWithRetry(profile, fn, opts)` → `{ result, attempts, providersTried }`
- `report(providerId, ok, opts)` → registra resultado
- `snapshot()` → estado observável

Ver [[05-Decisoes/Decisoes]] para porquê `or` está desativado.