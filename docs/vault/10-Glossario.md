---
tags: [glossário, referência]
created: 2026-11-19
---

# Glossário

Termos usados no SelfEvoPI.

| Termo | Definição |
|:---|:---|
| **PI Coding Agent** | `earendil-works/pi` — agente de código sobre o qual o SelfEvoPI é construído. Sem fork. |
| **Harness** | O conjunto de camadas que envolvem o PI: roteador, forge, sandbox, memória, grafo. |
| **Roteador** | Camada 2 — escolhe qual conta e modelo atende cada tarefa. `core/router/router.mjs`. |
| **Forge** | Núcleo de auto-evolução — detecta lacunas, gera artefatos, só promove sem regressão. `core/forge/`. |
| **Sandbox** | Gate estático + Node Permission Model + Job Objects. `core/sandbox/`. |
| **Grafo** | Executor de DAG com nós human, checkpoints, retomada. `core/graph/`. |
| **Memória** | Store em 3 níveis (session/project/skills), teto de 400 tok/turno. `core/memory/`. |
| **Eval** | Tarefa determinística que mede se o harness funciona. `evals/`. |
| **Baseline** | Estado de referência das evals. `evals/baseline.json`. |
| **LKG** | Last Known Good — checkpoint do último estado verde. `.pi/harness/last-known-good.json`. |
| **Gate** | Verificação que separa uma resposta boa de uma ruim. `evals/gate.mjs`. |
| **Sonda** | Exercita o artefato do jeito que ele é chamado. `core/forge/probe.mjs`. |
| **SpecWriter** | Transforma lacuna em contrato. `core/forge/specify.mjs`. |
| **Modo** | plan/build/manual/ask/goal — define o que o agente pode fazer sem perguntar. `core/governance/modes.mjs`. |
| **Permissão** | full-access/auto/ask — eixo distinto do modo. |
| **Esforço** | off/low/medium/high — nível de raciocínio do modelo. |
| **Ref** | `provider/modelo` — o que o roteador devolve. |
| **Pick** | Seleção de provider+modelo pelo roteador. |
| **Circuit breaker** | Disjuntor por provider — abre após N falhas, fecha após cooldown. |
| **Budget** | Teto de tokens/custo por tarefa. `core/router/budget.mjs`. |
| **Session** | Conversa persistida em `~/.pi/agent/sessions/`. |
| **Import** | Migração reversível de MCPs/skills do OpenCode para `~/.pi/` (`core/agent/import.mjs`). |
| **Probe** | Sonda JSON-RPC que abre o processo MCP, faz handshake e lista `tools/list` (`core/agent/mcp-probe.mjs`). |
| **Launcher** | `launcher/SelfEvoPI.cmd` + `instalar-atalhos.ps1` — abre a CLI de qualquer terminal via PATH. |
| **Sessão fantasma** | Resíduo de teste: sessão "fork de teste" criada por teste que rodou com HOME real. Limpa por `scripts/limpar-sessoes-teste.mjs`. |
| **Vault** | Esta base de conhecimento em Obsidian. |

Ver [[00-Mapa]] para navegar por toda a vault.
