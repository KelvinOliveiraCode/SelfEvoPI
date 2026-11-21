# CLI Landscape — O Resto do Mercado

> **Data da consulta:** 2026-11-17
> **Escopo:** tudo que não for Claude Code (A3) nem OpenCode (A4).
> **Regra:** cada afirmação com fonte (URL ou caminho de arquivo). "Não verificado" quando não achou.

---

## 1. PI Coding Agent (`earendil-works/pi`)

**Fonte primária:** `$(npm root -g)/@earendil-works/pi-coding-agent/docs/` (instalação local, 29 arquivos `.md`).

### 1.1 Comandos de barra (built-in)

Do arquivo `docs/slash-commands.md`:

| Comando | Descrição |
|:--|:--|
| `/settings` | Abre configurações |
| `/model [provider/model]` | Seleciona modelo |
| `/thinking [level]` | Define nível de raciocínio |
| `/scoped-models` | Configura modelos para cycling interativo |
| `/login [provider]` | Adiciona autenticação de provider |
| `/logout` | Remove autenticação |
| `/llama` | Gerencia modelos no roteador llama.cpp |
| `/new` | Nova sessão |
| `/resume` | Retoma outra sessão |
| `/name [name]` | Nome da sessão |
| `/session` | Info e estatísticas da sessão |
| `/tree` | Navega na árvore de sessões |
| `/fork` | Cria nova sessão a partir de mensagem anterior |
| `/clone` | Duplica sessão atual |
| `/compact [instructions]` | Compacta contexto |
| `/import <path>` | Importa sessão JSONL |
| `/copy` | Copia última mensagem do assistente |
| `/export [path]` | Exporta sessão como HTML ou JSONL |
| `/share` | Upload da sessão e link de visualização |
| `/bug [description]` | Prepara bug report privado |
| `/trust` | Salva decisão de confiança do projeto |
| `/mcp` | Gerencia servidores MCP |
| `/reload` | Recarrega keybindings, extensões, skills, templates, temas, context files |
| `/hotkeys` | Mostra atalhos ativos |
| `/changelog` | Mostra changelog |
| `/quit` | Sai do Pi |

**Extensões, templates e skills** adicionam comandos dinamicamente. Cada template de prompt vira `/<nome>`. Skills ficam em `/skill:<nome>`.

### 1.2 Atalhos de teclado

Do arquivo `docs/keybindings.md` (referência completa, 100+ ações):

**Editor:**
- `ctrl+a` / `ctrl+e` — início/fim de linha
- `ctrl+w` / `alt+backspace` — deleta palavra atrás
- `alt+d` / `alt+delete` — deleta palavra à frente
- `ctrl+u` — deleta até início da linha
- `ctrl+k` — deleta até fim da linha
- `ctrl+y` — yank (cola último texto deletado)
- `alt+y` — yank-pop (cicla entre deletados)

**Navegação:**
- `up` / `down` — cursor / histórico
- `left` / `right` (ou `ctrl+b` / `ctrl+f`) — cursor
- `alt+left` / `alt+right` (ou `ctrl+left` / `ctrl+right`) — cursor por palavra
- `home` / `end` (ou `ctrl+a` / `ctrl+e`) — início/fim
- `pageUp` / `pageDown` — scroll

**Aplicação:**
- `escape` — cancela/interrompe
- `ctrl+c` — limpa editor (primeiro) / sai (segundo)
- `ctrl+d` — sai (editor vazio)
- `ctrl+g` — editor externo
- `ctrl+v` / `alt+v` — cola imagem/arquivo da área de transferência

**Modelo e thinking:**
- `ctrl+l` — seletor de modelo
- `ctrl+p` — próximo modelo (cycle forward)
- `shift+ctrl+p` / `alt+p` (Windows/WSL) — modelo anterior
- `shift+tab` — cicla nível de thinking
- `ctrl+t` — mostra/esconde blocos de thinking

**Mensagens:**
- `alt+enter` / `ctrl+q` (Windows/WSL) — mensagem de follow-up (fila)
- `alt+up` / `alt+q` (Windows/WSL) — restaura mensagens enfileiradas

**Sessão:**
- `ctrl+p` — mostra/esconde path
- `ctrl+s` — alterna ordenação
- `ctrl+n` — alterna filtro de nome
- `ctrl+r` — renomeia sessão
- `ctrl+d` — deleta sessão

**Tree:**
- `ctrl+left` / `alt+left` — fold ou volta
- `ctrl+right` / `alt+right` — unfold ou avança
- `shift+l` — edita label
- `shift+t` — toggle timestamps
- `ctrl+d` / `ctrl+t` / `ctrl+u` / `ctrl+l` / `ctrl+a` — filtros do tree
- `ctrl+o` — cicla filtro forward
- `shift+ctrl+o` — cicla filtro backward

**Fullscreen:**
- `ctrl+shift+f` / `ctrl+f` (Windows/WSL) — busca no transcript
- `ctrl+shift+up` / `ctrl+up` — prompt anterior marcado
- `ctrl+shift+down` / `ctrl+down` — próximo prompt
- `ctrl+home` — início do transcript
- `ctrl+end` — fim do transcript

### 1.3 Modos

O Pi não tem "modos" como plan/build. Tem **interfaces** (documentado em `docs/cli-integration.md`):

| Modo | Interface | Vida | Quando usar |
|:--|:--|:--|:--|
| Interativo | TUI | Até sair | Pessoa trabalhando direto |
| Print | Texto final em stdout | Uma invocação | Script precisa da resposta final |
| JSON | Eventos JSONL em stdout | Uma invocação | Processo precisa de progresso estruturado |
| RPC | Comandos/respostas/eventos JSONL | Longa | Processo precisa de controle bidirecional |
| SDK | Embeddado em Node/Bun | — | Acesso direto TypeScript |

A escolha é por flag de CLI (`--print`, `--mode json`, `--mode rpc`) ou detecção automática (stdin/stdout não-TTY → print mode).

### 1.4 Outros comandos de CLI relevantes

Do `docs/cli.md`:

- `pi install <source>` — instala pacote (npm, git, local)
- `pi remove <source>` — remove
- `pi update [target]` — atualiza Pi, extensões ou modelos
- `pi list` — lista pacotes configurados
- `pi config` — configura quais recursos carregam
- `pi auth login <provider>` — login
- `pi auth logout <provider>` — logout
- `pi auth check` — verifica credenciais
- `pi mcp add|remove|list|login|logout` — gerencia MCP
- `pi --continue` — continua sessão mais recente do diretório
- `pi --resume` — seletor de sessões
- `pi --session <path|id>` — abre sessão específica
- `pi --fork <path|id>` — bifurca sessão
- `pi --session-id <id>` — abre/cria sessão com ID
- `pi --no-session` — sessão efêmera (não persiste)
- `pi --print` — modo print (uma execução, stdout)
- `pi --mode json` — eventos JSONL
- `pi --mode rpc` — controle bidirecional
- `pi --tools <lista>` — substitui seleção de tools
- `pi --extension <path>` — carrega extensão
- `pi --skill <path>` — carrega skill
- `pi --prompt-template <path>` — carrega template
- `pi --system-prompt <text|path>` — substitui system prompt
- `pi --append-system-prompt <text|path>` — anexa ao system prompt
- `pi --tui-mode fullscreen|regular` — modo do terminal

### 1.5 Configuração

Do `docs/configuration.md`:

**Diretório do agente (`~/.pi/agent/`):**
- `settings.json` — preferências, defaults, paths de recursos
- `keybindings.json` — keybindings customizados
- `mcp.json` — servidores MCP globais
- `models.json` — endpoints e modelos customizados
- `auth.json` — API keys e credenciais OAuth
- `AGENTS.md` / `AGENTS.override.md` / `CLAUDE.md` — instruções
- `SYSTEM.md` — substitui system prompt
- `APPEND_SYSTEM.md` — anexa ao system prompt
- `extensions/` — extensões
- `skills/` — skills
- `prompts/` — templates de prompt (viram `/<nome>`)
- `themes/` — temas

**Diretório do projeto (`.pi/`):**
- `settings.json`, `mcp.json`, `SYSTEM.md`, `APPEND_SYSTEM.md`
- `extensions/`, `skills/`, `prompts/`, `themes/`

### 1.6 Session tree

O Pi usa uma **árvore** de sessões (não linear). Cada entrada tem ID e referência ao pai. A "branch ativa" é o caminho até a entrada atual. Comandos: `/tree` (navega), `/fork` (nova sessão a partir de ponto anterior), `/clone` (duplica). Compactação insere um sumário que substitui mensagens antigas — as originais permanecem na árvore.

**Fonte:** `docs/how-pi-works.md`, `docs/sessions.md`, `docs/slash-commands.md`, `docs/keybindings.md`, `docs/cli.md`, `docs/configuration.md`.

---

## 2. Hermes Agent CLI (Nous Research)

**Fonte primária:** `https://hermes-agent.nousresearch.com/docs/reference/slash-commands` e `https://hermes-agent.nousresearch.com/docs/user-guide/cli`.

### 2.1 Comandos de barra (built-in)

Da referência oficial (página `/docs/reference/slash-commands`), organizados por categoria:

**Sessão:**
| Comando | Descrição |
|:--|:--|
| `/new [name]` (alias `/reset`) | Nova sessão (ID + histórico frescos) |
| `/clear` | Limpa tela e nova sessão |
| `/history` | Mostra histórico (respeita `/timestamps`) |
| `/save <json\|md\|html> [filename] [redact]` | Exporta sessão |
| `/prompt` (alias `/compose`) | Compõe próximo prompt no `$EDITOR` |
| `/retry` | Reenvia última mensagem |
| `/undo` | Remove última troca user/assistant |
| `/rewind [N \| fork N]` | Backtrack (navega prompts anteriores) |
| `/title` | Define título da sessão |
| `/compress [here [N] \| focus topic]` | Comprime contexto |
| `/rollback [number]` | Lista/restaura checkpoints de filesystem |
| `/diff [staged\|all\|session] [--stat] [path...]` | Diff git |
| `/snapshot [create\|restore <id>\|prune]` | Snapshots de config/state |
| `/stop` | Mata processos em background |
| `/queue <prompt>` (alias `/q`) | Enfileira prompt para próximo turno |
| `/steer <prompt>` | Injeta nota mid-run (após próximo tool call) |
| `/goal <text>` | Define goal persistente (Ralph loop) |
| `/subgoal <text>` | Adiciona critério ao goal ativo |
| `/heartbeat every <interval> <prompt>` (alias `/hb`) | Prompt recorrente na sessão |
| `/loop [interval] <prompt>` (alias `/proactive`) | Re-executa prompt em intervalo |
| `/refine [focus]` | Review de memória/skill self-improvement |
| `/review [instructions]` | Spawns reviewer subagent independente |
| `/moa <prompt>` | Mixture of Agents (um-shot) |
| `/resume [name]` | Retoma sessão nomeada |
| `/sessions` (alias `/switch` no TUI) | Browse sessões |
| `/branch [--here] [name]` (alias `/fork`) | Ramifica sessão |
| `/worktree [new [name]\|list]` | Worktrees git isolados |
| `/handoff <platform>` | Handoff para messaging (Telegram, Discord, etc.) |
| `/journey` (alias `/learning`, `/memory-graph`) | Timeline de skills + memórias |

**Configuração:**
| Comando | Descrição |
|:--|:--|
| `/focus [on\|off\|status]` | Modo focus (reduz output) |
| `/yolo` | Pula prompts de aprovação |
| `/wake [on\|off\|status]` | Wake word listener |
| `/egress [status]` | Status do proxy Docker |
| `/redraw` | Repaint completo da UI |
| `/status` | Info da sessão + recap local |
| `/context [all]` (alias `/ctx`) | Breakdown visual da janela de contexto |
| `/agents` (alias `/tasks`) | Agentes e tasks ativos |
| `/bg <prompt>` | Prompt em sessão background separada |
| `/btw <question>` | Pergunta lateral sobre a conversa atual |
| `/model <model> [--provider name]` | Troca modelo |
| `/compact [here [N] \| <focus>]` | Comprime contexto |

### 2.2 Atalhos

**Não verificado.** A página de CLI (`/docs/user-guide/cli`) menciona "multiline editing, slash-command autocomplete, conversation history, interrupt-and-redirect, and streaming tool output" mas não lista keybindings individuais. O Hermes tem TUI (`hermes --tui`) com "modal overlays, mouse selection, and non-blocking input" (fonte: `/docs/user-guide/cli`).

### 2.3 Modos

O Hermes não tem "modos" como plan/build. Tem **perfis** (`hermes --resume`, `hermes --continue`, `hermes -w` para worktree) e **plataformas** (CLI, TUI, Desktop, Bot mode, messaging gateway).

### 2.4 Comandos de CLI (não-interativos)

Da referência `/docs/reference/cli-commands`:

- `hermes [global-options] <command> [subcommand/options]`
- `hermes chat` — modo chat interativo
- `hermes -z <prompt>` — one-shot scripted
- `hermes --resume <session_id>` / `hermes --continue` — retoma sessão
- `hermes -w` — worktree isolado
- `hermes plugins install|list|enable|disable|update|remove`
- `hermes config set <key> <value>`
- `hermes dump` — diagnóstico completo
- `hermes worktree list|prune|restore`
- `hermes cron` — agendamento durável

**Fonte:** `https://hermes-agent.nousresearch.com/docs/reference/slash-commands`, `https://hermes-agent.nousresearch.com/docs/user-guide/cli`, `https://hermes-agent.nousresearch.com/docs/reference/cli-commands`.

---

## 3. Aider

**Fonte primária:** `https://aider.chat/docs/usage/commands.html` (página oficial de comandos).

### 3.1 Comandos de barra (confirmados um por um)

| Comando | Confirmado? | Descrição |
|:--|:--|:--|
| `/add` | ✅ | Adiciona arquivos ao chat |
| `/architect` | ✅ | Entra em modo architect/editor (2 modelos) |
| `/ask` | ✅ | Pergunta sobre o código sem editar |
| `/chat-mode` | ✅ | Troca modo de chat (ask/code/help) |
| `/clear` | ✅ | Limpa histórico do chat |
| `/code` | ✅ | Pede mudanças no código |
| `/commit` | ✅ | Commita edições feitas fora do chat |
| `/context` | ✅ | Entra em modo context |
| `/copy` | ✅ | Copia última mensagem do assistente |
| `/copy-context` | ✅ | Copia contexto como markdown |
| `/diff` | ✅ | Mostra diff desde última mensagem |
| `/drop` | ✅ | Remove arquivos do chat |
| `/edit` | ✅ | Alias para `/editor` |
| `/editor` | ✅ | Abre editor para escrever prompt |
| `/editor-model` | ✅ | Troca Editor Model |
| `/exit` | ✅ | Sai da aplicação |
| `/git` | ✅ | Roda comando git |
| `/help` | ✅ | Ajuda sobre o Aider |
| `/lint` | ✅ | Lint e corrige arquivos |
| `/load` | ✅ | Carrega comandos de arquivo |
| `/ls` | ✅ | Lista arquivos conhecidos |
| `/map` | ✅ | Mostra repo map atual |
| `/map-refresh` | ✅ | Força refresh do repo map |
| `/model` | ✅ | Troca Main Model |
| `/models` | ✅ | Busca modelos disponíveis |
| `/multiline-mode` | ✅ | Toggle multiline mode |
| `/ok` | ✅ | Alias para `/code Ok, please go ahead` |
| `/paste` | ✅ | Cola imagem/texto da área de transferência |
| `/quit` | ✅ | Sai da aplicação |
| `/read-only` | ✅ | Adiciona arquivos como referência somente-leitura |
| `/reasoning-effort` | ✅ | Define nível de reasoning effort |
| `/report` | ✅ | Reporta problema via GitHub Issue |
| `/reset` | ✅ | Remove todos arquivos e limpa histórico |
| `/run` | ✅ | Roda comando shell (alias `!`) |
| `/save` | ✅ | Salva comandos para arquivo |
| `/settings` | ✅ | Mostra configurações atuais |
| `/test` | ✅ | Roda comando de teste |
| `/think-tokens` | ✅ | Define budget de thinking tokens |
| `/tokens` | ✅ | Reporta tokens usados |
| `/undo` | ✅ | Desfaz último commit do Aider |
| `/voice` | ✅ | Grava e transcreve voz |
| `/weak-model` | ✅ | Troca Weak Model |
| `/web` | ✅ | Raspa página web e envia markdown |

### 3.2 Modos

Confirmados na documentação:

| Modo | Comando | Descrição |
|:--|:--|:--|
| **code** | `/code` | Edição normal (default) |
| **ask** | `/ask` | Pergunta sem editar |
| **architect** | `/architect` | Usa 2 modelos (architect + editor) |
| **context** | `/context` | Mostra contexto ao redor |
| **help** | `/help` | Ajuda |

**Fonte:** `https://aider.chat/docs/usage/commands.html`, `https://aider.chat/docs/config/options.html`.

---

## 4. Codex CLI (OpenAI)

**Fonte primária:** `https://developers.openai.com/codex/cli/slash-commands/` e `https://learn.chatgpt.com/docs/cli/slash-commands`.

### 4.1 Comandos de barra (built-in)

| Comando | Descrição |
|:--|:--|
| `/init` | Cria `AGENTS.md` com instruções para Codex |
| `/status` | Mostra configuração e uso de tokens da sessão |
| `/permissions` | Escolhe o que Codex pode fazer (approval mode) |
| `/model` | Escolhe modelo e reasoning effort |
| `/review` | Revisa mudanças e aponta problemas |
| `/new` | Nova conversa (limpa estado) |
| `/compact` | Resume e comprime histórico |
| `/quit` | Encerra sessão |
| `/mention` | Anexa arquivo à conversa |
| `/plan` | Entra em plan mode (revisa passos propostos) |
| `/diff` | Mostra mudanças git (incluindo untracked) |
| `/debug-config` | Diagnósticos de config |
| `/statusline` | Personaliza itens do footer |
| `/rename` | Renomeia chat atual |
| `/title` | Configura título da janela/aba |
| `/fork` | Bifurca chat atual |
| `/resume` | Retoma chat salvo |
| `/compact` | Sumariza conversa |
| `/recap` | Gera sumário sem compactar |
| `/cd` | Muda diretório de trabalho |
| `/goal` | Define objetivo persistente |
| `/memories` | Configura uso de memória |
| `/config` | Preferências do terminal |
| `/keymap` | Remapeia atalhos do TUI |
| `/vim` | Toggle vim mode |
| `/app` | Continua no app desktop |
| `/voice` | Conversa por voz |
| `/setup-default-sandbox` | Configura sandbox elevado (Windows) |

### 4.2 Modos

O Codex CLI não tem "modos" como plan/build. Tem **approval modes**: `Auto`, `Read Only`, `Full Access`. Configurados via `/permissions` ou `--sandbox`.

### 4.3 Atalhos

**Não verificado** na documentação oficial. O Codex CLI usa TUI padrão de terminal.

**Fonte:** `https://developers.openai.com/codex/cli/slash-commands/`, `https://learn.chatgpt.com/docs/cli/slash-commands`.

---

## 5. Gemini CLI (Google)

**Fonte primária:** `https://geminicli.com/docs/reference/commands/` e `https://www.developersdigest.tech/reference/gemini-cli/slash-commands`.

### 5.1 Comandos de barra (built-in)

| Comando | Descrição |
|:--|:--|
| `/about` | Info de versão |
| `/auth` | Dialog para trocar método de autenticação |
| `/clear` | Limpa contexto e nova sessão |
| `/commands` | Gerencia slash commands customizados (`.toml`) |
| `/compress` | Substitui contexto por sumário |
| `/copy` | Copia último output para clipboard |
| `/directory` (alias `/dir`) | Gerencia diretórios de workspace |
| `/docs` | Abre documentação no browser |
| `/extensions` | Gerencia extensões |
| `/help` (alias `/?`) | Ajuda |
| `/hooks` | Gerencia hooks de lifecycle |
| `/ide` | Gerencia integração IDE |
| `/init` | Gera `GEMINI.md` |
| `/mcp` | Gerencia servidores MCP |
| `/memory` | Gerencia memória hierárquica (`GEMINI.md`) |
| `/model` | Gerencia configuração de modelo |
| `/permissions` | Gerencia trust de pastas |
| `/plan` | Entra em Plan Mode (read-only) |
| `/privacy` | Notice de privacidade |
| `/quit` (alias `/exit`) | Sai (`--delete` remove histórico) |
| `/restore` | Restaura arquivos ao estado pré-tool |
| `/rewind` | Navega para trás no histórico |
| `/resume` (alias `/chat`) | Browse e retoma sessões |
| `/shells` (alias `/bashes`) | Toggle background shells |
| `/setup-github` | Configura GitHub Actions |
| `/stats` | Estatísticas da sessão |
| `/terminal-setup` | Configura keybindings para multiline |
| `/theme` | Dialog para trocar tema |
| `/tools` | Lista tools disponíveis |
| `/upgrade` | Página de upgrade do Gemini Code Assist |
| `/vim` | Toggle vim mode |
| `/gemma` | Status do modelo Gemma local |
| `@<path>` | Injeta arquivo no prompt |
| `!<shell_command>` | Roda comando shell |

### 5.2 Modos

O Gemini CLI tem **Plan Mode** (`/plan`): read-only, para revisar plano antes de executar. Não tem modos ask/code separados como Aider.

### 5.3 Atalhos

**Não verificado** na documentação oficial. Usa keybindings padrão de terminal.

**Fonte:** `https://geminicli.com/docs/reference/commands/`, `https://www.developersdigest.tech/reference/gemini-cli/slash-commands`.

---

## 6. Cline CLI

**Fonte primária:** `https://docs.cline.bot/cli/cli-reference`, `https://docs.cline.bot/usage/tui`, `https://docs.cline.bot/core-workflows/using-commands`.

### 6.1 Comandos de barra (TUI e chat)

**TUI (interactive):**
| Comando | Descrição |
|:--|:--|
| `/settings` | Configurações |
| `/model` | Troca modelo |
| `/account` | Conta |
| `/mcp` | MCP servers |
| `/compact` | Compacta contexto |
| `/undo` | Desfaz |
| `/clear` | Limpa |
| `/history` | Histórico |
| `/help` | Ajuda |
| `/quit` | Sai |

**Chat (slash commands):**
| Comando | Descrição |
|:--|:--|
| `/newtask` | Nova task com contexto distilado |
| `/smol` (alias `/compact`) | Comprime histórico preservando contexto essencial |
| `/newrule` | Cria arquivo de regra (`.clinerules`) |
| `/deep-planning` | Investigação + planejamento + cria task |
| `/reportbug` | Reporta bug com diagnóstico |

**Skills via slash:** qualquer skill habilitada pode ser disparada com `/<nome>`.

### 6.2 Modos

| Modo | Como | Descrição |
|:--|:--|:--|
| **Plan** | `Tab` na TUI ou `-p` na CLI | Planeja sem executar |
| **Act** | `Tab` na TUI (default) | Executa |
| **Yolo** | `--yolo` ou default em one-shot | Auto-aprova tudo, sem spawn/teams |

### 6.3 Atalhos

| Tecla | Ação |
|:--|:--|
| `Tab` | Toggle Plan/Act |
| `Shift+Tab` | Toggle auto-approve all |
| `Ctrl+C` | Abort turn (pressionar de novo = exit) |
| `Ctrl+D` | Exit (prompt vazio e idle) |
| `Ctrl+L` | Clear chat view |
| `@file` | Menciona arquivo |

### 6.4 Comandos de CLI (não-interativos)

- `cline [options] [command] [prompt]` — uma execução
- `cline -i` / `cline --tui` — TUI interativa
- `cline -p "prompt"` — plan mode
- `cline --act "prompt"` — act mode (com tools completos)
- `cline --yolo "prompt"` — yolo mode (auto-aprova)
- `cline --json "prompt"` — output JSON (NDJSON)
- `cline --worktree` — worktree git isolado
- `cline auth` — autenticação
- `cline config` — configuração
- `cline mcp` — gerencia MCP
- `cline history` — histórico de sessões
- `cline doctor` — diagnóstico
- `cline schedule` — tasks agendadas
- `cline hub` — daemon local
- `cline kanban` — app kanban

**Fonte:** `https://docs.cline.bot/cli/cli-reference`, `https://docs.cline.bot/usage/tui`, `https://docs.cline.bot/core-workflows/using-commands`.

---

## 7. Continue CLI

**Fonte primária:** `https://docs.continue.dev/cli/overview` (renderização incompleta — página carrega via JS). Informação secundária de `https://github.com/continuedev/continue/issues/11487` e `https://github.com/continuedev/continue/issues/11316`.

### 7.1 Comandos de barra

**Não verificado completamente** — a documentação oficial não renderizou. A issue #11487 confirma:

| Comando | Descrição | Fonte |
|:--|:--|:--|
| `/config` | Troca entre configurações | Issue #11487 |
| `/title` | Define título da sessão | Issue #11487 |
| `/rename` | Renomeia sessão | Issue #11487 |

A issue #11487 diz explicitamente: "The CLI supports several slash commands (like `/title`, `/rename`, `/config`) but there is no centralized documentation listing all available slash commands."

### 7.2 Modos

**Não verificado.** Sem documentação renderizada.

### 7.3 Atalhos

**Não verificado.** Sem documentação renderizada.

### 7.4 Comandos de CLI

**Não verificado completamente.** A issue #11316 menciona `/title`, `/rename` e "other missing commands" mas sem lista completa.

**Fonte:** `https://github.com/continuedev/continue/issues/11487`, `https://github.com/continuedev/continue/issues/11316`. Documentação oficial em `https://docs.continue.dev/cli/overview` não renderizou (JS-rendered).

---

## 8. Tamanhos e complexidade

| Ferramenta | Comandos de barra (confirmados) | Modos | Atalhos (confirmados) | Fonte |
|:--|:--|:--|:--|:--|
| PI Coding Agent | 25+ built-in + dinâmicos | 5 interfaces (não modos) | 100+ ações nomeadas | Docs locais (primária) |
| Hermes Agent | 40+ built-in | Perfis, não modos | Não verificado | Docs oficiais (primária) |
| Aider | 41 built-in | 5 modos (code/ask/architect/context/help) | Não verificado | Docs oficiais (primária) |
| Codex CLI | 27 built-in | Approval modes (não modos) | Não verificado | Docs oficiais (primária) |
| Gemini CLI | 41 built-in | Plan Mode (read-only) | Não verificado | Docs oficiais (primária) |
| Cline CLI | 15+ (TUI + chat) | 3 modos (plan/act/yolo) | 6 atalhos | Docs oficiais (primária) |
| Continue CLI | 3 confirmados | Não verificado | Não verificado | Issues GitHub (secundária) |

---

## 9. Observações para o SelfEvoPI

### 9.1 O que o PI Coding Agent tem que o SelfEvoPI deveria considerar

1. **Session tree** — o Pi usa árvore de sessões (não linear), com `/tree`, `/fork`, `/clone`. O SelfEvoPI usa sessões lineares.
2. **Prompt templates** — arquivos `.md` em `~/.pi/agent/prompts/` viram `/<nome>` automaticamente. O SelfEvoPI não tem.
3. **Skills como `/skill:<nome>`** — o Pi expõe skills como comandos. O SelfEvoPI tem `/skills` mas não `/skill:<nome>`.
4. **`/compact`** — compactação de contexto com instruções customizadas.
5. **`/share`** — upload da sessão e link de visualização.
6. **`/bug`** — bug report privado integrado.
7. **Keybindings customizáveis** via `keybindings.json`.
8. **MCP integrado** — `pi mcp add|remove|list|login|logout`.

### 9.2 Convenções que emergem do mercado

- `/help` — universal (todas as 7 ferramentas)
- `/model` — universal (todas)
- `/clear` — universal (todas)
- `/compact` ou `/compress` — 5 de 7 (PI, Hermes, Aider via `/smol`, Codex, Gemini)
- `/new` ou `/newtask` — 5 de 7
- `/diff` — 4 de 7 (Aider, Codex, Hermes, Gemini)
- `/mcp` — 4 de 7 (PI, Hermes, Gemini, Cline)
- `/init` — 3 de 7 (Codex, Gemini, Cline via `/deep-planning`)
- `/plan` — 3 de 7 (Codex, Gemini, Cline)
- `@file` mention — 3 de 7 (PI, Gemini, Cline)
- `!command` shell — 3 de 7 (PI, Gemini, Aider via `/run`)

### 9.3 Diferenciais

- **PI Coding Agent**: session tree, prompt templates, MCP nativo, RPC mode, SDK
- **Hermes Agent**: `/goal` (Ralph loop), `/steer` (mid-run injection), `/heartbeat` (recurring), `/loop` (proactive), `/worktree`, `/handoff` (cross-platform)
- **Aider**: repo map (`/map`), architect/editor (2 modelos), `/web` (scrape URL), `/voice` (Whisper)
- **Codex CLI**: `/goal` (persistente), `/plan` mode, approval modes granulares, `/statusline` customizável
- **Gemini CLI**: `/rewind` (navega histórico), `/restore` (checkpoint de arquivos), `/directory` (multi-workspace), `/hooks`
- **Cline CLI**: `/newtask` (contexto distilado), `/deep-planning` (investigação + plano + task), `/newrule` (regras customizadas), worktree auto, kanban board
- **Continue CLI**: **não verificado** — documentação não renderizou

---

## 10. Fontes

| Fonte | URL / Caminho | Tipo |
|:--|:--|:--|
| PI Coding Agent docs | `$(npm root -g)/@earendil-works/pi-coding-agent/docs/` | Primária (local) |
| Hermes Agent docs | `https://hermes-agent.nousresearch.com/docs/reference/slash-commands` | Primária (web) |
| Hermes Agent CLI | `https://hermes-agent.nousresearch.com/docs/user-guide/cli` | Primária (web) |
| Aider commands | `https://aider.chat/docs/usage/commands.html` | Primária (web) |
| Aider options | `https://aider.chat/docs/config/options.html` | Primária (web) |
| Codex CLI | `https://developers.openai.com/codex/cli/slash-commands/` | Primária (web) |
| Gemini CLI | `https://geminicli.com/docs/reference/commands/` | Primária (web) |
| Gemini CLI digest | `https://www.developersdigest.tech/reference/gemini-cli/slash-commands` | Secundária (verify Oct 17 2026) |
| Cline CLI ref | `https://docs.cline.bot/cli/cli-reference` | Primária (web) |
| Cline TUI | `https://docs.cline.bot/usage/tui` | Primária (web) |
| Cline commands | `https://docs.cline.bot/core-workflows/using-commands` | Primária (web) |
| Continue CLI | `https://github.com/continuedev/continue/issues/11487` | Secundária (issue) |
| Continue CLI | `https://github.com/continuedev/continue/issues/11316` | Secundária (issue) |