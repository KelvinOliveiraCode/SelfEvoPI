---
tags: [componentes, harness, agent]
created: 2026-11-19
---

# Harness (Agent)

> A camada que envolve o PI Coding Agent: sessões, banner, status, compactação, MCP,
> skills, temas, subagentes, atividade e swarm. `core/agent/`.

## Arquivos

| Arquivo | O que faz | Exports principais |
|:---|:---|:---|
| `core/agent/sessions.mjs` | Lista, carrega, bifurca e referencia sessões | `listSessions`, `loadSession`, `forkSession`, `referenceSession` |
| `core/agent/inspect.mjs` | Status, custo e uso de contexto | `sessionStatus`, `sessionCost`, `contextUsage` |
| `core/agent/compact.mjs` | Compacta o histórico da conversa | `compactHistory`, `estimateTokens` |
| `core/agent/banner.mjs` | Logo ASCII e linhas de estado | `bannerLines`, `asciiWordmark` |
| `core/agent/settings.mjs` | Coleta e aplica configurações | `collectSettings`, `applySetting` |
| `core/agent/settings-view.mjs` | Visão única do estado (`/settings`) | `renderSettings` |
| `core/agent/theme.mjs` | Tema da interface: 3 built-in (escuro/claro/alto-contraste), 11 papéis de cor | `getTheme`, `setTheme`, `listThemes`, `themeToAnsi256` |
| `core/agent/theme-custom.mjs` | 3 slots custom editáveis (`~/.pi/agent/custom-themes.json`) | `listCustomThemes`, `getCustomTheme`, `saveCustomTheme` |
| `core/agent/mcp.mjs` | Inventaria MCPs do projeto (`.mcp.json` / `.pi/settings.json`) | `readMcpConfig`, `listMcpServers` |
| `core/agent/mcp-probe.mjs` | Lê MCPs da config global `~/.pi/settings.json` + probe JSON-RPC (ex-`mcp-opencode.mjs`) | `listConfiguredMcp` (+ alias `listOpencodeMcp`) |
| `core/agent/mcp-logs.mjs` | Logs dos servidores MCP |, |
| `core/agent/skills-user.mjs` | Lista skills do PC (`~/.pi/skills/<nome>/SKILL.md`) (ex-`skills-pc.mjs`) | `findPcSkills`, `listPcSkills` |
| `core/agent/import.mjs` | Migra MCPs e skills do OpenCode para `~/.pi/` uma vez, reversível | `scanSource`, `scanTarget`, `planImport`, `applyImport`, `undoImport` |
| `core/agent/subagent.mjs` | Subagente moldado (dsh): provider/modelo/esforço/modo; persistente ou temporário; A2A | `runSubagent`, `sendA2A`, `listPersistent`, `closePersistent` |
| `core/agent/swarm.mjs` | Orquestra n subagentes rumo à tarefa (`/swarm`) | `synthesizeSubagents`, `runSwarmExecution` |
| `core/agent/activity.mjs` | Registro do painel Ctrl+P (shells + subagentes) | `registerActivity`, `listActivity`, `getActive` |
| `core/agent/providers.mjs` | Registro de provedores e modelos (`/providers`) |, |
| `core/agent/worktree.mjs` | Worktrees git isoladas (`/worktree`) |, |
| `core/agent/file-explorer.mjs` | Seletor de pasta do Windows (`/explorer`, `/pasta`) |, |
| `core/agent/list-window.mjs` | Lista janelas/pastas para escolher workspace |, |
| `core/agent/pi-rpc.mjs` | Ponte RPC com o engine do PI | `createPiClient`, `findEngine`, `listConfiguredModels` |
| `core/agent/init.mjs` | Gera rascunho de AGENTS.md | `renderAgentDoc` |

## O que a CLI e o desktop chamam

- **Sessões** (`/sessions`, `#sessions` no desktop): `sessions.mjs`, a mesma pasta de
  sessões alimenta as duas superfícies (ver [[05-Decisoes/Decisoes]] D8).
- **Status/custo/contexto** (`/status`, `/cost`, `/context`): `inspect.mjs`.
- **Compactação** (`/compact`): `compact.mjs`, mantém as mensagens recentes e resume
  o resto dentro de um teto de tokens.
- **MCP** (`/mcp`): `mcp.mjs` (projeto) + `mcp-probe.mjs` (global `~/.pi/settings.json`).
- **Skills** (`/skills`): `skills-user.mjs` (PC, `~/.pi/skills`) + store do loop.
- **Settings** (`/settings`): `settings-view.mjs` (`renderSettings`).
- **Tema** (`/theme`): `theme.mjs` (built-in) + `theme-custom.mjs` (slots custom).
- **Subagentes** (`/swarm`, `/subagent`): `subagent.mjs` + `swarm.mjs`. A2A via `sendA2A`.
- **Atividade** (`Ctrl+P`): `activity.mjs`, lista shells + subagentes; persistente
  interage, temporário é read-only.
- **Provedores** (`/providers`): `providers.mjs`.
- **Workspace** (`/workspace`, `/explorer`, `/pasta`): `list-window.mjs` + `file-explorer.mjs`.
- **Worktree** (`/worktree`): `worktree.mjs`.
- **Import** (`import.mjs`): migra MCPs/skills do OpenCode para `~/.pi/` uma vez,
  reversível, ligado ao comando `/import` no `apps/cli.mjs`.
- **Engine** (`pi-rpc.mjs`): encontra o binário do PI e cria o cliente RPC.

## `PiClient.promptAndWait`

`pi-rpc.mjs` tem dois jeitos de pedir uma resposta ao motor:

- **`prompt(message)`**, envia e devolve o stream de eventos; quem chama decide quando
  parar de ler.
- **`promptAndWait(message, timeoutMs)`**, envia e espera o texto final, sem ler cedo
  demais. É o que a CLI usa quando só quer a resposta pronta (não o stream). Estouro
  de tempo vira `Error("promptAndWait: tempo esgotado após N ms")`.

## Ver também

- [[02-Componentes/Roteador]], quem escolhe o modelo que o harness usa.
- [[02-Componentes/Memoria]], a memória persistente que o harness carrega no prompt.