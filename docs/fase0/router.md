# Roteador multi-provider

O roteador é a Camada 2 do SelfEvoPI. Ele escolhe **qual conta e qual modelo** atender cada tarefa, para que o orquestrador não precise conhecer os 8 providers.

Arquivo: `core/router/router.mjs` (sem dependências). CLI: `core/router/cli.mjs`. Testes: `core/router/router.test.mjs` (12 casos).

## Perfis

| Perfil | Família preferida | Contexto mínimo | Regra |
|:---|:---|:---:|:---|
| `orchestrator` | `kilo` | 200k | planeja e coordena |
| `worker` | `kilo` | 32k | implementa |
| `reviewer` | `kilo` | 32k | **nunca o provider do autor** |

### Famílias desativadas

`DISABLED_FAMILIES = ["or"]`. As contas `or1`–`or4` (OpenRouter, free tier, 50 req/dia) esgotam a cota e passam a responder exit 0 com corpo vazio. Como isso é uma falha silenciosa, nenhum perfil as seleciona — mesmo que estejam no `models.json`. Elas continuam lá (são chaves do usuário); basta remover `"or"` da lista para reativá-las.

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

## Retry com troca de provider

`pickWithRetry` junta `pick`, `withRetry` e `report` num único fluxo: escolhe provider, executa o callback e, se falhar com erro retryable (429, 5xx, timeout, rede), troca de provider e tenta de novo.

```js
const { result, attempts, providersTried } = await router.pickWithRetry(
  "worker",
  async (pick) => {
    const res = await fetch(`${pick.baseUrl}/chat`, {
      method: "POST",
      body: JSON.stringify({ model: pick.model, messages }),
    });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: `HTTP_${res.status}` });
    return res.json();
  },
  {
    attempts: 3,
    budget,                          // opcional: para se estourou
    exclude: [providerDoAutor],      // opcional: nunca reusa o autor
    onAttempt: ({ attempt, provider, ref }) => {
      console.log(`tentativa ${attempt}: ${ref}`);
    },
  }
);
// result  → valor retornado por fn
// attempts → quantas tentativas foram feitas
// providersTried → lista de providers usados, em ordem
```

**Critério de retry** (por padrão): erros com `code` `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `ECONNREFUSED`, `EAI_AGAIN`, mensagens contendo `429`, `rate limit`, `timeout`, ou códigos HTTP 5xx. Passe `isRetryable: (err) => boolean` para substituir.

**Parada por orçamento**: se o budget estourou antes da tentativa ou durante a execução, `pickWithRetry` lança erro claro e não gasta as tentativas restantes.

## Uso

```powershell
node core/router/cli.mjs --snapshot
node core/router/cli.mjs --profile orchestrator
node core/router/cli.mjs --profile reviewer --exclude kilo1
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
- [x] Teto de tokens por tarefa (`budget.mjs`).
- [x] Retry com troca de provider (`pickWithRetry`).