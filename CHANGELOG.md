# Changelog

Todas as mudanças notáveis neste projeto são documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
e este projeto adota [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [1.1.1] - 2026-11-19

**Agnosticismo e robustez.** O 1.1.0 amarrou o harness ao OpenCode; o 1.1.1 tira
essa amarra: as integrações passam a ler a config do **PI** (`~/.pi/`), não a de
outro harness. E conserta o que a auditoria de 1.1 achou: linha colorida
truncada vazando estilo, probe de MCP estourando memória, e a leitura do texto
final do modelo cedo demais.

### Adicionado

**Agnosticismo (passo 1).** As integrações da máquina deixam de apontar para a
config do OpenCode e passam a ler a do PI:

- **Skills** (`core/agent/skills-pc.mjs`) leem `~/.pi/skills` (antes
  `~/.config/opencode/skills`). O parser de frontmatter não depende mais de
  `compatibility: opencode`.
- **MCP global** (`core/agent/mcp-opencode.mjs`) lê `~/.pi/settings.json`, chave
  `mcpServers` — com **compatibilidade legada** `mcp.servers` para não quebrar
  quem já tinha a config antiga. O `probe-mcps.mjs` aponta para `~/.pi/`.

**`PiClient.promptAndWait`** (`core/agent/pi-rpc.mjs`) — novo método que devolve o
texto final sem ler cedo demais. Útil quando o chamador quer o resultado
completo, não um delta parcial.

### Corrigido

- **`capLinhas` fecha SGR aberto antes da reticência.** Uma linha 100% colorida
  (ex.: `/plan 'escrita: block - …'` em amarelo) terminava em `…` sem
  `\x1b[0m`: o corte preservava o que atravessava mas não fechava o estilo, e o
  terminal seguia colorido nas linhas seguintes. Agora rastreia `estiloAberto`
  (liga em SGR ≠ 0, desliga em SGR 0) e anexa `\x1b[0m` antes da reticência
  quando o corte deixa estilo aberto. Teste de regressão em
  `apps/cli-audit.test.mjs`: `ansiBalance(linha) === 0` e linha truncada termina
  em `\x1b[0m…`.
- **`tools/list` em chunks.** O `probeOpencodeMcp` acumula o buffer e faz parse
  por **profundidade de chaves**, com **teto de 4 MB** (`MAX_BUFFER`). Se um
  servidor mandar `{` e nunca fechar, o buffer é descartado em vez de crescer
  até estourar a memória. O teto de tempo do probe continua protegendo contra
  processo que não responde. Teste `SERVIDOR_CHUNKS` manda o `tools/list` em 3
  pedaços `stdout` sem newline entre eles (só no final) e verifica o catálogo
  completo.

### Contexto da versão

Métricas **medidas em 2026-11-19** no HEAD `2da6468` (branch `main`). Fotografia
da data, não garantia de desempenho. Cada número tem o comando que o produziu.

| Métrica | Valor medido | Comando |
|:---|:---|:---|
| Testes unitários | 937 (936 passam, 1 skip) | `npm test` |
| Mudanças desde 1.1.0 | 5 itens (skills ~/.pi, MCP ~/.pi, capLinhas, tools/list, promptAndWait) | `git log --oneline v1.1.0..HEAD` |

### Verificação

```powershell
npm test                       # 937 testes (936 passam, 1 skip)
```

## [1.1.0] - 2026-11-18

**A CLI polida e as integrações com a máquina.** O 1.0 entregou o produto; o 1.1
entrega o acabamento: comandos de estado e tema, o seletor de modelo, as skills e
os MCPs que já existem na máquina do usuário, e o fim da "bancada de teste" no
desktop. Tudo **sem dependência npm** — o bloco `dependencies` morto
(`jsdom`, `node-html-parser`) saiu; o `package.json` segue sem `dependencies` e o
`package-lock.json` com 1 entrada (medido em 2026-11-18, `npm ls --depth=0`).

### Adicionado

**Comandos novos.**

- **`/settings`** (`core/agent/settings-view.mjs`) — visão única do estado: modo,
  permissão, modelo, esforço, tema, MCPs conectados e skills encontradas. Cada
  linha diz o comando que a muda.
- **`/theme [escuro|claro|alto-contraste]`** (`core/agent/theme.mjs`) — troca a
  paleta da TUI. Persiste. Tema muda o que a TUI usa, não o que ela é — nada de
  cor decorativa.
- **`/swarm [n] <tarefa>`** (`core/agent/swarm.mjs`) — orquestra `n` subagentes
  rumo à tarefa, distribui, coleta e sintetiza. Subagente nasce de qualquer
  provedor configurado; o principal escolhe.
- **`/mode`** — alterna entre os 5 modos (`plan → build → manual → ask → goal`),
  mostra o modo novo e explica em uma linha o que ele permite. `/plan`, `/build`,
  `/ask` continuam indo direto ao modo.
- **`/effort [off|low|medium|high]`** — esforço de raciocínio do modelo em uso;
  aceita os níveis que o modelo realmente expõe (lê do provedor, não impõe).

**`/model` interativo.** O seletor de dois estágios (provedor → modelo → esforço)
com setas e `enter`/`esc`. Antes só listava; agora escolhe. `/model <nome>`
direto continua funcionando (pula o seletor).

**`/skills` de duas fontes.** Passa a ler o store do loop (`.pi/harness/memory`,
skills que o SelfEvoPI gerou) **e** as skills do OpenCode
(`~/.config/opencode/skills/*/SKILL.md` — **334** nesta máquina, 2026-11-18,
`node --input-type=module` com `listPcSkills`). Antes só a primeira, e por isso as
suas não apareciam. Cada resultado diz a fonte: `loop` ou `pc`.

**Integrações da máquina.**

- **`/mcp`** lê os servidores do OpenCode (`~/.config/opencode/opencode.jsonc`,
  `mcp.servers`) — **29** nesta máquina (2026-11-18, `listOpencodeMcp` com o home
  do usuário). O arquivo é **JSONC** (comentários); o módulo remove comentários
  antes de parsear e falha com a **linha** do erro, não com "JSON inválido" seco.
- **Sonda de handshake** (`probeOpencodeMcp`): abre o processo, escreve um
  `initialize` JSON-RPC em stdin e espera. Se não responder, `ok:false` com o
  motivo — um `ok:true` sem handshake seria pior que não ter sonda.

### Removido

- **Painel de métricas do desktop.** `/panel` agora responde **404** (medido em
  2026-11-18: `scripts/desktop.mjs` não serve mais a rota; `app.js` cai no 404
  do servidor). Quem baixar só tem CLI e desktop, sem bancada de teste. A
  informação de estado continua na CLI (`/settings`) e no desktop (barra de
  estado).

### Corrigido

- **`/goal` trunca em 72 col** — o argumento era ecoado sem teto. Agora respeita
  a largura (ver `apps/cli-audit.test.mjs`, BUG1).
- **`--render menu` existe** — a varredura listava `menu` e o render não o
  reconhecia. Agora `node apps/cli.mjs --render menu` imprime o frame (2026-11-18).
- **`/init` não cita o motor** — o rascunho de `AGENTS.md` não menciona
  "PI Coding Agent" (ver `apps/cli-audit.test.mjs`, BUG2).
- **`/mode plan` não estoura 72 col** — o texto do modo respeita a largura.

### Contexto da versão

Métricas **medidas em 2026-11-18** no HEAD `6935fcc` (branch `main`). Fotografia da
data, não garantia de desempenho. Cada número tem o comando que o produziu.

| Métrica | Valor medido | Comando |
|:---|:---|:---|
| Skills do OpenCode nesta máquina | 334 | `node --input-type=module` com `listPcSkills({})` |
| MCPs do OpenCode nesta máquina | 29 | `listOpencodeMcp({ home })` |
| Dependências npm | 0 (lock com 1 entrada) | `npm ls --depth=0` |
| Largura da TUI | ≤ 72 col | `node apps/cli.mjs --render menu` |

> A suíte completa (`npm test`) e o gate de URLs (`node scripts/verify-urls.mjs`)
> são o critério de aceite desta versão; ver a seção Verificação.

### Verificação

```powershell
npm test                       # suíte completa (unitários + interfaces)
node scripts/verify-urls.mjs   # 33 URLs citadas, todas 200
node apps/cli.mjs --render menu   # frame da paleta, ≤72 col
```

## [1.0.1] - 2026-11-18

**Fechamento do desktop.** O 1.0.0 saiu com o painel de configurações no código
e vazio na tela; este conserta e inclui as duas interfaces na suíte.

- **Painel de configurações abre e funciona.** `settings.js` passou a importar
  `./modes-data.js` — o módulo do browser não pode alcançar
  `core/governance/modes.mjs`, que carrega uma árvore de imports do lado do
  Node. O arquivo é gerado a partir do core e `modes-data.test.mjs` falha se
  divergirem.
- **Clique, não só teclado.** Os listeners de `#settings` e `#openDrawer` não
  existiam: o painel só abria por `Ctrl+,`. Agora o mouse também abre.
- **`npm test` passou a rodar as duas interfaces.** O glob só cobria `core/` e
  `scripts/`; os 71 testes da CLI e os 41 do desktop nunca rodaram no CI.
  Suíte: **789 testes, 788 passam, 1 skip**.
- **CLI com origem e título** (A4): `/sessions` mostra de onde veio a sessão
  (`cli`|`desktop`), deriva título da primeira mensagem quando o header não tem,
  e `Ctrl+K`/`Ctrl+,` abrem na hora em vez de esperar a varredura.

## [1.0.0] - 2026-11-18

> **Seção em preparação.** Esta entrada cobre o que já está integrado na data. Os itens
> marcados como *reservado* são preenchidos quando o respectivo subagente confirmar a
> integração (ver nota no fim da seção).

A versão 1.0.0 é o primeiro lançamento do SelfEvoPI como produto completo: CLI e desktop
conversando com o mesmo backend, menu de configurações, sessões compartilhadas e
interface responsiva. O `package.json` deixou de ter dependências npm — o bloco
`dependencies` morto (jsdom, node-html-parser) foi removido e o lock ficou com 1 entrada.

### Adicionado

**Menu de configurações no desktop.** `apps/desktop/settings.js` traz dois pontos de
controle, como no Claude Code Desktop: uma **linha de controle** abaixo do composer
(modo + modelo + permissão) e um **painel de preferências** (`Ctrl+,`) para o que não muda
a cada turno (modo `plan`/`build`/`manual`/`ask`/`goal`, modelo, esforço de raciocínio,
permissão, confirmar escritas, dicas). Persiste em `localStorage` sob
`selfevopi.settings`; não cria arquivo no disco. Zero dependência externa.

**Módulo de sessões do desktop.** `apps/desktop/sessions.js` lista, abre e cria sessões
(`newSession`), com o par título/turnos-tokens por linha e o estado ativo destacado.

**Campo `client` no header da sessão.** `core/agent/sessions.mjs` passa a expor `client`
(`cli` | `desktop`) em `listSessions` e `loadSession`. O header antigo, que não tinha o
campo, conta como `cli` — retrocompatível.

**Interface responsiva.** `apps/desktop/desktop.css` reorganiza a conversa em duas colunas
no desktop e vira uma **gaveta sobreposta** abaixo de 900px (a lista de sessões não some,
vira overlay); há ajuste para telas abaixo de 480px e respeito a
`prefers-reduced-motion`.

**Sem dependências npm.** O bloco `dependencies` morto (jsdom, node-html-parser) foi
removido; o `package-lock.json` ficou com 1 entrada. O projeto segue 100% Node puro.

### Reservado (a confirmar)

- **Sessões compartilhadas entre CLI e desktop** — a sessão criada no desktop deve
  aparecer no `/sessions` da CLI e vice-versa. *(Reservado: depende das rotas
  `GET /api/sessions` / `POST /api/sessions/fork` que o A8 está integrando em
  `scripts/desktop.mjs`.)*
- **Dois executáveis** — `SelfEvoPI.cmd` (CLI) e `SelfEvoPI-Desktop.cmd` (desktop).
  *(Reservado: A6 está produzindo os dois executáveis; só documentar quando integrado.)*

### Contexto da versão

Métricas **medidas em 2026-11-18** no HEAD `ee74ed9` (branch `main`). Fotografia da
data, não garantia de desempenho. Cada número tem o comando que o produziu.

| Métrica | Valor medido | Comando |
|:---|:---|:---|
| Testes unitários | 665 (664 passam, 1 skip) | `npm test` |
| Integridade das URLs | ok=33, fail=0 | `node scripts/verify-urls.mjs` |
| Módulos de produção | 65 | `Get-ChildItem -Recurse -Filter *.mjs` (apps+core+scripts, excl. testes) |
| Linhas de produção | 18.869 | idem |
| Arquivos de teste | 56 | `*.test.mjs` |
| Linhas de teste | 10.458 | idem |
| Cold start, CLI | 91 ms média (mín 82, máx 98) · 7 execuções | `node apps/cli.mjs --version` |
| Incremento do SelfEvoPI | +506 tok (memória no teto) | `node scripts/measure-selfevopi-overhead.mjs --runs 3` |
| Orçamento de prompt | 1.500 tok | — |

O orçamento de prompt é requisito, não aspiração: o limite é 1.500 tokens de acréscimo, e
a medição acima mantém o projeto dentro dele (506 de 1500).

### Verificação

```powershell
npm test                       # 665 testes (664 passam, 1 skip)
node scripts/verify-urls.mjs   # 33 URLs citadas, todas 200
```

<!-- Os itens "Reservado" acima serão preenchidos quando A6 (executáveis) e A8 (rotas de
     sessão) confirmarem a integração. Não documentar SelfEvoPI-Desktop.cmd antes disso. -->

[0.5.0]: #050---2026-11-17

Primeira versão em que o SelfEvoPI fecha o ciclo completo: detectar uma lacuna,
descrever o que falta, gerar o código, verificar, e só então promover — ou
desfazer tudo se a verificação reprovar.

Reúne o que as fases P, 0, 1, 2, 3, 4 e 5 entregaram.

### Adicionado

**Pesquisa e auditoria (Fase P).** Levantamento do que já existe, do que mudou e
do que ficou por construir, com fontes verificadas. Inclui o gate de integridade
das fontes citadas (`scripts/verify-urls.mjs`), que roda no CI.

**Roteador multi-provider (Fase 0).** Um único comando escolhe entre os
provedores configurados e cai para o próximo quando um deles falha. Backoff,
circuit breaker e retry com reviewer: o roteador segura a fila quando o provedor
responde e volta sozinho quando ele melhora.

**Suíte de evals com gate (Fase 0).** 29 tarefas com verificador automático,
agrupadas pelo que medem: código, lacunas resolvidas, regressão e modelo real. O
gate compara a execução atual com a baseline e reprova qualquer regressão —
incluindo regressão de qualidade, não só de quebra.

**Memória em 3 níveis (Fase 1).** `session`, `project` e `skills`, com teto de
tokens por turno e poda de linhas corrompidas por condição. O artefato promovido
é registrado na memória — sem isso ele existe e ninguém o encontra depois.

**Núcleo de auto-evolução (Fase 2).** O ciclo
`detect → specify → generate → verify → gate → promote/revert`, com cada passo
injétavel e parada honesta quando não há evidência. O detector não inventa
lacuna: sem evidência, não afirma nada. O gerador escreve código real para CLI,
servidor MCP e extensão — e valida com `node --check` antes de gravar.

**Sandbox em 3 camadas (Fase 2).** Gate estático que bloqueia acesso a
credencial, rede, subprocesso e destruição de arquivo antes da execução; Node
Permission Model confinando leitura e escrita ao worktree; e contenção de
processo que derruba a árvore inteira quando a execução termina.

**Grafo de execução com runtime (Fase 3).** Grafo validado com ordem
topológica, executor com timeout e gate humano, checkpoint por nó, pausa e
retomada sem re-rodar o que já passou. Um painel local — ASCII e HTML
autocontido — mostra o andamento lendo o estado das execuções.

**Ponte de estado para o desktop (Fase 4).** Formato git-nativo de
`harness-state`: o que um desktop precisa ler para mostrar o que o grafo está
fazendo, sem que o desktop precise executar nada. A ponte está entregue e
testada; validar contra o aplicativo real fica para quando ele estiver na
máquina.

**Rotina de evolução contínua (Fase 5).** Diagnóstico → aplicação com autogate →
relatório. A rotina desfaz o próprio delta se a aplicação regredir, e não roda o
gate quando não há nada a aplicar.

### Contexto da versão

Métricas **medidas em 2026-11-17** e publicadas em `docs/estado.md`. São
fotografia daquela data, não garantia de desempenho:

| Métrica | Valor medido |
|:---|:---|
| Cold start | 443 ms (mín. 383, máx. 611) com cache quente · 1,0–1,8 s na primeira execução |
| Prompt do PI puro | 8.680 tokens |
| Incremento do SelfEvoPI | +506 tokens (memória no teto) |
| `pi-subagents`, sob demanda | +1.654 tokens |
| Evals | 29 tarefas, 86/87 (98,85%) na baseline — B11 é estocástico |
| Testes unitários | 449 (448 passam, 1 skip) |

O orçamento de prompt é requisito, não aspiração: o limite é 1.500 tokens de
acréscimo, e as medições acima são o que mantém o projeto dentro dele. A extensão
de subagentes saiu do prompt padrão e passou a carregar sob demanda — sozinhos,
seus 1.654 tokens estouravam o orçamento.

### Mudanças de comportamento

- **Família de provedores `or` desativada.** O free tier responde `exit 0` com
  corpo vazio ao esgotar a cota — falha silenciosa que o roteador não deveria
  confiar. Gatilho de reavaliação registrado em `docs/fase1/decisoes.md`.
- **A sonda de interface substituiu o smoke test.** Um smoke test que sempre
  passa promoveu um artefato com a interface errada. Agora cada artefato é
  exercitado do jeito que é chamado: um servidor stdio não recebe flags, uma
  extensão não se executa pela linha de comando.
- **Kind sem gerador é erro, não recaída.** Quando nenhuma capacidade casa, o
  artefato honesto é a `skill` (sempre produzível). Recair para `cli` gerava o
  artefato errado com cara de sucesso.
- **`verify.mjs` roda fora do sandbox; o artefato que ele invoca roda dentro.**
  Uma exceção no gate criaria um buraco explorável por renomeação.
- **`pi-subagents` venceu o bake-off, mas ficou sob demanda.** A medição mostrou
  +1.654 tokens por turno sem ganho de acurácia. `billion-context` foi descartado
  pelo mesmo motivo (18.268 → 32.196 tokens, latência +15% a +83%, acurácia
  igual).

### Segurança

- Papel de cada fronteira documentado em `SECURITY.md`: gate estático,
  Permission Model, contenção de processo, política de aprovação, áreas
  protegidas e tratamento de credenciais.
- Política de aprovação pausa para um humano quando algo precisa de rede,
  credencial ou escrita fora do workspace — com uma pergunta específica, não um
  "tem certeza?".
- O Núcleo Evolutivo não edita `evals/` nem `core/governance/`: ele os consome.

### Verificação

```powershell
npm test              # 449 testes unitários (448 passam, 1 skip)
npm run verify        # testes + evals A/C + integridade das URLs
node evals/gate.mjs   # gate completo (grupo D inclui chamada de modelo)
```

[0.5.0]: #050---2026-11-17