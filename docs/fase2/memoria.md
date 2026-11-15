# Fase 2 — Memória em 3 níveis

> **Agente:** A7 — Memória e Refine
> **Status:** implementado (`core/memory/store.mjs`)
> **Fora de escopo:** o `/refine` em si — este documento define apenas o contrato.

## 1. Modelo de 3 níveis

A memória do SelfEvoPI é organizada em três níveis, do mais efêmero ao mais durável. O
modelo é o mesmo do `.pi/harness/README.md` (tabela "Níveis de memória"), agora com
persistência real e auditável.

| Nível | Diretório | O que guarda | Ciclo de vida |
|:---|:---|:---|:---|
| `session` | raiz do store | contexto da tarefa em curso (memória do agente) | termina com a sessão |
| `project` | raiz do store (espelha `.pi/harness/`) | fatos, decisões, convenções, débitos | sobrevive a sessões |
| `skills` | raiz do store (espelha `.pi/skills/`) | capacidades promovidas, executáveis e indexadas | promovido após passar no gate |

**Princípios:**

1. **Append-only.** Entradas nunca são editadas no lugar. Correções são novas entradas;
   a promoção é uma *regravação* do par origem/destino preservando `id` e `at`.
2. **Qualquer nível pode ser origem ou destino de promoção**, mas o fluxo canônico é
   `session → project → skills` (do efêmero para o durável).
3. **Nada de modelo.** A camada é determinística e não depende de LLM. O conteúdo é
   texto puro com tags; a interpretação mora no agente.

## 2. Formato da entrada

Toda entrada é um objeto JSON de formato estável, gravado como uma linha JSONL:

```json
{
  "id": "uuid-v4",
  "at": "2026-11-15T18:00:00.000Z",
  "text": "usar ESM puro, sem dependências externas",
  "tags": ["convencao", "esm"],
  "source": "A7"
}
```

| Campo | Tipo | Regra |
|:---|:---|:---|
| `id` | string | UUID v4 por padrão; estável e único dentro do store |
| `at` | string | ISO-8601 (UTC); ordenável lexicograficamente |
| `text` | string | conteúdo da memória, não vazio |
| `tags` | string[] | rótulos livres para busca e agrupamento |
| `source` | string | quem gerou (agente, subagente, sistema) |

### Layout em disco

```
<root>/
  session.jsonl
  project.jsonl
  skills.jsonl
```

Cada arquivo é uma trilha append-only. Linhas corrompidas não derrubam o store: são
marcadas como inválidas na leitura e ignoradas em `query` e `stats`.

## 3. API

```js
import { openStore } from "./core/memory/store.mjs";

const store = openStore({ root: ".pi/harness/memory" });

store.append("project", { text: "decisão X", tags: ["decisao"] });
store.query({ level: "project", tag: "decisao", limit: 10 });
store.query({ level: "project", text: "decisão" });        // busca textual (case-insensitive)
store.promote(entryId, "session", "project");               // move de nível
store.stats();                                              // { session, project, skills }
```

- `query` combina filtros com **AND** e devolve **mais recentes primeiro**.
- `promote` preserva `id` e `at`; recusa id duplicado no destino; devolve `null` se o
  id não existir na origem.
- `append` grava com flag de append (`"a"`); o id e o `at` são preenchidos quando ausentes.

## 4. Política de arquivamento

Uma skill só vive em `skills` enquanto for **executável e útil**. O arquivamento segue
três regras:

1. **Promoção** `session → skills` exige passar no gate (ver critério de aceite do
   subagente; no SelfEvoPI isso corresponde a `last-known-good.json` com evals verdes).
2. **Degradação.** Uma skill que passa a falhar, fica obsoleta ou deixa de ser usada é
   **rebaixada**: sai de `skills` e volta para `project` (mantendo o histórico), ou para
   `session` se for descartável. O rebaixamento é auditável — o `id` original é
   preservado, então a trajetória da capacidade fica rastreável.
3. **Nada é apagado.** Mesmo uma skill degradada permanece no histórico; o que muda é o
   nível em que ela conta como capacidade ativa (`stats().skills` reflete só as ativas).

## 5. Onde entra o `/refine` (contrato)

O `/refine` proposto **consome e produz memória**, mas não é implementado aqui. O
contrato é:

```
/refine  (entrada)
  - lê o nível `session`  → contexto da sessão
  - lê o nível `project`  → decisões/convenções vigentes
  - propõe deltas         → novas entradas (CRUD com evidência, estilo pi-continual-harness)

/refine  (saída)
  - novos fatos/decisões  → append("project", …)
  - skills candidatas      → append("session", …) e, após o gate, promote("skills")
  - skills degradadas      → promote(de skills para project/session)
```

O `/refine` é o **único escritor autorizado** a promover para `skills` — ele é o gate
que separa "memória bruta" de "capacidade executável". A camada de memória aqui
implementada é agnóstica quanto a quem chama `append`/`promote`; o contrato acima
amarra o `/refine` a ela sem acoplar a implementação.

## 6. Critério de aceite

- `node --test core/memory/store.test.mjs` sai 0.
- Persistência comprovada: criar, fechar, reabrir e ler os mesmos dados.
- Entrada em formato estável e auditável (JSONL append-only).