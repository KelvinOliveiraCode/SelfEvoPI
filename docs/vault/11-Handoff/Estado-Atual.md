---
tags: [handoff, estado-atual]
created: 2026-11-19
---

# Estado Atual (Handoff)

> Retrato do SelfEvoPI em 2026-11-19, versão **1.1.3**. Para quem vai continuar o
> desenvolvimento em outro chat: o que está pronto, o que falta, como rodar e onde
> estão as coisas.

## Situação

| | HEAD | Tag |
|:--|:--|:--|
| Repositório privado | `01a360c` | `v1.1.3` |
| Repositório público | `16de246` | `v1.1.3` |

**Gate:** 961 tests · 960 passam · 0 falham · 1 skip (integração pi-harness).
Medido em 2026-11-19, `npm test`.

## O que está pronto (1.1.3)

### Agnosticismo (1.1.1 — o grande)
- Skills leem `~/.pi/skills/<nome>/SKILL.md` (padrão agentskills.io), não a config de
  outro harness. `core/agent/skills-user.mjs` (ex-`skills-pc.mjs`).
- MCP global lê `~/.pi/settings.json` (chave `mcpServers`, com compat legada
  `mcp.servers`). `core/agent/mcp-probe.mjs` (ex-`mcp-opencode.mjs`).
- `/import` — migração reversível do OpenCode para `~/.pi/`, uma vez:
  `core/agent/import.mjs` (`scanSource`, `scanTarget`, `planImport`, `applyImport`,
  `undoImport`). Merge "existente vence", escrita atômica, backup `.bak-<ts>`,
  manifesto em `~/.pi/harness/ledger/import-<ts>.json`, rollback seletivo.
  **Nota:** o módulo existe e funciona (21 testes), mas **não está ligado** como
  comando `/import` no `apps/cli.mjs` — é um item em aberto.

### Robustez do probe (1.1.2)
- `ENV_BASE` com `APPDATA`/`LOCALAPPDATA` — o `searxng` voltou a responder.
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
- `scripts/limpar-sessoes-teste.mjs` — limpador (dry-run por padrão, `--confirm`
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
   `core/agent/mcp-probe.mjs`. Renomear quebraria importadores. Cosmético, não
   aparece na interface.
4. **Docs de design stale.** `docs/design/CONTRATO-1.1.md` e
   `docs/design/import-2026-11-19.md` (A10 corrigiu, mas pode ter sobrado).
5. **`SelfEvoPI-Painel.cmd`** — shim de compatibilidade mantido, não instalado.
6. **Teste `ctrl+k`** — flake resolvido com fixture, mas a máquina tem 83 processos
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
| `apps/cli.mjs` | Ponto de entrada da CLI (25 comandos de barra) |
| `apps/desktop/` | Desktop (webview) |
| `core/agent/` | Harness (sessões, banner, inspect, MCP, skills, tema, swarm, import) |
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

- [[00-Mapa]] — índice completo da vault.
- [[03-Comandos/CLI]] — os 25 comandos da CLI.
- [[02-Componentes/Agent]] — o harness por dentro.
- [[05-Decisoes/Decisoes]] — as decisões que carregam o projeto.