---
tags: [componentes, governança, modos]
created: 2026-11-19
---

# Governança

> O que o agente pode fazer, quando pede confirmação, e como desfazer. `core/governance/`.

## Arquivos

| Arquivo | O que faz |
|:---|:---|
| `core/governance/modes.mjs` | Os 5 modos (plan/build/manual/ask/goal) + `guard()` |
| `core/governance/approval.mjs` | Classificador de aprovação (`reviewApproval`) |
| `core/governance/rollback.mjs` | Git + LKG (last-known-good) para desfazer |

## Modos (`modes.mjs`)

Cinco modos reais, cada um definido por **ler / escrever / executar / quando-pergunta**:

| Modo | Lê | Escreve | Executa | Escopo | Quando pergunta |
|:---|:---:|:---:|:---:|:---|:---|
| `plan` | ✅ | ❌ | ✅ | readonly | escrita |
| `build` | ✅ | ✅ | ✅ | workspace | fora do workspace |
| `manual` | ✅ | ✅ | ✅ | workspace | cada escrita |
| `ask` | ✅ | ❌ | ❌ | none | nunca |
| `goal` | ✅ | ✅ | ✅ | herda de build | fora do workspace |

Ver [[05-Decisoes/Modos]] para a tabela de permissão TUI e o princípio anti-`/yolo`.

### `guard()`

`guard({ mode, action, path, workspace, command, code, scan, base })` é o ponto de
decisão. Devolve `{ decision, mode, action, reason, questions }` — `allow` ou
`ask`/`deny` com o motivo. É o que a CLI e o desktop chamam antes de tocar em disco.

## Aprovação (`approval.mjs`)

`reviewApproval({ request, scan })` classifica a ação (ex.: escrita fora do workspace)
e decide se pede confirmação. `TRIGGERS` e `RULE_VOCABULARY` definem os gatilhos.

## Rollback (`rollback.mjs`)

- `git(...)` / `headSha(...)` / `headBranch(...)` — inspeção do repositório.
- `runVerify(...)` — roda a verificação antes de reverter.
- `readLkg(...)` / `writeLkg(...)` — lê e grava o Last Known Good
  (`.pi/harness/last-known-good.json`), o checkpoint do último estado verde.

## Princípio

O modo (eixo do que o agente pode fazer) é distinto da permissão (eixo de como confirma:
`full-access` / `auto` / `ask`). Não existe `/yolo` aqui, e não vai existir.

## Ver também

- [[02-Componentes/Sandbox]] — o gate estático que complementa a governança em runtime.
- [[05-Decisoes/Decisoes]] — D4 (`verify.mjs` fora do sandbox) e D8 (desktop = CLI).