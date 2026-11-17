# Rodada 2 — O que ainda falta em relação ao Claude Code, OpenCode e Hermes

> **Data da consulta:** 2026-11-17
> **Escopo:** o que ficou de fora da rodada 1 (`matriz.md`). Sem repetir gap analysis já levantado.
> **Fontes:** `claude-code.md` (A3), `opencode.md` (A4), `mercado.md` (A9), `modos.md` (A6), `ux-tui.md` (A7), mais fontes primárias abertas nesta data.
> **Regra:** cada afirmação com fonte. "Não verificado" quando não achou.

---

## 1. Tabela de lacunas

| # | Feature | Quem tem | O que é | Fonte | Custo (linhas) | Prioridade |
|:--|:--|:--|:--|:--|:--|:--|
| 1 | **Thinking/reasoning toggle** | Claude Code (`Alt+T`), OpenCode (`session.toggle.thinking`, `/variants`), Hermes (status line) | Toggle para mostrar/ocultar blocos de raciocínio do modelo. Claude Code: `Alt+T` alterna, `Ctrl+O` abre transcript com detalhes. OpenCode: keybind dedicado, 3 modos (hide/show/expand). | Claude Code: `interactive-mode` docs, `keybindings` docs. OpenCode: `opencode.md` §5.1, source `session/index.tsx`. | ~30 | P0 |
| 2 | **Thinking indicator inline** | OpenCode | Quando thinking está oculto, mostra "Thinking: [summary]" com duração. Expande ao clicar. | OpenCode source: `ReasoningPart` em `session/index.tsx` (linhas ~1180–1220). | ~40 | P0 |
| 3 | **Spinner com verb + timer + tokens** | Claude Code, Hermes | Animação que mostra "thinking" vs "running" vs "idle". Claude Code: `✻ Cooking… (6s · ↓ 174 tokens · thinking)`. Hermes: braille spinner `⠋⠙⠹` com `⏱ 12s/3m 45s`. | Claude Code: `editz.pro/blog/claude-code-stuck`, `aiparabellum.com`. Hermes: `cli-symbols` docs. | ~60 | P0 |
| 4 | **Status bar / footer com modo + modelo + effort** | Claude Code (`/statusline`), OpenCode (footer nativo), Hermes (status line) | Barra fixa que mostra: modo/permissão, modelo, effort, tokens, contexto, branch. Claude Code: customizável via script. OpenCode: nativo (agent + model + tokens + context% + cost). Hermes: status line com braille spinner + timer + badges. | Claude Code: `statusline` docs. OpenCode: `footer.view.tsx` source. Hermes: `cli-symbols` docs. | ~80 | P0 |
| 5 | **Tool call com formato `⏺` + resultado indentado** | Claude Code, OpenCode | Mostra ferramenta sendo executada com marcador `⏺`, nome + alvo, e resumo indentado. Falhas mostram erro em vermelho. | Claude Code: `interactive-mode` docs, changelog v2.1.326 ("failures are now red instead of grey"). OpenCode: `ux-tui.md` §4. | ~50 | P1 |
| 6 | **Tool failure visível** | Claude Code | Tool que falha mostra `· 1 failed` ou `did not run` na linha colapsada. Antes mostrava "Ran" como se tivesse passado. Corrigido em v2.1.326. | Claude Code: changelog v2.1.326 ("Fixed failed, blocked or refused commands looking like passing ones"). | ~20 | P1 |
| 7 | **MCP server status no boot** | Hermes (banner), Claude Code (`/mcp` panel) | Lista servidores MCP com status (connected/failed/connecting) no banner de startup. Hermes: 4 seções colapsáveis (Tools, Skills, System Prompt, MCP Servers). Claude Code: `/mcp` com subcomandos. | Hermes: `tui` docs, PR #39920, issue #39901. Claude Code: `interactive-mode` docs. | ~40 | P1 |
| 8 | **Skills panel / browser** | Claude Code (`/skills`), OpenCode (`/skills`), Hermes (`/skills browse`) | Lista skills disponíveis, permite instalar/inspecionar. Claude Code: `/skills` lista. OpenCode: `/skills` seletor. Hermes: `/skills browse` (curses). | Claude Code: `claude-code.md` §1. OpenCode: `opencode.md` §1.3. Hermes: `tui` docs. | ~40 | P1 |
| 9 | **Session picker com preview** | Claude Code, OpenCode | Lista sessões com preview do conteúdo, busca, filtro por branch/projeto. Claude Code: `/resume` com preview (`Space`), busca (`/`), filtro por branch (`Ctrl+B`). OpenCode: `/sessions` com lista. | Claude Code: `sessions` docs. OpenCode: `opencode.md` §1.1. | ~80 | P1 |
| 10 | **Session fork / branch** | Claude Code (`/branch`), OpenCode (`/fork`), Hermes (`/branch`) | Bifurca sessão em nova, preservando original. Claude Code: `/branch [nome]`, `--fork-session`. OpenCode: `/fork`. Hermes: `/branch [--here] [nome]`. | Claude Code: `sessions` docs. OpenCode: `opencode.md` §1.2. Hermes: `slash-commands` docs. | ~30 | P1 |
| 11 | **Undo / redo de mensagens** | OpenCode (`/undo`, `/redo`), Claude Code (`Esc Esc`) | Remove última troca e volta o texto ao prompt. OpenCode: `/undo` reverte mensagem + trabalho posterior. Claude Code: `Esc Esc` cancela pergunta. | OpenCode: `opencode.md` §1.2. Claude Code: `interactive-mode` docs. | ~30 | P1 |
| 12 | **`/export` de sessão** | Claude Code (`/export`), OpenCode (`/export`), Hermes (`/save`) | Exporta transcript como markdown, JSON ou HTML. OpenCode: `/export` com opção de sanitizar. Hermes: `/save <json\|md\|html> [redact]`. | Claude Code: `claude-code.md` §1. OpenCode: `opencode.md` §1.2. Hermes: `slash-commands` docs. | ~40 | P2 |
| 13 | **`/btw` — pergunta lateral sem interromper** | Claude Code (`/btw`), OpenCode (`/btw`), Hermes (`/btw`) | Pergunta sobre a conversa atual sem entrar no histórico. Usa modelo auxiliar. Claude Code e OpenCode têm. Hermes tem. | Claude Code: `claude-code.md` §1. OpenCode: `opencode.md` §1.4. Hermes: `slash-commands` docs. | ~30 | P2 |
| 14 | **`/context` — visualização da janela** | Claude Code (`/context`), OpenCode (footer), Hermes (`/context`) | Mostra uso da janela de contexto como grade colorida (Claude Code) ou tabela por categoria (Hermes). OpenCode: footer com context%. | Claude Code: `claude-code.md` §1. Hermes: `slash-commands` docs. OpenCode: `footer.view.tsx` source. | ~40 | P2 |
| 15 | **Task list / checklist** | Claude Code (`Ctrl+T`) | Lista de tarefas que o agente criou para trabalho multi-etapa. Mostra até 5 por vez. Persiste entre compactions. | Claude Code: `interactive-mode` docs, changelog. | ~50 | P2 |
| 16 | **Background tasks (`Ctrl+B`)** | Claude Code (`Ctrl+B`), OpenCode (`Ctrl+B`) | Move comando bash para background, retorna task ID imediatamente. Claude Code: auto-move em timeout. OpenCode: `session.background`. | Claude Code: `interactive-mode` docs. OpenCode: `opencode.md` §3.3. | ~40 | P2 |
| 17 | **Queued messages** | Claude Code, OpenCode, Hermes | Mensagens enfileiradas enquanto o agente trabalha. Claude Code: `Enter` fila, `Ctrl+Enter` envia imediato. OpenCode: `Ctrl+X` depois `Enter`. Hermes: `/queue`. | Claude Code: `interactive-mode` docs. OpenCode: `opencode.md` §3.1. Hermes: `slash-commands` docs. | ~30 | P2 |
| 18 | **`/config` — painel de settings** | Claude Code (`/config`), OpenCode (`/settings`) | Painel interativo com abas (Status, Config, Usage), busca, toggle de opções. Claude Code: 3 abas, busca por texto. OpenCode: `/settings` abre config. | Claude Code: `config` docs, `vincentqiao.com` blog. OpenCode: `opencode.md` §1.1. | ~100 | P2 |
| 19 | **Snippet de comando no input** | Claude Code | Na primeira abertura, mostra comando exemplo em cinza baseado no git history. Sugere próximos prompts. | Claude Code: `interactive-mode` docs. | ~30 | P2 |
| 20 | **Terminal progress bar** | Claude Code | Mostra status no título da aba do terminal (ConEmu, Ghostty, iTerm2). | Claude Code: `config` docs (`terminalProgressBarEnabled`). | ~20 | P2 |

---

## 2. Foco em TUI

### 2.1 Como o Claude Code mostra reasoning/thinking

**Quando aparece:**
- Por padrão, o thinking aparece **inline** no transcript como um bloco separado, com header "Thinking" e o texto do raciocínio.
- `Alt+T` (macOS: `Option+T`) alterna **extended thinking** (ligado/desligado). Modelos Opus 5.5, Sonnet 5.5, Haiku 5.5 e Fable sempre usam extended thinking — o toggle não tem efeito neles.
- `Ctrl+O` abre o **transcript viewer**, que mostra uso detalhado de ferramentas e raciocínio, com timestamp e modelo por mensagem.
- O nível de effort (`/effort` ou `Alt+P` no picker) controla a profundidade: `low` (○), `medium` (◐), `high` (●), `xhigh` (Opus 4.7+), `max`.

**Estilo:**
- O bloco de thinking aparece como texto normal no transcript, separado da resposta final.
- Quando colapsado (Ctrl+O fecha), mostra uma linha resumo.
- O spinner durante o thinking mostra `✻ Cooking… (6s · ↓ 174 tokens · thinking)` — o token counter sobe em tempo real.

**É opcional:**
- Sim. `Alt+T` desliga. Em modelos que sempre usam extended thinking, não tem efeito.
- `MAX_THINKING_TOKENS=0` ou `--thinking disabled` desliga o thinking de modelos que思考 por padrão.

**Fonte:** Claude Code `interactive-mode` docs (seção Keyboard shortcuts), `keybindings` docs, `config` docs (`thinking` setting), changelog v2.1.166+.

### 2.2 Como mostra atividade de ferramenta

**Formato:**
- Cada tool call aparece no transcript com marcador `⏺` e o nome da ferramenta + alvo: `⏺ read src/index.ts`.
- O resultado vem indentado abaixo, em dim/cor apagada: `  ⎿ 120 linhas (2.1 KB)`.
- Só ferramentas bem-sucedidas mostram resumo. Falhas mostram o erro.

**Quando a ferramenta falha:**
- A linha do tool call mostra `· 1 failed` ou `did not run` em vermelho (corrigido em v2.1.326; antes mostrava "Ran" como se tivesse passado).
- O erro aparece no transcript como mensagem de erro.
- Hooks que falham: `PreToolUse` hook exit 127 mostra "its check may not have run" (v2.1.326).
- MCP tool errors em cloud sessions: quando uma chamada é cortada após envio, Claude é informado de que o resultado é desconhecido.

**Fonte:** Claude Code `interactive-mode` docs, changelog v2.1.326 (November 16, 2026), `claude-code.md` §5.

### 2.3 Animações de andamento

**Spinner:**
- Glyph cicla entre `· ✢ * ✶ ✻ ✽` (aproximadamente 1 em 6 frames mostra `*` — ASCII asterisk).
- Texto rotativo: "Cooking…", "Baking…", "Grooving…", "Architecting…" (decorativo; `spinnerVerbs` permite customizar).
- Timer: segundos decorridos.
- Token counter: sobe em tempo real (ex.: `↓ 174 tokens`).
- Estado: `thinking` quando está raciocinando; some quando está executando ferramenta.

**Estados:**
| Estado | O que mostra | Fonte |
|:--|:--|:--|
| **Thinking** | `✻ Cooking… (6s · ↓ 174 tokens · thinking)` | `aiparabellum.com`, `editz.pro` |
| **Running tool** | `⏺ read src/index.ts` + `  ⎿ 120 linhas` | `claude-code.md` §5 |
| **Waiting for API** | `Waiting for API response · will retry in … · check your network` (após 20s sem dados) | `editz.pro`, `interactive-mode` docs |
| **Retrying** | `Retrying in Ns · attempt x/y` (até 10 tentativas com backoff exponencial) | `editz.pro`, `interactive-mode` docs |
| **Idle** | `✻ Crafted for 6s` (milissegundos após completar) | `usenotra.com` (rebuild da UI) |
| **Interrupted** | `Interrupted` + `What should Claude do instead?` | `aiparabellum.com` |

**Fonte:** Claude Code `interactive-mode` docs, changelog, `editz.pro/blog/claude-code-stuck`, `aiparabellum.com`.

### 2.4 Painel de estado

**Onde fica:**
- **Status bar** (linha inferior): mostra modo de permissão ativo como `⏸ manual mode on`, `⏵⏵ accept edits on`, `⏸ plan mode on`, `⏵⏵ auto mode on`, etc.
- **Footer badges**: mostram `? for shortcuts`, dicas de voz, PR status.
- **Status line customizável** (`/statusline`): roda um script shell que recebe JSON no stdin e imprime o que quiser. Pode mostrar model, context%, tokens, git branch, custo, etc.

**O que aparece:**
- Modo de permissão (sempre visível na status bar).
- Modelo (quando configurado no statusline).
- Effort level (quando configurado).
- Context window usage ( quando configurado).
- Git branch e status (quando configurado).
- Vim mode indicator (`-- INSERT --` ou `[N]`/`[I]`).

**Fonte:** Claude Code `permission-modes` docs, `statusline` docs, `config` docs.

### 2.5 `/settings` (ou `/config`)

**O que tem:**
- **3 abas:** Status (diagnóstico), Config (settings ajustáveis), Usage (cota).
- **Busca:** começa em modo de busca; digite para filtrar.
- **Navegação:** Tab ou setas para trocar abas, Enter para toggle, Esc para fechar.

**Config tab — categorias:**
- Model & Reasoning: model, thinking, fast mode, effort
- Context Management: auto-compact, rewind checkpoints
- Permissions & Security: default permission mode
- Editor & Interaction: editor mode (normal/vim), language
- Output & Display: theme, output style, verbose, show turn duration, show tips, reduce motion, terminal progress bar, PR status footer
- Files & Version Control: respect .gitignore
- Copy & Share: always copy full response
- Notifications: auto, iterm2, terminal_bell, kitty, ghostty, disabled
- Auto-update: latest, beta
- IDE Integration: external includes

**Fonte:** Claude Code `config` docs, `vincentqiao.com` blog (April 2026), `claude-code.md` §1.

---

## 3. Ecossistema — como Hermes mostra MCP servers e skills

### 3.1 MCP servers

**No boot (banner de startup):**
- 4 seções colapsáveis com chevron `▸`/`▾`:
  - **Tools** (aberta por padrão)
  - **Skills** (colapsada)
  - **System Prompt** (colapsada)
  - **MCP Servers** (colapsada)
- Cada servidor MCP mostra: nome, transport (stdio/http), status (connected/failed/connecting), e número de tools.
- Estado inicial: `connecting` (não `failed` — corrigido em PR #39920; antes mostrava `failed` prematuramente para servidores HTTP que levavam 3–5s para conectar).
- Quando um servidor falha de verdade: mostra `failed` em vermelho.

**Durante a sessão:**
- `/mcp` lista servidores, status, e permite login/logout/reconnect.
- Status bar mostra badge quando MCP server falha (PR #96903, ainda aberto).

**Quando um MCP falha:**
- No banner: `failed` em vermelho.
- Durante a sessão: erro inline no transcript; tool call mostra `· 1 failed`.
- `activity` panel (se habilitado): mostra erros de MCP.
- Se `activity` está oculto: floating alert backstop.

**Fonte:** Hermes `tui` docs, `cli-symbols` docs, PR #39920 (fix: show startup servers as connecting), issue #39901 (bug: banner shows failed while async init in progress), PR #96903 (status-bar badge on MCP failure).

### 3.2 Skills

**No boot:**
- Seção "Skills" no banner (colapsada por padrão).
- Skills pré-carregadas via `-s name1,name2` aparecem como linha "activated skills" no startup.

**Durante a sessão:**
- `/skills` lista skills disponíveis.
- `/skills browse` abre browser curses (v1) ou overlay Ink (v2, em implementação).
- Skills podem ser disparadas como `/skill:<nome>` ou `/<nome>` (se não conflitar com built-in).

**Quando uma skill falha:**
- Erro inline no transcript.
- Se a skill tem `SKILL.md` malformado: erro de parse no boot.
- Status bar não mostra skill failure especificamente (apenas MCP failure tem badge dedicado).

**Fonte:** Hermes `tui` docs, `slash-commands` docs, issue #12130 (TUI v2 parity audit — "Skills hub ❌" em v2).

---

## 4. Sessions — fork, referência cruzada, o que cada um faz

### 4.1 Claude Code

**Fork / branch:**
- `/branch [nome]` (alias `/fork`) — cria cópia da conversa até o ponto atual, preserva original.
- `--fork-session` na CLI — mesma coisa via flag.
- O branch herda: histórico da conversa, permissões "allow for this session", subagentes em background continuam rodando.
- O branch **não** herda: permissões de processo separado (se `--fork-session` em processo novo, re-aprova).
- Forks aparecem como linhas separadas no `/resume` picker.

**Session picker (`/resume`):**
- Lista sessões do diretório atual + worktrees.
- Cada linha: nome (se setado) ou título gerado, tempo desde última atividade, git branch, tamanho.
- Atalhos: `↑↓` navega, `→←` expande/colapsa grupos, `Enter` retoma, `Space` preview, `Ctrl+R` renomeia, `/` busca, `Ctrl+A` all projects, `Ctrl+W` all worktrees, `Ctrl+B` filter by branch.
- Sessões de `/branch` e `--fork-session` aparecem como linhas separadas.
- Sessões de `/loop`, `-p`, Agent SDK não aparecem no picker (mas podem ser retomadas por ID).

**Referência cruzada:**
- Cada sessão tem ID único.
- `/branch` imprime dois IDs: o novo e o original.
- Não há link pai-filho persistente (fork é uma cópia, não uma referência).

**Fonte:** Claude Code `sessions` docs, `interactive-mode` docs.

### 4.2 OpenCode

**Fork:**
- `/fork` — bifurca sessão.
- `/sessions` — lista sessões (alias: `resume`, `continue`).

**Session picker:**
- `/sessions` abre lista de sessões.
- `/new` cria nova sessão.
- `/clear` limpa sessão atual.

**Referência cruzada:**
- Não verificado em detalhe. O `opencode.md` não descreve session tree ou referência cruzada.

**Fonte:** `opencode.md` §1.1–1.2.

### 4.3 Hermes Agent

**Fork / branch:**
- `/branch [--here] [nome]` (alias `/fork`) — ramifica sessão.
- `--here` troca o chat atual para o branch (sem `--here`, abre novo thread em plataformas que suportam).
- `/resume [nome]` — retoma sessão nomeada.
- `/sessions` — browse sessões (picker interativo no CLI, switcher no TUI).

**Session picker:**
- `/resume` (bare) lista sessões nomeadas ranqueadas por atividade recente.
- `/sessions` abre picker interativo.

**Referência cruzada:**
- `/journey` (alias `/learning`, `/memory-graph`) — timeline de skills + memórias aprendidas.
- Não há session tree nativo como Claude Code.

**Fonte:** Hermes `slash-commands` docs, `cli` docs.

---

## 5. Top 10 — o que mais eleva o padrão agora

| # | Item | Custo | Complexidade | Prioridade | Por quê |
|:--|:--|:--|:--|:--|:--|
| 1 | **Spinner com verb + timer + tokens** | ~60 | Média | P0 | Dá feedback de "está trabalhando" vs "está travado". Claude Code e Hermes têm. Sem isso, o usuário não sabe se o agente está vivo. |
| 2 | **Thinking toggle + indicator inline** | ~70 (toggle + indicator) | Média | P0 | `Alt+T` liga/desliga. Quando oculto, mostra "Thinking: [summary]" com duração. OpenCode tem exatamente isso. |
| 3 | **Status bar com modo + modelo + tokens** | ~80 | Média | P0 | O usuário sempre sabe em que modo está, qual modelo, quantos tokens. Claude Code tem statusline customizável; OpenCode tem footer nativo. |
| 4 | **Tool call com formato `⏺` + failure visível** | ~70 | Média | P0 | `⏺ read arquivo` + `  ⎿ 120 linhas`. Falha mostra `· 1 failed` em vermelho. Claude Code v2.1.326 corrigiu isso. |
| 5 | **Session picker com preview + busca** | ~80 | Média | P1 | `/resume` com preview (`Space`), busca (`/`), filtro por branch (`Ctrl+B`). Claude Code tem o mais completo. |
| 6 | **Session fork / branch** | ~30 | Baixa | P1 | `/branch [nome]` preserva original. 3 ferramentas têm. |
| 7 | **MCP server status no boot** | ~40 | Baixa | P1 | Banner com seções colapsáveis. Hermes mostra "connecting" antes de "failed" (correto). |
| 8 | **Queued messages** | ~30 | Baixa | P1 | `Enter` fila enquanto trabalha; `Ctrl+Enter` envia imediato. Claude Code, OpenCode, Hermes têm. |
| 9 | **Undo / redo de mensagens** | ~30 | Baixa | P1 | `/undo` reverte última troca. OpenCode tem `/undo` e `/redo`. |
| 10 | **`/config` — painel de settings** | ~100 | Alta | P2 | 3 abas, busca, toggle. Claude Code tem o mais completo. OpenCode tem `/settings`. |

---

## 6. Fontes

| Fonte | URL / Caminho | Tipo |
|:--|:--|:--|
| Claude Code interactive mode | `https://code.claude.com/docs/en/interactive-mode` | Primária (web) |
| Claude Code sessions | `https://code.claude.com/docs/en/sessions` | Primária (web) |
| Claude Code permission modes | `https://code.claude.com/docs/en/permission-modes` | Primária (web) |
| Claude Code statusline | `https://code.claude.com/docs/en/statusline` | Primária (web) |
| Claude Code config | `https://code.claude.com/docs/en/config` | Primária (web) |
| Claude Code keybindings | `https://code.claude.com/docs/en/keybindings` | Primária (web) |
| Claude Code changelog | `https://code.claude.com/docs/en/changelog` | Primária (web) |
| Claude Code stuck states | `https://editz.pro/blog/claude-code-stuck` | Secundária |
| Claude Code thinking fix | `https://aiparabellum.com/claude-code-stuck-on-thinking-how-to-get-it-moving-again/` | Secundária |
| Hermes TUI | `https://hermes-agent.nousresearch.com/docs/user-guide/tui` | Primária (web) |
| Hermes CLI symbols | `https://hermes-agent.nousresearch.com/docs/reference/cli-symbols` | Primária (web) |
| Hermes slash commands | `https://hermes-agent.nousresearch.com/docs/reference/slash-commands` | Primária (web) |
| Hermes MCP fix PR | `https://github.com/NousResearch/hermes-agent/pull/39920` | Primária (código) |
| Hermes MCP bug issue | `https://github.com/NousResearch/hermes-agent/issues/39901` | Primária (issue) |
| OpenCode TUI | `https://opencode.ai/docs/cli/tui/` | Primária (web) |
| OpenCode keybinds | `https://opencode.ai/docs/cli/keybinds/` | Primária (web) |
| OpenCode footer source | `https://github.com/anomalyco/opencode/blob/b6478dce/packages/opencode/src/cli/cmd/run/footer.view.tsx` | Primária (código) |
| OpenCode reasoning source | `https://github.com/anomalyco/opencode/blob/e23586af/packages/tui/src/routes/session/index.tsx` | Primária (código) |
| OpenCode statusline blog | `https://getagenttools.com/blog/opencode-statusline/` | Secundária |
| OpenCode agents | `https://opencode.ai/docs/agents/` | Primária (web) |