# Mapa e dono — onde cada coisa vive

Regra: **um conceito, um dono**. Se você procurar o mesmo conceito em dois
lugares, um deles está errado e vai divergir.

## Camadas

| Pasta | Dono de | Não faz |
|:--|:--|:--|
| `apps/cli.mjs` | REPL, paleta, comandos de barra, renderização ANSI, overlays | não fala o protocolo do motor direto |
| `core/agent/pi-rpc.mjs` | cliente RPC, normalização de eventos (`text`, `tool`, `settled`, `error`) | não decide interface |
| `core/agent/` | sessões, i18n, verbosidade, temas, anexos, metadados de modelo, MCP, skills, subagentes | não implementa evals nem governança |
| `core/router/` | escolha de provider, retry, circuit breaker, teto de tokens | não conhece a TUI |
| `core/forge/` | ciclo detect → specify → generate → verify → gate → promote | não edita áreas protegidas |
| `core/memory/` | memória em 3 níveis e poda por evidência | não é o ledger de evals |
| `core/graph/` | grafo, ordem topológica, checkpoint, pausa/retomada | não é interface |
| `core/sandbox/` | gate estático, Permission Model, contenção de processo | não decide permissão humana |
| `core/governance/` | modos, aprovação, rollback verificado | **protegido: ninguém edita** |
| `evals/` | tarefas, checkers, baseline, gate | **protegido: ninguém edita** |
| `scripts/` | importação, medições, rotinas, verificação de modelos | nada de interface |
| `docs/` | documentação, pesquisa, design e guias | não é código |

## Arquivos de fonte única

| Conceito | Fonte única | Quem consome |
|:--|:--|:--|
| Comandos de barra | `COMMANDS` em `apps/cli.mjs` | `/help`, paleta, testes |
| Textos da interface | dicionários em `core/agent/i18n.mjs` | CLI, `settings-view.mjs` |
| Níveis de feedback | `core/agent/verbosity.mjs` | spinner, ferramentas, raciocínio |
| Modelos e efforts | `~/.pi/agent/models.json` (fora do repo) | `model-metadata.mjs`, roteador, CLI |
| Exemplo versionado de provider | `config/providers.example.json` | importador, documentação |
| Capacidades do Forge | `ARTIFACT_KINDS` em `core/forge/contract.mjs` | geradores, sonda, gate |
| Gate de regressão | `evals/baseline.json` + `evals/checks/` | `node evals/gate.mjs` |
| Areas protegidas | `PROTECTED_AREAS` em `core/forge/auto.mjs` | loop autônomo |

## Rotas de dados

```
Prompt do usuário
  → apps/cli.mjs (parseInput / runSlash / converse)
  → core/agent/pi-rpc.mjs (RPC para o motor)
  → eventos: text | tool | settled | error
  → apps/cli.mjs (renderMarkdown, ⏺, ⎿, ⤷, spinner)

Lacuna detectada
  → core/forge/detect.mjs (evidência no ledger)
  → specify.mjs → generate-*.mjs → probe.mjs → gatekeeper.mjs
  → promote.mjs (commit + memória + LKG)  |  core/governance/rollback.mjs

Config da máquina
  → ~/.pi/agent/models.json  → model-metadata.mjs → /model, /effort
  → ~/.pi/settings.json      → mcp.mjs, mcp-probe.mjs → /mcp, /plugins
  → ~/.pi/skills/            → skills-user.mjs → /skills
```

## Como achar o dono de uma função

```powershell
# quem exporta / quem chama
Select-String -Path core\agent\*.mjs -Pattern 'export function NOME|export async function NOME'
Get-ChildItem apps,core -Recurse -Filter *.mjs | Select-String -Pattern 'NOME\('
```

Se a função aparece em mais de um dono, pare e pergunte antes de editar.
