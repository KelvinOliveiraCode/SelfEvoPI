# Fase 4 — A ponte de estado (grafo ↔ desktop)

> **Data:** 2026-11-16 (ponte) · **atualizado:** 2026-11-17 (validação contra o app real).
> **Ponto:** o nosso `core/graph` e um desktop (Pi-Harness ou outro) falam
> formatos diferentes. Esta ponte é o tradutor — e o `index.json` que um painel
> lê sem varrer diretório.
> **Validação:** a ponte foi validada contra o **`pi-harness@0.1.1` real**, nesta
> máquina, em **2026-11-17** (evidência medida na §5). O teste de integração
> (`core/graph/pi-harness.integration.test.mjs`) **pula com o motivo** quando
> nenhum servidor responde — CI verde em máquina sem o app e em máquina com o app
> quebrado. Os testes de unidade da ponte seguem verdes
> (`harness-state.test.mjs`, `harness-store.test.mjs`, `runtime.test.mjs`).

## 1. Os dois formatos que não se falavam

| Origem | Formato | Onde |
|:---|:---|:---|
| `runtime.mjs` | próprio: `{ runId, nodes:{id:rec}, order:[], checkpoints:[], waitingFor }` | `.pi/harness/graph/<runId>.json` |
| `scripts/checkpoint.mjs` | git: `{ sha, branch, checks }` | `.pi/harness/last-known-good.json` |

Um desktop precisaria entender os dois. A ponte (este módulo) produz **um** formato
que carrega o melhor dos dois: estado por nó **+** amarração a commit/tag (git-nativo).

## 2. O formato `harness-state`

```js
{
  runId, status, startedAt, updatedAt,
  nodes: [{ id, label, kind, status, startedAt, endedAt, durationMs, attempt }],
  checkpoints: [{ at, sha, label }],      // cada checkpoint amarrado a um commit/tag
  waitingFor, humanQueue: [{ nodeId, question, at }],
  stats: { total, done, failed, skipped, durationMs }
}
```

- **`nodes[]`** — um por nó, com `status` (`pending|running|done|failed|blocked|
  skipped|waiting`), `kind` (`task|review|human|artifact`), `attempt` (quantas vezes
  rodou) e `durationMs`.
- **`checkpoints[]`** — cada checkpoint tem `at` (ISO), `sha` (commit) e `label`
  (tag). É o que amarra o grafo ao Git: um desktop mostra "este nó foi concluído no
  commit X".
- **`humanQueue[]`** — nós `human` esperando decisão (para a fila de aprovação).
- **`stats`** — totais para o painel (barra de progresso).

### Por que é "git-nativo"

Porque cada checkpoint pode carregar **`sha`** e **`label`** — o mesmo vocabulário de
`git tag ckpt/<label>` / `git rev-parse HEAD` que o `scripts/checkpoint.mjs` já usa.
Assim o desktop não precisa de um formato novo: ele lê `sha`/`label` e casa com o
histórico Git. `durationMs`/`startedAt`/`endedAt` dão a linha do tempo sem relógio
escondido (o relógio só mede, não decide fluxo).

## 3. O que um desktop precisa ler para mostrar o grafo

Um desktop (Pi-Harness ou outro) precisa de **dois arquivos**:

1. **`index.json`** — a lista de runs (o que o painel lê primeiro, sem varrer dir):
   ```json
   {
     "version": 1,
     "runs": [
       { "runId": "run-demo", "status": "running", "startedAt": "...", "updatedAt": "...",
         "nodes": 2, "progress": 0.5, "done": 1, "failed": 0, "skipped": 0 }
     ]
   }
   ```
   `progress` é `done / total` (0..1). Serve para a lista lateral e a barra de progresso.

2. **`<runId>.json`** — o `harness-state` completo daquele run (nós, checkpoints,
   fila humana, stats). É o que o painel usa para desenhar a **árvore** do grafo.

O `panel.mjs` (`renderHtml`) já sabe consumir os dois: passe `indexUrl` (lista de
runs) e/ou `pollUrl` (estado de um run) e ele atualiza sozinho.

## 4. Como usar (código)

```js
import { createGraph } from "./core/graph/model.mjs";
import { createRuntime } from "./core/graph/runtime.mjs";
import { createHarnessStore } from "./core/graph/harness-store.mjs";

const graph = createGraph({ nodes, edges });
const bridge = createHarnessStore({ dir: ".pi/harness/graph" });

const rt = createRuntime({
  graph,
  runNode,
  harness: true,          // grava TAMBÉM no formato da ponte
  harnessStore: bridge,
  runId: "run-2026-11-16",
  harnessMeta: { sha: "abc1234", label: "ckpt/f3" },
});

await rt.run();             // grava runtime (próprio) + ponte (harness-state + index.json)
console.log(await bridge.list());  // [{ runId, status, progress, ... }]
```

Sem `harness: true`, o runtime se comporta **exatamente** como antes (formato próprio).
Os testes existentes continuam verdes — a ponte é aditiva.

## 5. Validação contra o pi-harness real (2026-11-17)

A ponte **foi validada contra o `pi-harness@0.1.1` instalado nesta máquina** em
2026-11-17. Não é mais "teste próprio contra o app ausente" — é evidência medida.

### 5.1 O que respondeu (saída real)

- **`GET /health`** →
  ```json
  {"status":"ok","sessions":0,"uptime":36.5,"version":"0.1.0"}
  ```
- **`POST /sessions`** com `{"sessionId":"run-A8-001"}` →
  ```json
  {"sessionId":"run-A8-001"}
  ```
  (o pi-harness 0.1.1 **ecoa o `sessionId` enviado pelo cliente**; não devolve
  `status`/`createdAt` como o tipo `SessionResponse` descreve).
- **Sessão do pi em disco** (`~/.pi/agent/sessions/<cwd-codificado>/<iso>_<uuid>.jsonl`)
  é um log de eventos append-only: cabeçalho `session` (`version:3`, `id`, `timestamp`,
  `cwd`), `model_change`, `thinking_level_change` e `message` (lista encadeada por
  `id`/`parentId`). O `parseSessionJsonl` (em `core/graph/pi-harness.mjs`) lê esse
  formato e é testado contra uma sessão **real** do disco.

### 5.2 Mapeamento campo a campo (a resposta para "a ponte precisou mudar?")

O `pi-harness` não tem conceito de grafo — ele é um **agente único** com uma
**sessão** (log de eventos). O nosso `harness-state` é um **run** (DAG de nós). O
mapeamento é:

| nosso `harness-state` | `pi-harness` `SessionResponse` | sessão do pi em disco |
|:---|:---|:---|
| `runId` | `sessionId` | nome do arquivo `<iso>_<uuid>.jsonl`; `session.id` (uuid) |
| `status` (`completed`/`failed`/`running`/`waiting-human`/…) | `status` (`active`/`ended`) | inferido dos eventos |
| `startedAt` | `createdAt` | `session.timestamp` |
| `updatedAt` | (não existe) | timestamp do último evento |
| `nodes[]` (DAG) | (não existe — pi-harness é agente único) | `message[]` |
| `checkpoints[]` | (não existe) | (log append-only = implícito) |
| `humanQueue[]` | (não existe) | (não existe) |
| `stats` | (não existe) | (não existe) |

**Veredito: a ponte NÃO precisou mudar o formato.** O `harness-state` + `index.json`
já respondem ao critério ("um host consegue listar e abrir nossos runs"). O que
faltava — e foi acrescentado — é o **adaptador** `core/graph/pi-harness.mjs`, que
traduz nos dois sentidos e sela o mapeamento com teste:

- `toSessionResponse(runDoc)` / `toSessionList(runDocs)` → nossos runs no formato
  de `GET /sessions` do pi-harness (sessionId = runId, status active/ended, createdAt = startedAt).
- `parseSessionJsonl(text)` → uma sessão real do pi em disco vira resumo
  (`id`, `cwd`, `model`, `messages[]`, timestamps).
- `probePiHarness` / `createSession` / `listSessions` / `health` → cliente HTTP
  mínimo (fetch injetável), usado pelo teste de integração.

A direção **pi-harness → nosso grafo** é **perdível por natureza**: uma sessão
plana não reconstrói um DAG. O inverso (nosso run → sessão) é o que um host usa
para listar/abrir. Como o pi-harness não tem grafo, **um run com N nós equivale a
N sessões**, e o DAG/checkpoints permanecem no nosso formato.

### 5.3 A ressalva do ecossistema (defeito do pacote, não da ponte)

O `pi-harness@0.1.1` **subdeclara dependências** e **quebra no Node 24 ESM**:

- `package.json` declara só `@hono/node-server`, `chalk`, `hono`, mas o bundle
  importa também `dotenv`, `@mariozechner/pi-coding-agent`, `@mariozechner/pi-ai`,
  `pg`, `unified`, `@sinclair/typebox`, `pptxgenjs`, `uuid`.
- o bundle usa `require("events")` via shim esbuild, que o Node 24 ESM rejeita
  (`Dynamic require of "events" is not supported`).
- além disso, o `pi-harness` cria o `DefaultResourceLoader` **sem `agentDir`**, e o
  `pi-coding-agent` morre em `addAutoDiscoveredResources` com
  `ERR_INVALID_ARG_TYPE: The "path" argument must be of type string. Received undefined`
  quando uma sessão é usada.

Por isso a coleta foi feita com um **launcher** que injeta
`globalThis.require = createRequire(import.meta.url)` antes de importar o CLI, rodando
de uma cópia limpa em diretório temporário. **Esse launcher é contorno local, não
entra no repositório.**

**Observação (não é bug nosso):** o `/health` reporta `"version":"0.1.0"`, mas o
pacote instalado é `0.1.1` — o bundle carrega um `package.json` interno defasado.

### 5.4 O que a ponte NÃO faz (honesto)

- **Não é sandbox.** `readOnly` do `pi-graph` (referência) é allowlist de ferramenta,
  não isolamento de OS. A contenção continua sendo a camada do A6 (Job Objects +
  Node Permission + gate).
- **Não decide fluxo.** Quem manda é o `runtime`; a ponte só **traduz e persiste**.
- **`progress` é por nós**, não por custo/tokens. Suficiente para uma barra, mas não
  substitui a telemetria (Camada 5).
- **A integração depende do servidor de pé.** Sem servidor, o teste pula com o
  motivo; não há como validar contra o app real de forma honesta sem ele.

## 6. Verificação

```bash
node --test core/graph/*.test.mjs
```

Teste de integração com o pi-harness real (roda se um servidor responde; pula se não):

```bash
PI_HARNESS_URL=http://127.0.0.1:8788 node --test core/graph/pi-harness.integration.test.mjs
```

Smoke da ponte (grava um `index.json` legível):

```bash
node -e "import('./core/graph/harness-store.mjs').then(async m => {
  const s = m.createHarnessStore({ dir: '.pi/harness/tmp/ponte-teste' });
  await s.save('run-demo', { runId:'run-demo', status:'running',
    startedAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
    nodes:[{id:'t1',label:'t1',kind:'task',status:'done',startedAt:new Date().toISOString(),
            endedAt:new Date().toISOString(),durationMs:1200,attempt:1}],
    checkpoints:[], waitingFor:null, humanQueue:[],
    stats:{total:1,done:1,failed:0,skipped:0,durationMs:1200} });
  console.log(await s.list());
})"
```

## 7. Arquivos

- `core/graph/harness-state.mjs` — `toHarnessState` / `fromHarnessState` (ida e volta)
- `core/graph/harness-store.mjs` — `createHarnessStore` (save/load/list, atomic, index.json)
- `core/graph/pi-harness.mjs` — adaptador pi-harness: mapeadores puros + parser de sessão + cliente HTTP
- `core/graph/harness-state.test.mjs` / `harness-store.test.mjs` — testes da ponte
- `core/graph/pi-harness.test.mjs` — testes dos mapeadores + parser (inclui sessão real do disco)
- `core/graph/pi-harness.integration.test.mjs` — integração (pula sem servidor)
- `core/graph/runtime.mjs` — agora aceita `harness: true` (integração)
- `core/graph/panel.mjs` — `renderHtml` lê `indexUrl` (lista de runs)