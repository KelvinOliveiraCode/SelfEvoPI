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

## 5. Refine baseado em regras (v1, sem modelo)

A primeira versão executável do `/refine` vive em `core/memory/refine.mjs`. É
**determinística, sem rede e sem LLM**: analisa entradas do nível `project` e propõe
deltas estruturados, dos quais aplica apenas os seguros.

### Deltas propostos

| Operação | Gatilho | Aplicada? |
|:---|:---|:---|
| `dedupe` | mesmo texto normalizado em mais de uma entrada | **sim** — mantém a mais recente, remove as demais |
| `drop` | entrada vazia, curta demais (`< 3` chars normalizados) ou corrompida (JSONL inválido) | **sim** — remove do nível |
| `keep` | texto com marcador de decisão (`sempre`, `nunca`, `deve`, `obrigatório`, `proibido`…) | não — apenas sinaliza (advisory) |
| `merge-tags` | tags que são variantes da mesma forma normalizada (`ESM`/`esm`) | não — apenas sinaliza (advisory) |

`keep` e `merge-tags` são **advisory**: a v1 os relata para o agente decidir; a versão
com modelo poderá usá-los para promover ou arquivar. A canônica de `merge-tags` é a
forma normalizada (minúsculas, sem espaços/hífens redundantes).

### Aplicação

```js
const store = openStore({ root: ".pi/harness/memory" });
const deltas = proposeDeltas({ entries: store.query({ level: "project" }) });
const res = applyDeltas(store, deltas, { level: "project" });
// res = { level, applied, removed, advisory }
```

`applyDeltas` reescreve o JSONL do nível removendo as entradas indicadas. É
**idempotente**: rodar de novo com as entradas já removidas não remove nada a mais e
devolve `removed: 0`.

### O que fica para a versão com modelo

- **Decisão semântica**: distinguir "fato duplicado" de "fato reafirmado com nuance"
  (hoje `dedupe` trata como iguais textos normalizados).
- **`keep` inteligente**: usar o modelo para julgar se um texto é decisão durável ou
  só um comentário, em vez da lista fixa de palavras.
- **`merge-tags` semântico**: unir tags com o mesmo significado mas grafias diferentes
  (`esm`/`modules`), não só variantes de caixa.
- **Novas operações**: `split` (fundir entradas correlatas), `promote` (sugerir subida
  de nível) e `summarize` (comprimir um bloco de entradas antigas).

Tudo isso depende do gate de evals (A2) para só aplicar deltas que vencem a suíte —
a v1 já respeita esse princípio ao limitar a aplicação aos deltas seguros.

## 6. Onde entra o `/refine` (contrato)

O `/refine` **consome e produz memória**. A v1 (regras) já dá conta de limpeza e
dedupe; o contrato completo é:

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

## 7. Integração com o PI

A extensão `core/memory/extension.mjs` liga a memória ao PI Coding Agent. É uma
extensão no formato que o PI carrega: **função default `(pi) => void`** (confirmado em
`docs/extensions.md` e no exemplo real `pi-subagents`, cujo `bundle/index.js` exporta
`registerSubagentExtension as default`).

### Handlers

| Handler | O que faz |
|:---|:---|
| `session_start` | abre o store em `<cwd>/.pi/harness/memory`, carrega os fatos do nível `project`, monta o bloco e avisa o usuário (`ctx.ui.notify`) |
| `before_agent_start` | injeta o bloco como mensagem de contexto (`customType: "selfevopi-memory"`, `display: false`) — respeitando o teto de tokens |
| `session_shutdown` | confirma a persistência das entradas novas e limpa o estado |
| comando `/mem` | `/mem` (lista) · `/mem add <texto>` (acrescenta) · `/mem promote <id>` (promove de `project` para `skills`) |

### Orçamento de contexto

O teto de tokens é configurável, com precedência:

1. flag `--mem-tokens <n>` (registrada via `pi.registerFlag`, aparece no `pi --help`)
2. variável de ambiente `SELFEOPI_MEM_TOKENS`
3. padrão `400` (`DEFAULT_MAX_TOKENS`)

`buildMemoryBlock(entries, { maxTokens })` nunca devolve um bloco acima do teto:
estimando ~4 chars/token, corta as entradas mais antigas que estourariam o orçamento e
marca `truncated: true`. O bloco é ordenado do mais recente para o mais antigo.

### Persistência

`/mem add` grava imediatamente no JSONL (append-only) via `store.append("project", …)`.
O `session_shutdown` apenas confirma a contagem do que foi acrescentado na sessão — não
há buffer em memória a escorrer, então nada se perde se o processo cair.

### Arquivo ausente

Se nenhum `.jsonl` existir ainda (store vazio), `load()` devolve um bloco
`"(sem memória de projeto)"` sem quebrar a sessão.

### Verificação de carga

A extensão carrega no PI de verdade: `pi -e ./core/memory/extension.mjs --help` lista a
flag `--mem-tokens`. O teste de fumaça `session_start → /mem add → before_agent_start`
injeta o bloco esperado. (Uma extensão quebrada produziria `Failed to load extension`;
não é o caso.)

### Design

O núcleo é puro e testável sem o PI: `buildMemoryBlock`, `createMemoryController`,
`estimateTokens`. O default export só usa o objeto `pi` recebido, sem importar o pacote
do PI no top-level — por isso `node --test core/memory/extension.test.mjs` roda sem o PI
instalado.

## 8. Critério de aceite

- `node --test core/memory/store.test.mjs` sai 0.
- Persistência comprovada: criar, fechar, reabrir e ler os mesmos dados.
- Entrada em formato estável e auditável (JSONL append-only).
- `node --test core/memory/extension.test.mjs core/memory/store.test.mjs core/memory/refine.test.mjs` sai 0.
- Extensão carregável por `pi` (flag `--mem-tokens` visível em `pi --help`).