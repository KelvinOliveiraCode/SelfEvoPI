# SelfEvoPI — as duas superfícies são interfaces de conversa

> Isto substitui a seção 6 e 7 de `marca.md` no que diz respeito a **comportamento**.
> A paleta, a tipografia e o movimento continuam valendo (o portfólio é a referência
> visual). O que muda é a **natureza** das duas peças.

## 1. O erro que isto corrige

A primeira versão entregou:

- uma **CLI de menu** — você escolhia "1. Estado do harness" e ela imprimia um relatório;
- um **painel de métricas** — cartões com 449 testes, 86/87, 443 ms.

Nenhum dos dois é uma interface de agente. São um catálogo de comandos e um dashboard.
O usuário pediu o **estilo** do Claude Code, do OpenCode e do Pi: uma conversa.

> A CLI e o desktop são **front-ends do agente**. O harness continua por baixo — os
> recursos dele aparecem como comandos de barra (`/evals`, `/forge`, `/memory`), não
> como um menu de juros.

## 2. A arquitetura

Os dois falam com o **mesmo backend**: o `pi` em modo RPC.

```
pi --mode rpc --no-session        (processo vivo, JSONL na entrada e na saída)
```

Contrato (documentado em `node_modules/@earendil-works/pi-coding-agent/docs/`):

| Documento | Para que serve |
|:--|:--|
| `cli-integration.md` | os quatro modos (interativo, print, json, rpc) e quando usar cada |
| `rpc.md` | ciclo de vida, framing, erros, encerramento |
| `rpc-commands.md` | comandos e respostas |
| `json.md` | forma dos eventos |
| `message-types.md` | tipos de mensagem |

O pacote exporta `RpcClient` de `@earendil-works/pi-coding-agent`, e há
`examples/rpc-client.ts` no repositório instalado. **Use o cliente, não reinvente o
protocolo.**

### Camada compartilhada

`core/agent/pi-rpc.mjs` — um cliente fino, nosso, sobre o `RpcClient` do pi:

```js
import { createPiClient } from "../core/agent/pi-rpc.mjs";

const pi = await createPiClient({ cwd: ROOT, model: "..." });
pi.on("text",     (delta) => ...);   // streaming de texto
pi.on("tool",     (call)  => ...);   // atividade de ferramenta
pi.on("settled",  ()      => ...);   // fim da execução automática

await pi.prompt("explique este repositório");
```

Por que uma camada nossa e não o cliente cru:

- os dois front-ends precisam **exatamente** do mesmo mapeamento evento → estado de tela;
- o desktop fala HTTP/SSE com o navegador, a CLI fala ANSI com o terminal — mas ambos
  consomem a mesma lista de eventos;
- se o pi mudar o protocolo, corrigimos em **um** lugar.

## 3. A CLI — um REPL, não um menu

```
  ◍  SelfEvoPI                                              v0.5.0
  ────────────────────────────────────────────────────────────────
  main · pronto · 86/87 baseline · 449 testes

  › como está a cobertura de testes?

  SelfEvoPI  86 de 87 tarefas passam. A única que fica abaixo é a B11
             (extração de HTML), que é estocástica: acertou 2 de 3.

  ⏺ read   evals/baseline.json
  ⏺ bash   npm test

  ────────────────────────────────────────────────────────────────
  /evals  /forge  /memory  /skills  /model  /clear  /help
  ────────────────────────────────────────────────────────────────
```

Regras:

1. **Prompt na última linha**, sempre. O texto do agente rola para cima.
2. **Streaming de verdade**: o texto aparece aos poucos, não em bloco.
3. **Atividade de ferramenta** como linha curta (`⏺ read  arquivo`), na ordem em que
   acontece — não como um bloco de JSON.
4. **Comandos de barra** para o que é do harness:

   | Comando | O que faz |
   :--|:--|
   | `/evals` | roda os grupos estruturais e mostra a tabela |
   | `/gate` | o gate completo (avisa que chama modelo) |
   | `/detect` | lacunas abertas |
   | `/forge <meta>` | inicia um ciclo evolutivo |
   | `/memory <termo>` | busca na memória (lexical + PPMI) |
   | `/skills` | o que já foi gerado |
   | `/model [nome]` | troca o modelo da sessão |
   | `/clear` | limpa a conversa |
   | `/help` | a lista acima |

5. **Ctrl+C** cancela a execução em curso e devolve o prompt — não mata o processo.
6. `q` ou `/quit` saem; `Ctrl+D` também.
7. **Markdown na saída**: negrito, listas, blocos de código e tabelas renderizados,
   não como `**assim**`.
8. Se `pi` não estiver instalado: uma linha dizendo isso e o que fazer. **A CLI é do
   SelfEvoPI, mas a conversa é do pi** — sem pi, não há agente.
9. A CLI anterior (menu) pode continuar acessível em `apps/cli-menu.mjs` enquanto esta
   vive em `apps/cli.mjs`. Não quebre o atalho da Área de Trabalho.

## 4. O desktop — um app de conversa

```
┌────────────────────────────────────────────────────────────────────┐
│  ◍  SelfEvoPI                                  main · 127.0.0.1   │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  VOCÊ                                                              │
│  Como está a cobertura de testes?                                  │
│                                                                    │
│  ────────────────────────────────────────────────────────────────  │
│                                                                    │
│  SELFEOPI                                                          │
│  86 de 87 tarefas passam. A única que fica abaixo é a B11, que      │
│  é estocástica.                                                    │
│                                                                    │
│   ⏺ read  evals/baseline.json                                      │
│   ⏺ bash  npm test                                                 │
│                                                                    │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ > escreva uma mensagem...                                    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  86/87 baseline · 449 testes · enter envia · shift+enter quebra    │
└────────────────────────────────────────────────────────────────────┘
```

Regras:

1. **Lista de mensagens** com o par você / agente, rolando.
2. **Streaming** via SSE: o texto cresce enquanto o modelo escreve.
3. **Atividade de ferramenta** como linha recuada, discreta.
4. **Caixa de entrada** ancorada embaixo, com envio por Enter e quebra por Shift+Enter.
5. **A barra de métricas encolhe para o rodapé**: 86/87 · 449 · 443 ms. Ela é contexto,
 não o conteúdo. O conteúdo é a conversa.
6. **Ações do harness** continuam existindo, mas como botões ao lado da entrada
 (`/evals`, `/detect`, `/gate`), não como dashboard.
7. Nada de gráfico de pizza, nada de tabela de execuções na tela principal — isso vive
 em `/evals` e no painel antigo, que continua acessível.

## 5. O que permanece igual

- **Paleta e tipografia**: `docs/design/marca.md`, seções 2 a 4. Preto absoluto,
  uma sans, pesos 400/500, estado como ponto.
- **Movimento**: 200 ms, `cubic-bezier(.22,1,.36,1)`. Nada mais.
- **Segurança**: 127.0.0.1, allowlist de ações, nada de ler fora da raiz.
- **Zero dependência nova.**
- **Não forçar preto/branco sobre o tema do terminal.**

## 6. O que medir para dizer que ficou pronto

- A CLI: uma conversa real de ponta a ponta (pergunta → streaming → ferramentas →
  resposta) sem quebrar o terminal nem deixar resíduo de escape.
- O desktop: a mesma conversa pelo navegador, com o texto crescendo.
- `/evals` mostra a tabela real; `/detect` mostra as lacunas reais.
- `npm test` continua verde (449, 448 passam, 1 skip).
- A CLI anterior segue acessível para não quebrar o atalho.