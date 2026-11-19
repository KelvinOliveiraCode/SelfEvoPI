# Verificação da integração 1.1

> A2 — verificação do commit `6935fcc` (quatro comandos novos + `capLinhas`).
> Escopo: ler tudo, não corrigir. Gate: `npm test`.

## Gate

```
npm test  ->  tests 900 / pass 899 / fail 0 / skipped 1 / todo 0   (EXIT=0)
```
Verde, igual ao baseline esperado (900/899/1 skip). Meus 3 `todo` da auditoria
anterior foram promovidos a `test` e passam (os 3 bugs foram corrigidos).

Nota: a 1ª execução de `npm test` saiu com exit=1 sem sumário (flaky transitório
de I/O sob carga fria); reexecutada, deu 900/899/0fail/EXIT=0. Não é regressão
de código — é instabilidade de ambiente no 1º run.

## Achados

F=apps/cli.mjs:430 | SEV=media | `capLinhas` trunca com `texto.slice(0, largura-1)` (slice cru de code units) em texto que JÁ tem ANSI; quando a linha colorida passa de 72 col visíveis, o slice cai no meio do texto e **perde o `\x1b[0m` final**, fazendo a cor vazar para as linhas seguintes | `/skills` (15 linhas vazam) e `/plan` (linha "escrita: block…" vaza)

F=apps/cli.mjs:459 | SEV=media | `/settings` mostra `tema [object Promise]`: `seguro(() => getTheme(), null)` é async e não é aguardado antes de entrar em `renderSettings`, então o campo `theme` vira um Promise não resolvido | `/settings` → linha "tema" mostra "[object Promise]"

F=apps/cli.mjs:507 | SEV=media | `/swarm 2 <tarefa>` mostra "0 subagente(s) / nenhum subagente planejado": `renderSwarm(plano)` recebe `plano = {subtasks,notices}` mas a função espera `{plan, results, notices}`; o plano fica vazio (o módulo `planSwarm` gera 2 subtarefas corretamente — 35/35 testes do módulo passam; o erro é só a fiação na CLI) | `/swarm 2 extrair dados de um html`

F=apps/cli.mjs:477 | SEV=baixa | `/theme <nome>` imprime "tema: true"/"tema: false" (o booleano de `setTheme`) em vez do nome aplicado; e `/theme lixo-inexistente` sai 0 com "tema: false" em vez de erro (deveria sair 2 e dizer o que vale) | `/theme alto-contraste` → "tema: true"; `/theme lixo` → "tema: false" (exit 0)

F=core/agent/theme.mjs:156 | SEV=baixa | `setTheme` devolve `false` para nome inválido (não lança), e `runTheme` trata `false` como sucesso — nome inválido não é rejeitado com mensagem | `/theme nao-existe`

## O que passou (saneamento)

- `/settings` mostra 8 linhas (modo, permissao, modelo, esforco, tema, mcp, skills, sessoes), maxcol 38 (≤72) — exceto o `[object Promise]` do tema (acima).
- `/theme alto-contraste` **passa WCAG AA** em fundo preto (medido, não confiado): fg 21.0:1, muted 9.68:1, accent 9.77:1, ok 15.9:1, warn 15.0:1, fail 7.57:1 — todos ≥ 4.5:1.
- `/skills` mostra duas seções (`loop` e `pc (OpenCode): 334`); `/skills <termo>` filtra.
- `/swarm` sem argumento mostra uso e sai 2.
- O seletor de `/model` (`moveModelPicker` linha 2448) navega com módulo (não sai da lista); o estágio de esforço lê `getAvailableThinkingLevels` do modelo (linha 2473) — não inventa níveis.
- `capLinhas` só corrompe quando a linha colorida passa de 72 col; hoje `/mode` e `/goal` não passam (só `/skills` e `/plan` passam).

## Severidade

- alta: 0
- media: 3  (capLinhas:430, settings:459, swarm:507)
- baixa: 2  (theme:477, theme.mjs:156)