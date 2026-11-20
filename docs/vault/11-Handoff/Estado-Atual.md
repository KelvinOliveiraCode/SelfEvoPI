---
tags: [handoff, estado-atual]
created: 2026-11-19
---

# Estado Atual (Handoff)

> Retrato do SelfEvoPI. Para quem vai continuar o desenvolvimento em outro chat: o
> que está pronto, o que falta, como rodar e onde estão as coisas.
>
> **Atualizado em 2026-11-20** para o HEAD `ed939e6`, versão `1.2.0` (bump já aplicado).

## Situação

| | HEAD | Versão |
|:--|:--|:--|
| Repositório privado | `ed939e6` | `1.2.0` (package.json) |
| Repositório público | | |

**Gate:** ver `npm test` / `node evals/gate.mjs` (os números do badge do README são a
referência viva; a última contagem medida da suíte foi 958 unit + 86/87 evals).

## O que há de novo (v1.2.0, desde a v1.1.4)

A v1.2.0 (`ed939e6`) fecha o trabalho de TUI que começou na v1.1.4. Ver
[[04-Features/Features]] e [[03-Comandos/CLI]].

- **`/plugins`** (`ed939e6`): lista os plugins (servidores MCP) ativos e sonda um
  (`/plugins <nome>`, handshake JSON-RPC + tools) ou todos (`/plugins test`). Lê o
  settings global (`~/.pi/settings.json`), mesma fonte do `/mcp`.
- **Tema violeta e padrão escuro** (`02bf804`): o tema `claro` virou `violeta`; o
  editor de tema custom não derruba mais a CLI; o padrão é sempre `escuro`.
- **Ctrl+K com deletar sessão**: a lista de sessões ganhou submenu abrir/deletar, com
  confirmação antes de remover o arquivo.
- **Ctrl+O**: abre o editor interativo de settings (tema, modo, permissão, modelo,
  esforço) sem sair da conversa.
- **Esforço**: o nível `"none"` é filtrado na linha de status, no seletor e no `/effort`;
  quando o motor não expõe raciocínio, aparecem os níveis padrão `off/low/medium/high`.

Antes disso, a v1.1.4 (`fd1fc16` a `fc9aa29`) trouxe:

- **TUI ousada** (`fd1fc16`): accent, cantos arredondados, tagline no header, status
  colorido, respeito a `reduced-motion`. Renomeação agnóstica (OpenCode → mcp-probe).
- **Subagentes moldáveis** (`08d082a`, estilo dsh): `core/agent/subagent.mjs`,
  `core/agent/swarm.mjs`. `/swarm` executa de verdade; `/subagent` cria subagente
  nomeado, persistente ou temporário; A2A entre persistentes e `@orquestrador`.
- **Temas, atividade e A2A** (`79955f7`): cores por papel semântico, 3 temas built-in
  mais 3 slots custom editáveis (`core/agent/theme-custom.mjs`), painel Ctrl+P de
  atividade (`core/agent/activity.mjs`), `sendA2A`.
- **Correções de tema e effort** (`6104f43`): temas funcionam em terminal 256 cores
  (fallback ANSI-256); modelos que só expõem `"none"` veem os níveis padrão de effort.
- **Comandos**: `/evo` (substituiu `/forge`), `/explorer` (seletor de pasta do Windows;
  o alias `/pasta` saiu depois), `/worktree`, `/workspace`, `/providers`, `/subagent`.
  `/evals` e `/gate` saíram de `COMMANDS` (as funções existem, mas não são digitáveis).
- **Infra**: `core/agent/providers.mjs`, `worktree.mjs`, `file-explorer.mjs`,
  `list-window.mjs`, `theme-custom.mjs`, `activity.mjs`, `subagent.mjs`, `swarm.mjs`,
  cada um com seu `*.test.mjs`.

## O que já estava pronto (v1.1.3 e anteriores)

### Agnosticismo (1.1.1, o grande)
- Skills leem `~/.pi/skills/<nome>/SKILL.md` (padrão agentskills.io), não a config de
  outro harness. `core/agent/skills-user.mjs` (ex-`skills-pc.mjs`).
- MCP global lê `~/.pi/settings.json` (chave `mcpServers`, com compat legada
  `mcp.servers`). `core/agent/mcp-probe.mjs` (ex-`mcp-opencode.mjs`).
- `/import`, migração reversível do OpenCode para `~/.pi/`, uma vez:
  `core/agent/import.mjs` (`scanSource`, `scanTarget`, `planImport`, `applyImport`,
  `undoImport`). Merge "existente vence", escrita atômica, backup `.bak-<ts>`,
  manifesto em `~/.pi/harness/ledger/import-<ts>.json`, rollback seletivo.
  Ligado ao comando `/import` no `apps/cli.mjs` (preview/confirma/undo/status).

### Robustez do probe (1.1.2)
- `ENV_BASE` com `APPDATA`/`LOCALAPPDATA`, o `searxng` voltou a responder.
- `timeout.catalog` como teto do `tools/list` (fallback 2s).
- `tools/list` em chunks: buffer acumulado + parse por profundidade de chaves, teto
  de 4 MB (`MAX_BUFFER`).

### Agnóstico estrito (1.1.3)
- Removido o fallback do OpenCode do runtime.
- `probe-mcps.mjs` diz a verdade quando não acha config.
- Mensagens user-facing sem citar outro produto.

### Launcher
- `selfevopi` funciona de qualquer terminal (PATH do usuário tem `launcher`).
- `launcher/instalar-atalhos.ps1` adiciona ao PATH (sem admin, idempotente).

### Desktop
- Bug das "sessões fantasmas" resolvido: `sessionDir()` devolve estado vazio honesto
  quando não há pasta do projeto. `scripts/desktop.mjs`.
- `scripts/limpar-sessoes-teste.mjs`, limpador (dry-run por padrão, `--confirm`
  remove só sessões com título "fork de teste").

### Outros (1.1.1)
- `capLinhas` fecha SGR antes da reticência (linha 100% colorida não vaza).
- `PiClient.promptAndWait` (texto final sem ler cedo demais).

## O que falta (com destaque)

1. **Auditoria de UI do desktop não concluída.** A8 ia fazer (chat, settings,
   responsividade), bateu rate limit. Só o sintoma das sessões foi resolvido.
2. **Overhead de prompt nunca medido.** Provedor devolveu 429 em todas as tentativas.
   Método no §7 de `docs/medidas-2026-11-19.md` (seção 3, "Overhead de prompt").
3. **Nomes internos ainda citam outro produto.** `findOpencodeConfig`,
   `listOpencodeMcp`, `normalizeOpencodeServer`, `OPENCODE_CONFIG_FILES` em
   `core/agent/mcp-probe.mjs`, as funções reais foram renomeadas
   (`findMcpConfig`, `listConfiguredMcp`, `normalizeServerEntry`, `MCP_CONFIG_FILES`) e
   os nomes antigos ficaram só como **aliases de compatibilidade**. Cosmético, não
   aparece na interface.
4. **Docs de design stale.** `docs/design/CONTRATO-1.1.md` e
   `docs/design/import-2026-11-19.md` (A10 corrigiu, mas pode ter sobrado).
5. **`SelfEvoPI-Painel.cmd`**, shim de compatibilidade mantido, não instalado.
6. **Teste `ctrl+k`**, flake resolvido com fixture, mas a máquina tem 83 processos
   node de base; medir dentro de worktree custa ~1,5x.

## Como rodar

```powershell
# CLI (conversa)
node apps/cli.mjs
# ou, de qualquer terminal, se o launcher estiver no PATH:
selfevopi

# Desktop (janela webview)
node scripts/desktop.mjs

# Testes
npm test

# Verificação completa
npm run verify
node evals/gate.mjs

# Diagnóstico sem aplicar
node scripts/daily.mjs --dry-run
```

## Onde estão as coisas

| Arquivo | O que é |
|:---|:---|
| `apps/cli.mjs` | Ponto de entrada da CLI (30 comandos de barra) |
| `apps/desktop/` | Desktop (webview) |
| `core/agent/` | Harness (sessões, banner, inspect, MCP, skills, tema, swarm, import) |
| `core/agent/theme.mjs` · `theme-custom.mjs` | 3 temas built-in + 3 slots custom (11 papéis de cor) |
| `core/agent/subagent.mjs` · `swarm.mjs` | Subagentes moldados (dsh) + execução em round-robin + A2A |
| `core/agent/activity.mjs` | Registro do painel Ctrl+P (shells + subagentes) |
| `core/agent/providers.mjs` | Registro de provedores e modelos (`/providers`) |
| `core/agent/worktree.mjs` | Worktrees git isoladas (`/worktree`) |
| `core/agent/mcp-probe.mjs` | Lê MCPs do settings global e sonda handshake/tools (`/mcp`, `/plugins`) |
| `core/agent/file-explorer.mjs` · `list-window.mjs` | Seletor de pasta do Windows (`/explorer`) e workspace |
| `core/router/` | Roteador (provider + modelo) |
| `core/forge/` | Auto-evolução (detect, specify, generate, probe, gatekeeper, promote) |
| `core/governance/` | Modos, aprovação, rollback |
| `core/sandbox/` | Gate estático + Permission Model |
| `core/memory/` | Memória em 3 níveis |
| `core/graph/` | Executor de DAG |
| `scripts/` | Automação (daily, schedule, measure, limpar-sessoes-teste, probe-mcps) |
| `evals/` | Suíte de evals determinística |
| `launcher/` | Atalhos e PATH (`SelfEvoPI.cmd`, `instalar-atalhos.ps1`) |
| `docs/medidas-2026-11-19.md` | Medidas mais recentes (com bloqueios explícitos) |
| `docs/estado.md` | Estado do projeto (2026-11-18, pode estar stale) |

## Ver também

- [[00-Mapa]], índice completo da vault.
- [[03-Comandos/CLI]], os 30 comandos da CLI.
- [[02-Componentes/Agent]], o harness por dentro.
- [[05-Decisoes/Decisoes]], as decisões que carregam o projeto.