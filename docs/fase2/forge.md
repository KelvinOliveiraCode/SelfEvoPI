# Forge — Núcleo Evolutivo (contrato de artefato)

O Forge é a Camada 4 do SelfEvoPI: o **Núcleo Evolutivo**. Ele permite ao loop
evolutivo **pedir, validar e promover** um artefato (uma capacidade nova) sem
que o modelo escreva código solto. O modelo mental vem de duas fontes em
`docs/research/inspiracoes.md`:

- **Octopus-SI-OS (§2.4)** — "capacidades são contratos", não add-ons. O sistema
  cresce em qualquer direção porque cada capacidade é um contrato explícito.
- **Voyager (§2.5)** — skill library executável indexada por descrição, só
  promovida após passar no verifier. É o "Registrar com Rollback Automático" da Fase 2.

Arquivo do contrato: `core/forge/contract.mjs` (sem dependências).
Testes: `core/forge/contract.test.mjs` (12 casos).

## O que é um artefato

Um artefato é um **contrato** que o loop evolutivo preenche e o Forge cumpre:

| Campo | Papel |
|:---|:---|
| `goal` | objetivo da capacidade (string, obrigatório) |
| `kind` | um de `ARTIFACT_KINDS` (obrigatório) |
| `inputs` / `outputs` | mapa `{ nome: descrição }` de entradas e saídas |
| `permissions` | o que o artefato **PODE** fazer |
| `forbidden` | o que o artefato **NÃO** pode fazer (obrigatório, não-vazio) |
| `tests` | casos `[{ name, command, expect? }]` — sem teste não há evidência |

## `ARTIFACT_KINDS` — do mais leve ao mais pesado

```
mcp-config  <  skill  <  cli  <  extension  <  mcp-server
```

`chooseKind(candidates)` recebe as capacidades necessárias e devolve o kind mais
**leve** que as atende. Regra de ouro: **prefira config/MCP existente antes de
criar servidor novo**. Comprovado no teste: `chooseKind(["mcp"])` → `mcp-config`,
nunca `mcp-server`.

## O loop de 7 etapas

Cada etapa tem um contrato JSON de entrada e saída, e sabe **o que recusa**.
Nesta fase (A5) só o contrato do artefato existe; as etapas 4–6 são módulos de
A6 / fase posterior — aqui estão mapeadas para o módulo concreto que as
implementará.

| # | Etapa | Módulo | Entrada | Saída | Recusa |
|:--|:---|:---|:---|:---|:---|
| 1 | **Detectar** | `core/gap/detector.mjs` (A1/A2) | `{ taskLog, stalled:boolean }` | `{ gaps: [{ symbol, why, evidence }] }` | tarefa sem stall / sem evidência de lacuna |
| 2 | **Especificar** | `core/forge/spec.mjs` | `{ gap }` | `ArtifactRequest` (via `createArtifactRequest`) | `kind` inválido, `forbidden` vazio, sem `tests` |
| 3 | **Hierarquia** | `core/forge/hierarchy.mjs` | `{ candidates: [cap] }` | `{ kind, covers, missing }` (via `chooseKind`) | capacidade que nenhum kind cobre (reporta `missing`) |
| 4 | **Gerar em Isolamento** | `core/forge/generator.mjs` (A6) | `ArtifactRequest` | `{ artifactId, kind, files }` | request inválido; geração fora da worktree |
| 5 | **Validar em Sandbox** | `core/sandbox/runner.mjs` (fase posterior) | `{ artifactId, tests }` | `{ tests: [{ name, passed }] }` | teste que não passa; acesso proibido |
| 6 | **Gatekeeper** | `core/forge/gatekeeper.mjs` (A6) | `{ request, result }` | `{ ok, reasons }` (via `validateArtifactResult`) | sem evidência, violação de `forbidden`, kind divergente |
| 7 | **Registrar** | `core/forge/registry.mjs` | `{ artifactId, request, result }` | `{ promoted:true, ref }` | gatekeeper não aprovou; rollback automático |

### Fluxo resumido

```
Detectar → Especificar → Hierarquia → Gerar em Isolamento → Validar em Sandbox → Gatekeeper → Registrar
   gap       request      kind         artifact            tests            ok/reasons      promoted
```

O **Gatekeeper** é o coração do loop: ele não executa nada, apenas confere se o
resultado traz **evidência de teste** e se **as proibições foram respeitadas**.
Se `validateArtifactResult` devolver `ok:false`, a etapa 7 faz rollback e o
artefato não é promovido — exatamente o "só promovido após passar no verifier"
do Voyager.

## Contrato das funções exportadas

### `createArtifactRequest({ goal, kind, inputs, outputs, permissions, forbidden, tests })`

Valida e normaliza. **Recusa**: `goal` vazio, `kind` fora de `ARTIFACT_KINDS`,
`forbidden` vazio, `tests` vazio ou malformado, `inputs`/`outputs` que não sejam
mapa string→string.

### `validateArtifactResult(result, request?)`

Confere evidência de teste e restrições. Devolve `{ ok, reasons }`. **Recusa**
(`ok:false`): resultado sem testes, teste com `passed !== true`, violação de
`forbidden` declarada em `result.violations` ou `result.permissionsUsed`, e kind
divergente do pedido.

### `chooseKind(candidates)`

Escolhe o kind mais leve que atende. Devolve `{ kind, covers, missing, ranked }`.
**Recusa**: capacidade que nenhum kind cobre → reportada em `missing` (não
lança erro, para que a etapa de Hierarquia trate a lacuna).

## Gerando uma skill

A etapa "Gerar em Isolamento" tem sua primeira peça executável: `generateSkill`
em `core/forge/generate-skill.mjs`. Ela transforma um pedido de kind `"skill"`
em arquivos reais, sem tocar em nada fora do diretório de saída.

### Fluxo: contrato → arquivo → verificação

```
createArtifactRequest          generateSkill               verify.mjs
   { goal, kind:"skill",   →   SKILL.md  (frontmatter +     node verify.mjs
     inputs, outputs,           objetivo, entradas,          │
     forbidden, tests }         saídas, proibições)          ├─ PASS smoke
                                verify.mjs (autocontido)  ──┤
                                 testes embutidos            └─ exit 0 só se todos passam
```

1. **Contrato** — `createArtifactRequest` valida o pedido (kind, `forbidden`
   não-vazio, `tests` não-vazio). Só um request válido chega ao gerador.
2. **Arquivo** — `generateSkill(request, outDir)` escreve:
   - `SKILL.md`: frontmatter `name` (slug do `goal`) e `description`, com o
     objetivo, as entradas, as saídas e a seção "O que NÃO pode fazer"
     (de `request.forbidden`).
   - `verify.mjs`: script autocontido que roda cada `command` de `request.tests`
     e sai 0 **somente** se todos passarem. Este é o gerador de evidência que
     o Gatekeeper (`validateArtifactResult`) vai exigir.
3. **Verificação** — o chamador executa `node verify.mjs`. Saída 0 = evidência
   de que a skill cumpre o contrato; saída ≠ 0 = reprova e o artefato não é
   promovido.

### Exemplo de SKILL.md gerado

Pedido: `{ goal: "detectar mudancas de arquivos", kind: "skill", inputs: { path: "arquivo a observar" }, outputs: { changed: "true se mudou" }, forbidden: ["acessar rede"], tests: [{ name: "smoke", command: 'node -e "process.exit(0)"' }] }`

```markdown
---
name: detectar-mudancas-de-arquivos
description: detectar mudancas de arquivos
---

# detectar mudancas de arquivos

## Objetivo

detectar mudancas de arquivos

## Entradas

- `path` — arquivo a observar

## Saídas

- `changed` — true se mudou

## O que NÃO pode fazer

- acessar rede

## Verificação

Execute `node verify.mjs`. Ele sai 0 somente se todos os testes passarem:

- `smoke` — `node -e "process.exit(0)"`
```

### Garantias

- **Recusa** `kind` diferente de `"skill"`.
- **Recusa** sobrescrever um `SKILL.md` já existente no `outDir`.
- Não gera código arbitrário: o `verify.mjs` só contém os comandos de teste
  declarados no próprio contrato (nada de rede, nada fora do escopo).
- Testes: `core/forge/generate-skill.test.mjs` (6 casos), incluindo a execução
  real do `verify.mjs` gerado (passa quando os testes passam, reprova quando falham).

## Gerando um CLI

O nível 3 da hierarquia — script/CLI local, entre a skill e a extensão — tem sua
peça executável em `core/forge/generate-cli.mjs`. `generateCli(request, outDir)`
transforma um pedido de kind `"cli"` em um CLI Node de verdade.

### Fluxo: contrato → arquivo → execução

```
createArtifactRequest            generateCli                 cli.mjs
  { goal, kind:"cli",       →    cli.mjs    (shebang,        node cli.mjs --path x
    inputs, outputs,             flags --<entrada>,         → {"ok":true,...}  (1 linha)
    forbidden, tests }           JSON de saída)                │
                                 README.md (uso)               ├─ faltando arg → exit 2
                                 verify.mjs (autocontido)  ──┤
                                 testes embutidos              └─ exit 0 só se todos passam
```

1. **Contrato** — `createArtifactRequest` valida (kind, `forbidden` não-vazio,
   `tests` não-vazio). Só um request válido chega ao gerador.
2. **Arquivo** — `generateCli(request, outDir)` escreve:
   - `cli.mjs`: shebang, expõe cada entrada de `request.inputs` como flag
     `--<nome> <valor>`, valida as obrigatórias, imprime **JSON compacto numa
     linha** conforme `request.outputs`, usa `process.exitCode` (não
     `process.exit`) e **sai 2** se faltar argumento obrigatório.
   - `README.md`: uso e exemplos curtos.
   - `verify.mjs`: autocontido, roda `request.tests` e sai 0 só se todos passarem.
3. **Execução** — o chamador roda `node cli.mjs ...` e `node verify.mjs`. O
   `verify.mjs` é a evidência que o Gatekeeper (`validateArtifactResult`) exige.

### Exemplo de uso do CLI gerado

Pedido: `{ goal: "detectar mudancas de arquivos", kind: "cli", inputs: { path: "arquivo ou pasta a observar" }, outputs: { changed: "...", count: "..." }, forbidden: ["acessar rede"], tests: [...] }`

```bash
# com argumento (exit 0) — JSON compacto numa linha
$ node cli.mjs --path src/index.js
{"ok":true,"goal":"detectar mudancas de arquivos","inputs":{"path":"src/index.js"},"outputs":{"changed":null,"count":null}}

# sem argumento obrigatório (exit 2) — erro em JSON no stderr
$ node cli.mjs
{"ok":false,"error":"faltando argumentos obrigatorios: path"}

# verificação (exit 0)
$ node verify.mjs
PASS smoke  (node -e "process.exit(0)")
```

### Garantias

- **Recusa** `kind` diferente de `"cli"`.
- **Recusa** sobrescrever um `cli.mjs` já existente no `outDir`.
- O CLI gerado é honesto: valida entradas e devolve as saídas declaradas (com
  `null` quando não há cálculo) — não inventa lógica de negócio.
- `process.exitCode` em vez de `process.exit`: permite ao processo pai ler o
  stdout/stderr antes de o processo terminar.
- Testes: `core/forge/generate-cli.test.mjs` (7 casos), incluindo a execução
  real do CLI via `spawnSync` (JSON válido, exit 2 sem argumento) e do `verify.mjs`.

## O loop evolutivo (ponta a ponta)

O loop amarra as peças: **detecta** lacuna -> **escolhe** kind -> **gera** ->
**verifica** fora do sandbox -> **gate** -> **promove** ou **reverte**. É o
coração do SelfEvoPI (Fase 2) e vive em `core/forge/loop.mjs`.

### Módulos

| Módulo | Papel |
|:---|:---|
| `core/forge/detect.mjs` | `detectGaps({ ledger, threshold, maxGaps })` — lê a trilha JSONL real e devolve gaps |
| `core/forge/gatekeeper.mjs` | `runGate(...) -> GateReport` e `decidePromotion(report, { toleranceTokens })` |
| `core/forge/loop.mjs` | `createEvolutionLoop(deps)` — o ciclo, com tudo injetável |
| `core/forge/cli.mjs` | linha de frente: `detect`, `evolve`, `gate`, `status` |

### Gatilhos reais do `detect.mjs`

`GAP_KINDS = ["tool-failing", "tool-missing", "tool-fragile"]`:

- **tool-failing** — mesma `taskId` com ≥ `threshold` falhas (default 3) no ledger.
- **tool-missing** — `goal` que nenhuma capability existente cobre.
- **tool-fragile** — tarefa acima do teto de tokens, marcada como frágil
  (`metrics.fragile`), ou que usou screenshot onde caberia CLI.

O detector lê `ledger` (array ou caminho do JSONL). Linhas corrompidas são
ignoradas, não derrubam a detecção. Deduplica por `(kind, taskId)` e respeita
`maxGaps`.

### Regra de promoção do `gatekeeper.mjs`

`runGate` recebe `runEvals` **injetado** (assíncrono) — o módulo nunca chama
`evals/run.mjs` sozinho; quem injeta é o CLI. `decidePromotion` promove se:

1. a tarefa-alvo passou (todas as execuções), **E**
2. zero regressões vs baseline, **E**
3. `deltaTokens <= tolerância`.

Sem baseline, não há o que comparar: `deltaTokens = 0` e `regressed = false`.

### Ciclo do `loop.mjs`

`createEvolutionLoop(deps)` recebe todas as peças com defaults reais
(`detectGaps`, `chooseKind`, `generateCli`/`generateSkill`,
`runGate`, `decidePromotion`, `promote`, `rollback`, `runEvals`, `onEvent`).
`evolve(input)` faz:

1. **detecta** a lacuna (ou usa a recebida; filtra pela tarefa pedida);
2. **escolhe** o kind via `chooseKind` (recai para `cli` se o escolhido não tem gerador);
3. **monta** o request (`createArtifactRequest`) do gap;
4. **gera** em isolamento (mkdtemp);
5. **gate estático** (reusa `core/sandbox/static-gate.mjs`): rede/credencial/fora
   do workspace => `needs-human`;
6. **verifica fora do sandbox** (roda o `verify.mjs` gerado);
7. **gate de promoção**;
8. **promove** (aplica) ou **reverte** (rollback).

Paradas honestas: `needs-human` (pede rede/credencial/escrita fora do
workspace), `rejected` (gate reprova), `promoted` (passou).

### CLI

```bash
node core/forge/cli.mjs detect [--json]
node core/forge/cli.mjs evolve --task D1-cria-soma [--dry-run] [--json]
node core/forge/cli.mjs gate --artifact <dir> --task <id>
node core/forge/cli.mjs status
```

`--json` imprime JSON compacto (uma linha); sem ele, texto curto. `--dry-run`
usa um stub de eval determinístico (não chama modelo real) e não promove.

### Testes

- `detect.test.mjs` — os três gatilhos, dedup, ledger corrompido.
- `gatekeeper.test.mjs` — aprovação, regressão, tolerância, runEvals injetado.
- `loop.test.mjs` — lacuna→artefato aprovado, reprovado por regressão (rollback),
  verify que falha, `needs-human`, dry-run.
- `cli.test.mjs` — detect/evolve/gate/status via subprocess, JSON e texto.

## Geradores dos cinco kinds

O `defaultGenerate` do loop agora despacha os cinco kinds reais. Antes só
`cli` e `skill` existiam, e o loop recaía para `cli` quando `chooseKind`
escolhia outro — uma "mentira educada". Agora cada kind tem seu gerador:

| Kind | Módulo | Artefato | verify.mjs confere |
|:---|:---|:---|:---|
| `mcp-config` | `generate-mcp-config.mjs` | `.mcp.json` (formato MCP do PI) | JSON válido + `mcpServers` com command/args/env |
| `skill` | `generate-skill.mjs` | `SKILL.md` | roda request.tests |
| `cli` | `generate-cli.mjs` | `cli.mjs` + README | roda request.tests |
| `extension` | `generate-extension.mjs` | `index.mjs` (`export default (pi) => …`) | importa com `pi` falso, confere `registerCommand` + handler |
| `mcp-server` | `generate-mcp-server.mjs` | `server.mjs` (JSON-RPC 2.0 stdio, só builtins) | sobe o server, manda initialize + tools/list |

### mcp-config (o mais leve)

`generateMcpConfig(request, outDir)` escreve um `.mcp.json` com `mcpServers`
contendo o nome do artefato, `command: "node"`, `args: ["server.mjs"]` e
`env: {}`. Recusa sobrescrever. O verify faz parse do JSON e confere as chaves.

### mcp-server

`generateMcpServer(request, outDir)` escreve `server.mjs` usando **apenas
builtins do Node** (sem `@modelcontextprotocol/sdk`): o artefato roda sem
`npm install`. Fala JSON-RPC 2.0 sobre stdio (`initialize`, `tools/list`,
`tools/call`). Cada entrada de `request.inputs` vira uma ferramenta; cada
saída de `request.outputs` é um campo do resultado. O verify sobe o servidor,
manda `initialize` + `tools/list` e confere que voltou JSON com a ferramenta.
O gerador roda `node --check` no `server.mjs` antes de escrever o resto.

### extension

`generateExtension(request, outDir)` escreve `index.mjs` no formato de
extensão do PI: `export default function (pi) { pi.registerCommand(...) }`.
Cada entrada vira uma flag; o handler responde JSON com as saídas. O verify
importa o módulo com um `pi` falso (mock com `on`, `registerCommand`,
`registerFlag`) e confere que o comando foi registrado e que o handler responde.

### Loop sem fallback silencioso

O loop não recai mais para `cli`. Se o gerador do kind escolhido não existir,
o loop retorna `outcome: "error"` com motivo explícito — nunca gera o
artefato errado. O kind pedido por `--kind` (ou `input.forceKind`) tem
prioridade sobre o `chooseKind`. O gate estático varre o arquivo-fonte primário
de cada kind (`.mcp.json`, `SKILL.md`, `cli.mjs`, `index.mjs`, `server.mjs`).

### Exemplos

```bash
node core/forge/cli.mjs evolve --goal "configurar um servidor MCP" --kind mcp-config --dry-run
node core/forge/cli.mjs evolve --goal "expor uma ferramenta de soma" --kind mcp-server --inputs "a,b" --outputs "soma" --dry-run
node core/forge/cli.mjs evolve --goal "registrar comando no PI" --kind extension --dry-run
```

## Auto-disparo (evolução sem operador)

O `cli.mjs evolve` só roda quando um humano chama. O `auto.mjs` fecha o
ciclo: o harness detecta a lacuna sozinho e, com `--auto`, executa o pipeline.
Vive em `core/forge/auto.mjs` e a linha de frente é o subcomando `auto`:

```bash
node core/forge/cli.mjs auto --once            # uma passada (default é dry-run)
node core/forge/cli.mjs auto --watch --interval 60   # repete a cada 60s, com backoff
node core/forge/cli.mjs auto --once --auto     # executa de verdade
node core/forge/cli.mjs auto --once --json     # saída de uma linha
```

### O padrão é dry-run

Sem `--auto`, `auto --once` apenas **IMPRIME o plano** (meta, kind, comando) e
não escreve nada, não promove nada, não toca em arquivo. O teste compara o hash
da árvore antes/depois: idêntico. `--auto` é obrigatório para agir.

### Mesmo com --auto, três travas

1. **Nunca promove sem o gate passar.** O `runAutoPass` delega ao loop, que só
   chama `promote` quando `decidePromotion` aprova; gate vermelho faz rollback.
2. **Toda ação auto-disparada vai ao ledger** com `origin: "auto"` (vs `"manual"`).
3. **Área protegida é recusada, não contornada.** Se a lacuna aponta para
   `evals/`, `core/governance/` ou `scripts/verify-urls.mjs`, a ação é
   pulada com mensagem (`PROTECTED_AREAS` em `auto.mjs`).

### Gatilho de lacuna

O gatilho é o `tool-failing` do `detect.mjs`: mesma `taskId` com ≥ `threshold`
falhas (default 3) no ledger. Ele não gera falso positivo porque exige **evidência
acumulada** (três execuções que falharam de verdade), não um palpite — ausência de
catálogo não é lacuna (`tool-missing` só dispara com evidência explícita no
registro).

### Tarefa de eval não é lacuna

Uma **tarefa de eval** (`evals/tasks/*.json`) mede o modelo/harness; ela não é uma
ferramenta que "falta". Se D1 falha 4 vezes, isso significa "o modelo errou o
benchmark", não "falta capacidade ao harness" — e o auto-disparo não deve perseguir
isso (geraria artefato para consertar uma medição e queimaria token).

Por isso o `runAutoPass` filtra `tool-failing` cujo `taskId` seja tarefa de eval:
a lacuna fica **visível no dry-run, marcada como ignorada e com o motivo**
(`· ignorado (tarefa de eval, mede o modelo não o harness): D1-cria-soma`). Ignorar
em silêncio seria pior que o falso positivo. O filtro é **só para `tool-failing`**:
`tool-missing` com erro "no such tool" pode indicar ferramenta realmente ausente e
não é filtrado. `--include-eval` desliga o filtro (para diagnóstico do detector cru).

No ledger real, isso reduz o auto a **zero lacuna acionável** (a única era D1, que
é medição) — o auto-disparo não queima token perseguindo benchmark.

## Contenção do artefato (o artefato nunca executa solto)

O auto-disparo remove o humano do caminho — e o humano era a contenção de último
resgate. Por isso o artefato gerado (código escrito por modelo) **nunca executa
solto**: a sonda de interface o roda **dentro do sandbox** do A6
(`core/sandbox/run-sandboxed.mjs`), com `workdir` = diretório temporário criado
por `mkdtemp`, nunca a raiz do projeto.

A arquitetura é preservada: o **verificador** (`verify.mjs`/`probe.mjs`) roda
fora; quem **invoca o artefato** é a sonda, via `runSandboxed` — com Node
Permission Model (fs restrito ao workdir, rede fechada pelo preload) e teardown de
árvore no timeout. O `defaultRunVerification` do loop roda o verificador sem
`shell` (o comando é gerado pelo loop, não entrada de usuário).

Três travas do gate (fail-closed):

1. **Varre todos os arquivos do artefato**, não só o primário. Se um arquivo
   secundário é perigoso, o artefato inteiro é bloqueado (needs-human).
2. **Se o gate lança, isso é bloqueio** (needs-human com o motivo), não "segue o
   jogo". O `catch` silencioso foi removido.
3. **Limpeza do diretório temporário ao fim** (inclusive em erro): após promote o
   artefato já foi copiado; após rollback/needs-human já foi removido.

Testes de contenção em `core/forge/sandbox-integration.test.mjs` (sandbox e gate
reais, sem fakes para o caminho de contenção):

- artefato que lê `~/.pi/settings.json` → bloqueado antes de executar;
- artefato que escreve fora do temp → bloqueado (Permission Model), não promove;
- `evaluateFile` lançando → needs-human, e não execução;
- artefato com dois arquivos, o secundário perigoso → bloqueado;
- caminho feliz ainda promove.

## Pendências

- [x] Detector de lacunas (`detect.mjs`) — os três gatilhos.
- [x] Gatekeeper (`gatekeeper.mjs`) — runGate + decidePromotion.
- [x] Loop ponta a ponta (`loop.mjs`) + CLI (`cli.mjs`).
- [x] Promoção real (`promote.mjs`): copia + commit atômico + `last-known-good`.
- [x] Geradores dos cinco kinds (`mcp-config`, `skill`, `cli`, `extension`, `mcp-server`).
- [x] Gerador com modelo (`generate-llm.mjs`) + testes de interface sintetizados.
- [x] Auto-disparo (`auto.mjs` + `cli.mjs auto`): dry-run por padrão, --auto com travas.
- [x] Filtro de tarefa de eval: falha de benchmark não vira lacuna de ferramenta.
- [x] Contenção do artefato: roda no sandbox (A6), gate fail-closed, temp limpo.
- [ ] Etapa 5 (sandbox Windows) — fase posterior, com Job Objects + `cc-safety-net`.
- [ ] Indexação semântica do registro (Voyager-style) na promoção.