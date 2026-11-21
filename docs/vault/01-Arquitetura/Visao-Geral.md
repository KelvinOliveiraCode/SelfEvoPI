---
tags: [arquitetura, visão-geral]
created: 2026-11-19
---

# Arquitetura

> Camadas e fluxo do SelfEvoPI.

## Camadas

```
┌─────────────────────────────────────────────────┐
│  Camada 1: PI Coding Agent (não modificado)     │
│  O motor de conversa. Recebe prompts, usa tools.│
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│  Camada 2: Roteador (core/router/)              │
│  Escolhe provider + modelo. Circuit breaker,    │
│  retry, budget, perfis.                         │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│  Camada 3: Harness (core/agent/, apps/)         │
│  CLI, sessões, settings, banner.       │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│  Camada 4: Auto-evolução (core/forge/)          │
│  Detecta lacunas, gera artefatos, promove.      │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│  Camada 5: Governança (core/governance/)        │
│  Modos, rollback, approval.                     │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│  Camada 6: Sandbox (core/sandbox/)              │
│  Gate estático, Permission Model, Job Objects.  │
└─────────────────────────────────────────────────┘
```

## Fluxo de uma tarefa

1. Usuário digita prompt na CLI
2. Roteador escolhe provider + modelo (`pick`)
3. PI Coding Agent recebe o prompt e executa
4. Se o agente tenta escrever/executar, o modo (`plan`/`build`/`manual`/`ask`/`goal`) decide se permite
5. Tokens e custo são registrados no ledger
6. Se auto-evolução está ativa, lacunas são detectadas e artefatos gerados

## Princípios

- **Sem fork do PI.** Tudo via extensões, skills, config e `.pi/harness/`.
- **Zero dependência npm.** Só `node:` embutido.
- **Windows nativo.** Sem Docker, WSL, VM.
- **Família `or` desativada.** OpenRouter free tier falha silenciosamente.

Ver [[05-Decisoes/Decisoes]] para as decisões que carregam o projeto.