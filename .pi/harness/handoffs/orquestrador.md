# Handoff do Orquestrador — estado completo

> **Propósito:** memória durável da sessão. Se o contexto for compactado, é por aqui que se retoma.
> **Atualizado:** 2026-11-16
> **Repositório:** `SelfEvoPI` · GitHub privado
> **HEAD:** `89a9c77` em `main` e `dev`

---

## 1. Estado: o projeto está completo

Todas as fases (P, 0, 1, 2, 3, 4, 5) foram entregues e verificadas. O estado
autoritativo está em **`docs/estado.md`** — este handoff é o atalho para retomar.

| Fase | Estado |
|:---|:---|
| P — pesquisa | ✓ |
| 0 — fundação | ✓ |
| 1 — CLI, bake-off, memória | ✓ |
| 2 — núcleo de auto-evolução | ✓ |
| 3 — grafo de execução | ✓ |
| 4 — desktop (ponte entregue) | ✓ parcial, validado por teste próprio |
| 5 — evolução contínua | ✓ |

## 2. Números finais (medidos)

| Métrica | Valor |
|:---|:---|
| Cold start | 433 ms (mín 399) — meta < 500 |
| Prompt do PI puro | 8.684 tok |
| Incremento do SelfEvoPI | **+501 tok** — meta < 1.500 |
| `pi-subagents` | +1.654 tok, sob demanda |
| Evals | **29 tarefas, 86/87 na baseline** (B11 é estocástico) |
| Tokens da suíte | ~211.900 |
| Testes unitários | **449** (448 passam, 1 skip) |
| Custo | US$ 0,00 |

## 3. O que foi construído

- **`core/forge/`** — `detect`, `contract`, `specify` (SpecWriter), `generate-cli`,
  `generate-skill`, `generate-mcp-config`, `generate-mcp-server`, `generate-extension`,
  `generate-llm` (código real para 3 kinds), `probe` (sonda por kind), `gatekeeper`,
  `promote`, `rollback` via governance, `loop`, `cli`.
- **`core/governance/`** — `rollback` (rollback verificado), `approval` (pausa humana).
- **`core/graph/`** — `model`, `executor`, `runtime` (checkpoint/pausa/retomada),
  `harness-state` + `harness-store` (ponte), `panel` (ASCII + HTML).
- **`core/memory/`** — `store`, `refine`, `extension`, `search` (busca por termo).
- **`core/sandbox/`** — `static-gate` (13 regras), `run-sandboxed`, `escape.test`.
- **`evals/`** — 29 tarefas (A8/B11/C6/D4), gate com classificação estocástica.
- **`.github/workflows/ci.yml`** — testes + evals A/C + URLs (sem chave).

## 4. Decisões que carregam o projeto

1. **`pi-subagents` sob demanda.** 1.654 tok sozinhos estouravam o orçamento de 1.500.
2. **Evidência fraca é pior que evidência nenhuma.** O smoke test vazio promoveu um
   artefato com a interface errada; a sonda por kind (`probe.mjs`) substituiu.
3. **Detector não inventa lacuna.** Sem catálogo ou marcador, `tool-missing` não dispara.
   Antes: 14 de 17 lacunas eram falsos positivos.
4. **`verify.mjs` fora do sandbox, artefato dentro.** Exceção no gate seria explorável.
5. **Família `or` desativada** (exit 0 com corpo vazio ao esgotar cota).
6. **Kind sem gerador é erro, não recaída.** Quando `chooseKind` não casa nada, o
   artefato honesto é a `skill`. Recair para `cli` gerava o artefato errado com cara de sucesso.
7. **Meta-auditoria evita lookup table.** Toda tarefa de modelo tem entrada surpresa
   gerada em tempo de execução; sem isso, o artefato imprime a resposta esperada sem calcular.

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
11. **No Windows o pid continua "existe" por alguns ms** depois de o processo morrer.
    Teste que acusa vazamento precisa esperar (ver `run-sandboxed.test.mjs` `after()`).
12. **Script auxiliar em `os.tmpdir()` não resolve import relativo** — escreva na raiz do
  projeto e remova depois.

## 6. Pendências honestas (não bloqueiam o uso)

| Item | Onde |
|:---|:---|
| Validar a ponte contra Pi-Harness instalado | `docs/fase4-ponte.md` |
| Grupo B mistura structural e real (B9–B11 usam modelo) | `evals/tasks/` |
| Auto-disparo do loop evolutivo | `core/forge/loop.mjs` |
| Recuperação de skills é lexical (sem embeddings) | `core/memory/search.mjs` |
| Job Objects e keep-alive do sandbox | `docs/fase2/sandbox.md` (descartados com número) |

## 7. Comandos essenciais

```powershell
npm test                                             # 449 testes
node evals/gate.mjs                                  # 86/87 baseline (B11 estocástico)
node scripts/measure-overhead.mjs --runs 10          # cold start
node scripts/measure-selfevopi-overhead.mjs --runs 3 # orcamento de prompt
node core/forge/cli.mjs detect --json
node core/forge/cli.mjs skills <termo>
node core/forge/cli.mjs evolve --goal "..." --kind cli --inputs "a,b" --outputs "x" --llm
node scripts/daily.mjs --dry-run
```

## 8. Áreas protegidas

- `evals/` — suíte e verificadores. O loop evolutivo não edita.
- `core/governance/` — rollback, aprovação, sandbox. Só A6.
- `scripts/verify-urls.mjs` — gate de fontes.

## 9. Equipe

A2 (evals, meta-auditoria), A3 (roteador, failover), A5 (forge, 5 kinds), A6 (sandbox/governança),
A7 (memória, `/mem find`), A8 (grafo/desktop). A1 sou eu.
Todos os worktrees sincronizados em `89a9c77`.