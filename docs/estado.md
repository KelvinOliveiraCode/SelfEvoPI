# SelfEvoPI — estado do projeto

> **Atualizado:** 2026-11-17 · **HEAD:** `f40f425` em `main` e `dev`
> **Repositório:** `SelfEvoPI` (privado)
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
| Cold start | **443 ms** (mín 383, máx 611, mediana) | < 500 ms | `node scripts/measure-overhead.mjs --runs 5` |
| Prompt do PI puro | **8.680 tok** | — | idem |
| Incremento do SelfEvoPI | **+506 tok** (memória no teto) | < 1.500 tok | `node scripts/measure-selfevopi-overhead.mjs --runs 3` |
| `pi-subagents` (sob demanda) | +1.654 tok | — | idem |
| Evals | **29 tarefas, 87/87 (100%)** | sem regressão | `node evals/gate.mjs` |
| Tokens da suíte | **~210.600** (5 tarefas com modelo) | — | idem |
| Testes unitários | **371** | — | `npm test` |
| Custo | US$ 0,00 (free tier) | — | ledger |
| Verificação de um comando | **exit 0** | — | `npm run verify` |
| Agendamento diário | **SelfEvoPI-Daily** (07:00, Windows Task Scheduler) | — | `node scripts/schedule.mjs --status` |

## 4. Os cinco kinds, todos com gerador real

O loop não recai mais para `cli` quando o kind escolhido é outro — cada um tem
seu gerador, e o código de `cli`, `mcp-server` e `extension` é escrito **pelo modelo**:

| Kind | Arquivo | Quem gera | Como é testado |
|:---|:---|:---|:---|
| `mcp-config` | `.mcp.json` | template | JSON válido + chaves |
| `skill` | `SKILL.md` | template | existe e descreve a capacidade |
| `cli` | `cli.mjs` | **modelo** | sonda com flags |
| `mcp-server` | `server.mjs` | **modelo** | sonda JSON-RPC 2.0 sobre stdio |
| `extension` | `index.mjs` | **modelo** | sonda importa com `pi` falso |

A **sonda** (`core/forge/probe.mjs`) é o que torna o teste honesto: ela exercita o
artefato do jeito que ele é chamado, não do jeito que um CLI é chamado. Um servidor
stdio não recebe flags; uma extensão não se executa pela linha de comando.

---

## 5. O que cada fase entregou

### Fase 1 — CLI, bake-off, memória
- `pi-subagents` venceu o bake-off por custo, mas a medição mostrou **+1.654 tok/turno
  sem ganho de acurácia**. Decisão: **sob demanda**, não no prompt padrão.
- `billion-context` descartado (18.268 → 32.196 tok, latência +15% a +83%, acurácia igual).
- Memória em 3 níveis (`session`/`project`/`skills`), com teto de 400 tok/turno e poda
  de linhas corrompidas por condição.

### Fase 2 — Núcleo de auto-evolução
- `core/forge/contract.mjs` — contrato de artefato (5 kinds, do mais leve ao mais pesado).
- `core/forge/detect.mjs` — detecta lacunas com **evidência** (falha repetida, capacidade
  ausente, fluxo frágil). Sem evidência não afirma nada: 14 falsos positivos eliminados.
- `core/forge/specify.mjs` — **SpecWriter** (passo 2 do plano, que faltava): transforma a
  lacuna em contrato. Usa o modelo e cai para o artefato sempre produzível se ele falhar.
- `core/forge/generate-llm.mjs` — gera **código real** para `cli`, `mcp-server` e `extension`,
  com `node --check` antes de escrever e erros tipados.
- `core/forge/generate-*.mjs` — geradores de template (referência e fallback), um por kind.
- `core/forge/probe.mjs` — a sonda de interface por kind.
- `core/forge/gatekeeper.mjs` — decide promoção (tarefa-alvo + zero regressão + delta de tokens).
- `core/forge/promote.mjs` — efetiva: copia, commit atômico, `last-known-good` só com verify,
  e **registra o artefato na memória** (senão ele existe e ninguém o encontra).
- `core/forge/loop.mjs` — o ciclo completo, com peças injetáveis e paradas honestas.
- `core/forge/cli.mjs` — `detect` / `evolve` / `gate` / `status`.
- `core/governance/rollback.mjs` — rollback verificado (reverte e só confira se passar).
- `core/governance/approval.mjs` — pausa humana para rede, credencial ou escrita externa.
- `core/sandbox/` — gate estático + Node Permission Model + Job Objects.

### Fase 3 — Grafo de execução
- `core/graph/model.mjs` — grafo, validação, ordem topológica.
- `core/graph/executor.mjs` — executor com timeout, gate humano e pausa cooperativa.
- `core/graph/runtime.mjs` — checkpoint por nó, pausa e retomada sem re-rodar.
- `core/graph/harness-state.mjs` + `harness-store.mjs` — a **ponte** git-nativa para o desktop.
- `core/graph/panel.mjs` — painel ASCII e HTML autocontido, lendo o `index.json` das execuções.

### Fase 4 — Desktop
- Verificação primária: **Pi-Harness** (wangmiaozero, v2.4.8) é o desktop que a fase pede.
- Descoberta de supply-chain: o pacote npm `pi-harness` **não é** o desktop (é um servidor
  headless). Fixar sempre `github.com/wangmiaozero/pi-harness`.
- Sobra para nós: a ponte entre `core/graph` e `.pi/harness/`. Não o `.exe` — e ela está
  entregue (`docs/fase4-ponte.md`): formato do `harness-state`, o que um desktop precisa
  ler, e por que ele é git-nativo.

### Fase 5 — Evolução contínua
- `scripts/refine-loop.mjs` — dry-run por padrão; com `--apply`, re-roda o gate e **desfaz**
  o delta se regredir.
- `scripts/weekly-report.mjs` — taxa de sucesso, tokens/tarefa, latência, lacunas, reversões.
- `scripts/daily.mjs` — a rotina que faltava: diagnóstico → apply (com autogate) → relatório.
  Não roda o gate quando não há nada a aplicar (era 73 s para não fazer nada).

---

## 6. Meta-auditoria dos verificadores

Uma suíte de 29 tarefas com 87/87 só vale se cada verificador **separe** uma resposta
boa de uma ruim. A meta-auditoria (2026-11-16) atacou cada tarefa com uma **resposta
degenerada**: um `cli.mjs` que imprime a saída esperada sem calcular nada.

**7 buracos encontrados, 7 corrigidos.** Todos eram a mesma classe — *lookup table*:
o artefato podia devolver a constante esperada em vez de resolver o problema.

| Tarefa | Buraco | Correção |
|:---|:---|:---|
| B9-csv-cli | `cli.mjs` por nome de arquivo | `surpresa.csv` gerado em tempo de execução |
| B10-schema-cli | lookup por nome | `surpresa_valido/faixa/tipo` |
| B11-html-extract | lookup por nome | `surpresa.html` |
| D1-cria-soma | lookup dos 6 pares | pares surpresa `[7,8] [-3,10] [100,250] [0.5,0.25]` |
| D2-corrige-contador | lookup dos 5 | `[100] [-10] [999]` |
| D3-cria-csv | lookup das 3 strings | entrada surpresa |
| D4-refatora-preservando | lookup dos 6 | `[Texto Qualquer] [São Paulo] [C++ & C#]` |

As 22 tarefas restantes **separam**: importam o código real do harness e afirmam
comportamento — um stub ou um `replace` falharia.

Nenhum buraco grande ficou para trás: os sete eram de "confundir presença com
comportamento", e a correção foi adicionar entrada imprevisível, sem enfraquecer nada.

## 7. Prova ponta a ponta

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

O ciclo: lacuna → contrato (SpecWriter) → código do modelo → `node --check` → sonda de
interface → gate → commit atômico → `last-known-good` → registro na memória.

**E o caminho do rollback, provado com um caso real:** a primeira promoção gerou um CLI
que lia argumentos posicionais em vez de `--flag`. A sonda de interface (que eu acrescentei
depois) passou a pegar isso, e o artefato com bug foi desfeito por
`core/governance/rollback.mjs` — commit `7bc8a09`, artefato removido, artefato bom intacto.

**E o gate me pegou:** quando mudei o comportamento do `chooseKind` (recaída para `skill`
quando nenhuma capacidade casa), o gate reprovou `A8-forge-choose-kind` na hora. Era uma
mudança de comportamento real, não um flake — atualizei o verificador com a justificativa
no próprio arquivo e regerei a baseline. É o gate fazendo o que ele existe para fazer.

---

## 8. Decisões que carregam o projeto

1. **Sem fork do PI.** Tudo via extensões, skills, config e `.pi/harness/`.
2. **Família `or` desativada.** OpenRouter free tier responde exit 0 com corpo vazio ao
   esgotar a cota — falha silenciosa. Gatilho de reavaliação escrito em `docs/fase1/decisoes.md`.
3. **Orçamento de prompt é requisito, não aspiração.** 1.654 tok de `pi-subagents` sozinhos
   estouravam os 1.500. A extensão saiu do prompt padrão e passou a carregar sob demanda.
4. **`verify.mjs` roda fora do sandbox; o artefato que ele invoca roda dentro.** Exceção no
   gate criaria um buraco explorável por renomeação.
5. **Evidência fraca é pior que evidência nenhuma.** Um "smoke test" que sempre passa
   promoveu um artefato com a interface errada. A sonda por kind (`probe.mjs`) substituiu
   o smoke test: cada artefato é exercitado do jeito que é chamado.
6. **Detector não inventa lacuna.** Sem catálogo ou marcador explícito, `tool-missing` não
   dispara. Antes, 14 das 17 lacunas eram falsos positivos.
7. **Kind sem gerador é erro, não recaída.** Quando `chooseKind` não casa nada, o artefato
   honesto é a `skill` (sempre produzível). Recair para `cli` gerava o artefato errado com
   cara de sucesso.

---

## 9. Como verificar

```powershell
npm test
node evals/gate.mjs
node scripts/measure-overhead.mjs --runs 10
node scripts/measure-selfevopi-overhead.mjs --runs 3
node core/forge/cli.mjs detect --json
node core/forge/cli.mjs skills <termo>
node core/forge/cli.mjs status
node scripts/daily.mjs --dry-run
```

No CI (`.github/workflows/ci.yml`) rodam os testes unitários e os evals dos grupos
A e C — os únicos que não precisam de chave de API. O gate completo fica local.

## 10. O que ficou honestamente por fazer

| Item | Por quê |
|:---|:---|
| Validar a ponte contra o Pi-Harness instalado | a ponte de estado está entregue e testada; falta o app real, que não está nesta máquina |
| Grupo B mistura structural e real | B9/B10/B11 chamam modelo (32.298 tok) e por isso o CI não roda o grupo B; B1–B8 seguem estruturais |
| Auto-disparo do loop evolutivo | o ciclo é autônomo dado um gatilho, mas nada o agenda; a rotina diária faz refine, não evolução |
| Agendamento da rotina diária | `scripts/schedule.mjs --install` registra `SelfEvoPI-Daily` no Task Scheduler (07:00 diário); requer sessão interativa |
| Recuperação de skills é lexical | busca por termo em texto e tags, sem embeddings — "semântica" exigiria vetores |
| Job Objects e keep-alive do sandbox | avaliados e descartados com número na mesa (ver `docs/fase2/sandbox.md`) |

Nada disso impede o ciclo de funcionar. São as peças que faltam para o loop ficar
autônomo de ponta a ponta sem operador.