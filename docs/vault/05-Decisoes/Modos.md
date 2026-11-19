---
tags: [decisões, modos]
created: 2026-11-19
---

# Modos de Permissão

> Os 5 modos reais de `core/governance/modes.mjs`.

## Critério

Um modo só existe se mudar **ler**, **escrever**, **executar** ou **quando-pergunta**. Se não muda nenhum dos quatro, é decoração.

## Os 5 modos

| Modo | Lê | Escreve | Executa | Escopo | Quando pergunta | Nota |
|:---|:---:|:---:|:---:|:---|:---|:---|
| `plan` | ✅ | ❌ | ✅ | readonly | escrita | lê, roda leitura, propõe; não escreve |
| `build` | ✅ | ✅ | ✅ | workspace | fora do workspace | escreve e executa no workspace; fora dele, pausa |
| `manual` | ✅ | ✅ | ✅ | workspace | cada escrita | como build, mas confirma cada escrita |
| `ask` | ✅ | ❌ | ❌ | none | nunca | responde sobre o código e nunca toca em disco |
| `goal` | ✅ | ✅ | ✅ | herda de build | fora do workspace | não muda permissão; acrescenta condição de conclusão verificada |

## Tipo de permissão (TUI)

| Rótulo | Quando |
|:---|:---|
| "Leitura apenas" | `plan` — lê e consulta, propõe, não escreve |
| "Aceita edições" | `build` — lê, escreve e executa no workspace |
| "Confirma cada escrita" | `manual` — como build, mas confirma cada escrita |
| "Consulta apenas" | `ask` — lê e responde; não escreve nem executa |
| "Acesso restrito" | `goal` — acesso reduzido ao mínimo |

## Permissão (eixo distinto)

| Tipo | Comportamento |
|:---|:---|
| `full-access` | Não pede confirmação para nada |
| `auto` | Um classificador (modelo separado) revisa ações |
| `ask` | Pede confirmação para cada ação |

## Princípio

Não existe `/yolo` aqui, e não vai existir: `bypassPermissions`, `yolo` e `danger-full-access` são o que o SelfEvoPI não deve expor.

Ver [[00-Mapa]] para navegar por toda a vault.
