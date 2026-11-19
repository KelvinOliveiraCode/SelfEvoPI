---
tags: [pesquisa, fontes]
created: 2026-11-19
---

# Pesquisa

> Fontes com URL e o que cada uma sustentou.

## CLI Landscape

### Claude Code (Anthropic)

- **URL:** https://code.claude.com/docs/en/cli-reference
- **O que sustentou:** 76+ comandos de barra, 5 permission modes, ~20 atalhos, paleta com filtro por prefixo.
- **Data:** 2026-11-17

### OpenCode

- **URL:** https://opencode.ai
- **O que sustentou:** skills em `~/.config/opencode/skills/<nome>/SKILL.md`, MCP em `~/.config/opencode/opencode.jsonc`.
- **Data:** 2026-11-17

### Cursor

- **URL:** https://cursor.com
- **O que sustentou:** referência de editor AI com codebase indexing.
- **Data:** 2026-11-17

### Zed

- **URL:** https://zed.dev
- **O que sustentou:** referência de performance (Rust, GPU).
- **Data:** 2026-11-17

### Warp

- **URL:** https://warp.dev
- **O que sustentou:** referência de terminal AI com blocks.
- **Data:** 2026-11-17

## Desktop

### Pi-Harness (wangmiaozero)

- **URL:** https://github.com/wangmiaozero/pi-harness
- **O que sustentou:** desktop base (Windows x64, checkpoints, worktrees, Task DAG). v2.4.8 (2026-11-14).
- **Data:** 2026-11-16

### Pi Agent Desktop

- **URL:** https://pi-desktop.app
- **O que sustentou:** fallback (Job Objects, Herdr v0.8.2). Beta não assinado.
- **Data:** 2026-11-16

### @shying/pi-graph

- **URL:** https://registry.npmjs.org/@shying/pi-graph
- **O que sustentou:** executor durável (nó human, resume, checkpoints). v0.2.0.
- **Data:** 2026-11-16

## Governança

### Modos de permissão

- **URL:** docs/research/cli-landscape/modos.md (interno)
- **O que sustentou:** critério de que um modo só existe se mudar ler/escrever/executar/quando-pergunta.
- **Data:** 2026-11-15

## Segurança

### Supply-chain

- **URL:** docs/fase4-desktop.md (interno)
- **O que sustentou:** `pi-harness` npm ≠ desktop (é headless). Fixar `github.com/wangmiaozero/pi-harness`.
- **Data:** 2026-11-16

Ver [[00-Mapa]] para navegar por toda a vault.
