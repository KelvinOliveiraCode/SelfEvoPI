# CLI Landscape — o resto do mercado (fora Claude Code e OpenCode)

> **Data da consulta:** 2026-11-17
> **Método:** documentação oficial de cada projeto (docs locais do pacote instalado, quando havia) + README/docs oficiais na web. Cada afirmação traz a fonte. "Não verificado" quando a fonte não foi aberta.
> **Escopo:** Hermes Agent CLI, PI Coding Agent, Aider, Cline CLI, Continue CLI, Codex CLI (OpenAI), Gemini CLI.

---

## 1. Tabela comparativa

| Ferramenta | Comandos principais (verificados) | Modos | O que se destaca |
|:---|:---|:---|:---|
| **Hermes Agent CLI** (Nous Research) | `hermes chat`, `hermes model`, `hermes setup`, `hermes -z` (one-shot), `hermes --resume`, `hermes -w` (worktree), `hermes kanban`, `hermes skills`, `hermes cron`, `hermes gateway` ([docs](https://hermes-agent.nousresearch.com/docs/reference/cli-commands)) | TUI vs CLI clássico (`--tui`/`--cli`); `--yolo` (sem aprovação); `--worktree` ([docs](https://hermes-agent.nousresearch.com/docs/user-guide/cli)) | Plataforma "que cresce com você": skills, memória, kanban, cron, gateway de mensagens (WhatsApp/Slack/Telegram), profiles isolados |
| **PI Coding Agent** (`earendil-works/pi`) | `/settings`, `/model`, `/thinking`, `/new`, `/resume`, `/tree`, `/fork`, `/compact`, `/mcp`, `/trust`, `/reload`, `/hotkeys`, `/quit` ([slash-commands.md](file:///C:/Users/Kelvin/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/docs/slash-commands.md)) | Não tem "modos" nomeados; tem nível de *thinking* (`/thinking`) e modelo por perfil ([keybindings.md](file:///C:/Users/Kelvin/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/docs/keybindings.md)) | Sessão em árvore (`/tree`), fork/clone, compactação, ciclo de modelo/thinking por atalho, extensões/skills como comandos |
| **Aider** | `/add`, `/drop`, `/commit`, `/undo`, `/run`, `/test`, `/lint`, `/map`, `/architect`, `/code`, `/ask`, `/chat-mode`, `/tokens`, `/reset`, `/model`, `/editor-model`, `/reasoning-effort`, `/think-tokens`, `/web`, `/voice` ([commands.html](https://aider.chat/docs/usage/commands.html)) | `code`, `ask`, `architect`, `help` ([modes.html](https://aider.chat/docs/usage/modes.html)) | Mapa de repositório, modo architect/editor com **dois modelos**, `/run` e `/test` que injetam saída no chat |
| **Cline CLI** | `/newtask`, `/smol`, `/newrule`, `/deep-planning`, `/reportbug` ([using-commands](https://docs.cline.bot/core-workflows/using-commands)); TUI: `/settings`, `/model`, `/theme`, `/account`, `/mcp`, `/plugins`, `/skills`, `/compact`, `/fork`, `/undo`, `/clear`, `/history`, `/team`, `/help`, `/quit` ([README](https://github.com/cline/cline/blob/main/apps/cli/README.md)) | TUI interativo (plan/act toggle), one-shot, `--json`, `--yolo`, `--zen` (hub em background) ([README](https://github.com/cline/cline/blob/main/apps/cli/README.md)) | `/deep-planning` (investiga, pergunta, gera `implementation_plan.md`), `/newtask` (handoff de contexto), hub/daemon, kanban |
| **Continue CLI** (`cn`) | `/help`, `/clear`, `/login`, `/logout`, `/model`, `/config`, `/mcp`, `/init`, `/compact`, `/resume`, `/fork`, `/title`, `/rename`, `/exit`, `/jobs` ([tui-mode](https://docs.continue.dev/cli/tui-mode)) | `normal`, `plan` (`--readonly`), `auto` (`--auto`) ([modes.md](https://github.com/continuedev/continue/blob/main/extensions/cli/spec/modes.md)) | Permissões por ferramenta com glob (`Write(**/*.ts)`), `permissions.yaml`, `Shift+Tab` cicla modos |
| **Codex CLI** (OpenAI) | `/permissions`, `/status`, `/model`, `/approvals` ([cli](https://learn.chatgpt.com/docs/codex/cli)); `codex exec` (não-interativo) | Sandbox: `read-only`, `workspace-write`, `danger-full-access`; aprovação: `on-request`, `never` ([sandboxing](https://learn.chatgpt.com/docs/sandboxing)) | Sandbox **nativo do SO** + política de aprovação separada, `approvals_reviewer = auto_review` (revisor agente), `writable_roots` |
| **Gemini CLI** | `/about`, `/agents`, `/chat`, `/clear`, `/commands`, `/compress`, `/help`, `/init`, `/mcp`, `/memory`, `/model`, `/permissions`, `/plan`, `/policies`, `/quit`, `/restore`, `/rewind`, `/resume`, `/settings`, `/skills`, `/stats`, `/tools`, `/vim` ([commands](https://geminicli.com/docs/reference/commands/)) | `default`, `auto_edit`, `yolo`, `plan` (`--approval-mode`) ([cli-reference](https://geminicli.com/docs/cli/cli-reference/)) | `/rewind` (desfaz chat + arquivos), `/restore` (checkpoint por tool call), `/vim`, `GEMINI.md` hierárquico, `@` (arquivos) e `!` (shell) |

---

## 2. Modos — o conceito em cada ferramenta

O "modo" é uma **predefinição de permissões + postura** (planejar vs. executar). Como se transita:

| Ferramenta | Modos | Como se transita | Fonte |
|:---|:---|:---|:---|
| **Aider** | `code` (edita), `ask` (discute, não edita), `architect` (arquiteto propõe + editor aplica), `help` | `/code`, `/ask`, `/architect` (numa mensagem) ou `/chat-mode <modo>` (fixo); `--chat-mode`/`--architect` no launch. O prompt mostra o modo (`ask>`, `architect>`) | [modes.html](https://aider.chat/docs/usage/modes.html) |
| **Continue** | `normal`, `plan` (read-only), `auto` (tudo liberado) | `Shift+Tab` cicla; `--readonly`/`--auto` no launch. Modos `plan`/`auto` **sobrescrevem** `permissions.yaml` | [modes.md](https://github.com/continuedev/continue/blob/main/extensions/cli/spec/modes.md) |
| **Codex** | Sandbox (`read-only`, `workspace-write`, `danger-full-access`) + aprovação (`on-request`, `never`) — **dois eixos independentes** | `/permissions` (picker interativo); `--sandbox`/`--ask-for-approval` no launch; `--full-auto` = workspace-write + on-request | [sandboxing](https://learn.chatgpt.com/docs/sandboxing) |
| **Gemini CLI** | `default`, `auto_edit`, `yolo`, `plan` | `--approval-mode <modo>` no launch; `/plan` entra em read-only | [cli-reference](https://geminicli.com/docs/cli/cli-reference/) |
| **Cline** | TUI com toggle **plan/act**; `--yolo` (sem aprovação); `--json`; `--zen` | Toggle na TUI; flags no launch | [README](https://github.com/cline/cline/blob/main/apps/cli/README.md) |
| **Hermes** | Não tem "modos" nomeados; tem `--yolo` (pula aprovação) e `--tui`/`--cli` (interface) | Flags no launch | [cli](https://hermes-agent.nousresearch.com/docs/user-guide/cli) |
| **PI** | Não tem "modos" nomeados; tem nível de thinking (`/thinking`) e ciclo de modelo | `/thinking`, `/model`, atalhos `shift+tab` (thinking), `ctrl+l` (modelo) | [slash-commands.md](file:///C:/Users/Kelvin/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/docs/slash-commands.md), [keybindings.md](file:///C:/Users/Kelvin/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/docs/keybindings.md) |

**Observação:** só **Aider** e **Continue** têm "modos" como conceito nomeado e documentado (code/ask/architect; normal/plan/auto). **Codex** e **Gemini** têm o conceito de **permissão** (sandbox/approval) como eixo separado. Cline tem toggle plan/act. Hermes e PI não têm modos — têm flags de postura.

---

## 3. Padrões que se repetem no mercado inteiro

1. **Comando de barra (`/`) como linguagem de controle.** Aider, Cline, Continue, Codex, Gemini, PI e Hermes têm comandos `/` dentro da sessão. É a convenção universal. Fontes: seção 1.

2. **`/help` existe em todas.** Aider (`/help`), Cline (`/help`), Continue (`/help`), Gemini (`/help` ou `/?`), PI (menu de comandos ao digitar `/`), Hermes (referência de slash commands). Fonte: seção 1.

3. **`/clear` (ou equivalente) para zerar contexto.** Aider (`/clear`), Cline (`/clear`), Continue (`/clear`), Gemini (`/clear`), PI (`/new`). Fonte: seção 1.

4. **Aprovação humana para ações destrutivas.** Codex (approval policy), Continue (tool permissions), Cline (`--yolo` inverte), Gemini (confirmação de mutators), Hermes (`--yolo`), Aider (confirmação antes de editar). É consenso: **ação que muda arquivo/comando pede confirmação**, e `--yolo`/`--auto` é a válvula de escape. Fontes: [sandboxing](https://learn.chatgpt.com/docs/sandboxing), [tool-permissions](https://docs.continue.dev/cli/tool-permissions), [gemini tools](https://geminicli.com/docs/reference/tools/).

5. **Retomada de sessão (`--resume`/`--continue`).** Hermes (`--resume`), PI (`/resume`), Cline (`--id`/`history`), Continue (`--resume`), Gemini (`/resume`), Aider (não tem — usa git). Fonte: seção 1.

6. **Compactação de contexto.** Aider (`/clear`/`/reset`), Cline (`/smol`/`/compact`), Continue (`/compact`), Gemini (`/compress`), PI (`/compact`), Hermes (contexto gerenciado). Fonte: seção 1.

7. **MCP (Model Context Protocol) como extensão de ferramentas.** PI (`/mcp`), Cline (`cline mcp`), Continue (`/mcp`), Gemini (`/mcp`), Hermes (`hermes mcp`). Aider não cita MCP. Fonte: seção 1.

8. **Saída JSON para automação.** Cline (`--json`), Hermes (`--format stream-json`, `-z`), Continue (`-p` headless), Codex (`codex exec`), Gemini (headless). Fonte: seção 1.

9. **Worktree Git isolado para paralelismo.** Hermes (`-w`/`--worktree`), Cline (`--worktree`). Fonte: [cli](https://hermes-agent.nousresearch.com/docs/user-guide/cli), [README](https://github.com/cline/cline/blob/main/apps/cli/README.md).

---

## 4. O que é específico de cada uma (diferencial)

- **Hermes Agent CLI** — é menos um "assistente de código" e mais uma **plataforma de agente**: gateway de mensagens (WhatsApp/Slack/Telegram/Signal), cron, kanban, profiles isolados, `hermes skills`, `hermes journey` (memória), `hermes acp` (servidor ACP para editores). O `hermes -z` é one-shot puro (só o texto final). Fonte: [cli-commands](https://hermes-agent.nousresearch.com/docs/reference/cli-commands).

- **PI Coding Agent** — **sessão em árvore** (`/tree`, `/fork`, `/clone`) navegável por atalho, ciclo de modelo/thinking sem sair da sessão (`ctrl+l`, `shift+tab`), e extensões/skills viram comandos `/skill:name`. É a base do SelfEvoPI. Fonte: [slash-commands.md](file:///C:/Users/Kelvin/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/docs/slash-commands.md), [keybindings.md](file:///C:/Users/Kelvin/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/docs/keybindings.md).

- **Aider** — **modo architect/editor com dois modelos** (arquiteto propõe, editor aplica) e **mapa de repositório** (`/map`). `/run` e `/test` injetam a saída no chat para o modelo se autocorrigir. É a lista de comandos mais estável do mercado. Fonte: [modes.html](https://aider.chat/docs/usage/modes.html), [commands.html](https://aider.chat/docs/usage/commands.html).

- **Cline CLI** — `/deep-planning` (investiga em silêncio, pergunta, gera `implementation_plan.md`, cria tarefa rastreável) e `/newtask` (handoff de contexto limpo). Hub/daemon (`--zen`) e kanban. Fonte: [using-commands](https://docs.cline.bot/core-workflows/using-commands).

- **Continue CLI** — **permissões por glob** (`Write(**/*.ts)`, `Bash(npm install*)` excluído) e `permissions.yaml`. `Shift+Tab` cicla normal→plan→auto. Nota: adquirida pela Cursor, última versão 1.5.47 ([cheat sheet](https://thevibefather.com/cheatsheets/continue)). Fonte: [tool-permissions](https://docs.continue.dev/cli/tool-permissions).

- **Codex CLI** — **sandbox nativo do SO** (macOS Seatbelt, Linux Landlock, Windows) separado da **política de aprovação**, `approvals_reviewer = auto_review` (um agente revisor avalia aprovações elegíveis), `writable_roots` para estender o que pode escrever, e `codex sandbox <os>` para testar o sandbox localmente. Fonte: [sandboxing](https://learn.chatgpt.com/docs/sandboxing), [sandbox.md](https://github.com/openai/codex/blob/main/docs/sandbox.md).

- **Gemini CLI** — `/rewind` (desfaz chat **e** arquivos) e `/restore` (checkpoint por tool call), `GEMINI.md` hierárquico, modo `/vim`, `@` (arquivos) e `!` (shell). Nota: CLI substituído pelo Antigravity CLI em 18/06/2026 para tiers gratuitos ([explainx](https://explainx.ai/blog/gemini-cli-slash-commands-complete-reference-guide-2026)). Fonte: [commands](https://geminicli.com/docs/reference/commands/).

---

## 5. Lacunas desta pesquisa (não verificado)

- **Hermes**: os **comandos de barra dentro da sessão** (slash commands) não foram abertos; só verifiquei os comandos de terminal (`hermes <comando>`). A doc aponta para uma "Slash Commands Reference" separada que não consultei. **Não verificado.**
- **PI**: não verifiquei se há mais comandos de barra além dos listados em `slash-commands.md` (o doc diz que extensões/templates/skills adicionam comandos, então a lista é o built-in, não o total).
- **Codex**: não verifiquei a lista completa de comandos de barra (só `/permissions`, `/status`, `/model`, `/approvals` citados nas páginas abertas).
- **Continue**: a lista de slash commands pode variar entre a doc e o binário shipped (a cheat sheet aponta divergências).
- **Aider**: a lista vem da doc oficial `commands.html`; não testei cada comando em execução.

---

## 6. Fontes

**PI Coding Agent (docs locais, primeira mão):**
- `C:\Users\Kelvin\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\docs\slash-commands.md`
- `C:\Users\Kelvin\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\docs\keybindings.md`

**Hermes Agent CLI:**
- https://hermes-agent.nousresearch.com/docs/user-guide/cli
- https://hermes-agent.nousresearch.com/docs/reference/cli-commands

**Aider:**
- https://aider.chat/docs/usage/commands.html
- https://aider.chat/docs/usage/modes.html

**Cline CLI:**
- https://docs.cline.bot/core-workflows/using-commands
- https://github.com/cline/cline/blob/main/apps/cli/README.md
- https://github.com/cline/cline/blob/main/docs/cli/cli-reference.mdx

**Continue CLI:**
- https://docs.continue.dev/cli/tui-mode
- https://docs.continue.dev/cli/tool-permissions
- https://github.com/continuedev/continue/blob/main/extensions/cli/spec/modes.md

**Codex CLI (OpenAI):**
- https://learn.chatgpt.com/docs/codex/cli
- https://learn.chatgpt.com/docs/sandboxing
- https://github.com/openai/codex/blob/main/docs/sandbox.md

**Gemini CLI:**
- https://geminicli.com/docs/reference/commands/
- https://geminicli.com/docs/reference/tools/
- https://geminicli.com/docs/cli/cli-reference/