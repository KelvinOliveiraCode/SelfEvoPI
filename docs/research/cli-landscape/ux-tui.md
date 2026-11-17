# UX de TUI — padrões de interação para CLIs de agente

> **Tipo:** pesquisa (nenhuma linha do SelfEvoPI alterada)
> **Data da consulta:** 2026-11-17
> **Método:** fontes primárias abertas nesta data (ECMA-48 5ª ed. 1991, Unicode UAX #11,
> Node.js docs, projetos de TUI reais). Cada afirmação traz a fonte; quando não há
> fonte primária, está marcado `[não verificado]`.

## Sumário

1. [A paleta de comandos](#1-a-paleta-de-comandos)
2. [Redesenho sem flicker](#2-redesenho-sem-flicker)
3. [Streaming de texto com markdown](#3-streaming-de-texto-com-markdown)
4. [Chamada de ferramenta](#4-chamada-de-ferramenta)
5. [Interrupção (Ctrl+C)](#5-interrupção-ctrlc)
6. [Largura e responsividade](#6-largura-e-responsividade)
7. [Estados vazios](#7-estados-vazios)
8. [Armadilhas conhecidas](#8-armadilhas-conhecidas)
9. [Checklist de qualidade](#9-checklist-de-qualidade)

---

## 1. A paleta de comandos

### O que é

Uma lista filtrável que aparece ao digitar `/` (ou `:` no vim, `>` em alguns TUIs). O
usuário digita um prefixo e a lista mostra os comandos candidatos; ele navega e escolhe um.
É o "command menu" das CLIs modernas (Claude Code, OpenCode, fzf, Textual Command Palette).

### Quem usa

- **Claude Code**: paleta `/` com comandos e skills. A doc oficial lista os comandos
  (`/model`, `/settings` etc.) e a cheatsheet descreve skills como "a capability Claude
  can invoke... Each tool call appears in the transcript".
  Fonte: https://code.claude.com/docs/en/cli-reference e
  https://support.claude.com/en/articles/14553413-claude-code-cheatsheet
- **Textual (Python)**: tem `Command Palette` nativa.
  Fonte: https://textual.textualize.io/command_palette/ (listada no índice do site, seção
  "Command Palette").
- **fzf**: o fuzzy finder de referência; usa algoritmo v2 por padrão.
  Fonte: https://github.com/junegunn/fzf e
  https://linuxhandbook.com/blog/fzf-command/ ("two searching algorithms, where the
  default one is v2. The algorithm v1 is supposed to be faster but not as accurate as v2").
- **Ink / React**: base do OpenCode (este projeto usa OpenCode, que é Ink-based `[não
  verificado: stack exato do OpenCode]`) e de CLIs como o `ink-diff-renderer`.
  Fonte: https://github.com/vadimdemedes/ink

### Como filtrar

| estratégia | como funciona | fonte |
|:---|:---|:---|
| prefixo | casa o começo da string | trivial; usada por CLIs simples |
| subsequência | os caracteres do termo aparecem na ordem, não necessariamente colados | fzf usa "fuzzy match" |
| fuzzy com score | algorítmo v2 do fzf usa programação dinâmica para achar o melhor casamento e pontuar fatores (posição, adjacência) | https://deepwiki.com/nvim-telescope/telescope-fzf-native.nvim/2-core-fzf-algorithm |
| case-insensitive + "smart case" | se o termo tem maiúscula, vira case-sensitive | comportamento comum `[não verificado: spec]` |

### Como mostrar cada linha

Cada linha costuma ter: **ícone/número**, **nome**, **descrição** e **atalho**. Ex.:
`⏺ read <arquivo>`, `  /model  trocar modelo  (ctrl+m)`. A fonte Claude Code mostra a
estrutura de transcript com marcadores `⏺` para ferramentas; a cheatsheet confirma que
cada tool call aparece no transcript.

### Navegação

| tecla | ação | fonte |
|:---|:---|:---|
| `↑`/`↓` | move seleção | universal |
| `tab` | completa / move | readline (`node:readline`) |
| `ctrl+n` / `ctrl+p` | próximo / anterior (emacs/readline) | `node:readline` keybindings `[não verificado: lista completa]` |
| `enter` | aceita | universal |
| `esc` | fecha sem escolher | universal |
| `ctrl+c` | cancela | ver §5 |

Node.js oferece `node:readline` para entrada linha a linha e emula os keybindings do
readline/GNU (incl. `ctrl+n`/`ctrl+p` histórico). Fonte: https://nodejs.org/api/readline.html

### Quantas linhas / rolagem

- Altura típica: 8–15 linhas (o Claude Code mostra uma janela curta; `[não verificado:
  número exato]`). Textual Command Palette tem altura configurável `[não verificado]`.
- Rolagem: a janela desliza quando a seleção passa do fim. Em ANSI puro, isso é
  redesenhar as N linhas da paleta a cada movimento (ver §2).

### Como aceitar / fechar

- Aceita: `enter` → o handler do comando roda, a paleta some.
- Fecha: `esc` ou `ctrl+c`.
- Ao fechar, **restaure o cursor e limpe as linhas** da paleta (ver §2, armadilha de
  "resíduo").

### Implementação em ANSI puro (Node, sem dependência)

Princípios: montar a lista como strings, mover o cursor para o topo da região da paleta,
reapintar cada linha com `ESC[K` (apagar até o fim da linha) e reposicionar. Esboço:

```js
// Constantes ANSI (ECMA-48):
//   ESC[<n>A  = CUU  (cursor up n)        -> "\x1b[<n>A"
//   ESC[<n>B  = CUD  (cursor down n)      -> "\x1b[<n>B"
//   ESC[K     = EL   (erase in line, 0)   -> "\x1b[K"
//   ESC[<r>;<c>H = CUP (cursor position)   -> "\x1b[<r>;<c>H"
//   ESC[?25l  = cursor invisível (D?25l)   -> "\x1b[?25l"
//   ESC[?25h  = cursor visível              -> "\x1b[?25h"
const ESC = "\x1b[";
const up = (n) => `${ESC}${n}A`;
const del = `${ESC}K`;           // apaga do cursor até o fim da linha
const hide = `${ESC}?25l`, show = `${ESC}?25h`;

function paintPalette(items, selected) {
  const rows = items.slice(0, 10).map((it, i) => {
    const mark = i === selected ? "› " : "  ";
    return `${mark}${it.name.padEnd(20)} ${it.desc}`;
  });
  // sobe para o topo da paleta e repinta
  let out = hide + up(rows.length);
  for (const r of rows) out += del + r + "\r\n";
  out += show;
  return out;
}
```

### Armadilhas

- **Resíduo**: se a nova lista tem menos linhas que a anterior, as linhas antigas
  sobram. Solução: apagar cada linha com `ESC[K` antes de escrever, ou `ESC[J` (ED 0,
  apagar até o fim da tela) no fim.
- **Alt-screen**: se você entrou no alt-screen (`ESC[?1049h`), ao sair o histórico do
  terminal é restaurado — a paleta some sem deixar rastro. Se **não** usou alt-screen, a
  paleta fica no scrollback e suja o histórico (ver §2).

---

## 2. Redesenho sem flicker

### O que é

Atualizar uma lista/área no terminal **sem piscar**. O olho percebe flicker quando o
terminal apaga e reescreve a tela inteira a cada frame.

### Quem usa / como

- **Ink** (React): renderiza com um reconciler customizado e usa **diffing** — só
  reescreve o que mudou. O projeto `ink-diff-renderer` descreve: "Diff-based rendering:
  only updates changed cells, eliminating flicker" e "Double buffering: smooth updates
  without tearing", e usa **DEC private mode 2026** (`ESC[?2026h` / `ESC[?2026l`) para
  "synchronized output" em terminais compatíveis.
  Fonte: https://github.com/kazhiramatsu/ink-diff-renderer e
  https://github.com/vadimdemedes/ink
- **Textual** (Python): "smart refresh" — ao mudar um atributo reativo, só chama
  `render()` do widget; "If you modify multiple reactive attributes, Textual will only
  do a single refresh to minimize updates."
  Fonte: https://textual.textualize.io/guide/reactivity/
- **Ratatui** (Rust): backend + buffer; redesenha a diferença.
  Fonte: https://ratatui.rs/concepts/ (seção Rendering).

### As primitivas ANSI relevantes

| função | sequência | ECMA-48 |
|:---|:---|:---|
| Cursor Up | `ESC[<n>A` | CUU (8.3.22 / Table 2) |
| Cursor Down | `ESC[<n>B` | CUD (8.3.20) |
| Cursor Position | `ESC[<r>;<c>H` | CUP (8.3.21) |
| Erase in Line | `ESC[<Ps>K` (Ps=0 fim, 1 início, 2 tudo) | EL (8.3.41) |
| Erase in Display | `ESC[<Ps>J` (0 fim, 1 início, 2 tudo, 3 scrollback) | ED (8.3.39) |
| Save Cursor | `ESC7` (DEC) / `ESC[s` (SCO) | `[não verificado: ECMA-48 não padroniza save/restore; é extensão DEC/SCO]` |
| Restore Cursor | `ESC8` (DEC) / `ESC[u` (SCO) | `[não verificado: mesma nota]` |
| Insert Line | `ESC[<n>L` | IL (8.3.67) |
| Delete Line | `ESC[<n>M` | DL (8.3.32) |
| Scroll Up | `ESC[<n>S` | SU (8.3.147) |
| Synchronized output | `ESC[?2026h` / `ESC[?2026l` | `[não verificado: DEC private mode, não é ECMA-48]` |

Fontes: ECMA-48 5ª ed. seção 8.3 e Tables 2/3 (https://ecma-international.org/wp-content/uploads/ECMA-48_5th_edition_june_1991.pdf);
save/restore e 2026 são extensões de terminal (xterm/DEC), não ECMA-48
(https://en.wikipedia.org/wiki/ANSI_escape_code).

### As duas estratégias

**A) Alt-screen (tela alternativa)** — `ESC[?1049h` entra, `ESC[?1049l` sai.
- Prós: você controla toda a tela; ao sair, o terminal volta ao estado anterior limpo.
- Contras: **não preserva histórico** — o que ficou na tela some ao sair. Ruim para
  transcripts de conversa (o usuário quer rolar para cima depois).
- Fonte: `ink-diff-renderer` chama `altScreen: true` para o modo `Terminal` e usa
  **main screen** (não alt) no `ScrollbackTerminal` "Claude Code-style" justamente para
  "history preservation".

**B) Inline / scrollback** — desenha no fluxo normal, sem alt-screen.
- Prós: histórico preservado; bom para chat.
- Contras: você precisa tomar cuidado para não deixar resíduo; o scrollback pode
  "engolir" a área fixa.
- Fonte: `ink-diff-renderer` `ScrollbackTerminal` ("Uses main screen buffer (not
  alternate screen)", "Content scrolls up and persists in terminal history", "Fixed
  input area at bottom stays in place").

### O padrão profissional (Claude Code-style)

`ink-diff-renderer` descreve exatamente o modelo que CLIs de agente usam:
- **main screen** (não alt) para preservar histórico;
- **fixed input area at bottom** (`inputHeight`), e a área de conteúdo rola acima;
- **diff-based** + **double buffering** + **fps limit** para não piscar;
- **DEC 2026** (synchronized output) quando o terminal suporta, para "display all at
  once".

### Implementação em ANSI puro (double buffer)

```js
// Duas telas (buffers) em memória: frente e trás.
// A cada frame: renderiza no buffer de trás, diffa com a frente, emite só as mudanças.
function diffRender(prev, next) {
  const ESC = "\x1b[";
  let out = "";
  const max = Math.max(prev.length, next.length);
  for (let i = 0; i < max; i++) {
    const a = prev[i] ?? "";
    const b = next[i] ?? "";
    if (a === b) continue;
    // posiciona na linha i (1-based), apaga a linha e escreve a nova
    out += `${ESC}${i + 1};1H${ESC}K${b}`;
  }
  return out;
}
// Uso: a cada frame, out = diffRender(prev, next); process.stdout.write(out); prev = next;
```

### Armadilhas

- **Flicker por redesenhar tudo**: escrever a tela inteira a cada frame pisca. Só mude o
  que mudou (diff).
- **Alt-screen vs inline**: alt-screen não preserva histórico; inline preserva mas exige
  cuidado com resíduo.
- **Resize no meio (`SIGWINCH`)**: se o terminal muda de tamanho durante a renderização,
  suas coordenadas antigas (`ESC[<r>;<c>H`) apontam para lugar errado e o desenho fica
  corrompido. Solução: ao receber `SIGWINCH`, **recalcule tudo e faça um `fullRefresh`**
  (redesenho completo). Node emite `SIGWINCH` no resize (Windows: só ao mover o cursor
  ou escrever). Fonte: https://nodejs.org/api/process.html
- **`ESC[K` vs limpar a linha toda**: `ESC[K` (EL 0) apaga do cursor ao fim; se você
  posicionou no meio, o começo fica. Posicione no início (`ESC[<r>;1H`) ou use `ESC[2K`.
- **Altura variável**: se o conteúdo encolhe, apague as linhas que sobraram
  (`ESC[J` / ED 0 no fim da região).
- **Performance**: escrever muitas vezes por segundo inunda o terminal; use um
  `fps` alvo (ex.: 30–60) e "coalesça" updates (Textual faz "single refresh" para
  múltiplas mudanças).

---

## 3. Streaming de texto com markdown

### O que é

Texto chegando aos poucos (token a token) e sendo renderizado como markdown (negrito,
código, listas) **sem quebrar a formatação a cada delta**.

### O problema

Markdown é um formato de bloco: `**negrito**`, `` `código` ``, `- lista`. Se você
renderiza a cada delta, um `**` pela metade vira texto literal por um instante, depois
vira negrito — "piscando" a formatação.

### Quem usa / como resolvem

- **Claude Code (Agent SDK)**: por padrão entrega um `AssistantMessage` completo por
  bloco; para streaming incremental, habilita "partial message streaming".
  Fonte: https://code.claude.com/docs/en/agent-sdk/streaming-output
- **Comunidade**: a recomendação comum é **re-renderizar e sanitizar o conteúdo
  inteiro a cada chunk** (não tentar fazer parse incremental de markdown).
  Fonte: https://community.openai.com/t/streaming-markdown-or-other-formatted-text/510268
  ("the workaround I implemented was to re-render and sanitize the entire contents of
  the completion on each incoming chunk").
- **Bibliotecas dedicadas**: `streaming-markdown` (parse tokens de markdown incompleto),
  `stream-markdown-parser` (parser+renderer com streaming, framework-agnostic).
  Fontes: https://github.com/thetarnav/streaming-markdown e
  https://www.npmjs.com/package/stream-markdown-parser

### A técnica que funciona

**Re-renderizar o buffer inteiro a cada frame** (não só o delta), a partir do texto
acumulado. Como a renderização é idempotente, o markdown "se acomoda" quando o próximo
delta fecha um `**` ou um bloco de código. Combinado com o diff (§2), só as células
mudadas vão para o terminal, então o custo é baixo mesmo re-renderizando tudo.

### Implementação em ANSI puro

```js
// acumula texto; a cada chunk, re-renderiza o markdown inteiro e faz diff
let buf = "";
function onDelta(chunk) {
  buf += chunk;
  const rendered = renderMarkdown(buf); // sua função markdown -> linhas ANSI
  const out = diffRender(prevLines, rendered); // §2
  process.stdout.write(out);
  prevLines = rendered;
}
```

O ponto-chave: **`renderMarkdown` recebe o texto inteiro acumulado**, não o delta. Assim
um `**` aberto é tratado como texto literal até fechar — sem flicker de formatação.

### Armadilhas

- **Parse incremental ingênuo**: tentar interpretar `**` no meio do streaming faz a
  formatação "piscar". Prefira re-renderizar o acumulado.
- **Custo**: re-renderizar tudo a cada token é caro; combine com `fps` alvo e diff.
- **Código inline vs bloco**: um ``` abre um bloco de código; enquanto ele não fecha,
  o conteúdo deve ser monospace cru — re-renderizar o acumulado resolve.
- **Sanitização**: texto do modelo pode conter sequências ANSI; **escape** antes de
  emitir, ou o modelo "pinta" o terminal. (Regra de segurança: conteúdo de modelo é
  dado, não comando.)

---

## 4. Chamada de ferramenta

### O que é

Mostrar que o agente está executando uma ferramenta (`read arquivo`, `bash ls`, `edit
arquivo`) de forma **discreta** (não polui a conversa) e **na ordem certa** (ordem de
execução, não ordem de exibição).

### Quem usa

- **Claude Code**: cada tool call aparece no transcript com marcador `⏺` e o nome da
  ferramenta + alvo. A cheatsheet descreve tools (read, edit, bash, web) e diz que "Each
  tool call appears in the transcript".
  Fonte: https://support.claude.com/en/articles/14553413-claude-code-cheatsheet
- **OpenCode**: usa o mesmo padrão visual `⏺` nas mensagens de ferramenta.
  Fonte: `[não verificado: doc oficial do OpenCode]` — o padrão `⏺` é observável no
  próprio OpenCode (este ambiente).

### Formato discreto

```
⏺ read src/index.ts
  ⎿ 120 linhas (2.1 KB)
```

- `⏺` marca "ferramenta"; o nome e o alvo vêm na mesma linha.
- O resultado (resumo) vem indentado abaixo, em dim/cor apagada.
- Só工具相 bem-sucedidas mostram resumo; falhas mostram o erro.

### Ordem certa

O ponto crítico: **em paralelo**, o agente pode disparar várias ferramentas; a
exibição deve seguir a **ordem de execução real** (quando cada uma termina), não a
ordem em que foram chamadas. O `ink-diff-renderer` ilustra streaming de alta
frequência com `useBatchedArray` para logs/streams — o mesmo princípio vale para
resultados de ferramenta chegando em ordem assíncrona.

### Implementação em ANSI puro

```js
// Linha de ferramenta: discreta, com dim no resultado.
const dim = "\x1b[2m", reset = "\x1b[0m";
function toolLine(name, target) {
  return `⏺ ${name} ${target}\n`;
}
function toolResult(summary) {
  return `  ⎿ ${dim}${summary}${reset}\n`;
}
```

### Armadilhas

- **Ordem errada**: mostrar na ordem de chamada em vez da ordem de término, em paralelo,
  confunde o usuário. Espere o resultado de cada uma e emita na ordem em que chegam.
- **Poluição**: mostrar o resultado inteiro de uma ferramenta (ex.: `read` de 1000
  linhas) afoga a conversa. Mostre resumo (nº de linhas, bytes) e deixe o detalhe
  para quando o usuário pedir.
- **ANSI não escapado**: o conteúdo da ferramenta pode ter `ESC[...`; escape antes de
  emitir.

---

## 5. Interrupção (Ctrl+C)

### O que é

Ctrl+C que **cancela o turno atual sem matar o processo**, e o usuário percebe que
cancelou.

### Como funciona no terminal

- Em modo **raw** (`process.stdin.setRawMode(true)`), o terminal **não** gera `SIGINT`
  automaticamente: "all special processing of characters by the terminal is disabled,
  including echoing input characters. Ctrl+C will no longer cause a SIGINT when in this
  mode." Você recebe o byte `0x03` e decide o que fazer.
  Fonte: https://nodejs.org/api/tty.html (ReadStream.setRawMode) e
  https://bun.sh/reference/node/tty/ReadStream/setRawMode
- Fora do raw mode, Ctrl+C gera `SIGINT` (processo pode tratar com
  `process.on('SIGINT', ...)`).
  Fonte: https://nodejs.org/api/process.html

### O padrão em CLIs de agente

- **Primeiro Ctrl+C**: cancela o turno em curso (aborta a requisição/geração) mas o
  processo continua vivo, voltando ao prompt.
- **Segundo Ctrl+C** (ou Ctrl+C com nada rodando): sai do processo (ou limpa a linha).
  `[não verificado: número exato de toques — Claude Code usa 1 para cancelar, 2 para
  sair; OpenCode idem; comportamento observável, não documentado]`

### Feedback para o usuário

O usuário precisa **ver** que cancelou. Padrões:
- Mostrar `^C` na linha de input (como o shell faz) ou uma mensagem `cancelado`.
- Parar o spinner/animação imediatamente.
- Em `ink-diff-renderer`, o `SIGINT` destrói o terminal e sai
  (`process.on('SIGINT', () => { terminal.destroy(); process.exit(0); })`) — mas isso é
  para "sair", não para "cancelar turno". Para cancelar turno, trate o `0x03` no raw
  mode e **não** destrua o terminal.

### Implementação em ANSI puro (raw mode)

```js
// Ctrl+C em raw mode = byte 0x03, não SIGINT.
process.stdin.setRawMode(true);
process.stdin.on("data", (chunk) => {
  const buf = Buffer.from(chunk);
  if (buf.includes(0x03)) {        // Ctrl+C
    abortTurn();                    // cancela a geração/turno atual
    process.stdout.write("^C\n");  // feedback visível
    return;
  }
  handleInput(buf);
});
```

Se preferir deixar o terminal gerar `SIGINT` (fora do raw mode):

```js
process.on("SIGINT", () => {
  // não process.exit: só cancela o turno e volta ao prompt
  abortTurn();
  process.stdout.write("^C\n");
});
```

### Armadilhas

- **Matar o processo no primeiro Ctrl+C**: o usuário perde o trabalho. Cancele o turno,
  não o processo.
- **Sem feedback**: se nada muda na tela, o usuário acha que "não funcionou" e aperta
  de novo — e aí você mata o processo. Sempre mostre `^C` ou "cancelado".
- **Raw mode + Ctrl+C**: em raw mode Ctrl+C **não** vira `SIGINT` — se você só escuta
  `SIGINT`, o Ctrl+C é ignorado. Escute o byte `0x03`.
- **Não restaurar o terminal**: se você mexeu em raw mode / alt-screen, restaure
  (`setRawMode(false)`, `ESC[?1049l`, `ESC[?25h`) antes de sair, ou o terminal do
  usuário fica "quebrado".

---

## 6. Largura e responsividade

### O que é

Lidar com 80 colunas, resize (`SIGWINCH`), texto muito longo, emojis e caracteres
largos (East-Asian Width).

### O problema de largura

- Terminais têm largura variável (80, 100, 120…). Texto maior que a largura **quebra a
  linha** (wrap) ou é cortado.
- Caracteres **wide** (CJK, emoji) ocupam **2 colunas**, não 1. Se você conta 1 por
  caractere, o layout quebra (alinhamento, bordas, truncate).
- Unicode define a propriedade **East_Asian_Width** (UAX #11): `Narrow`, `Wide`,
  `Fullwidth`, `Halfwidth`, `Ambiguous`. "Wide characters behave like ideographs... For a
  traditional East Asian fixed pitch font, this width translates to a display width of
  either one half or a whole unit width."
  Fonte: https://unicode.org/reports/tr11/ (UAX #11, Unicode 18.0.0, 2026-07-31).

### Como medir largura corretamente

- Use a propriedade `East_Asian_Width` do Unicode: `W` e `F` ocupam 2 colunas; `Na`,
  `H`, `N` ocupam 1; `A` (Ambiguous) depende do contexto/locale.
- Emoji são tratados como wide (o UAX #11 diz que "emoji characters... were treated as
  wide characters").
- Node não tem função embutida de `wcwidth` `[não verificado: não há API padrão]`; bibliotecas
  como `string-width` (npm) implementam isso `[não verificado: dependência externa]`.
  Implementação própria: percorrer os code points e consultar a tabela `East_Asian_Width`.

### Resize (`SIGWINCH`)

- Node emite `SIGWINCH` quando o console é redimensionado. No Windows, só quando o
  cursor se move ou há escrita. Fonte: https://nodejs.org/api/process.html
- Ao receber `SIGWINCH`: leia o novo tamanho (`process.stdout.columns` /
  `process.stdout.rows`) e faça **fullRefresh** (redesenho completo), porque coordenadas
  antigas não valem.

### Implementação em ANSI puro (largura + truncate + resize)

```js
// Largura de um caractere segundo East_Asian_Width (simplificado).
// W (Wide) e F (Fullwidth) = 2; demais = 1. Emoji (surrogate pairs / code points altos) = 2.
function charWidth(cp) {
  if (cp >= 0x1100 && (
    cp <= 0x115f ||                       // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0xa4cf) ||     // CJK
    (cp >= 0xac00 && cp <= 0xd7a3) ||     // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) ||     // CJK compat
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||     // Fullwidth forms
    (cp >= 0x1f300 && cp <= 0x1faff)      // emoji
  )) return 2;
  return 1;
}
function strWidth(s) {
  let w = 0;
  for (const ch of s) w += charWidth(ch.codePointAt(0));
  return w;
}
function truncate(s, maxCols) {
  let out = "", w = 0;
  for (const ch of s) {
    const cw = charWidth(ch.codePointAt(0));
    if (w + cw > maxCols) break;
    out += ch; w += cw;
  }
  return out;
}
// resize:
process.stdout.on("resize", () => {
  const cols = process.stdout.columns ?? 80;
  fullRefresh(cols); // redesenha tudo com a nova largura
});
process.on("SIGWINCH", () => {
  const cols = process.stdout.columns ?? 80;
  fullRefresh(cols);
});
```

### Armadilhas

- **Contar 1 por caractere**: alinhamento quebra com CJK/emoji. Use a largura real.
- **Emojis com ZWJ / sequências**: uma "família" é vários code points mas 1 glifo (2
  colunas). `strWidth` ingênuo superestima. `[não verificado: tratamento completo de
  ZWJ/emoji sequences]`
- **Ambiguous width**: caracteres `A` (ex.: alguns símbolos) são 1 ou 2 conforme o
  locale; escolha um e seja consistente.
- **Ignorar resize**: sem `SIGWINCH`/`resize`, o desenho fica cortado ou desalinhado
  após o usuário redimensionar a janela.
- **Wrap vs truncate**: se você conta errado a largura, o terminal quebra a linha no meio
  de um caractere wide, corrompendo o desenho.

---

## 7. Estados vazios

### O que é

O que mostrar quando **não há nada**: sem conversa, sem resultado de busca, sem
ferramentas.

### Princípio

Um estado vazio não é "tela em branco": é uma **instrução**. Diga o que o usuário pode
fazer.

### Exemplos

| situação | o que mostrar |
|:---|:---|
| sem conversa | "Nenhuma mensagem ainda. Digite `/` para ver os comandos ou comece a escrever." |
| busca sem resultado | "nada encontrado — talvez ainda não tenha sido gerado" (padrão que já usamos em `skills <termo>`, ver `core/forge/cli.mjs`) |
| sem ferramentas | "Nenhuma ferramenta disponível." |
| erro | mensagem acionável (o que aconteceu + o que fazer) |

Fontes: o padrão "nada encontrado" é o que o `cli.mjs` do SelfEvoPI já emite
(`core/forge/cli.mjs`, linha ~365 `[não verificado: número exato]`). CLIs como Claude
Code mostram dicas de comando no início `[não verificado: spec]`.

### Implementação

```js
function emptyState(kind, hint) {
  return `\x1b[2m${kind}\x1b[0m\n  ${hint}\n`; // dim + dica
}
```

### Armadilhas

- **Tela em branco**: o usuário não sabe se "não achou" ou "quebrou". Sempre dê uma
  mensagem.
- **Erro genérico**: "erro" sem contexto não é acionável. Diga o que aconteceu e o
  próximo passo.

---

## 8. Armadilhas conhecidas

| armadilha | por que quebra | como evitar |
|:---|:---|:---|
| **Flicker por redesenho total** | apagar+reescrever a tela inteira a cada frame | diff + double buffer (§2) |
| **Resíduo de linhas** | nova lista menor que a anterior deixa linhas antigas | `ESC[K` por linha ou `ESC[J` no fim |
| **Alt-screen engole histórico** | `ESC[?1049h` restaura a tela ao sair | usar main screen (scrollback) para chat |
| **Resize no meio corrompe** | coordenadas antigas (`ESC[r;cH`) apontam errado | `SIGWINCH` → fullRefresh (§6) |
| **Ctrl+C em raw mode não vira SIGINT** | raw mode desliga o processamento do terminal | escutar o byte `0x03` (§5) |
| **Ctrl+C mata o processo** | tratar `SIGINT` com `process.exit` | cancelar turno, não o processo (§5) |
| **Contar 1 por caractere** | CJK/emoji ocupam 2 colunas; layout quebra | East_Asian_Width (§6) |
| **Markdown piscando no streaming** | parse incremental de `**` aberto | re-renderizar o acumulado (§3) |
| **ANSI não escapado do modelo** | conteúdo do modelo "pinta" o terminal | escapar `ESC` antes de emitir (§4) |
| **Ordem de ferramentas errada** | exibir na ordem de chamada, não de término | emitir na ordem em que chegam (§4) |
| **Tela vazia sem instrução** | usuário não sabe o que fazer | empty state com dica (§7) |
| **Não restaurar o terminal** | raw/alt-screen sem restore deixa o terminal quebrado | restaurar `setRawMode(false)` + `ESC[?1049l` + `ESC[?25h` |

## 9. Checklist de qualidade

10 itens verificáveis que separam uma TUI boa de uma ruim.

- [ ] **1. Sem flicker no redraw** — a lista/área atualiza sem piscar. Verificação: grave
  a saída (script/`tee`) e observe; ou rode em um terminal e pisque os olhos durante um
  update de alta frequência. Deve haver diff, não repaint total.
- [ ] **2. Sem resíduo ao encolher** — uma lista que passa de 10 para 3 linhas não deixa
  7 linhas antigas. Verificação: filtre de 10 → 3 itens e cheque que só 3 linhas ficam.
- [ ] **3. Ctrl+C cancela sem matar** — primeiro Ctrl+C aborta o turno e volta ao prompt;
  processo continua vivo. Verificação: inicie uma geração, aperte Ctrl+C, veja `^C`/`cancelado`
  e o prompt de volta; o processo não sai.
- [ ] **4. Restaura o terminal ao sair** — após sair, o shell está normal (cursor visível,
  sem raw mode, sem alt-screen preso). Verificação: rode a TUI, saia, e cheque que o
  prompt funciona e o histórico não ficou na tela alternativa.
- [ ] **5. Largura correta com CJK/emoji** — linhas com 中文 e 🚀 alinham com linhas ASCII.
  Verificação: renderize uma linha com `"ascii 中文 🚀"` e outra só ASCII; as bordas
  coincidem.
- [ ] **6. Sobrevive a resize** — redimensione a janela durante a execução; o desenho se
  reorganiza sem corromper. Verificação: rode, redimensione, veja se alinha.
- [ ] **7. Markdown não pisca no streaming** — `**negrito**` e `` `código` `` aparecem
  formados, sem alternar entre literal e formatado. Verificação: stream com um modelo e
  observe um trecho com `**`; deve ficar nítido.
- [ ] **8. Tool call discreta e ordenada** — cada ferramenta aparece como `⏺ nome alvo`
  com resumo indentado, na ordem em que termina. Verificação: dispare ferramentas em
  paralelo e cheque a ordem de exibição.
- [ ] **9. Empty state útil** — sem dados, a TUI diz o que fazer (não fica em branco).
  Verificação: abra sem conversa; deve haver uma dica.
- [ ] **10. Conteúdo do modelo é escapado** — um `ESC[31m` vindo do modelo não pinta o
  terminal. Verificação: injete um texto com `\x1b[31m` e veja que aparece como texto
  (ou é removido), não como vermelho.

---

## Fontes

**Primárias (abertas 2026-11-17):**

1. ECMA-48 5ª ed. (1991) — Control Functions for Coded Character Sets:
   https://ecma-international.org/wp-content/uploads/ECMA-48_5th_edition_june_1991.pdf
2. ECMA-48 — Coded Representations (seções 4.x, tabelas 2/3):
   https://wezfurlong.org/ecma48/04-coding.html
3. Unicode UAX #11 — East Asian Width (Unicode 18.0.0, 2026-07-31):
   https://unicode.org/reports/tr11/
4. Node.js — Process (SIGWINCH):
   https://nodejs.org/api/process.html
5. Node.js — TTY (setRawMode):
   https://nodejs.org/api/tty.html
6. Node.js — Readline:
   https://nodejs.org/api/readline.html
7. Ink (React para CLI):
   https://github.com/vadimdemedes/ink
8. ink-diff-renderer (diffing, double buffer, DEC 2026, alt-screen vs scrollback):
   https://github.com/kazhiramatsu/ink-diff-renderer
9. Textual — Reactivity (smart refresh):
   https://textual.textualize.io/guide/reactivity/
10. Textual — Command Palette:
    https://textual.textualize.io/command_palette/
11. Ratatui — Concepts:
    https://ratatui.rs/concepts/
12. fzf (algoritmo v2):
    https://github.com/junegunn/fzf e
    https://deepwiki.com/nvim-telescope/telescope-fzf-native.nvim/2-core-fzf-algorithm
13. Claude Code — CLI reference:
    https://code.claude.com/docs/en/cli-reference
14. Claude Code — Streaming output:
    https://code.claude.com/docs/en/agent-sdk/streaming-output
15. Claude Code — cheatsheet (tools no transcript):
    https://support.claude.com/en/articles/14553413-claude-code-cheatsheet
16. ANSI escape code (histórico, DEC private modes):
    https://en.wikipedia.org/wiki/ANSI_escape_code
17. Streaming markdown (re-render do acumulado):
    https://community.openai.com/t/streaming-markdown-or-other-formatted-text/510268
18. streaming-markdown (parser de markdown incompleto):
    https://github.com/thetarnav/streaming-markdown
19. stream-markdown-parser (npm):
    https://www.npmjs.com/package/stream-markdown-parser

**Secundárias / `[não verificado]`:**

- Stack exato do OpenCode (Ink?) — não confirmado nesta consulta.
- Comportamento de "1 Ctrl+C cancela, 2 Ctrl+C sai" — observável em Claude Code/OpenCode,
  sem doc oficial que fixe o número.
- `wcwidth` / `string-width` — dependências npm, não verificadas nesta consulta.
- Tratamento completo de ZWJ/emoji sequences — não verificado.
- Lista completa de keybindings do `node:readline` — não verificada integralmente.