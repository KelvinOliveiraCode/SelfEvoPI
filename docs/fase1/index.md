# Fase 1 — Extensões, memória e integração

> **Objetivo:** ter uma CLI utilizável com extensões escolhidas por medição, memória persistente e o orçamento de contexto sob controle.
> **Data:** 2026-11-15

## 1. O vencedor do bake-off

A4 mediu os três candidatos a orquestração em duas rodadas (estática e runtime). Resultado:

| Pacote | Versão | Overhead/turno | TTFT | Tools novas |
|:---|:---|:---|:---|:---|
| **pi-subagents** | 0.88.1 | **+1.808** | 7,1–9,3 s | 4 |
| pi-agent-orchestrator | 0.2.1 | +2.139 | 3,6–4,3 s | 7 |
| @arhen/pi-core-subagent | 1.4.3 | +2.852 | 3,8–4,1 s | 9 |

**Instalado:** `pi-subagents`.

A medição do A4 previa `@arhen` como vencedor (scheduler DAG em código). A medição real inverteu: o custo por turno fala mais alto que a elegância da arquitetura. Fica registrado que **medição vence análise estática**.

## 2. Instalação

```powershell
pi install npm:pi-subagents -l      # instala em .pi/npm/ + .pi/settings.json
pi list --approve                   # confere
```

O `-l` instala **no projeto**, não globalmente. O `.pi/settings.json` fica versionado; os `node_modules` do pacote ficam fora do Git (`.gitignore` cobre `node_modules/`).

### O detalhe que quase passou batido

Sem `--approve`, o PI **ignora** os pacotes locais do projeto. A primeira medição deu 8.674 tokens mesmo com o `pi-subagents` instalado — porque o harness rodava vazio.

Correção aplicada em `evals/lib/pi.mjs` e `scripts/measure-overhead.mjs`: toda invocação passa `--approve`. Sem isso, o overhead medido é ficção.

## 3. Custo real

| | Prompt |
|:---|:---|
| PI puro | 8.674 tokens |
| PI + pi-subagents | **10.554 tokens** |
| **Overhead** | **+1.880 tokens** |

Confere com a medição do A4 (+1.808) e com a do site do PI (as descrições das skills entram, os prompts não).

## 4. Memória

`core/memory/store.mjs` implementa os 3 níveis (session/project/skills) com JSONL append-only e `promote()`. `core/memory/refine.mjs` propõe deltas por regra (dedupe, drop, keep, merge-tags) e aplica os seguros.

**Falta ligar ao PI.** A memória existe e é testada (16 testes), mas ainda não é invocada pelo harness — é a próxima tarefa da fase.

## 5. Estado da fase

| Item | Estado |
|:---|:---|
| Bake-off com vencedor | ✓ |
| `pi-subagents` instalado no projeto | ✓ |
| Overhead medido | ✓ +1.880 tokens |
| Memória persistente | ✓ implementada, ✗ não integrada |
| Compressão (`billion-context`) | pendente — precisa de teste empírico |
| Gate com extensão ativa | ✓ 42/42 |

## 6. Pendências

- [ ] Integrar `core/memory/` ao ciclo do PI (handoffs e fatos de projeto).
- [ ] Testar `billion-context` contra os evals: só manter se preservar acurácia.
- [ ] Medir o incremento do prompt do SelfEvoPI (meta < 1.500 tokens) quando houver extensão própria.