# Adicionar comando de barra (ou picker/atalho)

## Onde mexer

| Arquivo | Papel |
|:--|:--|
| `apps/cli.mjs` — `COMMANDS` | **fonte única**. `/help` e a paleta leem daqui. |
| `apps/cli.mjs` — `run<Nome>` | executor; recebe `{ arg, out, pi, onClear, home }`. |
| `apps/cli.mjs` — `localizedCommands()` | aplica descrição e argumentos traduzidos. |
| `core/agent/i18n.mjs` | chaves `cmd.<nome>` e argumentos em `ARG_TR`. |
| `apps/cli.mjs` — `start*Picker` | picker interativo, quando o comando não leva argumento. |
| `apps/cli.mjs` — `onData` | atalhos de teclado e prioridade dos overlays. |
| `apps/cli.test.mjs`, `apps/cli-features.test.mjs`, `apps/cli-audit.test.mjs` | regressões de interface. |

## O que não mexer

- Não crie uma segunda lista de comandos em outro lugar.
- Não escreva string de interface crua em português: use `t("chave")`.
- Não deixe linha passar de 72 colunas em `--render`, nem SGR aberto no fim.
- Não faça o atalho colidir com `Ctrl+O`, `Ctrl+,`, `Ctrl+K`, `Ctrl+P`, `Ctrl+T`,
  `Alt+T`, `Ctrl+C` ou `Ctrl+D`.
- Um overlay por vez: ao abrir outro, feche os anteriores.

## Passos

1. Escreva `async function runMeuComando({ arg, out, pi }) { ...; return 0; }`
   perto dos outros executores.
2. Registre em `COMMANDS`: `{ name: "/meu", args: "[x]", description: tr("cmd.meu"), run: runMeuComando }`.
3. Adicione `cmd.meu` nos dois dicionários de `i18n.mjs` (en e pt) e, se o
   argumento for novo, em `ARG_TR`.
4. Se houver picker, crie `startMeuPicker()` com `startValuePicker` e ligue no
   dispatch de `submit` quando `semArg`.
5. Escreva o teste antes ou junto: registro em `COMMANDS`, saída sem motor,
   largura e ANSI balanceado.
6. Atualize `README.md` (tabela de comandos), `docs/produto.md`,
   `docs/vault/03-Comandos/CLI.md` e o CHANGELOG.

## Verificação

```powershell
node --test apps/*.test.mjs
node apps/cli.mjs --render help
node apps/cli.mjs --render palette
npm run verify
```

Confira que `/help` e a paleta mostram o comando novo **nos dois idiomas** e que
`/language` troca a descrição sem reiniciar.

## Se quebrar

- Comando não aparece: esqueceu `COMMANDS` ou a chave `cmd.<nome>`.
- Texto cortado na tela: você usou truncamento; use `wrapAnsi`/`capLinhas`.
- Overlay sobreposto: falta fechar `panelOpen`, `taskOpen`, `sessionsOpen`,
  `settingsOpen`, `modelPicker` e `valuePicker` no novo atalho.
- Teste de largura falhou: meça com `visibleWidth()` e quebre a linha.
