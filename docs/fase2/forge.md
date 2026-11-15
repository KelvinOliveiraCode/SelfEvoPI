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

## Pendências

- [ ] Etapas 1 e 3 (detector de lacunas e hierarquia) — A1/A2.
- [ ] Etapas 6 e 7 (gatekeeper, registro) — A6.
- [ ] Geradores dos demais kinds (`cli`, `extension`, `mcp-server`) — A6.
- [ ] Etapa 5 (sandbox Windows) — fase posterior, com Job Objects + `cc-safety-net`.
- [ ] Indexação semântica do registro (Voyager-style) na promoção.