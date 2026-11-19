<div align="center">

<img src="assets/wordmark-readme.svg" alt="SelfEvoPI" width="420">

# SelfEvoPI

**A coding-agent harness that measures itself, and builds the capability it is missing.**

<sub>Windows-native · no fork · no Docker · Node ≥ 22.19</sub>

<br>

![Tests](https://img.shields.io/badge/tests-418%20passing-brightgreen)
![Evals](https://img.shields.io/badge/evals-86%2F87%20(98.85%25)-brightgreen)
![Cold start](https://img.shields.io/badge/cold_start-91ms%20avg-blue)
![Prompt](https://img.shields.io/badge/prompt_overhead-%2B506%20of%201500-blue)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

</div>

---

## What it is

SelfEvoPI is an autonomous coding agent that **notices what it is missing and builds it**.

It starts from the [PI Coding Agent](https://github.com/earendil-works/pi) as its engine — not a fork, not an extension, but its own product built on that base, the way Kimi Code is its own agent on the same foundation. Around that engine it adds what a base agent does not have: a multi-provider router, a deterministic evaluation suite with a regression gate, and an **evolutionary core** that detects a capability gap, writes the artifact that closes it, tests it in a Windows sandbox, and promotes it only if nothing else regressed.

The result is not "a harness for pi". It is an agent with its own CLI, its own desktop app, its own brand, and its own name — and the engine underneath is an implementation detail you never have to see.

The whole thing is **~19k lines of production Node ESM** across **65 modules** (56 of them test files, ~10k lines with tests), with **418 passing unit tests** and **29 evaluation tasks**. Cold start is **91 ms** average on `node apps/cli.mjs --version` (7 runs, warm cache). The prompt it adds to the engine is **506 tokens** at the ceiling, against a hard budget of 1,500.

## Why it exists

A coding agent's competence is mostly a property of its harness, not of the model underneath it. The [Harness Leaderboard](https://huggingface.co/spaces/joelniklaus/harness-leaderboard) makes this concrete: the same model, moved from one harness to another, swings success rate and cost per resolved task by tens of percent.

That has a design consequence. If the harness is the product, then:

- **context is a budget, not a resource** — every token of system prompt is paid on every single turn, forever;
- **latency is a feature** — an agent that takes 500 ms to start is used differently from one that takes 5 s;
- **quality must be measured, not asserted** - "it works" is not a result, `86/87, with the one miss named` is.

SelfEvoPI takes those three literally — and then goes one step further, because a harness that only measures itself is a dashboard. One that **closes the gap it found** is an agent.

## Measured results

Everything below was measured on this repository, on Windows 11, Node 24.13. Reproduce with `npm run verify` and the scripts named in the table.

| Metric | Value | Budget | How |
|:---|:---|:---|:---|
| Cold start, SelfEvoPI CLI | **91 ms** avg (min 82, max 98) · 7 runs | < 500 ms | `node apps/cli.mjs --version` |
| Cold start, the engine underneath | **473 ms** median · 1.012–1.806 s cold cache | — | `scripts/measure-overhead.mjs` |
| Prompt added by SelfEvoPI | **+506 tok** worst case | < 1.500 tok | `scripts/measure-selfevopi-overhead.mjs --runs 3` |
| Base agent prompt | 8.685 tok | — | same |
| Evaluation suite | **29 tasks, 86/87 baseline (98.85%)** — B11 is stochastic | no regression | `node evals/gate.mjs` |
| Unit tests | **418 passing** | - | `node --test core/agent/*.test.mjs apps/*.test.mjs apps/desktop/*.test.mjs` |
| Source URLs | **33 cited sources, all 200** | all reachable | `node scripts/verify-urls.mjs` |
| Suite cost per task | **US$ 0.00** (free tier) | — | JSONL ledger |
| Suite latency | ~5.9 s/task average | — | ledger |
| Codebase | **65 modules** · ~18.9k lines of production code | — | — |
| Test code | **56 files** · ~10.5k lines | — | — |

### What the prompt budget actually buys

The base agent already spends ~8.7k tokens before SelfEvoPI does anything. A naive extension set blows the budget on its own — a single orchestration extension measured **+1,653 tokens per turn**, which alone exceeds the entire 1,500-token allowance, with no measured gain in accuracy.

So SelfEvoPI ships its own contribution at **+499 tokens** and loads everything else on demand. That is a third of the budget, with two thirds held in reserve.

## Architecture

Five layers, each with a single responsibility and a narrow interface.

```
┌──────────────────────────────────────────────────────────────────────┐
│  layer 0 · base agent                                                │
│  PI Coding Agent, unmodified · TUI, loop, 4 native tools, sessions    │
└──────────────────────────────────────────────────────────────────────┘
        │
        │  extensions · skills · config · .pi/harness/   (no fork)
        ▼
┌──────────────────────────────────────────────────────────────────────┐
│  1  ROUTER        profiles · circuit breaker · retry · token ceiling │
│  2  EVALS         29 tasks · deterministic checkers · regression gate│
│  3  EVOLUTION     detect → specify → generate → sandbox → gate       │
│  4  SANDBOX       static gate · permission model · process containment
│  5  MEMORY        3 levels · evidence-based pruning · retrieval      │
└──────────────────────────────────────────────────────────────────────┘
```

| Layer | Module | Lines | Tests |
|:---|:---|:---|:---|
| Router | `core/router/` | 3 modules | 4 files |
| Forge (evolutionary core) | `core/forge/` | 14 modules | 14 files |
| Sandbox | `core/sandbox/` | 2 modules | 3 files |
| Governance | `core/governance/` | 2 modules | 2 files |
| Memory | `core/memory/` | 4 modules | 4 files |
| Graph | `core/graph/` | 6 modules | 6 files |

## The evolutionary loop

The core is a seven-stage cycle. Every stage is a separate module with its own tests, and every stage can be replaced by an injected dependency.

```
                    ┌──────────────┐
                    │   DETECT     │  ledger: repeated failure,
                    └──────┬───────┘  missing capability, fragile path
                           ▼
                    ┌──────────────┐
                    │  SPECIFY     │  contract: inputs, outputs,
                    └──────┬───────┘  prohibitions, test cases
                           ▼
                    ┌──────────────┐
                    │   GENERATE   │  lightest artifact kind that
                    └──────┬───────┘  satisfies the contract
                           ▼
                    ┌──────────────┐
                    │   VERIFY     │  syntax check → interface probe
                    └──────┬───────┘  in sandbox
                           ▼
                    ┌──────────────┐
                    │    GATE      │  target solved AND
                    └──────┬───────┘  zero regressions
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
       ┌─────────────┐          ┌──────────────┐
       │   PROMOTE   │          │   REVERT     │
       │ commit +    │          │ git revert + │
       │ LKG + memory│          │ re-verify    │
       └─────────────┘          └──────────────┘
```

### Artifact kinds, from lightest to heaviest

The loop always prefers the lightest artifact that satisfies the contract:

| # | Kind | Output | Rationale |
|:--|:---|:---|:---|
| 1 | `mcp-config` | `.mcp.json` | configure something that already exists |
| 2 | `skill` | `SKILL.md` | a procedure, no code |
| 3 | `cli` | `cli.mjs` | local automation |
| 4 | `extension` | `index.mjs` | UI inside the agent |
| 5 | `mcp-server` | `server.mjs` | a new tool server |

A request that no kind covers resolves to `skill` — the only artifact that can always be produced without inventing an interface. Falling through to `cli` would produce the wrong artifact with a success-shaped result.

### Why a probe instead of a smoke test

An early version of the gate accepted any artifact whose test command exited 0. That promoted a CLI that read positional arguments instead of the flags in its own contract.

The fix was a **per-kind interface probe**: a script written next to the artifact that exercises it the way it is actually invoked — flags for a CLI, JSON-RPC over stdio for a server, a mocked host object for an extension. The probe is a file, not a shell string, so it is readable, auditable, and free of quoting hazards.

## Engineering discipline

### Phase gating

Seven phases (P, 0, 1, 2, 3, 4, 5), each with explicit exit criteria and a test battery. A phase does not start until the previous one passes. Tags mark each: `v0.0-research` through `v0.5-desktop`.

### Parallel worktrees

Eight isolated worktrees (`.worktrees/A1`–`A8`), each with a disjoint file scope. No agent's work lands without the orchestrator reading it and running its verification command.

### Checkpoints and rollback

| Situation | Mechanism |
|:---|:---|
| Before any risky operation | `ckpt/pre-<operation>` tag + `.pi/harness/last-known-good.json` |
| Agent worktree fails | reset or discard the worktree only |
| Self-evolved artifact regresses | `git revert` + ledger entry + re-run the gate |
| Integration branch breaks | restore to last-known-good, branch `fix/`, re-verify |

`last-known-good.json` is written **only after verification passes**. A rollback that reverts cleanly but leaves the suite red does not update it.

### Quality gates

| Gate | What it checks | Enforcement |
|:---|:---|:---|
| `npm test` | 418 unit tests | CI on every push |
| `npm run verify` | tests + evals A/C + source URL integrity | CI |
| `node evals/gate.mjs` | 3 runs per task vs baseline | local, before merge |
| `scripts/verify-urls.mjs` | 33 cited sources still reachable | CI |
| Static analysis | 13 rules, pre-execution | sandbox, in-process |

### The gate catches real regressions

This is not a formality. During development, a deliberate change to the artifact-kind selector caused a regression, and the gate **failed the run**:

```
Regressões (1):
- `A8-forge-choose-kind` (A): 100% → 0% (3/3 → 0/3)
✗ GATE REPROVADO — há tarefa abaixo da linha de base.
```

The change was correct on the merits; the evaluator had encoded the previous behaviour. The fix was to update the evaluator with the reasoning, then regenerate the baseline. The gate's value is that it forced that decision to be explicit instead of silent.

### Evaluation suite

29 tasks in four groups, each with a deterministic checker:

| Group | Tasks | What it measures | Model calls |
|:---|:---|:---|:---|
| **A** | 8 | router, budget, retry, kind selection | none |
| **B** | 11 | generated CLIs, schema validation, parsing | 3 (B9–B11) |
| **C** | 6 | regressions that must never degrade | none |
| **D** | 4 | end-to-end coding tasks | 4 |

### Meta-audit: can the checker be fooled?

A suite is only worth its pass rate if each checker **separates** a correct answer from a plausible-looking wrong one.

The suite was audited by attacking every task with a **degenerate answer** — an artifact that prints the expected output without computing anything. Seven tasks failed the audit:

| Task | Hole | Fix |
|:---|:---|:---|
| B9, B10, B11 | filename lookup | runtime-generated surprise input |
| D1, D2, D3, D4 | hardcoded expected values | runtime-generated surprise inputs |

The remaining 22 import the real module under test and assert behaviour, so a stub or a stubbed replacement would fail.

### Sandbox

Three layers, because no single one is enough:

1. **Static gate** — 13 rules, AST-level, blocks credential access, network, subprocess spawning, destructive filesystem operations, before anything runs.
2. **Node Permission Model** — read/write confined to the worktree, no network, no child processes.
3. **Process containment** — full process-tree teardown, so nothing survives the run.

Proven against real escape attempts:

| Attempt | Result |
|:---|:---|
| `fetch()` to an external host | blocked at the preload |
| reading `C:\Windows\System32\drivers\etc\hosts` | blocked (`--allow-fs-read`) |
| writing to the home directory | blocked (`--allow-fs-write`) |
| spawning a subprocess | blocked (`--allow-child-process`) |
| reading `.ssh`, `.aws`, agent config | blocked |
| reading an ambient credential env var | blocked |

Zero attempts succeeded.

### Routing

| Property | Behaviour |
|:---|:---|
| Profiles | `orchestrator`, `worker`, `reviewer` |
| Reviewer isolation | forced onto a different provider than the worker |
| Failover | 429, timeout, empty body → next provider |
| Retry | exponential backoff, capped |
| Circuit breaker | opens after N failures, closes after cooldown |
| Token ceiling | per-task budget, `onExceeded` fires once |

Proven with injected failures rather than mocks that always succeed: 429, timeout, and empty-body responses all trigger a provider switch; the breaker opens and closes; the ceiling fires exactly once and the following call is refused.

## Requirements

- **Windows** natively — no Docker, no VM, no WSL
- **Node.js ≥ 22.19.1** (validated on 24.13)
- **PI Coding Agent ≥ 1.5.2**
- **Git ≥ 2.55** with `core.longpaths true`

## Install

Clone this repository, then verify:

```powershell
git clone <url-do-repositorio> SelfEvoPI
cd SelfEvoPI
npm run verify
```

`npm run verify` runs the unit tests, the deterministic evaluation groups, and the source-URL integrity check — the same command CI runs.

## Usage

### From the desktop

Two shortcuts on the Desktop, both carrying the brand icon:

- **`SelfEvoPI`** (`launcher/SelfEvoPI.cmd`) — opens the CLI: a keyboard-driven terminal interface. Type `/` at any time and the command palette opens with every command, filtering as you type.
- **`SelfEvoPI-Painel`** (`launcher/SelfEvoPI-Painel.cmd`) — opens the desktop app: a native window without an address bar into the conversation, backed by the server on `127.0.0.1:7777`.

The launcher sources live in `launcher/`, and the shortcuts point at them. Earlier copies are kept in `launcher/antigos/`.

> **A caminho (1.0):** dois executáveis nomeados pela marca — `SelfEvoPI.cmd` (CLI) e
> `SelfEvoPI-Desktop.cmd` (desktop). Enquanto o segundo não é integrado, o desktop abre
> pelo `SelfEvoPI-Painel.cmd`.

### The CLI

A conversation, not a menu. The engine underneath is invisible — the interface is SelfEvoPI's.

```
  ◍  SelfEvoPI                                              v0.5.0
  ────────────────────────────────────────────────────────────────
  ● main · pronto · 86/87 baseline · build

  › /
  ┌────────────────────────────────────────────────────────────────┐
  │ > /ask             modo ask: só responde, nunca toca em disco  │
  │   /build           modo build: escreve e executa no workspace  │
  │   /clear           limpa a conversa e começa de novo           │
  │   /compact         compacta o histórico da conversa            │
  │   ...                                                          │
  └────────────────────────────────────────────────────────────────┘
  ↑↓ navegar  enter escolher  esc fechar
```

| Comando | O que faz |
|:--|:--|
| `/evals` `/gate` `/detect` | os grupos estruturais, o gate completo, as lacunas abertas |
| `/forge <meta>` | inicia um ciclo evolutivo rumo à meta |
| `/memory <termo>` `/skills` | busca na memória (lexical + PPMI) e o que já foi gerado |
| `/compact` | resume o histórico quando a janela enche |
| `/sessions` `/sessions <id>` | lista sessões ou carrega uma |
| `/cost` `/status` `/context` | tokens e custo, estado da sessão, uso da janela |
| `/mcp` `/init` | servidores declarados e rascunho de `AGENTS.md` |
| `/model [nome]` `/clear` `/help` | modelo da conversa, limpar, ajuda |

**Modos** — mudam o que o agente pode fazer, e aparecem na barra de estado:

| Modo | Lê | Escreve | Executa | Pausa para perguntar |
|:--|:--:|:--:|:--:|:--|
| `/plan` | ✅ | ❌ | só leitura | antes de escrever |
| `/build` | ✅ | ✅ no workspace | ✅ no workspace | fora do workspace |
| `/manual` | ✅ | ✅ no workspace | ✅ no workspace | antes de **cada** escrita |
| `/ask` | ✅ | ❌ | ❌ | — |
| `/goal <condição>` | ✅ | ✅ | herda do modo base | fora do workspace |

`/manual` é como `/build` — escreve e executa no workspace — mas confirma **cada** escrita com você antes de aplicá-la. É o modo de quem quer revisar o diff antes de ele virar arquivo.

`/goal <condição>` define uma condição de conclusão. Um avaliador separado checa ao fim de cada turno e a meta se limpa sozinha quando o objetivo é atingido — nunca fica acesa.

**O que não é modo.** `full access` e `auto` não são modos. `full access` é o **tipo de permissão** (o que o agente pode tocar); `auto` é o **aprovador** (quem decide quando ele pode). São eixos diferentes, e é por isso que a barra de estado mostra os dois em linhas separadas — modo em cima, permissão e modelo na linha de baixo.

### From the shell

```powershell
npm run verify                          # tests + evals A/B/C + URLs
npm test                                # 418 unit tests
npm run gate                            # full gate (real model calls, slow)

node apps/cli.mjs                       # the CLI (same as the desktop shortcut)
node apps/cli.mjs --render status       # render one screen to text (no TTY needed)
node apps/cli.mjs --render palette      # the command palette, as text

node core/forge/cli.mjs detect          # what gaps exist right now
node core/forge/cli.mjs status          # harness state
node core/forge/cli.mjs skills <term>   # what has already been generated
node core/router/cli.mjs --snapshot     # routing decision
node scripts/desktop.mjs --app          # the desktop app (native window)
node scripts/schedule.mjs --status      # the daily routine
```

### The loop on a real objective

```powershell
node core/forge/cli.mjs evolve `
  --goal "compute BMI from weight and height" `
  --kind cli --inputs "peso,altura" --outputs "imc,classificacao" --llm
```

```
outcome: promoted
kind: cli
verify: pass (exit 0)
gate: promote — no eval task; gated on the artifact's own evidence
```

The resulting CLI, run by hand:

```console
$ node cli.mjs --peso 70 --altura 1.75
{"imc":22.86,"classificacao":"Peso normal"}
```

## The desktop app

A single Node process (`scripts/desktop.mjs`) serves the desktop UI on `127.0.0.1` and exposes a small JSON API. The interface is a conversation, not a dashboard:

- **settings menu** (`apps/desktop/settings.js`) — a control bar below the composer (mode, model, permission) and a preferences panel (`Ctrl+,`) for what does not change per turn: mode (`plan`/`build`/`manual`/`ask`/`goal`), model, reasoning effort, permission, confirm-writes, tips. Persists in `localStorage` under `selfevopi.settings`; no file on disk.
- **sessions** (`apps/desktop/sessions.js`) — list, open and start sessions from the sidebar, with title and turns/tokens per row.
- **responsive** (`apps/desktop/desktop.css`) — two columns on desktop, the session list becomes an overlay drawer below 900px (it does not disappear), an extra breakpoint below 480px, and `prefers-reduced-motion` is respected.

The server binds to loopback only, reads nothing outside the repository, and executes nothing that is not on the allowlist. The older metrics panel (`scripts/desktop.mjs`) is still available for evaluation rates, recent executions, promoted artifacts and graph runs.

> **Sessions carry a `client` field** (`cli` | `desktop`) in their header (`core/agent/sessions.mjs`), so a session created on one surface can be listed and opened from the other. Headers written before this field count as `cli`.

## Documentation

| Document | What's in it |
|:---|:---|
| [`docs/estado.md`](docs/estado.md) | current state: metrics, phase delivery, honest gaps |
| [`docs/fase1/decisoes.md`](docs/fase1/decisoes.md) | decisions with evidence and re-evaluation triggers |
| [`docs/fase2/forge.md`](docs/fase2/forge.md) | the evolutionary core |
| [`docs/fase2/sandbox.md`](docs/fase2/sandbox.md) | the three isolation layers and what each blocks |
| [`docs/fase2/governanca.md`](docs/fase2/governanca.md) | verified rollback and human approval |
| [`docs/fase3/painel.md`](docs/fase3/painel.md) | graph runtime and panel |
| [`docs/fase4-ponte.md`](docs/fase4-ponte.md) | the state bridge for a desktop host |
| [`docs/design/marca.md`](docs/design/marca.md) | brand system: palette, type scale, CLI and desktop anatomy |
| [`docs/design/superficies.md`](docs/design/superficies.md) | the two surfaces drawn out: how the CLI and the desktop present a conversation |
| [`docs/research/mercado.md`](docs/research/cli-landscape/mercado.md) | the coding-agent market: who ships what, and where the gaps are |
| [`docs/research/matriz.md`](docs/research/cli-landscape/matriz.md) | capability matrix across the CLIs we compared, with the gap analysis |
| [`docs/research/ux-tui.md`](docs/research/cli-landscape/ux-tui.md) | terminal-UI craft: what a good TUI does that a web page cannot |
| [`docs/research/inspiracoes.md`](docs/research/inspiracoes.md) | audit of 23 primary sources, 41 decisions |
| [`docs/research/round2.md`](docs/research/cli-landscape/round2.md) | second pass: what was still missing against Claude Code, OpenCode and Hermes |
| [`SECURITY.md`](SECURITY.md) | how to report a vulnerability, and the security model in one page |

## Brand

| Asset | Use |
|:---|:---|
| [`assets/wordmark-readme.svg`](assets/wordmark-readme.svg) | wordmark, tuned for both light and dark backgrounds |
| [`assets/logo-readme.svg`](assets/logo-readme.svg) | icon, same |
| [`assets/wordmark.svg`](assets/wordmark.svg) | original wordmark (dark ink) |
| [`assets/logo.svg`](assets/logo.svg) | original icon (dark ink) |
| [`assets/wordmark-circulo.svg`](assets/wordmark-circulo.svg) | circular lockup |
| [`assets/selfevopi.ico`](assets/selfevopi.ico) | app icon (six sizes, 16 to 256, transparent) |

The README variants exist because the originals use near-black ink (`#111`), which disappears against a dark background. Same geometry, mid-grey (`#6e7781`), legible on both. The full interface system — palette, type scale, and the two surface grammars (terminal and desktop) — is in [`docs/design/marca.md`](docs/design/marca.md).

## Project layout

```
apps/               the CLI (keyboard-driven terminal interface)
core/router/        multi-provider routing
core/forge/         evolutionary core: contract, detect, specify, generate, gate, loop
core/sandbox/       process isolation and static analysis
core/governance/    verified rollback and human approval
core/memory/        three-level memory with retrieval and pruning
core/graph/         execution graph: runtime, persistent bridge, panel, pi-harness adapter
evals/              29 tasks, checkers, regression gate
scripts/            measurement, desktop app, checkpoints, routines
launcher/           desktop shortcuts and the icon generator
.pi/harness/        persistent state (memory, ledger, reports, artifacts)
docs/               decisions, state, research, design system
.github/workflows/  continuous integration
```

## Security

- **Secrets live outside the repo** and the destination file is ACL-restricted.
- **The evolutionary loop never edits `evals/` or `core/governance/`.** Those are protected areas.
- **Anything that needs network, credentials, or writes outside the workspace pauses for human approval**, with a specific question rather than a generic confirmation.

## License

MIT — see [`LICENSE`](LICENSE).
