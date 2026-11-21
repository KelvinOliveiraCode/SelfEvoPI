# Idioma e detalhamento do feedback

## Onde mexer

| Arquivo | Papel |
|:--|:--|
| `core/agent/i18n.mjs` | dicionários `en`/`pt`, `getLocale`, `setLocale`, `t()`, `listLocales`. |
| `~/.pi/agent/cli-locale.json` | preferência real (fora do repo). Env: `SELFEOPI_LOCALE`. |
| `core/agent/verbosity.mjs` | presets e `shows(part)`. Env: `SELFEOPI_VERBOSITY`. |
| `~/.pi/agent/cli-verbosity.json` | preferência de detalhamento (fora do repo). |
| `apps/cli.mjs` — `ARG_TR` | tradução dos argumentos mostrados na paleta. |
| `core/agent/settings-view.mjs` | linhas de `/settings` também são traduzidas. |

## Regras

- **Inglês é o padrão.** Nunca mude o default para português.
- Toda chave nova vai nos **dois** dicionários. Chave faltando cai no inglês;
  se faltar nos dois, aparece o nome da chave na tela — isso é bug.
- `setLocale` e `setVerbosity` apagam a variável de ambiente ao receber uma
  escolha explícita: a preferência do usuário vence o override da sessão.
- Nada do que é enviado ao modelo depende do idioma da interface.
- `Alt+T` é override **de sessão** do raciocínio (`reasoningToggle`); não
  escreve a preferência em disco.

## Presets de verbosidade

| Nível | activity | tools | toolResult | reasoning | metrics |
|:--|:--:|:--:|:--:|:--:|:--:|
| `minimal` | – | – | – | – | – |
| `tools` | ✓ | ✓ | – | – | – |
| `reasoning` | ✓ | – | – | ✓ | – |
| `full` (padrão) | ✓ | ✓ | ✓ | ✓ | – |
| `verbose` | ✓ | ✓ | ✓ | ✓ | ✓ |

Se precisar de um novo nível, acrescente em `LEVELS`, em `PRESETS`, as chaves
`verb.<nivel>` nos dois idiomas e o texto em `describe()`.

## Passos para traduzir uma string

1. Troque o literal por `t("chave.nova")` (ou `tr(...)` em `cli.mjs`).
2. Adicione `chave.nova` em `en` e `pt`.
3. Se for argumento de comando, adicione em `ARG_TR.en`.
4. Rode o teste de chaves e os testes de interface.

## Verificação

```powershell
node --test apps/cli-features.test.mjs
node --test core/agent/i18n.test.mjs
node --test core/agent/verbosity.test.mjs
node --test core/agent/settings-view.test.mjs
node apps/cli.mjs --render help        # inglês
$env:SELFEOPI_LOCALE='pt'; node apps/cli.mjs --render help
```

Checagens esperadas: nenhuma linha > 72 colunas em nenhum idioma; `/language`
e `/verbosity` com argumento inválido devolvem exit 2; nível escolhido persiste
depois de reiniciar.

## Se quebrar

- Apareceu `chave.xyz` na tela: chave ausente em um dos dicionários.
- `/language` parece não funcionar: havia `SELFEOPI_LOCALE` definido no shell;
  `setLocale` apaga a variável, mas um novo shell pode redefini-la.
- Contador de tokens sumiu: `pollTokens()` precisa começar **depois** de
  `spin.start()` — o loop depende de `spin.active`.
- Raciocínio aparece quando deveria estar oculto: `reasoningOn()` deve consultar
  `shows("reasoning")` quando não há override de sessão.
