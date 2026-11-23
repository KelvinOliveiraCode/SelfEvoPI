<div align="center">

<img src="assets/wordmark-readme.svg" alt="SelfEvoPI" width="420">

# SelfEvoPI

**A coding-agent harness that measures itself — and builds the capability it is missing.**

<sub>Windows-native · engine-agnostic · zero npm dependencies · Node ≥ 22.19</sub>

<br>

| Tests | Evals | Cold start | Prompt overhead | License |
|:--:|:--:|:--:|:--:|:--:|
| 1016 (1015 pass) | deterministic gate | ~82 ms avg | +499 / 1,500 tok | MIT |

</div>

---

## What it is

SelfEvoPI is a **lightweight, agentic, self-evolving harness**. It does not fork
its engine. It wraps one with a thin, deliberate layer: a multi-provider router,
a deterministic evaluation suite with a regression gate, persistent memory, a
Windows-native sandbox — and an evolutionary core that notices a capability
gap, writes the artifact that closes it, tests it in isolation, and promotes it
only if nothing regressed.

The product is **the CLI**. One surface, one conversation. The engine underneath
is an implementation detail you never have to see.

Three properties are treated as requirements, not aspirations:

- **Context is a budget.** Every token in the system prompt is paid on every
  turn, forever. The SelfEvoPI contribution is capped at 1,500 tokens and
  currently measures +499 at the ceiling. Skills and MCP schemas load on demand.
- **Latency is a feature.** The CLI starts in under 100 ms on this machine;
  nothing heavy loads at boot.
- **Quality is measured.** "It works" is not a result. `85/87 on the baseline,
  with the stochastic task named` is.

## What makes it adaptive

The evolutionary loop is seven stages, each independently testable and
injectable:

```
detect → specify → generate → verify → gate → promote / revert
```

It prefers the lightest artifact that solves the problem: configure an existing
MCP → write a skill → write a CLI → write an extension → write an MCP server.
A request that no kind covers resolves to `skill`, the one artifact that can
always be produced honestly. A per-kind interface probe exercises the artifact
the way it is actually invoked — flags for a CLI, JSON-RPC over stdio for a
server, a mocked host for an extension. A smoke test that always passes is not
evidence, so it is not used.

The same discipline applies to the harness itself: `scripts/daily.mjs` runs
diagnose → apply (with autogate) → report, and reverts its own delta when the
gate goes red.

## The CLI

A conversation, not a menu. Type `/` at any time for the command palette.

```
  ╭────────────────────────────────────────────────────────────────────╮
  │ > /ask        ask mode: answers only, never touches disk           │
  │   /build      build mode: writes and runs inside the workspace    │
  │   /compact    compact the conversation history                    │
  │   /fork       fork the current session, keeping the original      │
  │   /language   switch the CLI language (English by default)        │
  ╰────────────────────────────────────────────────────────────────────╯
  ↑↓ navigate  enter select  esc close  ctrl+o status
```

| Command | What it does |
|:--|:--|
| `/evo <goal>` | main mode: the harness evolves and shapes itself toward the goal |
| `/detect` | open capability gaps |
| `/memory <term>` / `/skills` | search memory and list generated artifacts |
| `/compact` | compact history when the window fills |
| `/sessions [id]` | list sessions or load one |
| `/fork [name]` | fork the current session, preserving the original |
| `/diff` | show workspace changes |
| `/export [md\|json]` | export the conversation |
| `/undo` / `/redo` | undo or redo the last exchange |
| `/copy` | copy the last answer to the clipboard |
| `/cost` / `/status` / `/context` | tokens, session state, context usage |
| `/mcp` / `/plugins [name\|test]` | list MCP servers; probe one or all |
| `/init` / `/import` | draft `AGENTS.md`; reversible config migration |
| `/model [name]` / `/effort [level]` | model and reasoning effort |
| `/theme [theme]` | interface theme |
| `/language [en\|pt]` | interface language — **English by default** |
| `/providers [list\|add\|rm\|models]` | manage providers and models |
| `/swarm [n] <task>` / `/subagent …` | shape and run subagents |
| `/worktree [list\|new\|rm]` | isolated git worktrees |
| `/workspace [path]` / `/explorer` | change the working directory |
| `/reload` | reapply configuration without restarting |
| `/paste` / `/attach <file>` / `/images [clear]` | attach clipboard/file images to the next message |
| `/verbosity [level]` | choose what appears during a turn: `minimal`, `tools`, `reasoning`, `full`, `verbose` |
| `/history [n\|clear]` | inspect the session trail: tools, results, reasoning, answers |
| `/clear` / `/help` | clear the conversation, show this list |

**Keyboard.** `Ctrl+O` status view · `Ctrl+,` settings editor · `Ctrl+K` sessions
(with type-to-filter and preview) · `Ctrl+P` activity · `Ctrl+T` tasks ·
`Alt+T` show/hide reasoning · `Ctrl+C` cancel the current answer · `q` quit.
While the agent works you can keep typing: `Enter` queues the message, and it
is sent when the turn finishes. `!command` runs a shell command directly;
`@file` injects a file into the prompt as context.

**Modes.** `/plan` reads and proposes but does not write. `/build` writes and
runs inside the workspace. `/manual` is `/build` with a confirmation before
each write. `/ask` never touches disk. `/goal <condition>` adds a completion
check that clears itself when satisfied. Permission and approver are separate
axes from mode, and the status line shows them separately.

**Language.** English is the default. `/language pt` (or the `Ctrl+,` menu)
switches the whole interface to Portuguese. The choice lives outside the repo
in `~/.pi/agent/cli-locale.json`; `SELFEOPI_LOCALE` overrides it for a single
run. Nothing about the engine, the prompts sent to it, or the artifacts it
writes depends on this setting.

**Terminal look.** The TUI uses a warm bronze/gold palette with high-contrast
text roles, a framed response block with a `◆ SelfEvoPI` label, a winged spinner
with rotating verbs (`⟪◈ ⠋ processing ◈⟫`), tool rows in the `┊ 📄 read  file`
shape and a status bar with a `▰▱` context meter, turn timer, branch and session
id. Low-priority status segments are dropped whole instead of being cut, so text
never breaks or overlaps at the edge.

**Long answers and history.** Wide markdown tables are rendered as stacked
label/value pairs instead of broken columns, and the live redraw counts visual
rows so a long response never eats the prompt bar. `/history` keeps tools, tool
results, reasoning, answers and fallbacks even when `/verbosity` hid them.

**Feedback control.** `/verbosity` chooses how much appears while the agent
works: `minimal` (final answer only), `tools`, `reasoning`, `full` (default) or
`verbose` (adds timer and token counter). Tool lines name the target file, not
the content being written. The choice persists outside the repo and
`SELFEOPI_VERBOSITY` overrides it for one run.

**Images and model capabilities.** `/paste` reads a Windows clipboard image,
`/attach <file>` attaches a file, `@image.png` works inline and `/images clear`
drops pending attachments. Images go to the engine as `ImageContent` blocks.
Effort levels come from the model metadata (declared in `models.json` from the
public OpenRouter/Kilo catalogs) and are verified against the engine — for
example, ERNIE 5.5 Flash Preview correctly exposes only `high`. No text is
truncated: long lines wrap at the real terminal width.

```powershell
npm run models:check    # capabilities of every configured model, no API call
npm run models:prompt   # also sends one minimal prompt to each model
```

**Themes.** Twelve built-in palettes (`default`, `violet`, `blue`, `cyan`,
`green`, `emerald`, `orange`, `pink`, `red`, `magenta`, `gold`, `graphite`)
plus three editable custom slots, each with 11 semantic color roles. Old
Portuguese names saved in `theme.json` migrate automatically.
`/theme` opens a picker; every palette passes WCAG AA on its own background. If
the terminal does not announce truecolor, the palette degrades honestly to
ANSI-256 — no "I changed the theme and nothing happened" bug.

**Mouse and resizing.** In a real terminal the CLI enables SGR mouse reporting:
click a palette row to run the command, a picker row to choose, the status bar
to open the model picker, the hint line for `/help`, or the prompt to place the
cursor. Mouse and cursor-position reports are parsed out of the input stream, so
a click never becomes typed text. The frame follows `stdout.columns` and redraws
on window resize; `--render` stays deterministic at 72 columns.

**Editing and debugging.** `/ast-edit` previews structural edits anchored by
line hashes and only writes with `--apply`. `/dap` lists debug adapters from
`.pi/dap.json`; the DAP client also supports breakpoints, stepping and variable
inspection. An advisor can watch turns and stream rules can abort mid-token
when a forbidden pattern appears.

**LSP.** A zero-dependency LSP client reads `.pi/lsp.json` and exposes
diagnostics, symbols, hover and rename through `/lsp <file> [action]`. The child
server gets an environment allowlist. Position encoding (UTF-16) is not yet
converted — see the changelog for the honest limit.

**Model roles and rewind.** Nine model roles (`default`, `smol`, `slow`, `plan`,
`commit`, `advisor`, `vision`, `task`, `tiny`) select models by context, cost,
image support and reasoning effort, with fallback chains, path-scoped rules and
a cooldown for failed models. `/rewind [drop-errors|last:N|id:<id>]` prunes a
session into a **new** file — the active session is never overwritten.

**Resilience.** A failed model call is retried up to five times before the user
sees an error. After three failures the engine session is reset — a poisoned
assistant message used to make every later prompt fail, even after `/model`.

**Hooks and security log.** Workspaces can declare lifecycle hooks in
`.pi/hooks.json` (workspace-local, never your personal agent config). Events:
`turn_start`, `turn_end`, `tool_start`, `tool_result`, `error`, `compact`. Each
hook receives JSON on stdin, runs without a shell under a minimal environment
and a timeout; a failing hook is recorded, never fatal. `/hooks` shows the
configuration and last results. Every `block`/`warn` gate decision is appended
to a local security ledger (relative paths, redacted excerpts); `/security-log`
reads it back.

**Code Mode (opt-in).** In workspaces with many MCP servers, the tool catalog can
flood the context. `core/agent/code-mode.mjs` runs a short JavaScript program in
a restricted `node:vm` context whose only effect is `tools.call(name, args)` —
no `process`, `require`, `fetch`, `eval` or `Function`, plus an allowlist, call
limit, deadline and output cap. `scripts/code-mode-mcp.mjs` is an opt-in MCP
gateway exposing a single `run_code` tool; it discovers servers and tools from
the **local** config at runtime, so no server name, command or secret lives in
this repository. The gateway is registered locally by the user, with a backup
of the config. See `docs/agent-guides/hooks-e-seguranca.md`.

## Install

```powershell
git clone <repo-url> SelfEvoPI
cd SelfEvoPI
npm run verify
```

Or create the Desktop shortcut with `pwsh launcher/instalar-atalhos.ps1`.

Requirements: Windows (native, no Docker/WSL/VM), Node ≥ 22.19.1, the engine
CLI installed, Git ≥ 2.55 with `core.longpaths true`.

## Sessions

Every launch opens a **new, persisted session**. Nothing is resumed silently.
To continue older work, choose it explicitly:

```powershell
node apps/cli.mjs --resume <session-id>   # or --session <id>
/resume                                  # session picker inside the CLI
/sessions <id>                           # load a known session
```

The active session id appears in `/status`, in the status panel and in
`/history`. Scripts that only inspect models run with an ephemeral session and
leave no files behind.

## First run: configure a provider

The public release ships with **no pre-configured provider**. Point the CLI at
your gateway and let it discover models, reasoning efforts, image support and
free/fast variants:

```powershell
# guided, in a terminal
node scripts/providers-setup.mjs

# agent-friendly, JSON, dry-run then apply
node scripts/providers-setup.mjs --base-url https://your-gateway/v1 `
  --api-key-env YOUR_API_KEY --json --free-only --apply

# from inside the CLI
/providers discover https://your-gateway/v1 YOUR_API_KEY
```

The API key is read from an environment variable and is never printed. The
result goes to `~/.pi/agent/models.json`, outside the repository, with a backup
and a Windows ACL. You can also add a single model by hand with
`--add-model <id> --provider <id> --efforts low,high --image --apply`.

**Several accounts of the same gateway** are first-class: each gets its own id
and key (`kilo1`, `kilo2`, `or1`, `or2`…). The setup never reuses an existing id,
detects duplicate keys, and can clone a sibling's catalog with
`--clone-from kilo1 --api-key-env KILO2_API_KEY --apply`.

## Verify

```powershell
npm test                                # full unit + interface suite
npm run verify                          # tests + evals A/B/C + source URLs
node evals/gate.mjs                     # full gate (real model calls, slow)
node apps/cli.mjs --render status       # render one screen to text (no TTY)
node apps/cli.mjs --render palette      # the command palette, as text
node core/forge/cli.mjs status          # harness state
```

`npm run verify` is what CI runs. It is green on this checkout.

## Security

- Secrets live outside the repository in ACL-restricted files.
- The evolutionary loop never edits `evals/` or `core/governance/`.
- Anything needing network, credentials, or writes outside the workspace pauses
  for a specific human approval question.
- The sandbox gates static analysis, confines filesystem access to the active
  worktree, and tears down the whole process tree.

## Documentation

| Document | What's in it |
|:--|:--|
| [`AGENTS.md`](AGENTS.md) | first read for any coding agent: rules, map, verification |
| [`docs/agent-guides/`](docs/agent-guides/README.md) | practical guides to change providers, tools, commands, language and integrations |
| [`docs/produto.md`](docs/produto.md) | full product dossier: thesis, architecture, CLI, models, security |
| [`docs/estado.md`](docs/estado.md) | measured state, honest gaps |
| [`docs/fase1/decisoes.md`](docs/fase1/decisoes.md) | decisions with evidence and re-evaluation triggers |
| [`docs/fase2/forge.md`](docs/fase2/forge.md) | the evolutionary core |
| [`docs/fase2/sandbox.md`](docs/fase2/sandbox.md) | the isolation layers |
| [`docs/fase2/governanca.md`](docs/fase2/governanca.md) | verified rollback and approval |
| [`docs/fase3/grafo.md`](docs/fase3/grafo.md) | execution graph runtime |
| [`docs/design/marca.md`](docs/design/marca.md) | brand system |
| [`docs/design/superficies.md`](docs/design/superficies.md) | CLI surface grammar |
| [`docs/research/cli-landscape/matriz.md`](docs/research/cli-landscape/matriz.md) | competitor capability matrix |
| [`docs/research/cli-landscape/round2.md`](docs/research/cli-landscape/round2.md) | second-pass gap analysis |
| [`SECURITY.md`](SECURITY.md) | security model in one page |


## License

MIT — see [`LICENSE`](LICENSE).
