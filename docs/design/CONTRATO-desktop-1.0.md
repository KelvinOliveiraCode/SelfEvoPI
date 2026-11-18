# CONTRATO — Desktop SelfEvoPI 1.0

> Escrito pelo orquestrador. Todo subagente LÊ este arquivo antes de escrever.
> Se divergir daqui, o subagente errou — mesmo que "funcione".

## 0. Contexto

Dois executáveis, um único agente:

| Executável | Entra | Arquivo |
|:--|:--|:--|
| `SelfEvoPI.cmd` | CLI (TUI no terminal) | `apps/cli.mjs` |
| `SelfEvoPI-Desktop.cmd` | Desktop (janela webview) | `scripts/desktop.mjs` + `apps/desktop/*` |

**A regra de ouro:** o desktop é uma versão mais visual da CLI, não outro produto.
As duas pontas leem e escrevem **a mesma pasta de sessões**.

## 1. Camada de sessões (o que conecta os dois)

Pasta base: `~/.pi/agent/sessions/`
Subpasta do projeto: escolhida por `header.cwd` == raiz do projeto (o CLI já faz isso em `sessionDir()`).
Arquivo: `<iso>_<uuid>.jsonl`

Formato JSONL (linha 1 = header, resto = mensagens):

```json
{"type":"session","version":3,"id":"01a1e171-...","timestamp":"2026-11-15T23:01:39.318Z","cwd":"C:\\...","title":"opcional","client":"cli|desktop"}
```

O campo `client` é NOVO e serve para a interface dizer de onde veio a sessão.
Quem não tiver `client` é histórico antigo: trate como `"cli"`.

Módulo: `core/agent/sessions.mjs` — use as funções existentes, não reimplemente:
`listSessions(dir, {refresh})`, `loadSession(dir, id)`, `forkSession(dir, id, name)`.

## 2. API HTTP do desktop (contrato congelado)

Todas as respostas são JSON. Erro: `{"ok":false,"error":"mensagem"}` com status 4xx/5xx.

| Método | Rota | Entra | Sai |
|:--|:--|:--|:--|
| GET | `/api/sessions` | — | `{"ok":true,"sessions":[SessionMeta],"dir":"<caminho>"}` |
| GET | `/api/sessions/:id` | id na URL | `{"ok":true,"session":{...},"messages":[Msg]}` |
| POST | `/api/sessions/fork` | `{"id":"...","name":"opcional"}` | `{"ok":true,"session":SessionMeta}` |

`SessionMeta`:

```json
{"id":"...","title":"...","startedAt":"ISO","updatedAt":"ISO","turns":3,"tokens":1234,"forkedFrom":null,"client":"desktop"}
```

`Msg`: `{"role":"user|assistant|tool","content":"...","at":"ISO"}`

**Não existe** endpoint de criar sessão: a sessão nasce quando o primeiro turno roda,
como já acontece. Listar/retomar é o que faltava.

## 3. Interface do desktop

Estrutura de arquivos (a separação existe para trabalho paralelo):

```
apps/desktop/desktop.css   estilos (responsivo)
apps/desktop/app.js        bootstrap, SSE, chat
apps/desktop/sessions.js   lista de sessões (MÓDULO ES)
apps/desktop/settings.js   menu de configurações (MÓDULO ES)
```

`app.js` importa os módulos com `import`. A ordem no HTML importa: `app.js` por último.

### IDs obrigatórios (não renomeie)

| ID | O que é |
|:--|:--|
| `#chat` | área de mensagens |
| `#composer` | textarea de entrada |
| `#send` | botão enviar |
| `#sessions` | lista lateral de sessões |
| `#settings` | botão que abre o menu |
| `#settingsPanel` | o menu em si |
| `#status` | faixa de estado (modo/permissão/modelo) |

### Comportamento

- Sessão ativa: `.session.active` na lista
- Clicar numa sessão carrega o histórico e passa a conversar nela
- "Nova conversa" limpa a área e cria sessão nova no primeiro turno
- `Ctrl+K` abre/fecha a lista de sessões
- `Ctrl+,` abre/fecha as configurações
- `Esc` fecha o que estiver aberto

## 4. Design

- Fundo preto absoluto (`#000`), texto branco, muted `#787878` — já é a língua da casa
- Tipografia: system-ui, 14px base, 1.5 de entrelinha
- Responsivo: funciona de 720px a 1920px de largura. Abaixo de 900px a lista de
  sessões vira gaveta sobreposta, não some.
- Nada de gradiente decorativo, nada de neon, nada de glassmorphism
- Foco visível sempre (`:focus-visible`), alvos de toque ≥ 40px

## 5. Restrições absolutas

1. **Zero dependência npm.** Só `node:` embutido. Proibido criar bloco `dependencies`.
2. **Windows nativo.** Sem Docker, WSL, VM.
3. **Nunca** imprimir, commitar ou logar chave/segredo.
4. **Não inventar número.** Métrica sem data é afirmação; com data é evidência.
5. **Não tocar** em `evals/`, `core/governance/`, `core/sandbox/` — área protegida.
6. **Não renomear** ID, classe ou função que outro arquivo use.
7. Arquivo de teste: `*.test.mjs` ao lado do que testa, no padrão do repo.

## 6. Gate de cada entrega

Todo subagente roda e cola a **última linha** da saída:

```
node --test <arquivo de teste>
```

Quem mexer em `apps/cli.mjs` roda também `node apps/cli.mjs --render status`.
Quem mexer no desktop roda `node scripts/desktop.mjs --no-open --port 7810` e
confere `curl http://127.0.0.1:7810/api/sessions`.