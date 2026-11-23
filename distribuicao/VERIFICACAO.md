# Verificação — SelfEvoPI 1.9.3

Medições feitas em 21/11/2026. Cada número tem origem rastreável.

| Verificação | Resultado | Como reproduzir |
|:--|:--|:--|
| Suíte completa | 1044 testes, 1043 passam, 1 skip | `npm test` |
| Verificação completa | exit 0 | `npm run verify` |
| Fontes citadas | 33/33 respondem 200 | `node scripts/verify-urls.mjs` |
| Cold start da CLI | 82 ms médio (7 execuções, 75–96 ms) | cronômetro sobre `node apps/cli.mjs --version` |
| Telas `--render` | 9 telas em inglês e português, nenhuma acima de 72 colunas | medição sobre a saída |
| Modelos — capacidades | 48/48 OK, 0 divergências | `npm run models:check` |
| Modelos — prompt real | 37/48 responderam texto | `npm run models:prompt` |
| ERNIE 5.5 Flash | 8/8 provedores com effort `high` | `npm run models:check` |

## Uso real em tarefas pequenas

| Tarefa | Resultado | Tempo |
|:--|:--|:--|
| App Node (`app.js` + `package.json`, soma e CLI) | arquivos criados, `node app.js` imprime 5, tool calling funcionou (3 chamadas) | 7,4 s |
| Site HTML (`index.html` + `style.css`, botão que troca cor) | arquivos criados, JS inline e CSS separado, tool calling funcionou (3 chamadas) | 9,2 s |
| Dois subagentes em paralelo | ambos responderam (`UM` e `DOIS`) | 3,1 s no total |

## Feedback na tela

Com `/verbosity full`, cada turno mostra:

- `⏺ <ferramenta>  <arquivo-alvo>` no momento da chamada, com caminho curto;
- `⎿ N linhas (X KB)` como resultado indentado;
- `⤷ raciocínio` seguido do texto do modelo em cinza;
- spinner com verbo, tempo e contador de tokens no nível `verbose` (confirmado: `↓ 9039 tokens`);
- resposta final em markdown, com código em bloco.

Os níveis `minimal`, `tools`, `reasoning`, `full` e `verbose` controlam cada
uma dessas peças. `Alt+T` alterna o raciocínio apenas na sessão corrente.

## Limites observados

- O raciocínio que chega depois do texto pode aparecer abaixo das linhas de
  ferramenta; o conteúdo não é perdido, mas a ordem cronológica pode inverter.
- Quatro ids do catálogo (`stealth/crouton-alpha`,
  `thinkingmachines/inkling-2-small`, `inclusionai/ling-3.2-flash`,
  `liquid/lfm-3-1.7b`) terminam `settled` sem texto em parte dos provedores.
  As capacidades deles conferem 100%.

## Segurança

Varredura da árvore e dos 385+ commits dos dois repos: apenas fixtures falsos
em testes. Nenhuma chave de API, `.env`, token ou caminho pessoal versionado.
