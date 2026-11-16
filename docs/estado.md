# SelfEvoPI — estado do projeto

> **Atualizado:** 2026-11-16 · **HEAD:** `80f41d4` em `main` e `dev`
> **Repositório:** `KelvinOliveiraCode/SelfEvoPI` (privado)
> **Verificação:** todos os comandos abaixo foram executados nesta data.

---

## 1. O que é

Um harness de agente de código **ultraleve, rápido, econômico em contexto** e
**auto-evolutivo**, construído **sobre** o PI Coding Agent (`earendil-works/pi`)
— sem fork. Acrescenta roteador multi-provider, suíte de evals determinística,
gatekeeper, memória persistente, sandbox Windows nativo e um núcleo que detecta
lacunas, gera artefatos e só promove o que não causa regressão.

---

## 2. Fases

| Fase | Nome | Estado |
|:---|:---|:---|
| **P** | Pesquisa e auditoria | ✓ concluída (`v0.0-research`) |
| **0** | Fundação Windows, Git, providers, evals | ✓ concluída (`v0.1-foundation`) |
| **1** | CLI, bake-off, memória | ✓ concluída (`v0.2-cli`) |
| **2** | Núcleo de auto-evolução | ✓ concluída (`v0.3-self-evo`) |
| **3** | Grafo de execução | ✓ concluída (`v0.4-graph`) |
| **4** | Desktop Windows | ✓ decisão tomada, integração entregue (`v0.5-desktop`) |
| **5** | Evolução contínua | ✓ rotina entregue |

---

## 3. Números (medidos, não estimados)

| Métrica | Valor | Meta | Comando |
|:---|:---|:---|:---|
| Cold start | **433 ms** (mín 399, máx 492) | < 500 ms | `node scripts/measure-overhead.mjs` |
| Prompt do PI puro | **8.684 tok** | — | idem |
| Incremento do SelfEvoPI | **+501 tok** (memória no teto) | < 1.500 tok | `node scripts/measure-selfevopi-overhead.mjs` |
| `pi-subagents` (sob demanda) | +1.654 tok | — | idem |
| Evals | **26 tarefas, 78/78 (100%)** | sem regressão | `node evals/gate.mjs` |
| Tokens da suíte | **117.758** (4 tarefas com modelo) | — | idem |
| Testes unitários | **280** | — | `node --test core/*/*.test.mjs` |
| Custo | US$ 0,00 (free tier) | — | ledger |

---

## 4. O que cada fase entregou

### Fase 1 — CLI, bake-off, memória
- `pi-subagents` venceu o bake-off por custo, mas a medição mostrou **+1.654 tok/turno
  sem ganho de acurácia**. Decisão: **sob demanda**, não no prompt padrão.
- `billion-context` descartado (18.268 → 32.196 tok, latência +15% a +83%, acurácia igual).
- Memória em 3 níveis (`session`/`project`/`skills`), com teto de 400 tok/turno e poda
  de linhas corrompidas por condição.

### Fase 2 — Núcleo de auto-evolução
- `core/forge/contract.mjs` — contrato de artefato (5 kinds, do mais leve ao mais pesado).
- `core/forge/detect.mjs` — detecta lacunas com **evidência** (falha repetida, capacidade
  ausente, fluxo frágil). Sem evidência não afirma nada.
- `core/forge/generate-llm.mjs` — gera **código real** a partir do contrato, com
  `node --check` antes de escrever e erros tipados.
- `core/forge/generate-cli.mjs` / `generate-skill.mjs` — geradores de esqueleto (fallback).
- `core/forge/gatekeeper.mjs` — decide promoção (tarefa-alvo + zero regressão + delta de tokens).
- `core/forge/promote.mjs` — efetiva: copia, commit atômico, `last-known-good` só com verify.
- `core/forge/loop.mjs` — o ciclo completo, com peças injetáveis e paradas honestas.
- `core/forge/cli.mjs` — `detect` / `evolve` / `gate` / `status`.
- `core/governance/rollback.mjs` — rollback verificado (reverte e só confira se passar).
- `core/governance/approval.mjs` — pausa humana para rede, credencial ou escrita externa.
- `core/sandbox/` — gate estático + Node Permission Model + Job Objects.

### Fase 3 — Grafo de execução
- `core/graph/model.mjs` — grafo, validação, ordem topológica.
- `core/graph/executor.mjs` — executor com timeout e gate humano.
- `core/graph/runtime.mjs` — checkpoint por nó, pausa cooperativa, retomada sem re-rodar.
- `core/graph/panel.mjs` — painel ASCII e HTML autocontido do grafo em tempo real.

### Fase 4 — Desktop
- Verificação primária: **Pi-Harness** (wangmiaozero, v2.4.8) é o desktop que a fase pede.
- Descoberta de supply-chain: o pacote npm `pi-harness` **não é** o desktop (é um servidor
  headless). Fixar sempre `github.com/wangmiaozero/pi-harness`.
- Sobra para nós: a ponte entre `core/graph` e `.pi/harness/`. Não o `.exe`.

### Fase 5 — Evolução contínua
- `scripts/refine-loop.mjs` — dry-run por padrão; com `--apply`, re-roda o gate e **desfaz**
  o delta se regredir.
- `scripts/weekly-report.mjs` — taxa de sucesso, tokens/tarefa, latência, lacunas, reversões.

---

## 5. Prova ponta a ponta

```
$ node core/forge/cli.mjs evolve \
    --goal "calcular o IMC a partir de peso e altura" \
    --kind cli --inputs "peso,altura" --outputs "imc,classificacao" --llm

outcome: promoted
kind: cli
verify: pass (exit 0)
artefato: .pi/harness/artifacts/calcular-o-imc-.../cli.mjs

$ node .pi/harness/artifacts/calcular-o-imc-.../cli.mjs --peso 70 --altura 1.75
{"imc":22.86,"classificacao":"Peso normal"}
```

O ciclo: lacuna → contrato → código do modelo → `node --check` → teste de interface →
gate → commit atômico → `last-known-good`.

**E o caminho do rollback, provado com um caso real:** a primeira promoção gerou um CLI
que lia argumentos posicionais em vez de `--flag`. O teste de interface (que eu acrescentei
depois) passou a pegar isso, e o artefato com bug foi desfeito por
`core/governance/rollback.mjs` — commit `7bc8a09`, artefato removido, artefato bom intacto.

---

## 6. Decisões que carregam o projeto

1. **Sem fork do PI.** Tudo via extensões, skills, config e `.pi/harness/`.
2. **Família `or` desativada.** OpenRouter free tier responde exit 0 com corpo vazio ao
   esgotar a cota — falha silenciosa. Gatilho de reavaliação escrito em `docs/fase1/decisoes.md`.
3. **Orçamento de prompt é requisito, não aspiração.** 1.654 tok de `pi-subagents` sozinhos
   estouravam os 1.500. A extensão saiu do prompt padrão e passou a carregar sob demanda.
4. **`verify.mjs` roda fora do sandbox; o artefato que ele invoca roda dentro.** Exceção no
   gate criaria um buraco explorável por renomeação.
5. **Evidência fraca é pior que evidência nenhuma.** Um "smoke test" que sempre passa
   promoveu um artefato com a interface errada. Testes sintetizados de interface substituíram
   o smoke test.
6. **Detector não inventa lacuna.** Sem catálogo ou marcador explícito, `tool-missing` não
   dispara. Antes, 14 das 17 lacunas eram falsos positivos.

---

## 7. Como verificar

```powershell
node --test core/router/*.test.mjs core/forge/*.test.mjs core/memory/*.test.mjs core/graph/*.test.mjs core/governance/*.test.mjs core/sandbox/*.test.mjs scripts/refine-loop.test.mjs
node evals/gate.mjs
node scripts/measure-overhead.mjs --runs 10
node scripts/measure-selfevopi-overhead.mjs --runs 3
node core/forge/cli.mjs detect --json
node core/forge/cli.mjs status
```

---

## 8. O que ficou honestamente por fazer

| Item | Por quê |
|:---|:---|
| Geradores de `extension`, `mcp-server`, `mcp-config` | o loop recai para `cli`/`skill`; só existem geradores para esses dois |
| Indexação semântica de skills (Voyager) | a promoção grava o artefato e o commit, mas não recupera por descrição |
| Ponte `core/graph` ↔ Pi-Harness | a decisão de adotar o Pi-Harness está tomada; a integração fina não foi feita |
| Política de keep-alive do sandbox | definida, não implementada |
| Grupo B com lacunas reais | as tarefas B são verificações estruturais; não forçam criação de ferramenta |

Nada disso impede o ciclo de funcionar. São as peças que faltam para o loop ficar
autônomo de ponta a ponta sem operador.