---
tags: [componentes, forge, auto-evolução]
created: 2026-11-19
---

# Forge (Auto-evolução)

> Núcleo que detecta lacunas, gera artefatos e só promove sem regressão.

## Arquivos

| Arquivo | O que faz |
|:---|:---|
| `core/forge/contract.mjs` | Contrato de artefato (5 kinds) |
| `core/forge/detect.mjs` | Detecta lacunas com evidência |
| `core/forge/specify.mjs` | SpecWriter — transforma lacuna em contrato |
| `core/forge/generate-llm.mjs` | Gera código real para cli/mcp-server/extension |
| `core/forge/generate-*.mjs` | Geradores de template (fallback) |
| `core/forge/probe.mjs` | Sonda de interface por kind |
| `core/forge/gatekeeper.mjs` | Decide promoção |
| `core/forge/promote.mjs` | Efetiva: copia, commit, LKG, memória |
| `core/forge/loop.mjs` | Ciclo completo |
| `core/forge/cli.mjs` | detect / evolve / gate / status |

## Os 5 kinds

| Kind | Arquivo | Quem gera |
|:---|:---|:---|
| `mcp-config` | `.mcp.json` | template |
| `skill` | `SKILL.md` | template |
| `cli` | `cli.mjs` | **modelo** |
| `mcp-server` | `server.mjs` | **modelo** |
| `extension` | `index.mjs` | **modelo** |

## Fluxo

1. **Detecta** lacuna com evidência (falha repetida, capacidade ausente, fluxo frágil)
2. **Especifica** — SpecWriter transforma lacuna em contrato
3. **Gera** código (modelo ou template)
4. **Valida** — `node --check` + sonda de interface
5. **Decide** — gatekeeper avalia (tarefa-alvo + zero regressão + delta de tokens)
6. **Promove** — copia, commit atômico, LKG, registra na memória

Ver [[08-Desempenho/Desempenho]] para números medidos.