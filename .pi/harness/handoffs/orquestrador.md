# Handoff do Orquestrador — estado completo

> **Propósito:** memória durável da sessão. Se o contexto for compactado, é por aqui que se retoma.
> **Atualizado:** 2026-11-16
> **Repositório:** `C:\Users\Kelvin\Desktop\SelfEvoPI` · GitHub privado `KelvinOliveiraCode/SelfEvoPI`
> **HEAD:** `04602e8` em `main`, `dev` e nas 4 tags de fase

---

## 1. Estado: o projeto está completo

Todas as fases (P, 0, 1, 2, 3, 4, 5) foram entregues e verificadas. O estado
autoritativo está em **`docs/estado.md`** — este handoff é o atalho para retomar.

| Fase | Estado | Tag |
|:---|:---|:---|
| P — pesquisa | ✓ | `v0.0-research` |
| 0 — fundação | ✓ | `v0.1-foundation` |
| 1 — CLI, bake-off, memória | ✓ | `v0.2-cli` |
| 2 — núcleo de auto-evolução | ✓ | `v0.3-self-evo` |
| 3 — grafo de execução | ✓ | `v0.4-graph` |
| 4 — desktop | ✓ | `v0.5-desktop` |
| 5 — evolução contínua | ✓ | — |

## 2. Números finais (medidos)

| Métrica | Valor |
|:---|:---|
| Cold start | 433 ms (mín 399) — meta < 500 |
| Prompt do PI puro | 8.684 tok |
| Incremento do SelfEvoPI | **+501 tok** — meta < 1.500 |
| `pi-subagents` | +1.654 tok, sob demanda |
| Evals | 26 tarefas, **78/78 (100%)** |
| Tokens da suíte | 117.758 |
| Testes unitários | **280** |
| Custo | US$ 0,00 |

## 3. O que foi construído nesta rodada

- **`core/forge/`** — `detect`, `contract`, `generate-cli`, `generate-skill`,
  `generate-llm` (código real), `gatekeeper`, `promote`, `loop`, `cli`.
- **`core/governance/`** — `rollback` (rollback verificado), `approval` (pausa humana).
- **`core/graph/`** — `model`, `executor`, `runtime` (checkpoint/pausa/retomada), `panel` (ASCII + HTML).
- **`scripts/`** — `pi-launch.mjs` (extensões sob demanda), `measure-selfevopi-overhead.mjs`,
  `refine-loop.mjs`, `weekly-report.mjs`, `smoke-llm.mjs`.
- **`evals/`** — 26 tarefas, gate com separação de regressão real × instabilidade de modelo.

## 4. Decisões que carregam o projeto

1. **`pi-subagents` sob demanda.** 1.654 tok sozinhos estouravam o orçamento de 1.500.
2. **Evidência fraca é pior que evidência nenhuma.** O smoke test vazio promoveu um
   artefato com a interface errada; testes sintetizados de interface substituíram.
3. **Detector não inventa lacuna.** Sem catálogo ou marcador, `tool-missing` não dispara.
   Antes: 14 de 17 lacunas eram falsos positivos.
4. **`verify.mjs` fora do sandbox, artefato dentro.** Exceção no gate seria explorável.
5. **Família `or` desativada** (exit 0 com corpo vazio ao esgotar cota).

Detalhe com evidência: `docs/fase1/decisoes.md`.

## 5. Armadilhas (não repetir)

1. `pi` é shim `.cmd` no Windows — rodar `dist/bundle/cli.js` com `node`.
2. `--permission` não barra rede no Node 24.13 — precisa de preload.
3. Sem `--approve`, o PI ignora pacotes locais.
4. `icacls` com `%USERNAME%` pode valer `SYSTEM` e trancar o arquivo (usar `whoami`).
5. Worktree velho = "regressão" fantasma. Sincronizar antes de medir.
6. PowerShell engole acentos sem `-Encoding UTF8`.
7. O PI só lê `.pi/settings.json` no cwd e não sobe a árvore.
8. **`*/` dentro de comentário de bloco fecha o comentário.** Quebrou o gerador de CLI
   do A5, a minha correção, e o `generate-llm.mjs`. Sempre `node --check` no código gerado.
9. **Template literal aninhado** em string que já é template: quebra em tempo de parse.
10. **`node --check` não lê stdin** — precisa de arquivo.

## 6. Pendências honestas (não bloqueiam o uso)

| Item | Onde |
|:---|:---|
| Geradores de `extension`, `mcp-server`, `mcp-config` | `core/forge/` |
| Indexação semântica de skills (Voyager) | `core/forge/promote.mjs` |
| Ponte `core/graph` ↔ Pi-Harness | `docs/fase4-desktop.md` |
| Política de keep-alive do sandbox | `docs/fase2/sandbox.md` |
| Grupo B com lacunas reais (hoje são estruturais) | `evals/tasks/` |

## 7. Comandos essenciais

```powershell
node --test core/router/*.test.mjs core/forge/*.test.mjs core/memory/*.test.mjs core/graph/*.test.mjs core/governance/*.test.mjs core/sandbox/*.test.mjs scripts/refine-loop.test.mjs
node evals/gate.mjs                                  # 78/78
node scripts/measure-overhead.mjs --runs 10          # cold start
node scripts/measure-selfevopi-overhead.mjs --runs 3 # orcamento de prompt
node core/forge/cli.mjs detect --json
node core/forge/cli.mjs status
node core/forge/cli.mjs evolve --goal "..." --kind cli --inputs "a,b" --outputs "x" --llm
```

## 8. Áreas protegidas

- `evals/` — suíte e verificadores. O loop evolutivo não edita.
- `core/governance/` — rollback, aprovação, sandbox. Só A6.
- `scripts/verify-urls.mjs` — gate de fontes.

## 9. Equipe

A2 (evals), A5 (forge), A6 (sandbox/governança), A7 (memória/refine), A8 (grafo/desktop)
entregaram e foram integrados. A1 sou eu. Todos os worktrees sincronizados em `04602e8`.