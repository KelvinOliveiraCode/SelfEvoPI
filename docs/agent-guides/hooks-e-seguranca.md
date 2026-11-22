# Hooks e observabilidade de segurança

## Onde mexer

| Arquivo | Papel |
|:--|:--|
| `core/agent/hooks.mjs` | lê `.pi/hooks.json` do workspace e dispara os eventos |
| `apps/cli.mjs` | chama `fireHook()` em `converse` e no `/compact`; comandos `/hooks` e `/security-log` |
| `core/sandbox/telemetry.mjs` | ledger append-only de decisões `block`/`warn` |
| `core/sandbox/run-sandboxed.mjs` | ponto onde a decisão do gate é observada e registrada |
| `core/agent/i18n.mjs` | strings dos comandos (`cmd.hooks`, `cmd.securitylog`, `hooks.*`, `securitylog.*`) |

## O que não mexer

- `.pi/hooks.json` é **do workspace**, não a config pessoal em `~/.pi`. Nunca
  grave chave, token ou caminho de usuário nele, e nunca o versionar no release
  público com dados reais.
- Hooks não recebem shell. `args` com `;`, `|`, `` ` ``, `$` ou `&` são
  rejeitados na leitura da config. Não "conserte" isso usando `shell: true`.
- O gate continua puro: `static-gate.mjs` não escreve em disco. Quem registra é
  `run-sandboxed.mjs`, depois da decisão.
- Falha de hook ou de escrita do ledger **nunca** pode mudar o resultado do
  turno ou do gate.

## Eventos disponíveis

`turn_start`, `turn_end`, `tool_start`, `tool_result`, `error`, `compact`.

Formato:

```json
{
  "version": 1,
  "hooks": {
    "turn_start": [
      { "name": "auditar", "command": "node", "args": ["scripts/hook.mjs"], "timeoutMs": 2000 }
    ]
  }
}
```

O payload chega como JSON no stdin: `{ event, at, payload }`. A saída é limitada
a 4 KB e redigida (`apiKey`, `token`, `sk-…`, `eyJ…`).

## Passos

1. Acrescente o evento em `EVENTS` em `hooks.mjs` — e a tradução em `i18n.mjs`
   se ele ganhar comando ou mensagem de tela.
2. Chame `await fireHook(evento, payload)` no ponto do ciclo. Use `void` quando
   o caminho não for `async` e o atraso for indesejado.
3. Para nova decisão observável, chame `recordGateDecision()` com o resultado
   do gate. Nunca jogue o erro da gravação para o chamador.
4. Documente o comando novo no README, `docs/produto.md`, `docs/estado.md` e
   na vault (`03-Comandos/CLI.md`, `02-Componentes/*`, `04-Features/Features.md`).

## Verificação

```powershell
node --test core/agent/hooks.test.mjs
node --test core/sandbox/telemetry.test.mjs
npm test
npm run verify
node apps/cli.mjs --render status
```

A prova de integração é um hook `turn_start` real que escreve um marcador em
arquivo temporário; o marcador precisa conter o evento e o texto do prompt.
