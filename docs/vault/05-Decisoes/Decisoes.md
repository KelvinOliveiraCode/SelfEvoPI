---
tags: [decisões]
created: 2026-11-19
---

# Decisões

> As decisões que carregam o projeto, com data e motivo.

## D1. Sem fork do PI (2026-11-15)

Tudo via extensões, skills, config e `.pi/harness/`. O PI é o motor; o SelfEvoPI é a camada ao redor.

## D2. Família `or` desativada (2026-11-15)

OpenRouter free tier responde exit 0 com corpo vazio ao esgotar a cota — falha silenciosa. `DISABLED_FAMILIES = ["or"]` em `core/router/router.mjs`. Gatilho de reavaliação em `docs/fase1/decisoes.md`.

## D3. Orçamento de prompt é requisito (2026-11-16)

1.659 tok de `pi-subagents` sozinhos estouravam os 1.500 (medido em 2026-11-17: `docs/medidas-2026-11-17.md`, `scripts/measure-selfevopi-overhead.mjs --runs 3`). A extensão saiu do prompt padrão e passou a carregar sob demanda. Ver [[08-Desempenho/Desempenho]].

## D4. `verify.mjs` roda fora do sandbox (2026-11-16)

O artefato que ele invoca roda dentro. Exceção no gate criaria um buraco explorável por renomeação.

## D5. Evidência fraca é pior que evidência nenhuma (2026-11-16)

Um "smoke test" que sempre passa promoveu um artefato com a interface errada. A sonda por kind (`probe.mjs`) substituiu o smoke test: cada artefato é exercitado do jeito que é chamado.

## D6. Detector não inventa lacuna (2026-11-16)

Sem catálogo ou marcador explícito, `tool-missing` não dispara. Antes, 14 das 17 lacunas eram falsos positivos.

## D7. Kind sem gerador é erro, não recaída (2026-11-16)

Quando `chooseKind` não casa nada, o artefato honesto é a `skill` (sempre produzível). Recair para `cli` gerava o artefato errado com cara de sucesso.

## D8. Uma única superfície (2026-11-21)

O produto é a CLI. O que não era conversa saiu do repositório; a gramática da
interface está em `docs/design/superficies.md`.

## D9. Vault como base de conhecimento (2026-11-19)

Usuário quer navegar e reencontrar. `[[wikilinks]]`, frontmatter com tags, mapa de conteúdo como porta de entrada.

## D10. Config própria em `~/.pi/`, não do outro produto (2026-11-19)

Skills e MCPs passam a ler a config **do próprio SelfEvoPI** (`~/.pi/skills/<nome>/SKILL.md` e `~/.pi/settings.json`, chave `mcpServers`), com compat legada. Antes o `/skills` só lia o store do loop e não enxergava as skills instaladas do usuário; e o `/mcp` dependia da config de outro harness. O produto passa a ser autônomo: instala, configura e se mantém sem depender de outro produto estar presente.

## D11. Agnóstico estrito: sem fallback do outro produto (2026-11-19)

O 1.1.1 deixou o import como ponte; o 1.1.3 removeu o fallback do runtime. O produto não lê a config de outro harness nem em último caso — se não achar a própria config (`~/.pi/`), diz a verdade e para. Ver [[11-Handoff/Estado-Atual]].

## D12. Launcher no PATH do usuário (2026-11-19)

`selfevopi` funciona de qualquer terminal porque o `launcher/` entra no PATH do usuário (sem admin, idempotente, via `instalar-atalhos.ps1`). O `SelfEvoPI.cmd` descobre a raiz do repositório e chama o Node — não tem caminho pessoal fixo.