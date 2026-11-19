# Fase 4 — Desktop Windows: avaliação honesta

> **Data da verificação:** 2026-11-16 (todas as URLs abertas nesta data).
> **Método:** leitura direta de npm registry, GitHub e site oficial. Cada afirmação
> abaixo tem fonte primária com data. O que não deu para abrir está marcado
> `[NÃO VERIFICADO]`.

**Veredito em uma linha:** não construiremos um `.exe` do zero. O **Pi-Harness**
(wangmiaozero) já é o desktop que a Fase 4 pede (Windows x64, checkpoints, worktrees,
Task DAG), e o **Pi Agent Desktop** (pi-desktop.app) entra como camada de contenção
por Job Objects. Sobra para nós a **integração** (o grafo, o painel e o estado em
`.pi/harness/`), não o app.

---

## 1. O que foi verificado (com fonte primária)

### 1.1 Pi-Harness — **existe, roda em Windows x64** (base recomendada)

- **Fonte:** <https://github.com/wangmiaozero/pi-harness> (aberto 2026-11-16) e
  <https://github.com/wangmiaozero/pi-harness/releases> (aberto 2026-11-16).
- **Versão:** release mais recente **v2.4.8, de 2026-11-14** (página de releases).
- **Windows:** instalador **`.exe` x64** (a página de quick start diz: *"Windows: The
  x64 .exe installer"*). Releases confirmam *"Supported platforms: macOS ARM64/x64,
  Windows x64, Linux x64"* repetidamente.
- **O que traz (verificado no README):** Runs, Trace, Replay, Run Compare, Evaluation,
  Policy, Budget, Checkpoints, Recovery, Diagnostics, Regression, Artifacts, Multi-Agent,
  **Task DAG**, **Handoff**, **Review Gates**, **Worktree isolation**. Instaladores
  *"bundle Pi and Node.js"*.
- **Por que serve:** cobre Fase 3 **e** Fase 4 no mesmo produto (grafo/DAG +
  checkpoints + worktrees + desktop). É a base.
- **Ressalva de segurança (do próprio README):** builds de comunidade; **instaladores
  Windows são não assinados** (podem mostrar SmartScreen). Há `SHA256SUMS` para conferir
  o download. Isso não impede o uso, mas exige verificar o hash antes de abrir.

### 1.2 Pi Agent Desktop — **existe, Windows x64, mas é fallback**

- **Fonte:** <https://pi-desktop.app/en/download/> (aberto 2026-11-16; `server_modified`
  2026-11-08) e <https://pi-desktop.app/en/docs/> (aberto 2026-11-16).
- **Versão:** **v0.5.0**; inclui **Pi Coding Agent 1.5.0 + Herdr v0.8.2**.
- **Windows:** *"Windows 10 / 11 · 64-bit (x64) … Unsigned Beta … NSIS installer (.exe)
  Unsigned"*. Docs: *"Windows 10 and 11 x64 are supported. The current installer is an
  unsigned Beta."*
- **Diferencial (verificado):** terminais contidos por **Job Objects** — *"Windows x64
  now bundles Herdr v0.8.2 with Fleet, Agent control, and Job Object-contained
  terminals"*. É o único que oferece contenção de processos.
- **Por que é fallback, não base:** é **beta não assinado** e a página de releases do
  repositório `pi-desktop/pi-desktop` **não tem releases publicadas**
  (<https://github.com/pi-desktop/pi-desktop/releases>: *"There aren't any releases
  here"*, aberto 2026-11-16). Ou seja: o binário é distribuído pelo site, mas não há
  tag/checksum pública no GitHub para auditar. `[parcialmente NÃO VERIFICADO]` — o site
  existe e é claro, mas a distribuição por GitHub Releases que o texto cita não está
  visível.

### 1.3 Colisão de nomes — **descoberta nova e crítica**

Há **dois "pi-harness" diferentes**, e um deles **não é desktop**:

| Nome | O que é | Fonte |
|:---|:---|:---|
| **Pi-Harness** (wangmiaozero) | Desktop operacional (Runs/Trace/Checkpoints/Worktrees/Task DAG) | github.com/wangmiaozero/pi-harness |
| **`pi-harness` 0.1.1** (npm, zosmaai/openzosma) | **Servidor headless HTTP/SSE** que roda `pi-coding-agent` em background — **não é desktop** | registry.npmjs.org/pi-harness (aberto 2026-11-16; server_modified 2026-04-26) |

O pacote npm `pi-harness` **não** é o desktop. Quem安装 `npm i -g pi-harness` (ou
`@openzosma/pi-harness`) cai no servidor headless do OpenZosma, não no app da Fase 4.
O desktop é distribuído por **GitHub Releases** (wangmiaozero), não por esse nome no npm.
`[supply-chain]` — fixar sempre `github.com/wangmiaozero/pi-harness` e conferir o
`SHA256SUMS`; nunca presumir que `pi-harness` no npm é o desktop.

### 1.4 Executor de grafo — `@shying/pi-graph` 0.2.0 (existe, alinhado)

- **Fonte:** <https://registry.npmjs.org/@shying/pi-graph> (aberto 2026-11-16;
  server_modified 2026-08-25) e <https://github.com/huang-sh/pi-graph> (aberto 2026-11-16).
- **Versão:** **0.2.0**, MIT, exige **Node ≥ 22.19.0**.
- **O que traz (verificado):** *"LangGraph-inspired Pi agent graph extension with durable
  execution, bounded state, artifacts, and explicit agent context modes"*; nós `agent`,
  `set` e **`human`**; `/pig validate`, `/pig run`, `/pig resume <runId>`, `/pig inspect`;
  checkpoints em `~/.pi/agent/pi-graph/`; contextos `isolated`/`thread`/`shared`.
- **Por que importa:** é o mais próximo do que construímos em `core/graph/` (nó human,
  checkpoints, resume, arestas com semântica). Candidato natural a **ADOTAR** como
  executor durável depois do bake-off, substituindo o nosso `runtime.mjs` só na parte de
  persistência — o nosso modelo continua sendo a espinha.
- **Ressalva (do próprio repo):** `readOnly` é allowlist de ferramenta, **não** sandbox
  de OS; checkpoint é *at-least-once*, não *exactly-once*. Ou seja: não substitui a
  camada de sandbox do A6.

### 1.5 `pi-graph` (HeathHe) 0.2.3 — colisão de nome curto

- **Fonte:** registro npm (registrado em `docs/research/alternativas-windows.md` §6;
  aberto 2026-11-16 via registry). **Nome curto `pi-graph` ≠ `@shying/pi-graph`.**
- Risco de supply-chain: instalar o errado por engano. Fixar pelo nome completo.

---

## 2. O que serve × o que não serve × o que sobra para nós

| Camada | Serve? | Fonte / motivo |
|:---|:---|:---|
| Desktop base (Fase 4) | **Serve — Pi-Harness** | Windows x64 `.exe`, checkpoints, worktrees, Task DAG, bundles Pi+Node (github.com/wangmiaozero/pi-harness, v2.4.8) |
| Terminais contidos / aprovações | **Serve (fallback) — Pi Agent Desktop** | Job Objects (Herdr v0.8.2); mas beta não assinado, sem release pública no GitHub (pi-desktop.app) |
| Executor de grafo durável | **Serve — `@shying/pi-graph` 0.2.0** | nós human, resume, checkpoints (registry npm + github.com/huang-sh/pi-graph) |
| Servidor headless | **Não é o desktop** — `pi-harness` npm (zosmaai) | é HTTP/SSE, não app (registry.npmjs.org/pi-harness) |
| Sandbox de OS | **Não serve** — `pi-graph` diz `readOnly ≠ sandbox` | precisa da camada do A6 (Job Objects + Node Permission + gate) |
| Nosso grafo/painel/runtime | **Construído** | `core/graph/*` (model, executor, runtime, panel) — leve, testado, sem dep |

**Sobra para nós construir/integrar:**
1. A **ponte** entre o nosso `core/graph` e o estado que o Pi-Harness espera em
   `.pi/harness/` (checkpoint por nó ↔ `ckpt/<fase>-<step>-pre`).
2. O **painel** do grafo (já feito: `core/graph/panel.mjs`) e o `status.json` que ele
   lê por polling.
3. A **política de processos** por tarefa (`kill-tree` vs `keep-alive`) — que o
   desktop só executa, quem decide é o sandbox (A6).
4. A **fila de aprovação** ligada ao nó `human` (o gate do executor já devolve
   `waiting-human`).

**Não sobra para nós:** o `.exe`, o instalador, o runtime do agente, o Task DAG
visual — tudo isso já existe no Pi-Harness e no Pi Agent Desktop.

---

## 3. Recomendação final (Fase 4)

**Adotar Pi-Harness como desktop base; Pi Agent Desktop como camada de contenção.**
Não forkar o `.exe`. Construir apenas a integração (grafo + painel + estado + política
de processos).

Motivos, com fonte primária e data:
1. **Já é Windows x64 de verdade** — instalador `.exe` que inclui Pi e Node, sem
   Tauri/Rust/macOS (github.com/wangmiaozero/pi-harness, releases v2.4.8 de 2026-11-14).
2. **Cobre Fase 3 e Fase 4 juntas** — Task DAG, Checkpoints, Recovery, Worktrees,
   Evaluation, Handoff, Review Gates no mesmo app (README do repo).
3. **Pi Agent Desktop só entra pelo que é exclusivo** — Job Objects (Herdr v0.8.2), mas
   é beta não assinado e não tem release pública no GitHub (pi-desktop.app, v0.5.0).
4. **`@shying/pi-graph` 0.2.0** é o executor durável mais alinhado (nó human, resume,
   checkpoints) — candidato a ADOTAR no bake-off.

---

## 4. Riscos abertos (honestos)

| Risco | Severidade | Como resolver |
|:---|:---|:---|
| Instalador Pi-Harness não assinado | Médio | Conferir `SHA256SUMS` antes de abrir (README do repo) |
| Pi Agent Desktop beta sem release pública no GitHub | Médio | `[parcialmente NÃO VERIFICADO]` — só usar como fallback; confirmar checksum quando houver release |
| Colisão `pi-harness` npm (headless) vs desktop | Alto | Fixar `github.com/wangmiaozero/pi-harness`; nunca `npm i pi-harness` achando que é o desktop |
| `pi-graph` (HeathHe) vs `@shying/pi-graph` | Médio | Fixar sempre pelo nome completo com escopo |
| `readOnly` do pi-graph não é sandbox | Alto | Não substitui a camada do A6; sandbox continua obrigatório |

---

## 5. Fontes (todas abertas em 2026-11-16)

1. <https://github.com/wangmiaozero/pi-harness>
2. <https://github.com/wangmiaozero/pi-harness/releases>
3. <https://pi-desktop.app/en/download/>
4. <https://pi-desktop.app/en/docs/>
5. <https://github.com/pi-desktop/pi-desktop/releases> (releases vazias — verificado)
6. <https://registry.npmjs.org/pi-harness> (0.1.1, zosmaai — headless, não desktop)
7. <https://registry.npmjs.org/@shying/pi-graph> (0.2.0, huang-sh — MIT, Node ≥ 22.19.0)
8. <https://github.com/huang-sh/pi-graph>
9. `docs/research/alternativas-windows.md` §1, §2, §6 (base da auditoria anterior)