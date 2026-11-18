# Matriz Comparativa — CLI Landscape

> **Data da consulta:** 2026-11-17
> **Escopo:** Claude Code, PI Coding Agent, Hermes, Aider, Codex CLI, Gemini CLI, Cline CLI. OpenCode (A4) ainda em campo — coluna será adicionada quando entregar.
> **Fontes:** `claude-code.md` (A3), `mercado.md` (A9), `modos.md` (A6), `ux-tui.md` (A7).
> **Regra:** cada afirmação traz a fonte. "Não verificado" quando não achou.

---

## 1. O que virou convenção

Se três ou mais ferramentas independentes fazem igual, é convenção. Copiar convenção reduz fricção do usuário e evita reinventar.

| Convenção | Claude Code | PI Coding Agent | Hermes | Aider | Codex CLI | Gemini CLI | Cline CLI | Fontes |
|:--|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--|
| `/help` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Todos os relatórios |
| `/model` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Todos os relatórios |
| `/clear` (ou `/new`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Todos os relatórios |
| `/compact` ou `/compress` | ✅ | ✅ | ✅ | ✅ (`/smol`) | ✅ | ✅ | ✅ (`/smol`) | Todos |
| `/new` (nova sessão) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Todos |
| `/diff` | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | 4/7 — Claude Code, Hermes, Aider, Codex |
| `/mcp` | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | 5/7 — Claude Code, PI, Codex, Gemini, Cline |
| `/init` (gera contexto) | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ (`/deep-planning`) | 4/7 — Claude Code, Codex, Gemini, Cline |
| `/plan` (modo read-only) | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | 4/7 — Claude Code, Codex, Gemini, Cline |
| `@file` (menção de arquivo) | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | 5/7 — Claude Code, PI, Codex, Gemini, Cline |
| `!command` (shell direto) | ✅ | ✅ | ❌ | ✅ (`/run`) | ❌ | ✅ | ❌ | 4/7 — Claude Code, PI, Aider, Gemini |
| `/copy` (clipboard) | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ | 4/7 — Claude Code, PI, Aider, Gemini |
| `/cost` ou `/tokens` | ✅ | ❌ | ✅ (`/context`) | ✅ | ✅ (`/status`) | ✅ (`/stats`) | ✅ (status bar) | 6/7 — Claude Code, Hermes, Aider, Codex, Gemini, Cline |
| `/status` ou `/session` | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | 6/7 — Claude Code, PI, Hermes, Codex, Gemini, Cline |
| Paleta com filtro por prefixo | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | 6/7 — Claude Code, PI, Hermes, Codex, Gemini, Cline |
| `Shift+Tab` cicla modos | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (Plan/Act) | 2/7 — Claude Code, Cline |
| Atalhos customizáveis | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | 3/7 — Claude Code, PI, Codex |
| Session tree / fork | ✅ | ✅ | ✅ (`/branch`) | ❌ | ✅ (`/fork`) | ✅ (`/rewind`) | ❌ | 5/7 — Claude Code, PI, Hermes, Codex, Gemini |
| Skills como `/skill:<nome>` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | 4/7 — Claude Code, PI, Hermes, Cline |
| MCP integrado | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | 5/7 |

**Fontes:** `claude-code.md` §1, `mercado.md` §1–7, `modos.md` §1, `ux-tui.md` §1.

---

## 2. Gap analysis — o que o SelfEvoPI não tem e deveria ter

O SelfEvoPI tem hoje: `/evals /gate /detect /forge /memory /skills /model /clear /help` (fonte: `apps/cli.mjs`, linhas 571–715).

Em ordem de valor (maior impacto primeiro):

| # | Falta | Por que importa | Quem tem | Fonte |
|:--|:--|:--|:--|:--|
| 1 | **`/sessions`** (listar, retomar, bifurcar) | Sessão é o ativo mais valioso do usuário. Sem isso, fechar o terminal = perder contexto. | Claude Code (`/resume`), PI (`/resume`, `/tree`, `/fork`), Hermes (`/resume`, `/sessions`), Codex (`/resume`, `/fork`), Gemini (`/resume`) | `claude-code.md` §1, `mercado.md` §1, §2, §4, §5 |
| 2 | **`/compact`** (comprimir contexto) | Sessões longas estouram a janela. Compactação preserva o essencial e libera espaço. | Claude Code, PI, Hermes, Aider, Codex, Gemini, Cline — **convenção universal** | Todos os relatórios |
| 3 | **`/diff`** (mostrar mudanças) | O usuário precisa ver o que o agente fez antes de commitar. | Claude Code, Hermes, Aider, Codex | `claude-code.md` §1, `mercado.md` §2–4 |
| 4 | **`/plan`** (modo read-only, propõe sem executar) | "Pensar antes de fazer" é o pedido mais comum em CLI de agente. 4 ferramentas têm. | Claude Code, Codex, Gemini, Cline | `modos.md` §1, §4 |
| 5 | **`/cost`** (custo e tokens da sessão) | Transparência. O usuário sabe quanto gastou. | Claude Code, Hermes, Aider, Codex, Gemini, Cline | `claude-code.md` §1, `mercado.md` §2–6 |
| 6 | **`/mcp`** (gerenciar servidores MCP) | Extensibilidade. 5 ferramentas têm. O SelfEvoPI já tem `core/mcp/` mas não expõe comando. | Claude Code, PI, Codex, Gemini, Cline | `claude-code.md` §1, `mercado.md` §1, §4–6 |
| 7 | **`/init`** (gerar contexto do projeto) | Bootstrap. Cria `AGENTS.md`/`CLAUDE.md`/`GEMINI.md` com instruções. | Claude Code, Codex, Gemini, Cline | `claude-code.md` §1, `mercado.md` §4–6 |
| 8 | **`/context`** (visualizar uso da janela) | O usuário entende o que está ocupando espaço. | Claude Code, Hermes, Codex, Gemini | `claude-code.md` §1, `mercado.md` §2, §4–5 |
| 9 | **`/copy`** (copiar última resposta) | Atalho para clipboard. 4 ferramentas têm. | Claude Code, PI, Aider, Gemini | `claude-code.md` §1, `mercado.md` §1, §3, §5 |
| 10 | **`/status`** (versão, modelo, conta) | Diagnóstico rápido. 6 ferramentas têm. | Claude Code, PI, Hermes, Codex, Gemini, Cline | Todos |
| 11 | **Paleta com filtro por prefixo** | UX. Digitar `/` mostra comandos. 6 ferramentas têm. | Claude Code, PI, Hermes, Codex, Gemini, Cline | `ux-tui.md` §1 |
| 12 | **`@file`** (menção de arquivo) | Contexto rápido. 5 ferramentas têm. | Claude Code, PI, Codex, Gemini, Cline | `claude-code.md` §3, `mercado.md` §1, §4–6 |
| 13 | **`/skills`** como `/skill:<nome>` | Skills individuais como comando. O SelfEvoPI tem `/skills` (lista) mas não `/skill:<nome>` (executa). | Claude Code, PI, Hermes, Cline | `claude-code.md` §1, `mercado.md` §1–2, §6 |
| 14 | **`/branch`** ou `/fork` de sessão | Bifurcar sem perder o original. | Claude Code, PI, Hermes, Codex, Gemini | `claude-code.md` §1, `mercado.md` §1–2, §4–5 |
| 15 | **`/rewind`** (checkpoint de código) | Desfazer não só a conversa mas o código. | Claude Code, Gemini | `claude-code.md` §1, `mercado.md` §5 |
| 16 | **Indicador de modo na status bar** | O usuário sempre sabe em que modo está. | Claude Code, Cline | `modos.md` §3 |
| 17 | **Shell mode `!`** | Rodar comando direto sem passar pelo modelo. | Claude Code, PI, Aider, Gemini | `claude-code.md` §3, `mercado.md` §1, §3, §5 |
| 18 | **`/reload`** | Recarregar config sem reiniciar. | Claude Code, PI | `claude-code.md` §1, `mercado.md` §1 |

---

## 3. Modos — o que vale a pena

O A6 provou: modo só existe se mudar **ler, escrever, executar ou quando-pergunta**. Se não muda nenhum dos quatro, é enfeite.

### Modos que valem a pena para o SelfEvoPI

| Modo | Significado em uma linha | Muda o quê | Lastro | Fonte |
|:--|:--|:--|:--|:--|
| `/plan` | Lê e executa só leitura; propõe; **não escreve** até aprovação explícita | Escreve: não. Executa: só read-only. | Claude Code `plan`, Cline `Plan`, OpenCode `plan`, Gemini `plan` | `modos.md` §1, §4 |
| `/build` | Escreve e executa dentro do workspace; fora pede | Escreve: sim (workspace). Executa: sim (workspace). | Claude Code `acceptEdits`, Cline `Act`, Codex `workspace-write` | `modos.md` §1, §4 |
| `/ask` | Responde sobre o código e **nunca** toca em disco | Escreve: nunca. Executa: não. | Aider `ask`, OpenCode `explore` | `modos.md` §1, §4 |
| `/goal` | Define condição de conclusão; avaliador separado checa após cada turno | Não muda permissão. Muda **quando o loop para**. | Claude Code `/goal`, Codex `/goal` | `modos.md` §1, §4 |
| `/review` | Lê um diff e devolve achados, sem editar | Escreve: não. Executa: não. | OpenCode `reviewer` (exemplo) | `modos.md` §4 |

### O que NÃO vale a pena

| Modo | Por quê | Fonte |
|:--|:--|:--|
| `/yolo` (sem perguntas) | Exatamente o que o SelfEvoPI não deve expor. O valor está nas camadas, não em desligá-las. | `modos.md` §4 |
| Modo que só muda o prompt | Se não muda permissão nem sandbox, é decoração. | `modos.md` §4 |
| `/architect` (Aider) | É separação de papéis (2 modelos), não de permissão. O SelfEvoPI não tem 2 modelos. | `modos.md` §2 |

### Onde o SelfEvoPI tem lastro real

- **`/plan`, `/build`, `/ask`** — lastro direto e idêntico em pelo menos 3 ferramentas cada.
- **`/goal`** — lastro em 2 (Claude Code, Codex), e encaixe natural para o loop auto-evolutivo.
- **Modo "evolução assistida"** — **invenção nossa**, sem equivalente nomeado. Significado honesto: `/build` cujo `verify()` e promoção passam por `core/governance/approval.mjs`.

---

## 4. Top 10 — o que mais eleva o padrão

Em ordem de impacto. Custo em linhas estimadas e complexidade (baixa/média/alta).

| # | Item | Custo | Complexidade | Prioridade | Por quê |
|:--|:--|:--|:--|:--|:--|
| 1 | **`/compact`** | ~40 linhas | Baixa | P0 | Convenção universal. Sem isso, sessões longas quebram. Usa `core/memory/refine.mjs` que já existe. |
| 2 | **`/sessions`** (listar + retomar) | ~80 linhas | Média | P0 | Sessão é o ativo mais valioso. Usa `core/graph/harness-store.mjs` que já existe. |
| 3 | **`/plan`** (modo read-only) | ~60 linhas | Média | P0 | 4 ferramentas têm. Muda `core/sandbox/static-gate.mjs` para bloquear escrita. |
| 4 | **`/diff`** | ~30 linhas | Baixa | P1 | 4 ferramentas têm. `git diff` + formatar. |
| 5 | **`/cost`** | ~20 linhas | Baixa | P1 | 6 ferramentas têm. Lê `core/graph/harness-store.mjs` (tokens já rastreados). |
| 6 | **`/status`** | ~20 linhas | Baixa | P1 | 6 ferramentas têm. Versão, modelo, sessão, tokens. |
| 7 | **Paleta com filtro** | ~120 linhas | Média | P1 | 6 ferramentas têm. UX. `ux-tui.md` §1 tem implementação ANSI puro. |
| 8 | **`/mcp`** | ~40 linhas | Baixa | P2 | 5 ferramentas têm. `core/mcp/` já existe, só falta expor. |
| 9 | **`/init`** | ~50 linhas | Média | P2 | 4 ferramentas têm. Gera `AGENTS.md` com instruções do projeto. |
| 10 | **`/context`** | ~30 linhas | Baixa | P2 | 4 ferramentas têm. Visualização da janela de contexto. |

---

## 5. Tabela comparativa

| Ferramenta | Comandos de barra | Modos | Atalhos | O que se destaca | Fonte |
|:--|:--|:--|:--|:--|:--|
| **Claude Code** | 76+ | 5 permission modes (manual, auto, acceptEdits, plan, bypass) | Ctrl+R, Ctrl+B, Ctrl+O, Ctrl+L, Ctrl+C/D, Shift+Tab, Esc, `!`, `@`, `#` | Paleta, permission modes, session tree, skills, hooks, `/goal`, `/cost`, `/context` | `claude-code.md` |
| **PI Coding Agent** | 25+ built-in + dinâmicos | 5 interfaces (interactive, print, JSON, RPC, SDK) | 100+ ações nomeadas em `keybindings.json` | Session tree, prompt templates, MCP nativo, RPC mode, SDK, keybindings customizáveis | `mercado.md` §1 |
| **Hermes Agent** | 40+ | Perfis (não modos) | Não verificado | `/goal` (Ralph loop), `/steer`, `/heartbeat`, `/loop`, `/worktree`, `/handoff`, `/journey` | `mercado.md` §2 |
| **Aider** | 41 | 5 modos (code, ask, architect, context, help) | Não verificado | Repo map (`/map`), architect/editor (2 modelos), `/web` (scrape URL), `/voice` (Whisper) | `mercado.md` §3 |
| **Codex CLI** | 27 | Approval modes (não modos de permissão) | Não verificado | `/goal` (persistente), `/plan`, approval modes granulares, `/statusline` | `mercado.md` §4 |
| **Gemini CLI** | 41 | Plan Mode (read-only) | Não verificado | `/rewind` (navega histórico), `/restore` (checkpoint), `/directory` (multi-workspace), `/hooks` | `mercado.md` §5 |
| **Cline CLI** | 15+ | 3 modos (plan, act, yolo) | 6 atalhos (Tab, Shift+Tab, Ctrl+C/D/L, @file) | `/newtask` (contexto distilado), `/deep-planning`, `/newrule`, worktree auto, kanban | `mercado.md` §6 |
| **OpenCode** | — | 4 agentes (build, plan, general, explore) | — | Ainda em campo (A4). Coluna será adicionada. | — |

---

## 6. Notas sobre divergências

Nenhuma divergência material entre relatórios. As fontes são primárias (docs oficiais) e concordam nos pontos verificados. Quando um relatório marcou "não verificado", a informação não foi confirmada em fonte primária e foi omitida da matriz.

---

## 7. Fontes

| Fonte | Arquivo | Autor |
|:--|:--|:--|
| Claude Code CLI landscape | `claude-code.md` | A3 |
| Mercado (PI, Hermes, Aider, Codex, Gemini, Cline, Continue) | `mercado.md` | A9 |
| Modos de CLI | `modos.md` | A6 |
| UX de TUI | `ux-tui.md` | A7 |
| Comandos atuais do SelfEvoPI | `apps/cli.mjs` (linhas 571–715) | — |