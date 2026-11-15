# Handoff — estado para o orquestrador

> Escrito ao fim da etapa de implementação. Serve de memória após compactação de contexto.
> Atualizado em 2026-11-15.

## Onde estamos

Fase P concluída e tagada `v0.0-research`. Fase 0 quase completa.

| Bloco | Estado |
|:---|:---|
| PI Coding Agent | 1.5.2 instalado (npm; o instalador PowerShell falha com exit 1) |
| Git | `main` + `dev` em `c190f27`, `core.longpaths true` |
| GitHub | privado: `KelvinOliveiraCode/SelfEvoPI` |
| Worktrees | `.worktrees/A1`–`A8`, branches `agent/A*`, parados em `1720d68` |
| Providers | 8 contas, 48 modelos, chaves distintas, todas HTTP 200 |
| Roteador | `core/router/`, 3 perfis, circuit breaker, 12 testes |
| Evals | 14 tarefas (A/B/C estruturais + D modelo real), 14/14 |

## Como as coisas funcionam

- **Providers**: `scripts/import-providers.mjs --apply` gera `~/.pi/agent/models.json` e aplica `icacls`.
  Nunca imprimir chaves; usar `whoami` para o ACL (não `%USERNAME%`, que pode valer `SYSTEM`).
- **Roteador**: `node core/router/cli.mjs --profile <orchestrator|worker|reviewer> [--exclude <provider>]`.
  Reviewer **nunca** usa o provider do autor.
- **Evals**: `node evals/run.mjs [--group X] [--task ID]`, relatório em `node evals/report.mjs`.
  Ledger append-only em `.pi/harness/ledger/evals.jsonl`.
- **Modelo real**: tarefas com `prompt` copiam `evals/fixtures/<fixture>`, chamam o PI e rodam o checker
  no mesmo workspace. `evals/lib/pi.mjs` faz a ponte.

## Armadilhas já resolvidas (não repetir)

1. `pi` no Windows é shim `.cmd` → rodar `dist/bundle/cli.js` com Node.
2. Saída via pipe congela o filho → redirecionar para arquivo temporário e `stdin: ignore`.
3. `icacls` com `%USERNAME%` tranca o arquivo para o dono → usar `whoami`.

## Próximo passo

**Gatekeeper** (Fase 0): rodar a suíte com e sem um artefato e exigir zero regressão.
Depois **baseline oficial** e **Fase 1** (bake-off dos orquestradores).

## Modo de operação combinado

A partir da compactação, atuar **somente como orquestrador**: subagentes executam, o orquestrador audita e decide.
Mudanças pequenas podem ser feitas diretamente. Nada de subagente é aceito sem revisão do código gerado.

## Limitação conhecida

A2A do Traycer não está registrado nesta sessão (`No Traycer A2A tools are registered`), então não há
agentes persistentes. A alternativa é o `subagent` nativo do OpenCode, em lotes, com revisão.