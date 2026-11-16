# SelfEvoPI

Harness de agente de código **ultraleve, rápido, econômico em contexto** e **auto-evolutivo**, construído **sobre** o [PI Coding Agent](https://github.com/earendil-works/pi) — sem fork.

A ideia em uma frase: o harness mede o próprio trabalho, e quando falta uma capacidade ele **cria** a capacidade, testa em sandbox e só promove o que não quebra nada.

## O que ele acrescenta ao PI

| Camada | O que é | Onde |
|:---|:---|:---|
| Roteador | perfis (`orchestrator`, `worker`, `reviewer`), circuit breaker, retry, teto de tokens | `core/router/` |
| Evals | 29 tarefas determinísticas com verificador próprio; gate de regressão | `evals/` |
| Núcleo evolutivo | detecta lacuna → especifica → gera → valida → promove ou reverte | `core/forge/` |
| Sandbox | gate estático + Node Permission Model + contenção de processo | `core/sandbox/` |
| Governança | rollback verificado e política de aprovação humana | `core/governance/` |
| Memória | 3 níveis, com busca por termo e poda por evidência | `core/memory/` |
| Grafo | execução paralela com checkpoint por nó e painel | `core/graph/` |

## Números medidos

| | |
|:---|:---|
| Cold start | **433 ms** |
| Prompt incremental do SelfEvoPI | **+501 tokens** (orçamento: 1.500) |
| Evals | **29 tarefas, 87/87** |
| Testes unitários | **341** |
| Custo | US$ 0,00 (modelos free tier) |

Medidos com `node scripts/measure-overhead.mjs` e `node scripts/measure-selfevopi-overhead.mjs`.

## Instalação

Requisitos: **Windows nativo** (sem Docker, VM ou WSL), Node ≥ 22.19.1, PI Coding Agent ≥ 1.5.2, Git ≥ 2.55 com `core.longpaths true`.

```powershell
git clone https://github.com/KelvinOliveiraCode/SelfEvoPI.git
cd SelfEvoPI
npm run verify                      # testes + evals A/C + URLs
```

## Uso diário

O jeito mais simples é o atalho **`SelfEvoPI.cmd`** na Área de Trabalho: um menu com
estado do harness, detecção de lacunas, evals, verificação completa, gate e o painel
gráfico (`SelfEvoPI-Painel.cmd`).

Sem atalho, pela linha de comando:

```powershell
node core/router/cli.mjs --profile worker        # qual modelo o roteador escolheria
node evals/run.mjs --group D                     # rodar só as tarefas de modelo
npm run gate                                     # comparar com a linha de base
node core/forge/cli.mjs detect --json            # quais lacunas o harness detectou
node core/forge/cli.mjs skills parser            # o que já foi gerado sobre "parser"
node core/forge/cli.mjs status                   # estado do harness
node scripts/desktop.mjs                         # painel local em 127.0.0.1:7777
```

## O ciclo evolutivo

É o coração do projeto. Dado um objetivo, ele:

1. **Detecta** a lacuna no ledger (falha repetida, capacidade ausente, fluxo frágil) — ou recebe o objetivo direto.
2. **Especifica** um contrato curto: entradas, saídas, proibições, testes.
3. **Gera** o artefato — código escrito pelo modelo, com `node --check` antes de ir para o disco.
4. **Valida** rodando o artefato do jeito que ele é chamado, em sandbox.
5. **Decide**: promove se passou e não houve regressão; caso contrário, reverte.
6. **Registra**: commit atômico, `last-known-good` e uma entrada na memória — para a próxima sessão saber que já existe.

```powershell
node core/forge/cli.mjs evolve `
  --goal "calcular o IMC a partir de peso e altura" `
  --kind cli --inputs "peso,altura" --outputs "imc,classificacao" --llm
```

Os cinco artefatos possíveis, do mais leve ao mais pesado: `mcp-config`, `skill`, `cli`, `extension`, `mcp-server`.

## Documentação

- [`docs/estado.md`](docs/estado.md) — **estado atual do projeto**: números, o que cada fase entregou, o que falta.
- [`docs/fase1/decisoes.md`](docs/fase1/decisoes.md) — decisões com evidência e gatilho de reavaliação.
- [`docs/fase2/forge.md`](docs/fase2/forge.md) — o núcleo evolutivo.
- [`docs/fase2/sandbox.md`](docs/fase2/sandbox.md) — as três camadas de isolamento e o que cada uma barra.
- [`docs/fase2/governanca.md`](docs/fase2/governanca.md) — rollback verificado e aprovação humana.
- [`docs/fase4-ponte.md`](docs/fase4-ponte.md) — a ponte de estado para o desktop.
- [`docs/research/inspiracoes.md`](docs/research/inspiracoes.md) — auditoria das fontes, 41 decisões, 10 correções ao plano.
- [`SelfEvoPI — Plano do Projeto.md`](SelfEvoPI%20—%20Plano%20do%20Projeto.md) — a especificação original.

## Verificação

```powershell
npm run verify                       # testes + evals A/C + gate de URLs (o mesmo do CI)
npm test                             # só os 371 testes unitários
npm run gate                         # gate completo (modelo real, lento)
```

No CI (`.github/workflows/ci.yml`) roda `npm run verify`: os grupos B e D chamam modelo
real e ficam de fora porque as chaves não vão para o repositório.

## Estrutura

```
core/router/       roteador multi-provider
core/forge/        núcleo evolutivo (contrato, detecção, geração, gate, loop)
core/sandbox/      isolamento de processo e gate estático
core/governance/   rollback verificado e aprovação humana
core/memory/       memória em 3 níveis com busca e poda
core/graph/        grafo de execução com checkpoint, ponte e painel
evals/             29 tarefas, verificadores e gate de regressão
scripts/            medições, desktop local, checkpoints e rotinas
.pi/harness/        estado persistente (memória, ledger, relatórios, artefatos)
docs/               decisões, estado e pesquisa
.github/workflows/  integração contínua
```

## Licença

A definir.