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
| `core/agent/theme.mjs` | Tema da interface: 12 paletas de cor, 11 papéis de cor | `getTheme`, `setTheme`, `listThemes`, `themeToAnsi256` |
| `core/agent/theme-custom.mjs` | 3 slots custom editáveis (`~/.pi/agent/custom-themes.json`) | `listCustomThemes`, `getCustomTheme`, `saveCustomTheme` |
| `core/agent/hooks.mjs` | Hooks de ciclo de vida do workspace (`turn_start`…`compact`), sem shell e com redação de segredos | `readHooks`, `runHooks`, `EVENTS` |
| `core/agent/rewind.mjs` | Recorte puro de JSONL de sessão (erros, antes de id, manter últimos) | `rewindSession`, `rewindReport`, `summarizeSession` |
| `core/agent/lsp.mjs` | Cliente LSP zero-dep sobre stdio (`Content-Length`, diagnostics, rename, hover, symbols) | `LspClient`, `readLspConfig`, `serverForFile` |
| `core/agent/ast-edit.mjs` | Edição estrutural com âncora por hash e preview | `hashTexto`, `localizarBloco`, `planejarEdicao`, `aplicarEdicao` |
| `core/agent/advisor.mjs` | Notas de revisor e regras de stream com abort | `observeTurn`, `parseNotes`, `verificarStream` |
| `core/agent/dap.mjs` | Cliente DAP zero-dep (launch, breakpoints, stepping, variables) | `DapClient`, `readDapConfig`, `adapterForFile` |
| `core/agent/agent-defs.mjs` | Definições de agente, modos e permissões ordenadas | `readAgentDefs`, `resolveAgent`, `checkPermission` |
| `core/agent/team.mjs` | Equipes persistentes com quadro, mensagens e tarefas | `createTeam`, `board`, `runTeamStep` |
| `core/agent/memory-auto.mjs` | Memória automática com redação e recuperação | `retain`, `recall`, `digestSession` |
| `core/agent/magic-words.mjs` | Palavras de controle somente em prosa | `parseMagicWords` |
| `core/agent/cells.mjs` | Célula persistente restrita com reentrada de ferramenta | `createCellRuntime` |
| `core/agent/refutation-audit.mjs` | Auditoria de afirmações com veredito | `audit` |
| `core/agent/code-mode.mjs` | Executa programa curto com acesso restrito a tools (`node:vm`) | `runCode` |
| `scripts/code-mode-mcp.mjs` | Gateway MCP opt-in que expõe apenas `run_code`; descobre servidores locais em runtime | (processostdio) |
| `core/agent/mcp.mjs` | Inventaria MCPs do projeto (`.mcp.json` / `.pi/settings.json`) | `readMcpConfig`, `listMcpServers` |
| `core/agent/mcp-probe.mjs` | Lê MCPs do settings global (`~/.pi/settings.json`) e sonda handshake/tools (`/mcp`, `/plugins`) (ex-`mcp-opencode.mjs`) | `listConfiguredMcp` (+ alias `listOpencodeMcp`), `probeMcpServer` |
| `core/agent/mcp-logs.mjs` | Logs dos servidores MCP |, |
| `core/agent/skills-user.mjs` | Lista skills do PC (`~/.pi/skills/<nome>/SKILL.md`) (ex-`skills-pc.mjs`) | `findPcSkills`, `listPcSkills` |
| `core/agent/import.mjs` | Migra MCPs e skills do OpenCode para `~/.pi/` uma vez, reversível | `scanSource`, `scanTarget`, `planImport`, `applyImport`, `undoImport` |
| `core/agent/subagent.mjs` | Subagente moldado (dsh): provider/modelo/esforço/modo; persistente ou temporário; A2A | `runSubagent`, `sendA2A`, `listPersistent`, `closePersistent` |
| `core/agent/swarm.mjs` | Orquestra n subagentes rumo à tarefa (`/swarm`) | `synthesizeSubagents`, `runSwarmExecution` |
| `core/agent/activity.mjs` | Registro da lista de atividade (Ctrl+P) | `registerActivity`, `listActivity`, `getActive` |
| `core/agent/providers.mjs` | Registro de provedores e modelos (`/providers`) |, |
| `core/agent/worktree.mjs` | Worktrees git isoladas (`/worktree`) |, |
| `core/agent/file-explorer.mjs` | Seletor de pasta do Windows (`/explorer`) |, |
| `core/agent/list-window.mjs` | Lista janelas/pastas para escolher workspace |, |
| `core/agent/pi-rpc.mjs` | Ponte RPC com o engine do PI | `createPiClient`, `findEngine`, `listConfiguredModels` |
| `core/agent/init.mjs` | Gera rascunho de AGENTS.md | `renderAgentDoc` |

## O que a CLI chama

- **Sessões** (`/sessions`, `/fork`, `/export`): `sessions.mjs`, a pasta de
  sessões do projeto; a CLI é a única superfície (ver [[05-Decisoes/Decisoes]] D8).
- **Status/custo/contexto** (`/status`, `/cost`, `/context`): `inspect.mjs`.
- **Compactação** (`/compact`): `compact.mjs`, mantém as mensagens recentes e resume
  o resto dentro de um teto de tokens.
- **MCP** (`/mcp`, `/plugins`): `mcp-probe.mjs` lê o settings global (`~/.pi/settings.json`).
  `/mcp` lista; `/plugins` também sonda (handshake JSON-RPC + tools).
- **Skills** (`/skills`): `skills-user.mjs` (PC, `~/.pi/skills`) + store do loop.
- **Settings** (`/settings`): `settings-view.mjs` (`renderSettings`).
- **Tema** (`/theme`): `theme.mjs` (built-in) + `theme-custom.mjs` (slots custom).
- **Subagentes** (`/swarm`, `/subagent`): `subagent.mjs` + `swarm.mjs`. A2A via `sendA2A`.
- **Atividade** (`Ctrl+P`): `activity.mjs`, lista shells + subagentes; persistente
  interage, temporário é read-only.
- **Provedores** (`/providers`): `providers.mjs`.
- **Workspace** (`/workspace`, `/explorer`): `list-window.mjs` + `file-explorer.mjs`.
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