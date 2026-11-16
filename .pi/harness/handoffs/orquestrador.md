# Handoff do Orquestrador — estado completo

> **Propósito:** este arquivo é a memória durável da sessão. Se o contexto for compactado, é por aqui que se retoma.
> **Atualizado:** 2026-11-15
> **Repositório:** `C:\Users\Kelvin\Desktop\SelfEvoPI` · GitHub privado `KelvinOliveiraCode/SelfEvoPI`
> **HEAD:** `f80ed0a` em `main` e `dev`

---

## 1. O projeto em uma frase

**SelfEvoPI** é um harness de agente de código ultraleve, rápido, econômico em contexto e **auto-evolutivo**, construído **sobre** o PI Coding Agent (`earendil-works/pi`) — sem fork. Ele acrescenta roteador multi-provider, suíte de evals determinística, gatekeeper e um núcleo que detecta lacunas, gera artefatos e só promove o que não causa regressão.

## 2. Estado das fases

| Fase | Nome | Estado |
|:---|:---|:---|
| **P** | Pesquisa e auditoria | ✓ concluída, tag `v0.0-research` |
| **0** | Fundação Windows, Git, providers, evals | ✓ **concluída** |
| **1** | CLI, bake-off, memória | em andamento — `pi-subagents` instalado e medido (+1.880 tok); memória integrada ao PI e medida (+48 tok/entrada); falta o veredito do `billion-context` |
| **2** | Núcleo de auto-evolução | parcial — contrato, gerador de skill, gerador de CLI e sandbox prontos (171 testes) |
| **3** | Grafo de execução | parcial — modelo e executor prontos |
| **4** | Desktop Windows | não iniciada — base escolhida: **Pi-Harness** |
| **5** | Evolução contínua | não iniciada |

## 3. Arquitetura (8 camadas)

| Camada | Módulo | Origem | Estado |
|:---|:---|:---|:---|
| 0. Base | PI Coding Agent 1.5.2 | upstream, sem fork | ✓ |
| 1. Essenciais | `pi-mcp-adapter`, `pi-web-access`, `billion-context` | comunidade | parcial — só `pi-subagents` instalado |
| 2. Roteador | `core/router/` | **autoral** | ✓ 26 testes |
| 3. Orquestração | `pi-subagents` 0.88.1 | comunidade | ✓ instalado no projeto |
| 4. Núcleo Evolutivo | `core/forge/` + `core/sandbox/` | **autoral** | parcial |
| 5. Evals | `evals/` + ledger JSONL | **autoral** | ✓ 14 tarefas, gate aprovado |
| 6. Memória | `core/memory/` + `.pi/harness/` | **autoral** | ✓ implementada, ✗ não integrada |
| 7. Grafo/Desktop | `core/graph/` + Pi-Harness | autoral + comunidade | parcial |

## 4. Números que importam

| Métrica | Valor | Origem |
|:---|:---|:---|
| Cold start do PI | **405 ms** (mín 378, máx 456) | `scripts/measure-overhead.mjs` |
| Prompt do PI puro | **8.674 tokens** | idem |
| Prompt com `pi-subagents` | **10.554 tokens** | idem |
| Overhead do `pi-subagents` | **+1.880 tokens/turno** | idem (A4 mediu +1.808) |
| Evals | **14 tarefas, 42/42** | `node evals/gate.mjs` |
| Testes unitários | **171** em 7 arquivos | `node --test` |
| Memória injetada | **~48 tokens** por entrada | medição em sessão real |
| Providers ativos | **4** (`kilo1`–`kilo4`), 20 modelos | `scripts/check-providers.mjs` |
| Custo por tarefa (grupo D) | US$ 0,00 (free tier) | ledger |

**Meta do plano:** prompt incremental do SelfEvoPI < 1.500 tokens — ainda não medida porque não há extensão própria.

## 5. Decisões fechadas (com o porquê)

1. **Sem fork do PI.** Tudo via extensões, skills e `.pi/harness/`.
2. **Família `or` desativada.** OpenRouter free tier = 50 req/dia; ao esgotar responde **exit 0, corpo vazio, zero token**. `DISABLED_FAMILIES = ["or"]` em `router.mjs`. Reativar é remover da lista.
3. **`pi-subagents` venceu o bake-off.** Medição reverteu a análise estática (que apontava `@arhen`). Custo por turno fala mais alto.
4. **Memória com decaimento.** Sem poda, memória vira ruído (lição do Unharnessed).
5. **Desktop: Pi-Harness.** Roda em Windows x64, cobre Fases 3 e 4, já traz checkpoints e worktrees. `pi-native-app` virou cliente web (0.2.2).
6. **Unharnessed: aproveitar ideias, não o benchmark.** O site mostra "Placeholder data" no gráfico — 47/66 é afirmação não verificada.
7. **Sandbox em 3 camadas.** Gate estático → Node Permission Model → Job Objects. Nenhum isolado basta.

## 6. Armadilhas (não repetir)

1. **`pi` é shim `.cmd` no Windows.** `execFile` não executa. Rodar `dist/bundle/cli.js` com `node`.
2. **`--permission` não barra rede no Node 24.13.** `has("net")=false` e `fetch` retorna 200. Precisa de preload que sobrescreva `fetch`/`http`/`https`/`net`/`tls`/`dgram`.
3. **Sem `--approve`, o PI ignora pacotes locais.** Medição de overhead dá 8.674 (vazio) em vez de 10.554. Passar `--approve` em toda invocação.
4. **`icacls` com `%USERNAME%`.** Em processo de serviço vale `SYSTEM` e tranca o arquivo para o dono. Usar `whoami`.
5. **Worktree velho = "regressão" fantasma.** O gate do A2 acusou D1 67%→0% só porque o worktree estava 29 commits atrás. Sincronizar antes de medir.
6. **PowerShell engole acentos** ao ler UTF-8 sem `-Encoding UTF8`. Usar `read` ou `Get-Content -Encoding UTF8`.

## 7. Equipe (8 subagentes Traycer)

| Agente | Provider | Lane | Área exclusiva |
|:---|:---|:---|:---|
| A1 | `kilo1` | fundação/coordenação | sou eu |
| A2 | `kilo2` | evals | `evals/gate.mjs`, `evals/baseline.json`, `docs/baseline-f0.md` |
| A3 | `kilo3` | roteador | `core/router/*`, `docs/fase0/router.md` |
| A4 | `kilo4` | bake-off | `scripts/bakeoff*.mjs`, `docs/bakeoff-orquestracao.md` |
| A5 | `or1` | forge | `core/forge/*`, `docs/fase2/forge.md` |
| A6 | `or2` | sandbox | `core/sandbox/*`, `docs/fase2/sandbox.md` |
| A7 | `or3` | memória | `core/memory/*`, `docs/fase2/memoria.md` |
| A8 | `or4` | grafo/desktop | `core/graph/*`, `docs/fase3/grafo-desktop.md` |

**Atenção:** A5–A8 estão em contas `or` (OpenRouter), que o roteador não usa — mas os agentes em si funcionam (são o harness do Traycer, não o SelfEvoPI). Se um deles falhar com rate limit, remanejar para uma conta `kilo` com `traycer_configure_agent`.

**Regra de trabalho:** nenhum código de subagente entra sem eu ler e rodar o comando de verificação. Já corrigi/completei trabalho deles várias vezes (teste faltante no A3, doc do A6, baseline do A2).

## 8. Comandos essenciais

```powershell
# qualidade
node --test core/router/*.test.mjs core/forge/*.test.mjs core/memory/*.test.mjs core/graph/*.test.mjs core/sandbox/*.test.mjs
node evals/run.mjs                 # suíte completa (grupos A/B/C/D)
node evals/gate.mjs                # regressão (3 execuções, sai 1 se cair)
node evals/report.mjs              # relatório do ledger

# infra
node scripts/check-providers.mjs   # 4 contas HTTP 200
node scripts/measure-overhead.mjs  # cold start + prompt
node scripts/checkpoint.mjs status|create <label>|restore <tag> --force|verify
node scripts/agents-status.mjs     # estado dos 8 worktrees
node scripts/verify-urls.mjs       # 33 URLs das fontes

# roteador
node core/router/cli.mjs --snapshot
node core/router/cli.mjs --profile orchestrator
```

## 9. Pendências imediatas

1. **Agentes em campo (1):** A2 testa `billion-context`. (A7 concluiu a integração da memória; A5 concluiu o gerador de CLI.)
2. **~~Integrar `core/memory/`~~** ✓ feito — `core/memory/extension.mjs`, 15 testes, carrega no PI real.
3. **Testar `billion-context`** — só manter se preservar acurácia.
4. **Medir o incremento do prompt** quando houver extensão própria (meta < 1.500 tokens). O incremento autoral atual é a memória: ~48 tokens por entrada.
5. **Fase 1 completa:** falta só o veredito da compressão.
6. **Fase 2:** ligar as peças do Forge (detecção → spec → geração → sandbox → gatekeeper → rollback) num loop único.
7. **Lacunas de design registradas:** (a) gate do A6 bloqueia `child-process` e o `verify.mjs` do A5 usa `spawnSync` — todo artefato gerado seria barrado pelo próprio sandbox; (b) linhas corrompidas de JSONL nunca saem do store.

## 10. Áreas protegidas

- `evals/` — suíte e verificadores. Loop evolutivo não edita.
- `core/governance/` — sandbox, permissões, git recovery.
- `scripts/verify-urls.mjs` — gate de fontes.

## 11. Estado do Git

- `main`: produção, só recebe merge aprovado.
- `dev`: integração.
- `agent/A1..A8`: branches dos subagentes, worktrees em `.worktrees/A1..A8`.
- Tags: `v0.0-research`, `ckpt/f0-baseline`, `ckpt/f0-overhead`.
- `last-known-good.json` aponta para o último estado verde.