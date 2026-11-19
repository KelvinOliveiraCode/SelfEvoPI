---
tags: [componentes, desktop]
created: 2026-11-19
---

# Desktop

> A janela webview do SelfEvoPI.

## Arquivos

| Arquivo | O que é |
|:---|:---|
| `apps/desktop/app.js` | Bootstrap, SSE, chat |
| `apps/desktop/settings.js` | Menu de configurações |
| `apps/desktop/sessions.js` | Lista de sessões |
| `apps/desktop/desktop.css` | Estilos |

## IDs obrigatórios

| ID | O que é |
|:---|:---|
| `#chat` | Área de mensagens |
| `#composer` | Textarea de entrada |
| `#send` | Botão enviar |
| `#sessions` | Lista lateral de sessões |
| `#settings` | Botão que abre o menu |
| `#settingsPanel` | O menu em si |
| `#status` | Faixa de estado |

## Atalhos

- `Ctrl+K` — abre/fecha lista de sessões
- `Ctrl+,` — abre/fecha configurações
- `Esc` — fecha o que estiver aberto

## Sessões fantasmas (bug resolvido em 1.1.3)

Testes de `/api/sessions/fork` rodavam contra o HOME real e criaram sessões
"fork de teste" reais na pasta do projeto, que poluíam a lista do desktop
("sessões que eu nunca usei"). O bug de produção (teste usando HOME real) foi
corrigido; `sessionDir()` agora devolve estado vazio honesto quando não há pasta
do projeto. O resíduo é limpo por `scripts/limpar-sessoes-teste.mjs` (dry-run por
padrão, `--confirm` remove só sessões com título "fork de teste").

## Duas superfícies (padrão Claude Code Desktop)

1. **Linha de controle** (abaixo do composer): modo + modelo + permissão
2. **Painel #settingsPanel** (Ctrl+,): preferências que não mudam por turno

Ver [[04-Features/Features]] para como usar.