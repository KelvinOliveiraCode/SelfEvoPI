---
tags: [mapa, índice]
created: 2026-11-19
---

# Mapa do SelfEvoPI

> Porta de entrada. Navegue pelas notas abaixo.

## Índice

### Fundamentos
- [[01-Arquitetura/Visao-Geral]], camadas e fluxo do sistema
- [[05-Decisoes/Decisoes]], decisões com data e motivo
- [[05-Decisoes/Modos]], os 5 modos de permissão (plan/build/manual/ask/goal)

### Componentes (`core/` e `apps/`)
- [[02-Componentes/Agent]], harness (sessões, banner, inspect, MCP)
- [[02-Componentes/Roteador]], camada 2: escolhe provider + modelo
- [[02-Componentes/Forge]], auto-evolução: detecta lacunas, gera, promove
- [[02-Componentes/Governanca]], modos, aprovação, rollback
- [[02-Componentes/Sandbox]], gate estático + Permission Model
- [[02-Componentes/Memoria]], store em 3 níveis, teto de 400 tok/turno
- [[02-Componentes/Grafo]], executor de DAG com nós human e checkpoints
- [[02-Componentes/CLI]], interface de linha de comando (TUI)


### Comandos e uso
- [[03-Comandos/CLI]], comandos que o usuário digita (`/...`)
- [[04-Features/Features]], o que existe e como usar (inclui temas, subagentes, Ctrl+P, A2A)

### Evidência e origem
- [[08-Desempenho/Desempenho]], números medidos, com data e comando
- [[06-Pesquisa/Fontes]], fontes com URL e o que cada uma sustentou
- [[07-Inspiracoes/Inspiracoes]], Claude Code, OpenCode, Cursor, Zed, Warp

### Para agentes de código
- `AGENTS.md` (raiz), regras de ouro e índice operacional — leia primeiro
- `docs/agent-guides/`, guias por tipo de mudança: providers, ferramentas,
  comandos, idioma/verbosidade, integrações, invariantes e rollback
- `docs/agent-guides/registro.json`, o mesmo mapa em formato legível por máquina

### Reprodução e referência
- [[09-Replicacao/Replicacao]], como montar do zero, 1:1
- [[10-Glossario]], termos do projeto

### Estado e continuação
- [[11-Handoff/Estado-Atual]], retrato da v1.2.1: modelos e efforts, anexos de imagem, idioma, comandos de sessão, o que está pronto e o que falta

## Sobre

O SelfEvoPI é um harness de agente de código ultraleve, rápido, econômico em contexto e auto-evolutivo, construído sobre o PI Coding Agent sem fork.

- **Repositório privado:** SelfEvoPI-Priv
- **Repositório público:** SelfEvoPI (release limpa)
- **HEAD de referência das medições:** `ed939e6` (2026-11-20); medições antigas em `ee74ed9` (2026-11-18)
- **Fases:** P, 0, 1, 2, 3, 4, 5, todas concluídas