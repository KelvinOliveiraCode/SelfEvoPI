# Fase 4 — A ponte de estado (grafo ↔ desktop)

> **Data:** 2026-11-16.
> **Ponto:** o nosso `core/graph` e um desktop (Pi-Harness ou outro) falam
> formatos diferentes. Esta ponte é o tradutor — e o `index.json` que um painel
> lê sem varrer diretório.
> **Honestidade:** o Pi-Harness **não está instalado** nesta máquina. A ponte é
> validada por **teste próprio** (`core/graph/harness-state.test.mjs`,
> `harness-store.test.mjs`, `runtime.test.mjs`), **não** contra o app real.

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

## 5. O que a ponte NÃO faz (honesto)

- **Não valida contra o Pi-Harness real.** O app não está instalado aqui; a ponte é
  validada por teste próprio. Se o Pi-Harness esperar um schema diferente, a ponte
  terá que ser ajustada — e isso só se descobre instalando o app.
- **Não é sandbox.** `readOnly` do `pi-graph` (referência) é allowlist de ferramenta,
  não isolamento de OS. A contenção continua sendo a camada do A6 (Job Objects +
  Node Permission + gate).
- **Não decide fluxo.** Quem manda é o `runtime`; a ponte só **traduz e persiste**.
- **`progress` é por nós**, não por custo/tokens. É o suficiente para uma barra, mas
  não substitui a telemetria (Camada 5).

## 6. Verificação

```bash
node --test core/graph/*.test.mjs
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
- `core/graph/harness-state.test.mjs` / `harness-store.test.mjs` — testes da ponte
- `core/graph/runtime.mjs` — agora aceita `harness: true` (integração)
- `core/graph/panel.mjs` — `renderHtml` lê `indexUrl` (lista de runs)