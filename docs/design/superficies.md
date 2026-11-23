# SelfEvoPI — a superfície é uma conversa

> Este documento define a gramática da **única** superfície do produto: a CLI.
> A paleta, a tipografia e o movimento continuam valindo (`marca.md`); o que
> mudou ao longo do projeto é a **natureza** da interface: deixou de ser um
> catálogo de comandos e virou uma conversa com um agente.

## 1. O erro que isto corrige

A primeira versão entregou uma **CLI de menu** — você escolhia "1. Estado do
harness" e ela imprimia um relatório. Isso é um catálogo, não uma interface de
agente. O usuário pediu o estilo do Claude Code, do OpenCode e do PI: uma
conversa.

> A CLI é o front-end do agente. O harness continua por baixo — seus recursos
> aparecem como comandos de barra (`/evo`, `/detect`, `/memory`), não como menu.

## 2. A arquitetura

A conversa mora no motor em modo RPC; a CLI fala ANSI com o terminal.

```
processo do motor  ── JSONL (stdin/stdout) ──>  core/agent/pi-rpc.mjs
                                                   │
                                     eventos text / tool / settled
                                                   ▼
                                              apps/cli.mjs
```

`core/agent/pi-rpc.mjs` é a camada fina compartilhada: converte os eventos do
motor em três tipos (`text`, `tool`, `settled`) e expõe o cliente que a CLI usa.
Se o protocolo mudar, a correção fica em um lugar.

## 3. A CLI — um REPL, não um menu

```
  ╭────────────────────────────────────────────────────────────────────╮
  │ > /evo        MODO PRINCIPAL: o harness evolui rumo à meta         │
  │   /fork       bifurca a sessão atual, preservando a original       │
  │   /language   troca o idioma da CLI (inglês por padrão)           │
  ╰────────────────────────────────────────────────────────────────────╯
  ↑↓ navegar  enter escolher  esc fechar  ctrl+o status
```

Regras:

1. **Prompt na última linha, sempre.** O texto do agente rola para cima.
2. **Streaming de verdade.** O texto aparece aos poucos, nunca em bloco.
3. **Atividade de ferramenta como linha curta**: `┊ 📄 read      arquivo`, com o
   resultado alinhado na coluna seguinte. Falha aparece como `1 failed`.
4. **Raciocínio em bloco discreto**, ocultável com `Alt+T`; quando oculto, resta
   uma linha de resumo com duração.
5. **Barra de estado sempre visível**: modo, permissão, modelo, esforço, uso de
   contexto, tempo do turno e branch. Em TTY acompanha a janela; em pipe fica
   em 72 colunas.
6. **`Ctrl+O` mostra o estado**, `Ctrl+,` abre o editor de configuração,
   `Ctrl+K` abre sessões com busca e prévia, `Ctrl+P` abre atividade,
   `Ctrl+T` abre tarefas.
7. **Mensagens enfileiradas**: digitar enquanto o agente trabalha não perde o
   texto — `Enter` enfileira e envia quando o turno termina.
8. **Imagens**: `/paste` lê a área de transferência do Windows, `/attach` anexa
   um arquivo, `@imagem.png` funciona inline e `/images clear` limpa os anexos.
   O texto nunca é truncado: linhas longas quebram na largura real do terminal.
9. **`Ctrl+C` cancela** a execução em curso e devolve a linha; `q`, `/quit` e
   `Ctrl+D` saem.
10. **Markdown renderizado** na saída: negrito, listas, código e tabelas.
11. **Sem motor, uma linha diz o que fazer**; os comandos `/` continuam valendo.
12. **Idioma**: inglês por padrão; `/language pt` troca a interface. Nada do que
    é enviado ao modelo depende dessa preferência.
13. **Clique e janela**: mouse SGR em TTY — clique executa a paleta, escolhe no
    seletor, abre o modelo na barra de estado, mostra `/help` nas dicas e
    posiciona o cursor no prompt. O redesenho acompanha `SIGWINCH`.
14. **Queda do modelo**: cinco tentativas antes do erro; sessão reiniciada após
    três falhas para o turno não ficar preso repetindo a mensagem de falha.

## 4. O que medir para dizer que ficou pronto

- Uma conversa real de ponta a ponta (pergunta → streaming → ferramenta →
  resposta) sem resíduo de escape e sem linha acima de 72 colunas.
- Todas as telas de `--render` saem 0 e cabem em 72 colunas.
- `npm test` verde; `npm run verify` verde.
- Cold start < 150 ms (p95) e acréscimo de prompt < 1.500 tokens.
