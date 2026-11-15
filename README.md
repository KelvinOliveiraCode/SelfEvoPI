# SelfEvoPI

Harness de agente de código **ultraleve, rápido, econômico em contexto** e **auto-evolutivo**, construído **sobre** o [PI Coding Agent](https://github.com/earendil-works/pi) — sem fork.

## O que é

O SelfEvoPI acopla-se ao PI via extensões, skills, configuração e estado versionado em `.pi/harness/`. Ele acrescenta três coisas que o PI não tem:

1. **Roteador multi-provider** — perfis (`orchestrator`, `worker`, `reviewer`) sobre 8 contas, com fallback e teto de tokens.
2. **Suíte de evals determinística** — 30–50 tarefas com verificador automático, medindo acurácia, tokens e latência.
3. **Núcleo evolutivo** — detecta lacunas, especifica, gera o artefato, valida em sandbox Windows e só promove o que não causa regressão.

## Por que eficiência é requisito

O [Harness Leaderboard](https://huggingface.co/spaces/joelniklaus/harness-leaderboard) mede o mesmo modelo trocando apenas o harness: o Pi resolve **49,4%** das tarefas a **US$ 0,29** por tarefa resolvida, contra 51,4% a US$ 0,53 do mini-swe-agent. Eficiência de contexto não é otimização — é a diferença entre 45% mais barato e o dobro do custo.

## Estado

| Fase | Status |
|:---|:---|
| P — Pesquisa e auditoria | concluída — ver `docs/research/` |
| 0 — Fundação Windows, Git e providers | em andamento |
| 1 — CLI, bake-off e memória | pendente |
| 2 — Núcleo de auto-evolução | pendente |
| 3 — Grafo de execução | pendente |
| 4 — Desktop Windows | pendente |

## Ambiente

- **Windows nativo** — sem Docker, sem VM, sem WSL.
- Node.js **≥ 22.19.1** (validado em v24.13.0).
- PI Coding Agent **≥ 1.5.2**.
- Git **≥ 2.55** com `core.longpaths true`.

## Documentação

- [`docs/research/inspiracoes.md`](docs/research/inspiracoes.md) — auditoria das fontes, 41 decisões, 10 correções ao plano.
- [`docs/research/backlog-fase1.md`](docs/research/backlog-fase1.md) — backlog derivado, com comando de verificação por item.
- [`scripts/verify-urls.mjs`](scripts/verify-urls.mjs) — gate de integridade das fontes citadas.

```shell
node scripts/verify-urls.mjs
```

## Estrutura

```
docs/research/     auditoria, decisões e backlog
scripts/           ferramentas de verificação (sem dependências)
.pi/harness/       estado persistente do harness
.worktrees/        worktrees isolados dos subagentes (ignorado)
```

## Licença

A definir.