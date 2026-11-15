# Fase 3 — Modelo de Grafo & Decisão de Desktop

> **Dono:** A8 · **Escopo:** modelo de grafo de execução + decisão de desktop Windows.
> **Sem UI.** Este documento define a estrutura de dados que a orquestração usa e
> justifica a escolha de desktop, com base em `docs/research/`.

Arquivos:
- `core/graph/model.mjs` — modelo (sem dependências)
- `core/graph/model.test.mjs` — 18 casos com `node:test`
- Este documento

---

## 1. Por que um grafo

O plano da Fase 3 pede: *"nós = agentes, arestas = handoffs de dados, cores = estado"*
(`SelfEvoPI — Plano do Projeto.md`, §FASE 3). O grafo é a **fonte de verdade** da
execução: o coordenador não precisa guardar a fila de tarefas na cabeça — ele pergunta
ao grafo *o que já terminou* e *quem pode rodar agora*. Isso é o que permite pausar,
retomar e recuperar um nó específico sem reexecutar o fluxo inteiro.

O modelo é deliberadamente **burro**: não executa nada, não fala com o PI, não desenha.
Ele só responde três perguntas — *está válido?*, *em que ordem?* e *quem está pronto?*.
Toda a execução e a visualização ficam em volta dele.

## 2. Modelo de grafo

### 2.1 Nós

Um nó é uma unidade de trabalho ou de decisão:

```js
{
  id: "t2",            // string única (obrigatória)
  agent: "A3",         // quem responde (string ou null)
  kind: "task",        // "task" | "review" | "human" | "artifact"
  status: "pending",   // "pending" | "running" | "done" | "failed" | "blocked"
  dependsOn: ["t1"],   // ids que precisam terminar antes
}
```

| `kind` | Significado | Exemplo |
|:---|:---|:---|
| `task` | trabalho de um agente | implementar `core/graph/model.mjs` |
| `review` | revisão por agente diferente do autor | revisar o código do A3 |
| `human` | decisão/aprovação humana | aprovar merge do artefato |
| `artifact` | produção de um artefato | gerar o `.pptx` da Fase 4 |

### 2.2 Arestas

Aresta é o **fluxo visível** entre dois nós — o que o painel do grafo desenha:

```js
{ from: "t2", to: "r1", kind: "handoff" } // "handoff" | "approval" | "artifact"
```

### 2.3 Estados

```
pending ──► running ──► done
               │
               ├──► failed
               └──► blocked
```

- `pending` — ainda não começou (deps não terminaram).
- `running` — em execução.
- `done` — concluiu; libera os dependentes.
- `failed` — terminou com erro; **não** libera dependentes.
- `blocked` — dependência falhou/pende; fica parado até desbloquear.

### 2.4 `dependsOn` é o que ordena; aresta é o que se vê

Essa separação é o ponto central do modelo:

- **`dependsOn` manda na ordem.** Só ele decide quem vem antes. É um DAG estrito:
  nada de ciclo, nada de depender de id que não existe.
- **Arestas não ordenam.** Uma aresta `t1 → t2` sem `dependsOn` correspondente é
  apenas visual. Isso deixa o painel livre para desenhar *handoffs* que não são
  dependência dura (ex.: um `artifact` que aponta para vários nós que o consumiram).

Assim o grafo pode crescer visualmente sem travar a execução, e a ordenação continua
determinística.

### 2.5 O que `validate` rejeita

`validate(graph)` devolve `{ ok, errors }` (não lança). Regras de rejeição:

| Código | Quando |
|:---|:---|
| `duplicate-id` | dois nós com o mesmo `id` |
| `unknown-dependency` | `dependsOn` aponta para id inexistente |
| `cycle` | ciclo em `dependsOn` (inclui auto-dependência) |
| `human-without-task` | nó `human` sem nenhuma `task` anterior (ancestral via `dependsOn`) |

E, por robustez, reprova estruturas quebradas: nó/aresta malformados, `kind`/`status`
fora do vocabulário, aresta com ponta inexistente (`unknown-edge-endpoint`).

A regra do `human` merece destaque: um nó humano só é válido se existir pelo menos
uma `task` **ancestral** (direta ou indireta) pela cadeia de `dependsOn`. Isso garante
que nenhuma aprovação humana apareça "antes" de qualquer trabalho — em qualquer ordem
topológica válida, a tarefa vem primeiro.

### 2.6 `topologicalOrder` e `nextReady`

- `topologicalOrder(graph)` → ids em ordem de execução (Kahn). Empates caem na ordem
  de inserção, então a saída é determinística. Ciclo → lança `GraphError(code:"cycle")`.
- `nextReady(graph)` → nós `pending` cujas `dependsOn` estão **todas** `done`. Nó sem
  dependência entra pronto. Nó com dep `failed`/`blocked` **não** entra.

É esse par que o coordenador usa em laço: roda `nextReady`, marca `running`, e quando
o agente termina marca `done` — e o próximo `nextReady` já reflete o novo estado.

## 3. Execução (executor)

O executor (`core/graph/executor.mjs`) é o motor que percorre o grafo. Ele é
deliberadamente separado do modelo: o modelo diz *o que* existe e *em que ordem*;
o executor *faz acontecer*. Quem chama fornece `runNode(node, ctx)` — a parte que
realmente fala com o agente/PI. Assim o executor é testável sem subir o PI.

```js
import { createGraph } from "./model.mjs";
import { createExecutor } from "./executor.mjs";

const graph = createGraph({ nodes, edges });

const result = await createExecutor({
  graph,
  autoApprove: false,   // true => nós `human` rodam como os outros
  timeoutMs: 30_000,    // teto padrão por nó (nó pode ter o seu `timeoutMs`)
  runNode: async (node, { state, previous }) => {
    // ... executa o nó, usa `state`, devolve o resultado
    return doWork(node, state, previous);
  },
});
// result = { status, nodes: [...], state, waitingFor }
```

### 3.1 Como um handoff vira aresta

O handoff é o **conteúdo**; a aresta é o **ponteiro** que o executor segue. O fluxo,
passo a passo:

1. O coordenador escreve o contrato do handoff em `.pi/harness/handoffs/<from>->
   <to>.json` (objetivo, arquivos-alvo, restrições, critério de aceite).
2. O grafo recebe a aresta `{ from, to, kind: "handoff" }` — ela não carrega o
   texto, só diz que existe um contrato de `from` para `to`.
3. Quando o nó `to` é alcançado, o executor chama `runNode(to, ctx)`. O `ctx.state`
   carrega o que veio de `from` (o resultado registrado em `state`), e `ctx.previous`
   aponta para o registro do nó imediatamente anterior.
4. `runNode` lê o contrato (ou o que o nó anterior deixou em `state`) e executa.

Ou seja: **a aresta `handoff` no grafo ↔ o arquivo de handoff em disco ↔ o valor que
viaja em `ctx.state`.** Os três são a mesma coisa vista em camadas diferentes.

### 3.2 Como o estado trafega

O executor mantém **um único objeto `state`** compartilhado por todos os nós:

- Cada `runNode` recebe `{ state, previous }` e pode **ler e escrever** `state`.
- O que um nó grava fica visível para os nós seguintes — inclusive os que dependem
  dele por caminhos diferentes.
- `previous` é o registro (`{ id, status, result? , error? }`) do nó processado
  imediatamente antes, ou `null` no primeiro. Serve para o caso comum "só preciso do
  nó anterior"; para "preciso de todos os que me antecedem", leia `state`.

`state` é um objeto simples de propósito: serializável, sem segredos, pronto para
virar checkpoint (`.pi/harness/`). Recuperar um nó = restaurar `state` + status.

### 3.3 Regras de execução

| Situação | O que o executor faz |
|:---|:---|
| Nó com `dependsOn` não-`done` | marca `blocked`, **segue** (não roda) |
| `runNode` resolve | marca `done`, guarda `result` |
| `runNode` lança | marca `failed` (`reason: "error"`, guarda `error`), **segue** |
| `runNode` excede `timeoutMs` | marca `failed` (`reason: "timeout"`), **segue** |
| Nó `human` com `autoApprove` falso | para e devolve `status: "waiting-human"`, `waitingFor: <id>` |
| Nós depois de um `human` parado | ficam `skipped` (nunca rodaram) |

Detalhe de projeto: **o relógio só existe para o timeout.** A ordem e o fluxo vêm
exclusivamente do grafo (`dependsOn`) — um teste prova isso desligando `Date.now` e
executando um grafo linear inteiro. Um nó que falha não derruba a execução: ele marca
`failed` e bloqueia apenas os seus dependentes, que ficam `blocked`.

Resultado agregado (`result.status`): `completed` (tudo `done`), `failed` (algum
`failed`), `waiting-human` (parou num `human`), ou `blocked`.

## 4. Como o grafo se liga aos handoffs

O plano exige **handoffs estruturados curtos** (objetivo, arquivos-alvo, restrições,
critério de aceite) em `.pi/harness/handoffs/`, nunca o histórico bruto
(`SelfEvoPI — Plano do Projeto.md`, §4 e §A8). O grafo é o índice desses handoffs:

- **Cada aresta `handoff` corresponde a um arquivo de handoff** do nó `from` para o
  nó `to`. O conteúdo do handoff é o contrato JSON; a aresta é só o ponteiro.
- ** Nó que vira `running` dispara a leitura do handoff das suas dependências**:
  o agente recebe os contratos dos nós `done` que apontam para ele, não a conversa.
- **`kind` do nó diz quem valida o quê:** `review` exige revisor de provider
  diferente do autor (regra do roteador, Camada 2); `human` bloqueia até aprovação;
  `artifact` só é produzido depois do `human` aprovador.
- **Ciclo de vida = checkpoint:** cada transição de `status` é um ponto de
  checkpoint sincronizável com Git (`ckpt/<fase>-<step>-pre` + `last-known-good.json`,
  §4 do plano). Recuperar um nó = restaurar o grafo para o estado anterior à falha.

Em resumo: **o grafo guarda a topologia; o handoff guarda o conteúdo.** Um aponta
para o outro.

## 5. Decisão de Desktop (Windows)

Critérios de avaliação (pedidos no plano e na auditoria de Windows):

1. **Cobertura de Fase 3 + Fase 4** — resolve grafo/checkpoints *e* serve de desktop.
2. **Checkpoints / recovery** — pausa, retoma e recupera nó.
3. **Worktrees** — isolamento por agente (`.worktrees/A1..A8`).
4. **Sandbox / contenção** — terminais e processos controlados no Windows.
5. **Windows nativo** — roda x64 sem depender de macOS/Tauri/Rust.
6. **Risco de supply-chain** — pacote instalável com nome/versão inequívocos.

### 5.1 Candidatos (evidências de `docs/research/`)

| Candidato | O que é hoje | Windows | Fonte |
|:---|:---|:---|:---|
| **Pi-Harness** (wangmiaozero) | Superset operacional: Runs, Trace, Replay, Evaluation, Policy, Budget, Checkpoints, Recovery, Agent Teams, Task DAG, Worktrees | **Sim** — instalador `.exe` x64; inclui Pi e Node | `docs/research/alternativas-windows.md` §1 (linha 16); `inspiracoes.md` §2.3 (linhas 144, 146) |
| **Pi Agent Desktop** (pi-desktop.app) | Desktop empacotado com Pi 1.5.0 + Herdr v0.8.2 (terminais contidos por **Job Objects** + Fleet + Agent control) | **Sim** — Win 10/11 x64 (beta não assinado) | `alternativas-windows.md` §1 (linha 17) e §2 (linhas 28, 37) |
| `pi-native-app` 0.2.2 | **Cliente web** (AG-UI + Pi SDK em Node); desktop Tauri removido, pin só em `0.1.15` | Sim, no navegador | `alternativas-windows.md` §1 (linha 15); `inspiracoes.md` §2.3 (linha 145) |

Sobre o grafo em si (executor), a auditoria registra dois pacotes com **nome colidindo**:

- `@shying/pi-graph` 0.2.0 — LangGraph-inspired, nós `human`, checkpoints, contextos
  isolated/thread/shared (`alternativas-windows.md` §6, linha 86; `inspiracoes.md` §2.3, linha 141).
- `pi-graph` 0.2.3 (HeathHe) — DAG durável com child agents Pi; **mesmo nome curto**,
  risco de instalar o errado (`alternativas-windows.md` §6, linha 87).

E há um terceiro ator relevante: `@arhen/pi-core-subagent` 1.4.3 traz **scheduler por
grafo de dependências** (arestas carregam a saída do upstream) — alinhado ao nosso
`dependsOn` (`alternativas-windows.md` §3, linha 55).

### 5.2 Recomendação: **Pi-Harness** como base, `Pi Agent Desktop` como fallback

**Decisão:** adotar **Pi-Harness** como desktop/base da Fase 4, e usar
**Pi Agent Desktop** como fallback onde a fila de aprovações/terminais exigir
contenção por Job Objects.

Motivos (todos rastreáveis a `docs/research/`):

1. **Cobre Fase 3 e Fase 4 no mesmo produto.** Pi-Harness já traz, num único
   instalador, exatamente o que as duas fases pedem: Task DAG (o grafo), Checkpoints,
   Recovery, Worktrees, Evaluation e Agent Teams (`alternativas-windows.md` §1, linha 16;
   `inspiracoes.md` §2.3, linhas 144/146). Escolher Pi-Harness evita montar duas peças
   (um executor de grafo + um desktop) e depois costurá-las.
2. **É Windows x64 de verdade, sem Tauri/Rust/macOS.** Instalador `.exe` que já inclui
   Pi e Node (`alternativas-windows.md` §1, linha 16). Isso elimina o risco que derrubou
   `pi-native-app` (virou cliente web; o desktop Tauri só existe fixado em `0.1.15`,
   linhas 15 e 396) e evita a dependência de toolchain pesada.

Motivo adicional (não eliminatório, mas relevante): **herda sessões, skills e extensões
do Pi**, então nada do SelfEvoPI precisa ser reescrito — o harness continua dono do loop
(`alternativas-windows.md` §1, Recomendação para a Fase 4).

**Por que não `pi-native-app`:** virou cliente web (AG-UI + Pi SDK); não é desktop
nativo Windows (`alternativas-windows.md` §1, linha 15). Fica descartado como base.

**Por que manter `Pi Agent Desktop` como fallback, e não como base:** ele traz algo que
nenhum outro oferece — terminais contidos por **Job Objects** (Herdr v0.8.2), úteis
para a fila de aprovações/permissões e para a política de `kill-tree` vs `keep-alive`
(`alternativas-windows.md` §2, linhas 28/37). Mas é beta não assinado e não cobre
explicitamente o Task DAG/checkpoints que o Pi-Harness cobre — por isso entra como
camada de contenção, não como a base.

### 5.3 Ressalva de segurança herdada da pesquisa

A auditoria é explícita: **Job Objects com `KILL_ON_JOB_CLOSE` encerram a árvore
inteira por padrão** (`alternativas-windows.md` §2; `inspiracoes.md` §2.13). Isso é
ótimo para limpeza, mas o DeepSeek Harness **perdeu 1,5–1,7 ponto** por matar processos
de background que deveriam sobreviver (`inspiracoes.md` §0 item 7 e §2.17). Logo, a
política de processos do SelfEvoPI precisa ser **por tarefa**: `kill-tree` para CLIs
efêmeros, `keep-alive` explícito para tarefas que deixam serviço no ar. O desktop
apenas **executa** essa política; quem a decide é a camada de sandbox (A6).

## 6. Plano de integração em etapas

Adotar, não reinventar. Cada etapa tem um alvo verificável.

| Etapa | Entrega | Verificação |
|:--|:---|:---|
| **E1** | Congelar o modelo (este módulo) + testes verdes | `node --test core/graph/model.test.mjs` sai 0 |
| **E2** | Mapear nó→Pi: `status` ↔ estado de run do Pi; `dependsOn` ↔ arestas do **Task DAG** do Pi-Harness | grafo serializado em `.pi/harness/` reproduz o DAG esperado |
| **E3** | Checkpoint por nó ↔ Git (`ckpt/<fase>-<step>-pre` + `last-known-good.json`) | recuperar um nó restaura o estado anterior sem reexecutar os já `done` |
| **E4** | Handoffs JSON em `.pi/harness/handoffs/` ligados às arestas `handoff` | revisor recebe só o contrato, nunca o histórico bruto |
| **E5** | Desktop Pi-Harness lendo `.pi/harness/`: painel do grafo, fila de aprovação, rollback Git | fluxo `tarefa → lacuna → artefato → aprovação → execução` visível no desktop |
| **E6** | Camada de contenção: terminais via Job Objects (Pi Agent Desktop) + política `kill-tree`/`keep-alive` por tarefa | `keep-alive` preserva servidor; `kill-tree` encerra a árvore |

O **executor de grafo** (`@shying/pi-graph` vs `pi-graph`) só entra depois do bake-off
da orquestração (P2) e de revisão de código — a colisão de nomes é risco de
supply-chain registrado (`alternativas-windows.md` §6; `inspiracoes.md` §5). Até lá, o
modelo aqui (`core/graph/model.mjs`) já basta para validar e ordenar, sem depender de
terceiros.

## 7. O que construir × o que adotar

| Camada | Decisão | Fonte / justificativa |
|:---|:---|:---|
| Modelo de grafo (nós/arestas/estados/ordenação) | **CONSTRUIR** (este módulo) | é a espinha autoral; leve e testável, sem dep |
| Executor de grafo durável | **ADOTAR** após bake-off (`@shying/pi-graph` 0.2.0) | já traz nós `human` + checkpoints; nome colide, revisar antes |
| Desktop Fase 4 | **ADOTAR Pi-Harness** | cobre Fase 3+4, Windows x64, checkpoints, worktrees, DAG |
| Terminais contidos / aprovações | **ADOTAR Pi Agent Desktop** (fallback) | Job Objects (Herdr) — único a oferecer contenção |
| Live preview | **ADOTAR/integrar OpenDesign** | Apache-2.0, local-first, `od mcp install pi` (`inspiracoes.md` §2.19) |
| Política `kill-tree` vs `keep-alive` | **CONSTRUIR** | DSH perdeu pontos por matar background (`inspiracoes.md` §2.17) |
| Handoffs JSON em `.pi/harness/handoffs/` | **CONSTRUIR** | contrato do plano (§4); a aresta só aponta |

## 8. Fontes

- `docs/research/alternativas-windows.md` — §1 Desktop, §2 Isolamento, §3 Orquestração, §6 Grafo.
- `docs/research/inspiracoes.md` — §0 (itens 7 e 9), §2.3 (ecossistema PI), §2.13 (Job Objects), §2.17 (DeepSeek/keep-alive), §2.19 (OpenDesign).
- `SelfEvoPI — Plano do Projeto.md` — §4 (handoffs), §FASE 3, §FASE 4, §A8.