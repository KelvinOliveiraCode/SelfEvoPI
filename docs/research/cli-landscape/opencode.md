# OpenCode CLI — comandos de barra, modos, atalhos e a paleta

> **Consulta:** 2026-11-17
> **Alvo:** [OpenCode](https://opencode.ai) — agente de código open source (TUI, desktop e web).
> **Versão medida localmente:** `opencode v2.3.0` (`opencode --version`, 2026-11-17).
> **Repositório:** `sst/opencode` redireciona para **`anomalyco/opencode`**, branch padrão `dev`
> (<https://api.github.com/repos/sst/opencode>).
> **Documentação:** a doc pública foi reestruturada em **v2**. A página v1 de slash commands
> (https://opencode.ai/docs/slash-commands/) responde **404**. As páginas usadas aqui estão
> no sitemap: <https://opencode.ai/docs/sitemap.xml>.

**Convenção de fonte.** Cada bloco traz a URL de origem. Quando a informação veio da
**código-fonte** (não da doc), o link aponta para o arquivo e a linha no GitHub.
Quando não foi possível verificar, está escrito **"não verificado"** — nunca uma
inferência apresentada como fato.

---

## 1. Comandos de barra

São **34** comandos de barra no TUI, distribuídos em quatro arquivos do
código-fonte. A lista vem de `slash: { name: … }` em cada registro de comando;
não é uma lista de doc, é o que o binário registra.

### 1.1 Globais (`packages/tui/src/app.tsx`)

| Comando | O que faz | Fonte |
|:---|:---|:---|
| `/sessions` | Switch session (alias: `resume`, `continue`) | [app.tsx:768](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/app.tsx#L768) |
| `/new` | New session | [app.tsx:778](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/app.tsx#L778) · [doc](https://opencode.ai/docs/cli/tui/) |
| `/clear` | Clear session | [app.tsx:804](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/app.tsx#L804) |
| `/open` | Open session or project (alias: `projects`, `project`) | [app.tsx:831](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/app.tsx#L831) |
| `/models` | Switch model | [app.tsx:907](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/app.tsx#L907) · [doc](https://opencode.ai/docs/cli/tui/) |
| `/agents` | Switch agent | [app.tsx:952](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/app.tsx#L952) · [doc](https://opencode.ai/docs/cli/tui/) |
| `/usage` | View usage | [app.tsx:961](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/app.tsx#L961) |
| `/mcps` | MCP servers | [app.tsx:970](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/app.tsx#L970) |
| `/variants` | Switch model variant (alias: `thinking`, `effort`) | [app.tsx:997](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/app.tsx#L997) |
| `/connect` | Connect an integration | [app.tsx:1022](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/app.tsx#L1022) · [doc](https://opencode.ai/docs/) |
| `/highlights` | Show release highlights | [app.tsx:1037](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/app.tsx#L1037) · [doc](https://opencode.ai/docs/cli/tui/) |
| `/settings` | Open settings | [app.tsx:1047](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/app.tsx#L1047) |
| `/status` | View status | [app.tsx:1056](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/app.tsx#L1056) |
| `/update` | Update OpenCode — **só existe quando há update disponível** (`updater.open`) | [app.tsx:1062-1071](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/app.tsx#L1062) |
| `/pair` | Pair device (alias: `web`) | [app.tsx:1076](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/app.tsx#L1076) |
| `/restart` | Restart service — **só existe quando o cliente suporta restart** | [app.tsx:1082-1100](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/app.tsx#L1082) |
| `/reload` | Reload configuration | [app.tsx:1106](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/app.tsx#L1106) |
| `/debug` | View debug info | [app.tsx:1122](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/app.tsx#L1122) |
| `/themes` | Switch theme | [app.tsx:1131](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/app.tsx#L1131) |
| `/help` | Help | [app.tsx:1162](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/app.tsx#L1162) |
| `/exit` | Exit the app (alias: `quit`, `q`) | [app.tsx:1180](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/app.tsx#L1180) |

### 1.2 De sessão (`packages/tui/src/routes/session/index.tsx`)

| Comando | O que faz | Fonte |
|:---|:---|:---|
| `/rename` | Rename session — **recebe argumento**; sem argumento abre diálogo | [session/index.tsx:1063](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/routes/session/index.tsx#L1063) |
| `/timeline` | Jump to message | [session/index.tsx:1078](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/routes/session/index.tsx#L1078) |
| `/fork` | Fork session | [session/index.tsx:1087](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/routes/session/index.tsx#L1087) |
| `/compact` | Compact session | [session/index.tsx:1104](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/routes/session/index.tsx#L1104) · [doc](https://opencode.ai/docs/compaction/) |
| `/undo` | Undo previous message (reverte a mensagem e o trabalho posterior; o texto volta ao prompt) | [session/index.tsx:1128](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/routes/session/index.tsx#L1128) · [doc](https://opencode.ai/docs/cli/tui/) |
| `/redo` | Redo | [session/index.tsx:1156](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/routes/session/index.tsx#L1156) · [doc](https://opencode.ai/docs/cli/tui/) |
| `/copy` | Copy last assistant message | [session/index.tsx:1281](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/routes/session/index.tsx#L1281) |
| `/export` | Export session transcript (markdown ou json, com opção de sanitizar) | [session/index.tsx:1354](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/routes/session/index.tsx#L1354) |

### 1.3 De prompt (`packages/tui/src/component/prompt/index.tsx`)

| Comando | O que faz | Fonte |
|:---|:---|:---|
| `/cd` | Change working directory — **recebe argumento** | [prompt/index.tsx:272](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/component/prompt/index.tsx#L272) |
| `/editor` | Open editor (usa `$VISUAL`/`$EDITOR`) | [prompt/index.tsx:555](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/component/prompt/index.tsx#L555) · [doc](https://opencode.ai/docs/cli/tui/) |
| `/skills` | Skills (seletor de skills) | [prompt/index.tsx:588](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/component/prompt/index.tsx#L588) |
| `/worktrees` | Manage workspaces | [prompt/index.tsx:628](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/component/prompt/index.tsx#L628) |

### 1.4 De plugin (`packages/tui/src/feature-plugins/prompt/btw.tsx`)

| Comando | O que faz | Fonte |
|:---|:---|:---|
| `/btw` | Ask a side question — **recebe argumento**; sem argumento abre um prompt "Ask anything". A resposta usa o contexto e o modelo da sessão, mas **não entra na conversa** | [btw.tsx:54-66](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/feature-plugins/prompt/btw.tsx#L54) · [doc](https://opencode.ai/docs/cli/tui/) |

### 1.5 Comandos do prompt do composer web (não do TUI)

A suíte web (`packages/app`) tem um registro próprio, com `slash` em
`model`, `connect`, `reload` e `agent`
([commands.tsx:109-162](https://github.com/anomalyco/opencode/blob/dev/packages/app/src/composer/commands.tsx#L109)).
**Não** são os mesmos comandos do TUI — é outra superfície. Confundir os dois
leva a documentar `/model` (singular) como se existisse no terminal, e não existe:
no TUI é `/models`.

### 1.6 Comandos que a doc cita mas o código não registra

A página da TUI cita `/new`, `/sessions`, `/models`, `/agents`, `/undo`, `/redo`
e `/editor` como "common commands" ([doc](https://opencode.ai/docs/cli/tui/)).
Todos os seis existem no código. Já estes **não** aparecem como comando de barra
no TUI v2.3.0:

| Comando | Situação |
|:---|:---|
| `/share` | **não verificado** — não há `slash: { name: "share" }` em nenhum arquivo do TUI; o que existe é `/pair` (device pairing) e `opencode pair` no CLI |
| `/init` | **não verificado** — não há registro; o fluxo equivalente é o agente `plan` e o comando `opencode run` |
| `/compact` | existe (ver 1.2) |

---

## 2. Modos e agentes

### 2.1 Os agentes embutidos

A doc de agentes lista quatro agentes visíveis
([doc](https://opencode.ai/docs/agents/)):

| Agente | Modo | O que faz |
|:---|:---|:---|
| **Build** (`build`) | `primary` | Agente de código padrão. Ferramentas e acesso fora do workspace liberados por padrão; leitura de arquivos sensíveis (`.env`) pede aprovação. |
| **Plan** (`plan`) | `primary` | Explora e planeja **sem editar** arquivos do projeto. Pode escrever arquivos de plano do OpenCode quando pedido; comandos de shell continuam sob permissão. |
| **General** (`general`) | `subagent` | Pesquisa e trabalho em várias etapas, com acesso amplo a ferramentas, mas **não pode lançar outros subagentes**. |
| **Explore** (`explore`) | `subagent` | Busca e lê código ou fontes web sem editar arquivos. |

Há ainda agentes **ocultos** (`hidden: true`) de manutenção — `compaction`,
`title` e `summary` — que não podem ser selecionados
([doc](https://opencode.ai/docs/agents/)).

**Divergência de doc que vale registrar:** o README do repositório diz
"two built-in agents you can switch between with the `Tab` key" e cita apenas
`build` e `plan` ([README.md:85-96](https://github.com/anomalyco/opencode/blob/dev/README.md#L85)).
A doc de agentes fala em quatro. O código-fonte da TUI registra os quatro
comandos (`/agents`) e o ciclo de agente
([keymap](https://opencode.ai/docs/cli/keybinds/)). Trate o README como
defasado nesse ponto.

### 2.2 Os três modos

`mode` vem do frontmatter/config de cada agente
([doc](https://opencode.ai/docs/agents/)):

| Modo | Comportamento |
|:---|:---|
| `primary` | Roda como agente principal da sessão. É o padrão de um agente novo. |
| `subagent` | Roda **só** em sessão filha, via ferramenta `subagent`. |
| `all` | Roda como principal **ou** como subagente. |

Subagentes rodam com contexto novo, em sessões filhas, **sempre em background**:
o pai recebe um relatório quando o filho fica ocioso, e novamente a cada rodada
posterior de trabalho ([doc](https://opencode.ai/docs/agents/)).

### 2.3 Como se troca

| Ação | Como | Fonte |
|:---|:---|:---|
| Ciclar agente | **`Shift+Tab`** (`agent.cycle`) | [keybinds](https://opencode.ai/docs/cli/keybinds/) · [doc TUI](https://opencode.ai/docs/cli/tui/) |
| Lista de agentes | **`<leader>a`** (`agent.list`), leader = `Ctrl+X` | [keybinds](https://opencode.ai/docs/cli/keybinds/) |
| Rodar comando de barra | `/agents` | [app.tsx:952](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/app.tsx#L952) |
| Ciclar modelo | **`F2`** (`model.cycle_recent`), `Shift+F2` volta | [keybinds](https://opencode.ai/docs/cli/keybinds/) |
| Escolher modelo | **`<leader>m`** ou `/models` | [keybinds](https://opencode.ai/docs/cli/keybinds/) |
| Ciclar variante | **`Ctrl+T`** (`variant.cycle`) | [keybinds](https://opencode.ai/docs/cli/keybinds/) |

**Atenção:** o README diz "Tab" para trocar de agente; a doc de keybinds diz
`Shift+Tab`. A doc de keybinds é a fonte canônica — `agent.cycle` = `shift+tab`,
e `Tab` puro não está vinculado a troca de agente
([keybinds](https://opencode.ai/docs/cli/keybinds/)).

Não existe um par "plan/build" com nomes próprios de modo: são **agentes**
(`plan`, `build`), e o que muda entre eles é o `mode` (ambos `primary`) e as
permissões. Um agente `plan` nega edição e pede aprovação para shell
([doc](https://opencode.ai/docs/agents/)).

---

## 3. Atalhos

Leader padrão: **`Ctrl+X`**. Tudo que usa `<leader>` abaixo depende dele
([keybinds](https://opencode.ai/docs/cli/keybinds/)).

### 3.1 Navegação e entrada

| Tecla | O que faz | ID |
|:---|:---|:---|
| `Enter` | Envia o prompt. **Enquanto o OpenCode trabalha, `Enter` "dirige" (steer) a sessão ativa** | `input.submit` |
| `Shift+Enter` / `Ctrl+Enter` / `Alt+Enter` / `Ctrl+J` | Nova linha | `input.newline` |
| `Ctrl+X` depois `Enter` | Enfileira o prompt para depois | `prompt.queue` (`<leader>return`) |
| `Esc` | Interrompe a sessão / fecha o diálogo | `session.interrupt` |
| `↑` / `↓` | Histórico do prompt | `prompt.history.previous/next` |
| `Ctrl+O` | Menu de sessões e projetos recentes | `open.menu` |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Próxima / anterior aba de sessão | `session.tab.next/previous` |

### 3.2 Menções `@`, `#`, `!` e `/`

| Gatilho | Comportamento | Fonte |
|:---|:---|:---|
| `@` | Busca de arquivo. Digite `@` e continue digitando para filtrar; selecione para anexar ao prompt. Aceita linha ou faixa: `@src/auth.ts#20-45` | [doc TUI](https://opencode.ai/docs/cli/tui/) |
| `!` no início de um prompt vazio | **Modo shell**. Digite o comando e `Enter`; `Esc` sai sem executar. A saída fica na sessão | [doc TUI](https://opencode.ai/docs/cli/tui/) |
| `/` no início | Lista comandos de barra (ver §4) | [autocomplete.tsx:829-832](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/component/prompt/autocomplete.tsx#L829) |
| `#` | **não verificado** — não encontrei menção a `#` nas páginas de TUI nem no código baixado |

### 3.3 Atalhos que mais importam

| Tecla | Ação | Fonte |
|:---|:---|:---|
| `Ctrl+P` | **Paleta de comandos** (`command.palette.show`) — "List available commands" | [keybinds](https://opencode.ai/docs/cli/keybinds/) · [doc](https://opencode.ai/docs/cli/tui/) |
| `F2` / `Shift+F2` | Ciclar modelo recente (frente/trás) | [keybinds](https://opencode.ai/docs/cli/keybinds/) |
| `Shift+Tab` | Ciclar agente | [keybinds](https://opencode.ai/docs/cli/keybinds/) |
| `Ctrl+T` | Ciclar variante do modelo | [keybinds](https://opencode.ai/docs/cli/keybinds/) |
| `<leader>c` | Compactar sessão | [keybinds](https://opencode.ai/docs/cli/keybinds/) |
| `<leader>u` / `<leader>r` | Undo / redo | [keybinds](https://opencode.ai/docs/cli/keybinds/) |
| `<leader>e` | Abrir editor externo | [keybinds](https://opencode.ai/docs/cli/keybinds/) |
| `<leader>n` / `<leader>l` | Nova sessão / listar sessões | [keybinds](https://opencode.ai/docs/cli/keybinds/) |
| `<leader>x` | Exportar sessão para o editor | [keybinds](https://opencode.ai/docs/cli/keybinds/) |
| `<leader>q` | Gerenciar prompts enfileirados | [keybinds](https://opencode.ai/docs/cli/keybinds/) |
| `Ctrl+B` | Mandar ferramentas bloqueantes para background | `session.background` |
| `Ctrl+R` | Renomear sessão | `session.rename` |
| `Ctrl+D` | Apagar sessão | `session.delete` |

Todos os IDs acima estão na tabela canônica de keybinds
([keybinds](https://opencode.ai/docs/cli/keybinds/)). Atalhos podem ser
redefinidos em `cli.json`, e uma tecla pode ser desligada com `"none"`/`false`.

---

## 4. A paleta de comandos

Aqui há **duas** coisas distintas que o usuário chama de "paleta". Confundir as
duas é o erro mais fácil de cometer ao documentar este TUI.

### 4.1 A lista de `/` (a que o usuário digita)

O gatilho é uma função só: `slashTriggerIndex(beforeCursor, widthMethod)`, e a
lista abre **apenas quando o `/` está na posição 0** do prompt
([autocomplete.tsx:829-832](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/component/prompt/autocomplete.tsx#L829)):

```ts
const slash = slashTriggerIndex(beforeCursor, renderer.widthMethod)
if (slash === 0) {
  show("command")
  setStore("index", slash)
}
```

**O que a lista mostra.** Duas fontes concatenadas
([autocomplete.tsx:491-521](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/component/prompt/autocomplete.tsx#L491)):

1. comandos internos do keymap que tenham `slash` (os 34 da §1);
2. comandos do servidor/localização (`data.location.command.list(...)`) — os
   comandos customizados em `.opencode/commands/*.md` e no config.

Cada item é renderizado como `/nome` + descrição, **com o nome padronizado por
espaços** até a maior largura, para que as descrições fiquem alinhadas
(`display.padEnd(max + 2)`). A lista é ordenada alfabeticamente por
`display.localeCompare` — ou seja, por nome, não por relevância.

**Como filtra** (`autocomplete.tsx:569-592`):

```ts
const fuzziedNonFiles = fuzzysort.go(stripFileLineRange(searchValue), nonFileOptions, {
  keys: [
    (obj) => stripFileLineRange((obj.value ?? obj.display).trimEnd()),
    ...(store.visible === "command" ? ["description" as const] : []),
    (obj) => obj.aliases?.join(" ") ?? "",
  ],
  threshold: store.visible === "reference" ? 0.5 : 0,
  limit: 10,
  scoreFn: (objResults) => {
    let score = objResults.score
    if (displayResult.target.startsWith(prefix + searchValue)) score *= 2
    const frecencyScore = objResults.obj.path ? frecency.getFrecency(objResults.obj.path) : 0
    return score * (1 + frecencyScore)
  },
})
```

Em palavras:

- **Fuzzy, não substring.** `fuzzysort` casa os caracteres do que você digitou
  fora de ordem (typo-tolerante).
- **Três chaves:** o nome, a **descrição** (só para `/` — para `@` a descrição
  trazia itens irrelevantes, diz o comentário do código) e os **aliases**.
- **Limiar 0** para comandos (sem corte); 0,5 para menções `@`.
- **Teto de 10 resultados** (`limit: 10`).
- **Bônus de prefixo ×2:** se o alvo começa com `/` + o que você digitou, a
  pontuação dobra. Isso faz `/mo` colocar `/models` na frente de qualquer coisa
  que só tenha "mo" no meio.
- **Frecência** multiplica a pontuação por caminhos de arquivo (não afeta
  comando de barra, que não tem `path`).

**O que acontece ao aceitar.** Depende de uma flag no registro do comando
([autocomplete.tsx:495-499](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/component/prompt/autocomplete.tsx#L495)):

```ts
onSelect: slash.arguments ? () => insertSlash(name) : command.run,
```

- `arguments: true` → **não executa**; insere `/nome ` (com espaço final) no
  prompt e devolve o controle ao usuário, que continua digitando o argumento.
  É o caso de `/rename`, `/cd`, `/btw`.
- sem `arguments` → **executa na hora** e fecha a lista.

Isso é a parte mais elegante do desenho: o mesmo comando serve para "ação
imediata" e para "ação com argumento", e a diferença é uma linha no registro.

**Como navega** (`autocomplete.tsx:601-643`):

- `move(±1)` com `policy: "wrap"` — chega ao fim e volta ao começo.
- A seleção **zera a cada filtro** (`createEffect` → `setStore("selected", 0)`).
- A lista **rola para revelar** a seleção (`revealSelectionOffset`), sem
  rolagem manual.
- `Esc` / dismiss esconde a lista; `prompt.clear` descarta de vez.
- Estado vazio: `"No matching commands"` (`autocomplete.tsx:858`).

### 4.2 A paleta `Ctrl+P` (ações, não comandos de barra)

`Ctrl+P` abre um `DialogSelect` distinto, que lista **ações** (keymap commands
com `palette: true`) **mais** as configurações
([command-palette.tsx](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/component/command-palette.tsx)):

- Título **"Commands"**, placeholder **"Search commands"**.
- **Sem filtro**, mostra primeiro um grupo **"Suggested"** (comandos marcados
  como `suggested`) e depois **todos** os outros.
- **Com filtro**, mostra comandos + settings numa lista plana (`flat={true}`),
  sem cabeçalhos de grupo.
- Cada item carrega `searchText` = `id` + `description`, e um rodapé com
  `grupo · atalho`.
- Filtragem: `fuzzysort` sobre `title`, `category` e `searchText`, com
  **título pesando 2** e categoria/texto pesando 1
  (`scoreFn: r[0].score * 2 + r[1].score + r[2].score`,
  [dialog-select.tsx:221-228](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/ui/dialog-select.tsx#L221)).
  Limiar configurável (`filterThreshold`, na paleta = `0.7`).
- Selecionar executa `command.run()` e limpa o diálogo.

**Resumo da diferença:** `/` é *digitação* (filtro incremental no prompt,
máx. 10, executa ou insere argumento); `Ctrl+P` é *descoberta* (lista todas as
ações da view atual, com grupo "Suggested", e muda de contexto para settings).

---

## 5. Estados e feedback

### 5.1 Streaming

- A TUI mostra o texto chegando de forma incremental enquanto o modelo
  responde. É o que a doc pressupõe quando diz que, com o OpenCode trabalhando,
  `Enter` **dirige** a sessão em andamento em vez de esperar a vez
  ([doc TUI](https://opencode.ai/docs/cli/tui/)).
- Há um keybind dedicado a **mostrar/ocultar blocos de raciocínio**:
  `session.toggle.thinking` ([keybinds](https://opencode.ai/docs/cli/keybinds/)).
- **Não verificado:** os nomes dos eventos de streaming (`text_delta`,
  `thinking_delta`, `message_update`). Não encontrei página de eventos na doc v2
  — `https://opencode.ai/docs/json/` responde 404 e o sitemap não a lista — nem
  esses identificadores em `packages/client/src/shared-events.ts`. Sem fonte,
  não afirmo.
- **Steering:** com o OpenCode trabalhando, `Enter` envia o texto como *steer*
  da sessão ativa em vez de esperar a vez
  ([doc TUI](https://opencode.ai/docs/cli/tui/)).
- **Enfileirar:** `Ctrl+X` depois `Enter` (`prompt.queue`) deixa o prompt para
  depois, com um contador no rodapé.

### 5.2 Tool calls

- O transcript agrupa chamadas de ferramenta relacionadas; há dois keybinds
  para isso: `session.toggle.exploration_grouping` e
  `session.verbosity.cycle` ([keybinds](https://opencode.ai/docs/cli/keybinds/)).
- Sessões filhas têm navegação própria por teclado: `session.child.first`
  (`↓`) abre o seletor de subagentes, `session.child.next`/`previous`
  (`→`/`←`) navegam entre filhos, `session.parent` (`↑`) volta ao pai
  ([keybinds](https://opencode.ai/docs/cli/keybinds/)).
- **Não verificado:** o formato exato do card de tool call (quais campos,
  se mostra duração, se colapsa diffs). A doc pública não descreve e eu não
  capturei a TUI rodando.

### 5.3 Erros

- Erros de operação viram **toast** com variante de erro e a mensagem extraída
  do erro (`toast.show({ message: errorMessage(error), variant: "error" })`) —
  ver, por exemplo,
  [session/index.tsx:1120](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/routes/session/index.tsx#L1120)
  e [:1147](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/routes/session/index.tsx#L1147).
- Erros com detalhe têm diálogo próprio
  (`packages/tui/src/component/dialog-error-details.tsx`) — o arquivo existe no
  repositório ([tree](https://github.com/anomalyco/opencode/tree/dev/packages/tui/src/component)).
- Erros de servidor são formatados por `formatServerError`
  ([session/index.tsx](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/routes/session/index.tsx)).
- **Não verificado:** como um erro de API (429, 402, contexto estourado) aparece
  na tela — se é card no transcript, toast, ou ambos.

### 5.4 "TUI de baixo custo"

O site oficial descreve o produto como
**"A fast terminal UI that works in any shell, editor or remote server"**
(<https://opencode.ai/>). É a afirmação pública de performance que encontrei.

Evidência **de desenho** (não é benchmark, é código):

| Escolha | Onde |
|:---|:---|
| O filtro da lista é **local** (`fuzzysort` no processo), sem chamada de rede | [autocomplete.tsx:569](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/component/prompt/autocomplete.tsx#L569) |
| A lista é **limitada a 10** itens, não renderiza o acervo inteiro | [autocomplete.tsx:578](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/component/prompt/autocomplete.tsx#L578) |
| O diâmetro da lista é derivado da altura do terminal, com indicador `…` em overflow | [dialog-select.tsx:262-274](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/ui/dialog-select.tsx#L262) |
| O TUI é um binário nativo único, servido por um servidor local | [doc CLI](https://opencode.ai/docs/cli/) |

**Não verificado:** qualquer número de latência, FPS ou consumo de memória. Não
medi e não encontrei medição publicada. Se o projeto for comparar "custo" de
 verdade, isso precisa ser medido por nós — a doc não entrega.

---

## 6. O que vale copiar

Filtro: o que um projeto **pequeno, em Node, sem dependências** consegue
reproduzir sem reinventar um motor de UI.

### 6.1 Copiar (barato e alto valor)

1. **Uma flag `arguments` no registro do comando.** É a decisão de UX mais
   importante do TUI: `arguments: true` insere `/nome ` e devolve o controle;
   sem ela, executa. Custa um booleano e evita criar dois comandos
   (`/rename` e `/rename-dialog`) para a mesma coisa.
2. **Uma única tabela de comandos alimentando duas superfícies.** No OpenCode,
   `slash` e `palette` são campos do **mesmo** registro — a lista do `/` e a
   paleta `Ctrl+P` leem o mesmo lugar. Um projeto pequeno ganha consistência
   de graça: se está na tabela, aparece nos dois caminhos.
3. **Bônus de prefixo ×2 no score.** Duas linhas de código, e é o que faz a
   busca parecer "inteligente" sem fuzzy library: `if (alvo.startsWith('/' + termo)) score *= 2`.
4. **Teto de 10 resultados.** Lista infinita em TUI é lista inútil — o usuário
   rola mais do que lê. Dez é um número defensável e cabe em qualquer terminal.
5. **Alinhar descrições com `padEnd`.** De graça, e legibilidade salta. É o
   tipo de detalhe que separa "funciona" de "parece feito".
6. **Grupo "Suggested" quando a lista está sem filtro.** Só o que você marcou
   como sugerido aparece em cima; o resto vem depois. Custo zero, e resolve o
   problema de lista cheia na primeira abertura.
7. **`Esc` sempre esconde; `Enter` sempre aceita.** Não reinventar.

### 6.2 Adaptar com cuidado

8. **`fuzzysort`** é a dependência que faz o filtro bom. Sem dependência, um
   casador de subsequência simples (case-insensitive) + o bônus de prefixo
   entrega 80% do efeito. O valor do `fuzzysort` está no *ranking*, não na
   existência do filtro.
9. **Frequência (frecency)** só vale para caminhos de arquivo, e só depois de
   haver histórico. Não implementar antes de ter uso real.
10. **Filtro por descrição, só para `/`.** O comentário do código é explícito:
    para `@` a descrição trazia itens irrelevantes. Copiar essa assimetria
    evita uma classe chata de bug.

### 6.3 Não copiar

11. **A paleta `Ctrl+P` como `DialogSelect` com 40+ parâmetros.** É uma peça de
    UI de TUI madura, com rolagem virtual, grupos, rodapés e settings
    embutidas. Para um projeto pequeno, uma lista simples com filtro resolve.
12. **34 comandos de barra.** É o resultado de um produto grande. Um projeto
    pequeno deveria começar com **5 a 8** e crescer por demanda — cada comando
    é uma superfície de teste e de documentação.
13. **A estrutura de `keymap` com camadas.** `Keymap.createLayer` com
    `enabled()` e `bindings` é elegante, mas é um mini-framework. Um
    `switch` sobre a tecla resolve até um tamanho razoável.

### 6.4 Para o SelfEvoPI, especificamente

O desenho que eu levaria, em uma frase: **uma tabela
`{ name, description, args, run }`, um filtro local com bônus de prefixo e teto
de 10, e `Enter` que executa ou insere `/name ` conforme `args`.** É
compatível com a regra de zero dependência, cabe em um arquivo, e cobre o
caminho que o usuário mais usa — descobrir o que existe sem sair do prompt.

O que **não** levaria: a paleta de ações (`Ctrl+P`) antes de haver ações
suficientes para justificá-la; e qualquer coisa que dependa de um servidor
local, porque o SelfEvoPI é uma CLI própria, não um cliente de um serviço.

---

## 7. Fontes

### Documentação oficial

| Página | Uso |
|:---|:---|
| <https://opencode.ai/docs/sitemap.xml> | inventário das páginas v2 |
| <https://opencode.ai/docs/cli/tui/> | TUI: `/`, `@`, `!`, steering, comandos comuns |
| <https://opencode.ai/docs/cli/keybinds/> | tabela canônica de keybinds e configuração |
| <https://opencode.ai/docs/agents/> | agentes, modos, permissões |
| <https://opencode.ai/docs/commands/> | comandos customizados (`.opencode/commands/*.md`) |
| <https://opencode.ai/docs/cli/> | CLI: `run`, `mini`, service, paths |
| <https://opencode.ai/docs/compaction/> | `/compact` e orçamento de contexto |
| <https://opencode.ai/docs/migrate-v1/> | formato v2 de config, agents, commands |
| <https://opencode.ai/> | afirmação pública "A fast terminal UI" |

### Código-fonte (branch `dev`, consultado em 2026-11-17)

| Arquivo | Para quê |
|:---|:---|
| `packages/tui/src/app.tsx` | comandos de barra globais |
| `packages/tui/src/routes/session/index.tsx` | comandos de sessão |
| `packages/tui/src/component/prompt/index.tsx` | `/cd`, `/editor`, `/skills`, `/worktrees` |
| `packages/tui/src/component/prompt/autocomplete.tsx` | **a lista do `/`: gatilho, filtro, aceite** |
| `packages/tui/src/feature-plugins/prompt/btw.tsx` | `/btw` |
| `packages/tui/src/context/keymap.tsx` | tipo do campo `slash` |
| `packages/tui/src/ui/dialog-select.tsx` | filtro da paleta `Ctrl+P` |
| `packages/tui/src/component/command-palette.tsx` | composição da paleta |
| `packages/app/src/composer/commands.tsx` | comandos da suíte web (não do TUI) |
| `packages/app/src/composer/client-slash-command.ts` | parser de `/` no cliente |

### Verificado localmente

| Fato | Como |
|:---|:---|
| Versão | `opencode --version` → `2.3.0` |
| Repositório | `GET api.github.com/repos/sst/opencode` → `anomalyco/opencode`, `dev`, 227.524 stars |
| Página v1 de slash commands | `https://opencode.ai/v1/docs/slash-commands/` → HTTP 404 |

### Não verificado

- Formato visual do card de tool call (campos, duração, colapso de diff).
- Como erros de API (429, 402, overflow) aparecem na tela.
- Qualquer número de latência, FPS ou memória da TUI.
- Comportamento do gatilho `#`.