# Roteador multi-provider

O roteador é a Camada 2 do SelfEvoPI. Ele escolhe **qual conta e qual modelo** atender cada tarefa, para que o orquestrador não precise conhecer os 8 providers.

Arquivo: `core/router/router.mjs` (sem dependências). CLI: `core/router/cli.mjs`. Testes: `core/router/router.test.mjs` (12 casos).

## Perfis

| Perfil | Família preferida | Contexto mínimo | Regra |
|:---|:---|:---:|:---|
| `orchestrator` | `kilo` | 200k | planeja e coordena |
| `worker` | `or` | 32k | implementa |
| `reviewer` | `kilo` ou `or` | 32k | **nunca o provider do autor** |

A regra do reviewer é o ponto central: quem revisa não pode ser a mesma conta que implementou. O chamador passa `exclude: [providerDoAutor]`.

## Estratégias

| Estratégia | Comportamento |
|:---|:---|
| `roundRobin` | distribui em ordem, ignorando latência |
| `latency` | escolhe o menor EWMA de latência |
| `random` | sorteio entre os saudáveis |

## Circuit breaker

Cada provider tem seu próprio disjuntor:

```
closed --(N falhas consecutivas)--> open --(cooldown)--> halfOpen --(sucesso)--> closed
```

Com o circuito aberto, o provider sai da rotação até o cooldown expirar. Se todos abrirem, o roteador recorre ao pool inteiro em vez de falhar — degrada em vez de parar.

## Retry

`withRetry` faz backoff exponencial com jitter total:

```
delay = min(cap, base * factor^(attempt-1)) * (0.5 + random/2)
```

Importante: nem todo erro deve ser retentado. `retryOn` decide — um 401 não se resolve tentando de novo.

## Teto de consumo

O teto de contexto filtra modelos sem janela suficiente. O **teto de consumo** (`core/router/budget.mjs`) limita tokens e custo gastos numa tarefa, independente do modelo.

```js
import { createBudget } from "./budget.mjs";

const budget = createBudget({
  limitTokens: 100_000,
  limitCostUsd: 0.50,
  onExceeded: ({ spentTokens, spentCostUsd }) => {
    console.error(`orçamento esgotado: ${spentTokens} tokens, $${spentCostUsd}`);
  },
});

budget.spend({ tokens: 12_000, costUsd: 0.03 });
budget.ok // true

budget.spend({ tokens: 200_000, costUsd: 0.10 });
budget.ok // false — onExceeded chamado uma única vez
```

`Router.pick()` aceita `{ budget }` e recusa (throw) quando o orçamento já estourou:

```js
const pick = router.pick("worker", { budget });
// lança Error: "router: orcamento da tarefa esgotado (tokens=…)"
```

O budget é determinístico e testável sem relógio real. `reset()` zera a contagem para reutilizar o mesmo objeto em outra tarefa.

## Uso

```powershell
node core/router/cli.mjs --snapshot
node core/router/cli.mjs --profile orchestrator
node core/router/cli.mjs --profile reviewer --exclude or1
node core/router/cli.mjs --profile worker --min-context 100000
```

Saída:

```
perfil    orchestrator
provider  kilo1
modelo    nvidia/nemotron-3-ultra-550b-a55b:free
ref       kilo1/nvidia/nemotron-3-ultra-550b-a55b:free
```

## Como o roteador se conecta ao PI

O roteador não substitui o PI: ele devolve uma `ref` (`provider/modelo`) que o chamador usa em `pi --model <ref>`. Assim o roteador é testável sem subir o PI, e o PI continua dono do loop.

## Pendências

- [ ] Wrapper como extensão do PI (expor `pick`/`report` como comando).
- [ ] Coletor de latência real alimentando o EWMA (hoje só via `report`).
- [ ] Teto de tokens por tarefa (o de contexto existe; falta o de consumo).