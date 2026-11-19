# Auditoria dos comandos novos do 1.1

> A2 — varredura de `/settings`, `/theme`, `/swarm`, `/skills`, `capLinhas` e do
> seletor de `/model`. Escopo: ler tudo, não corrigir. Gate: `node --test apps/cli-audit.test.mjs`.
> Data: 2026-11-19 · HEAD `6935fcc`

## Achados

F=apps/cli.mjs:430 | SEV=media | `capLinhas` trunca com `texto.slice(0, largura-1)` — slice cru de code units sobre texto que já contém ANSI. Mede com `visibleWidth` (certo) mas corta com `.slice` (errado): se a linha colorida passa de 72 col visíveis, o corte cai no meio e **perde o reset `\x1b[0m`**, cor vazando | `/skills` (15 linhas) e `/plan` (linha "escrita: block…") — medido: `probe_leak` achou 15 vazamentos em /skills e 1 em /plan

F=apps/cli.mjs:459 | SEV=media | `/settings` mostra `tema [object Promise]` — `seguro(() => getTheme(), null)` é async e entra em `renderSettings` sem `await`; o campo vira Promise não resolvido | `/settings`

F=apps/cli.mjs:507 | SEV=media | `/swarm 2 <tarefa>` dá "0 subagente(s) / nenhum subagente planejado" — `renderSwarm(plano)` recebe `{subtasks,notices}` mas a função espera `{plan,...}`; o plano esvazia. `planSwarm` gera 2 subtarefas (módulo 35/35 ok) — erro é a fiação | `/swarm 2 extrair dados de um html`

F=apps/cli.mjs:477 | SEV=baixa | `/theme <nome>` imprime "tema: true"/"tema: false" (booleano de setTheme) em vez do nome; nome inválido sai 0 com "tema: false" em vez de erro | `/theme alto-contraste`; `/theme lixo`

F=core/agent/theme.mjs:156 | SEV=baixa | `setTheme` retorna `false` para nome inválido (não lança); `runTheme` trata `false` como sucesso — nome inválido não é rejeitado | `/theme nao-existe`

## Respostas por item (do pedido)

### 1. `/settings`
- 8 linhas ✓ (modo, permissao, modelo, esforco, tema, mcp, skills, sessoes).
- Nenhuma passa de 72 col ✓ (maxcol 38) — **menos** o valor de `tema`, que é `[object Promise]` (bug acima).
- `seguro()` engolindo erro: se `mcp`/`skills` falham, devolve `[]` e a visão mostra 0 — **mascara um erro real** sem dizer. É por design ("não derruba"), mas reporto: um erro de leitura de MCP/skills aparece como "0 servidores"/"0 skills", indistinguível de "não há". SEV baixa (não consertar agora).

### 2. `/theme`
- Troca de fato ✓ (escuro/claro/alto-contraste aplicam; persiste em arquivo + localStorage).
- Nome inválido **não quebra**, mas também **não é rejeitado** (sai 0, "tema: false") — bug baixo.
- `alto-contraste` passa WCAG AA em fundo preto (medido): fg 21.0, muted 9.68, accent 9.77, ok 15.9, warn 15.0, fail 7.57 — todos ≥ 4.5:1 ✓.

### 3. `/swarm`
- Sem argumento: mostra uso e sai 2 ✓.
- Com `2 <tarefa>`: **NÃO** produz plano coerente — mostra "0 subagente(s)" (bug de fiação, acima).
- Sem provedor configurado: diz "nenhum provedor configurado" e sai 2 ✓ (linha 501-503).

### 4. `/skills`
- Mostra seções `loop` e `pc` ✓ (`pc (OpenCode): 334`).
- `pc` lista as skills do OpenCode ✓ (334 nesta máquina).
- `/skills <termo>` filtra ✓ (html → filtra; zzz → "nenhuma skill encontrada").

### 5. `capLinhas`
- Usa `visibleWidth` + slice cru → **corrompe ANSI** quando a linha colorida passa de 72 col (bug acima). Afeta `/skills` e `/plan` hoje; `/mode` e `/goal` não passam de 72 (por enquanto). Uso indevido de slice em string com escape é o risco que você previu — confirmado.

### 6. `/model` (A4)
- `moveModelPicker` (linha 2448) usa módulo — navegação não sai da lista ✓.
- Estágio de esforço lê `getAvailableThinkingLevels` do modelo (linha 2473) — **não inventa** níveis; se não expõe, pula ✓.
- Só funciona no REPL; por fora (runSlash) vê a lista estática — como esperado.

## Severidade

- alta: 0
- media: 3  (capLinhas:430, settings:459, swarm:507)
- baixa: 2  (theme:477, theme.mjs:156)

## Regressões (apps/cli-audit.test.mjs)

Os 3 bugs da auditoria anterior (goal 72 col, init motor, render menu) agora passam
(promovidos de `todo` para `test` pelo orquestrador). `node --test apps/cli-audit.test.mjs`
= 5/5. Os 3 bugs desta rodada ainda não têm regressão dedicada (não mexi em apps/).