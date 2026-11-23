# Changelog

Todas as mudanças notáveis neste projeto são documentadas neste arquivo.
O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e
[Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [1.9.0] - 2026-11-23

**Edição estrutural, advisor, regras de stream e DAP.**

- `core/agent/ast-edit.mjs` (subagente `hy4-flash-free` high): hash FNV-1a por
  linha, âncoras que detectam arquivo stale, localização de função/classe/arrow
  com strings e comentários, preview em 72 colunas e aplicação em ordem reversa.
  `/ast-edit <arquivo> <símbolo> <novo> [--apply]` — prévia por padrão.
- `core/agent/advisor.mjs`: notas de um revisor (`NOTE/CONCERN/BLOCKER`),
  `observeTurn` com timeout e regras de stream que detectam um padrão atravessando
  deltas e abortam uma vez com a nota no histórico. `/advisor` mostra notas e
  regras; regras vêm de `.pi/stream-rules.json`.
- `core/agent/dap.mjs` (subagente): cliente DAP zero-dep — `initialize`,
  `launch`/`attach`, breakpoints, stepping, stack/variables e eventos, com o
  mesmo framing UTF-8 do LSP. `/dap [arquivo]` lista adaptadores de `.pi/dap.json`.
- Testes: 12 AST + 7 advisor + 6 DAP + 3 de comandos. `npm test`: 1138 testes /
  1137 passam; `npm run verify`: 33/33.
- **Limites honestos:** scanner de chaves não é AST real (sem JSX/regex literals);
  adaptadores DAP reais e `configurationDone` não testados; compatibilidade LSP
  com servidores reais segue sem prova.

## [1.8.0] - 2026-11-23

**Temas em inglês e cooldown persistente.**

- Os 12 temas pré-definidos agora têm nomes em inglês: `default`, `violet`,
  `blue`, `cyan`, `green`, `emerald`, `orange`, `pink`, `red`, `magenta`,
  `gold`, `graphite`. Cores hex inalteradas. Todos os nomes antigos em
  português (`padrao`, `violeta`, `azul`, …) continuam como aliases legados e
  migram ao carregar `theme.json`/localStorage.
- `core/router/cooldown-store.mjs`: cooldown dos papéis de modelo persistido em
  `~/.pi/agent/model-cooldown.json`. Só `ref → timestamp`; entradas com
  `apiKey`/token/secret e refs inválidos são descartadas. Best-effort: disco
  corrompido ou cheio nunca derruba o turno.
- Testes: 20 de temas (renomeação + migração) e 5 de persistência de cooldown.
  `npm test` e `npm run verify` verdes nos dois repositórios.

## [1.7.0] - 2026-11-23

**Integração na TUI e LSP — segunda leva do plano.**

- `/role [nome]`: mostra ou troca o papel de modelo ativo; a escolha aparece na
  barra de estado (`◇ papel`). Falhas de modelo alimentam o `Cooldown` do papel,
  então o próximo turno evita o ref que quebrou. Regras opcionais por caminho
  em `~/.pi/agent/model-roles.json`.
- `core/agent/lsp.mjs` (subagente `hy4-flash-free` high): cliente LSP mínimo,
  zero-dependência, com `Content-Length` em bytes UTF-8, parser incremental,
  `initialize`, `didOpen`/`didChange`, `publishDiagnostics` com fallback de pull,
  `rename`, `hover` e `documentSymbols`. Ambiente do filho por allowlist.
- `/lsp` lista servidores de `.pi/lsp.json`; `/lsp <arquivo> [diagnostics|symbols|hover:L:C|rename:L:C:novo]`
  roda a ação e fecha o servidor. Nenhum segredo sai do config local.
- Testes: 6 do cliente LSP (com servidor falso) + 1 de `/lsp` + 1 de `/role`.
  `npm test`: 1103 testes / 1102 passam; `npm run verify`: 33/33.
- **Limite conhecido:** posições LSP em UTF-16 code units ainda não convertidas;
  compatibilidade com servidores reais (tsserver/pyright/rust-analyzer) não provada.

## [1.6.0] - 2026-11-23

**Primeira leva do plano de capacidades: papéis de modelo e rewind.**

- `core/router/model-roles.mjs`: 9 papéis (`default`, `smol`, `slow`, `plan`,
  `commit`, `advisor`, `vision`, `task`, `tiny`) com política determinística de
  seleção, cadeia de fallback, regras por caminho e `Cooldown` em memória.
  Camada pura sobre o roteador existente — nenhuma mudança em `router.mjs`.
- `core/agent/rewind.mjs` (implementado em conjunto com subagente
  `hy4-flash-free` high): recorte puro de JSONL de sessão nos modos
  `dropErrors`, `beforeMessageId` e `keepLast`; linhas corrompidas preservadas.
- Novo comando `/rewind [drop-errors|last:N|id:<id>]`: cria uma **nova** sessão
  recortada, nunca sobrescreve a ativa, e troca para ela quando o motor permite.
  RELATÓRIO em 72 colunas, sem reticências.
- `SELFEOPI_SESSIONS_DIR` permite apontar outra pasta de sessões (testes e
  isolamento).
- Testes: 9 de papéis + 13 de rewind + 1 integração `/rewind` pela CLI.
  `npm test`: 1095 testes / 1094 passam; `npm run verify`: 33/33.

## [1.5.0] - 2026-11-22

**A CLI sobrevive a queda de modelo e adapta a janela — com clique no terminal.**

- **Reconexão antes do erro:** o modelo agora é tentado até **5 vezes** antes de
  aparecer "não consegui falar com o modelo". Mensagens de retry são mostradas
  durante a tentativa. Após 3 falhas, e também ao desistir, a sessão do motor é
  reiniciada — antes, uma mensagem com `stopReason: error` envenenava o
  histórico e **toda** mensagem seguinte falhava, inclusive após `/model`.
- **Clique no terminal:** mouse SGR habilitado em TTY. Clique na paleta escolhe
  e executa o comando; no seletor genérico escolhe o item; na barra de estado
  abre o seletor de modelo; nas dicas abre `/help`; no prompt posiciona o cursor.
  Relatórios de mouse e de posição do cursor são separados do comando, então um
  clique nunca vira texto no prompt.
- **Janela redimensionável:** `frameWidth()` deixou de ter piso de 72 colunas e
  agora acompanha `stdout.columns` (com `SIGWINCH` redesenhando). A moldura da
  resposta usa a mesma largura — numa janela de 50 colunas, nada vaza nem
  sobrepõe. `--render` continua determinístico em 72.
- Testes: recessão (4ª tentativa resolve; 5 falhas deixam sessão limpa), parser
  de mouse e largura estreita. 1067+ testes; `npm run verify` 33/33.

## [1.4.0] - 2026-11-22

**Code Mode opt-in para ambientes com muitos servidores MCP.**

- `core/agent/code-mode.mjs`: executa um programa curto que encadeia chamadas
  por `tools.call()`. Contexto `node:vm` sem `process`, `require`, `fetch`,
  `eval` ou `Function`; allowlist, limite de chamadas, prazo e teto de saída.
  O módulo é puro — não lê config nem sobe processo.
- `scripts/code-mode-mcp.mjs`: gateway MCP que expõe apenas `run_code`. Descobre
  servidores e ferramentas da config **local em tempo de execução** — nenhum
  nome de servidor, comando ou segredo vive no repositório. Servidores que
  falham são ignorados; a descoberta é cacheada.
- Registro local feito pelo usuário, com backup da config. Na validação com um
  ambiente numeroso, a primeira chamada levou ~39 s (cold) e as seguintes ficaram
  em cache. Nenhuma config, nome de servidor ou segredo foi versionado.
- Testes: 7 de unidade + 1 de integração com servidor MCP falso. Validação real
  ponta a ponta: o modelo chamou `run_code`, o gateway descobriu centenas de
  ferramentas de dezenas de servidores e devolveu a contagem em milissegundos.
- Documentação: README, `docs/estado.md`, `docs/produto.md`, vault e guia
  `hooks-e-seguranca.md` atualizados.

## [1.3.0] - 2026-11-22

**Hooks de ciclo de vida e registro de segurança, sem depender do motor.**

- **Hooks** em `.pi/hooks.json` do workspace (não é config pessoal): eventos
  `turn_start`, `turn_end`, `tool_start`, `tool_result`, `error` e `compact`.
  Payload chega como JSON no stdin, sem shell, com ambiente mínimo, timeout e
  redação de segredos. Hook que falha nunca derruba o turno. Novo comando
  `/hooks` mostra a config e os últimos resultados.
- **Registro de segurança append-only:** toda decisão `block`/`warn` do gate
  vira uma linha em `.pi/harness/ledger/blocked.jsonl`, com caminho relativo e
  excerpt redigido. Novo comando `/security-log` consulta as últimas decisões.
- Testes novos cobrem validação de config, injeção de shell, timeout, redação
  e gravação/leitura do ledger. Integração ponta a ponta verificada com hook
  real disparado num turno da CLI.
- Corrigido drift em `docs/estado.md` (dizia "três temas" e `⏺`/`⎿`).

## [1.2.9] - 2026-11-22

**Modelos com reasoning obrigatório validados e saída de comandos sem quebras de moldura.**

- **Capabilities preservadas na reimportação:** um modelo com reasoning
  obrigatório (`off`/`none` devolve 400) teve seu mapa de esforço fixado para
  que uma reimportação de providers não o perca.
- **Erro transitivo não é mais falha:** quando o motor recebe 429 e responde na
  tentativa seguinte, a CLI mostrava "não consegui falar com o modelo" **acima**
  da resposta correta. Agora o erro só aparece se o turno terminar sem texto.
- **Saída de comandos passou pelo crivo da tela:** `makeOut()` quebra linhas de
  `/theme`, `/detect`, `/mcp` e afins em ≤ 72 colunas, sem reticência e com SGR
  balanceado. `/help` e `/diff` não cortam mais com "…".
- **Negrito que atravessa quebra** não deixa `\x1b[1m` aberto nem `\x1b[0m`
  órfão na moldura da resposta.
- **Modo pipe/CI limpo:** sem `\r` nem `\x1b[2K` em log; o aviso de 118 colunas
  do motor ao criar sessão nova é filtrado.
- Verificação: 1051 testes (1050 passam, 1 skip), `npm run verify` 33/33,
  12 tarefas e 72 comandos em oito contas de gateway configuradas.

## [1.2.8] - 2026-11-22

**Conjunto de temas reorganizado: um `padrao` e uma paleta de cores para cada gosto.**

- **Doze temas embutidos:** `padrao` (padrão, o bronze/ouro anterior), `violeta`,
  `azul`, `ciano`, `verde`, `esmeralda`, `laranja`, `rosa`, `vermelho`, `magenta`,
  `dourado` e `grafite` — além dos três slots customizados.
- **`escuro` e `alto-contraste` removidos do conjunto.** Nomes antigos salvos em
  `theme.json`/`localStorage` migram automaticamente para `padrao` — ninguém
  fica com tema quebrado ao atualizar.
- Cada paleta tem 11 papéis semânticos e passa WCAG AA (4,5:1) no próprio fundo;
  teste de contraste e de accents distintos cobre todas as cores.
- `/theme` agora mostra `[tema]` genérico em vez de uma lista fixa de três nomes.

## [1.2.7] - 2026-11-22

**TUI reorganizada no estilo dos CLIs modernos: bloco de resposta, skins quentes e sem sobreposição.**

- **Causa raiz da sobreposição corrigida:** o redraw da resposta terminava
  movendo o cursor para dentro do próprio bloco; o texto seguinte pisava na
  resposta. Agora o cursor fica logo após o bloco, e o `flush()` não adiciona
  linha extra.
- **Bloco de resposta** com rótulo `╭─ ◆ SelfEvoPI`, borda lateral e fechamento,
  largura fixa e markdown renderizado — inclusive negrito dentro de tabelas.
- **Paleta quente de alto contraste** (bronze/ouro) em todos os temas; cada papel
  de texto passa de 7:1 de contraste sobre o fundo (teste WCAG no CI).
- **Spinner com asas** `⟪◈ ◈⟫` e verbos rotativos (processando, analisando…),
  space-padding em vez de `\x1b[K`, e um único frame quando a saída não é TTY.
- **Barra de estado reorganizada:** modo, permissão, modelo, medidor de
  contexto `▰▱`, tempo do turno, branch e id da sessão; segmentos de baixa
  prioridade são descartados antes de estourar a largura — nunca há "con…" na
  borda.
- **Linhas de ferramenta** no padrão `┊ 📄 read      arquivo` com resultado
  alinhado. Banner com a nova marca DNA.
- Novas logos DNA adotadas (SVG claro/escuro, ícone e documentação de marca).

## [1.2.6] - 2026-11-21

**Sessão nova por padrão; retomar é escolha do usuário.**

A release pública também foi enxugada: plano de execução, handoffs de agentes,
auditorias internas e notas de ambiente ficam apenas no repositório de origem.
Aqui restam documentação de uso, arquitetura, pesquisa e guias para agentes.

- O motor deixou de ser iniciado com `--no-session` (efêmero). Cada abertura
  agora cria uma sessão **nova e persistida** com `--session-id <uuid>`.
- Para continuar uma conversa antiga: `node apps/cli.mjs --resume <id>` (ou
  `--session <id>`), `/resume` com seletor, ou `/sessions <id>`.
- `createPiClient` ganhou `buildEngineArgs()` puro, com os modos `new`,
  `resume` e `ephemeral`; verificações que não precisam de histórico
  (`models:check`) continuam efêmeras.
- O id da sessão entra no `/status`, no painel e no `/history`.

## [1.2.5] - 2026-11-21

**Resposta longa não quebra mais a tela; histórico da sessão.**

- **Redraw corrigido**: o cursor subia pela contagem de linhas *lógicas*, mas o
  terminal avança por linhas *visuais* após `wrapAnsi`. Numa resposta longa com
  tabela larga isso desalinhava tudo e fazia o prompt desaparecer. Agora o
  redesenho conta linhas visuais e sempre termina com prompt + barra de estado.
- **Tabela markdown larga** deixa de ser forçada em colunas: vira pares
  rótulo/valor empilhados. Negrito dentro de célula é renderizado (antes
  aparecia `**Foco**` cru).
- **`/history [n|clear]`**: trilha da sessão com tools, resultados, raciocínio,
  respostas, fallback e comandos. Registrada independentemente do `/verbosity`,
  então o que foi oculto continua consultável depois.
- Caso reproduzido: resposta de acesso à internet com tabela de 3 colunas —
  saída sem `**` cru, nenhuma linha acima de 72 colunas e prompt visível no fim.

## [1.2.4] - 2026-11-21

**Várias contas do mesmo gateway.**

- `providers-setup` nunca reutiliza o id de uma conta existente: sugere
  `kilo1`, `kilo2`…, recusa sobrescrever chave sem `--replace-key` e avisa quando
  a mesma chave já está cadastrada para aquele endpoint.
- `--clone-from <id>` copia o catálogo de uma conta irmã com outra chave, sem
  precisar redescobrir modelos.
- `--list` agrupa contas por endpoint e mostra fingerprint da chave (nunca o
  valor). `models-config` ganhou `providersForEndpoint`, `nextProviderId`,
  `keyFingerprint` e `isDuplicateKey`.
- Endpoints com IP recebem id `gateway1`, `gateway2`… em vez de `128`, `129`.

## [1.2.3] - 2026-11-21

**Providers configuráveis pelo usuário, sem nada pré-configurado no release público.**

- **`core/agent/provider-discovery.mjs`**: dado endpoint + chave, descobre
  modelos e infere efforts de raciocínio, `thinkingLevelMap`, suporte a imagem,
  limites de contexto e variantes `free`/`fast`. Normaliza catálogos da
  OpenRouter, Kilo, Nous e genéricos; tenta Bearer antes de `X-API-Key`.
- **`core/agent/models-config.mjs` + `scripts/providers-setup.mjs`**: leitura
  e escrita segura de `~/.pi/agent/models.json` com backup e ACL; assistente
  interativo para humanos e modo `--json`/flags para agentes. Padrão é dry-run;
  `--apply` grava. A chave nunca é impressa.
- **`/providers discover <url> [ENV]`** na CLI.
- **Overrides locais** saem do código: `config/providers.private.json` (arquivo
  ignorado pelo Git) é lido por `scripts/import-providers.mjs`. Nenhum provider
  vem pré-configurado no release; cada usuário cadastra os seus.
- Release sem providers pré-configurados; o pacote de download será publicado
  no site do projeto.

## [1.2.2] - 2026-11-21

**Controle de feedback e polimento observado em uso real.**

- **`/verbosity [minimal|tools|reasoning|full|verbose]`**: escolha o que aparece
  durante um turno. `minimal` mostra só a resposta final; `tools` mostra as
  chamadas de ferramenta; `reasoning` mostra o raciocínio; `full` (padrão) mostra
  raciocínio, ferramentas e resultados; `verbose` acrescenta tempo e tokens.
  A preferência persiste em `~/.pi/agent/cli-verbosity.json`; `SELFEOPI_VERBOSITY`
  sobrescreve por execução. `Alt+T` continua valendo como override da sessão.
- **Linha de ferramenta mais útil**: `⏺ write  <caminho>` em vez de mostrar o
  conteúdo que está sendo escrito.
- **Contador de tokens no spinner** passou a usar também o total de tokens da
  sessão quando `contextUsage` ainda está zerado.
- **`AGENTS.md` e `docs/agent-guides/`**: guias operacionais para qualquer
  agente que precise mudar a harness — mapa de donos, como adicionar provider,
  ferramenta, comando, idioma/verbosidade e integrações, invariantes e
  protocolo de verificação/rollback. Inclui `registro.json` com os mesmos
  ponteiros em formato legível por máquina.
- **Validação em uso real**: duas tarefas pequenas (um app Node e um site HTML)
  criaram os arquivos corretos com tool calling, 7,4 s e 9,2 s; dois subagentes
  em paralelo responderam em 3,1 s. Ver `VERIFICACAO.md` no pacote organizado.

## [1.2.1] - 2026-11-21

**Modelos, esforços e anexos de imagem.**

### Corrigido

- **ERNIE 5.5 Flash Preview mostrava efforts errados.** O `models.json` não
  declarava `reasoning` nem `thinkingLevelMap`, então o motor devolvia só
  `off`. O importador agora enriquece os modelos com os catálogos públicos da
  OpenRouter e do Kilo Gateway: o ERNIE tem `reasoning: true`,
  `thinkingLevelMap` com `high` como único nível e
  `compat.supportsReasoningEffort: true`. A CLI também deixou de esconder o
  seletor quando o modelo expõe um único nível válido.
- **Texto cortado na borda ("con…").** Saídas de comando, barra de estado e
  overlays agora quebram linhas em vez de truncar, usando a largura real do
  terminal (72 colunas em `--render`). Nenhum SGR fica aberto no fim de uma
  linha quebrada.
- **`capLinhas` descartava stdout quando não havia `onLine`** em `runProcess`,
  o que fazia `/diff` e `/gate` dizerem "sem alterações".

### Adicionado

- **Anexos de imagem**: `/paste` lê a área de transferência do Windows,
  `/attach <arquivo>` anexa um arquivo, `@imagem.png` funciona na mensagem e
  `/images [clear]` mostra/limpa os anexos. As imagens vão como blocos
  `ImageContent` no `prompt` do motor. Aviso quando o modelo atual não declara
  entrada de imagem.
- **`npm run models:check` / `models:prompt`**: varredura de todos os modelos
  configurados comparando efforts e capacidades declarados pelo motor contra o
  `models.json`, opcionalmente com um prompt real por modelo.
- Novos módulos: `core/agent/model-metadata.mjs` e `core/agent/attachments.mjs`.

## [1.2.0] - 2026-11-21

**Uma superfície, inglês por padrão, e a CLI alinhada ao que promete.**

O produto passa a ser somente a CLI. Tudo o que não era a conversa — a outra
superfície, os atalhos que a abriam e os documentos que a descreviam — sai do
repositório. O que sobra ganha acabamento: os atalhos de teclado finalmente
fazem o que a ajuda diz, a resposta das ferramentas aparece, o raciocínio pode
ser ocultado, e a interface fala inglês por padrão com `/language` para trocar.

### Adicionado

- **`/language [en|pt]`** (`core/agent/i18n.mjs`). Inglês é o padrão. A opção
  persiste em `~/.pi/agent/cli-locale.json`, fora do repositório, e pode ser
  sobrescrita por `SELFEOPI_LOCALE`. Dicionário com 150+ chaves cobrindo
  comandos, ajuda, paleta, painel de estado, configurações, spinner, raciocínio,
  ferramentas, erros e mensagens de uso. `/language` sem argumento abre um
  seletor; `Ctrl+,` também oferece o idioma.
- **Comandos de sessão e inspeção.** `/fork [nome]` bifurca a sessão preservando
  a original; `/diff` mostra `git diff --stat` e o patch do workspace;
  `/export [md|json]` grava a conversa em `.pi/harness/exports/`; `/undo` e
  `/redo` desfazem e refazem a última troca; `/copy` manda a última resposta
  para a área de transferência; `/reload` reaplica tema e estado sem reiniciar.
- **Mensagens enfileiradas.** Digitar enquanto o agente trabalha não perde o
  texto: `Enter` enfileira e a mensagem é enviada quando o turno termina.
- **`!comando`** roda um comando de shell direto no workspace, sem passar pelo
  modelo. **`@arquivo`** injeta o conteúdo do arquivo como contexto explícito.
- **`Alt+T`** alterna exibir/ocultar o raciocínio; quando oculto, resta uma linha
  de resumo com a duração. **`Ctrl+T`** abre a lista de tarefas da interface.
- **Barra de estado completa**: modo, permissão, modelo, esforço, uso de
  contexto em porcentagem e branch — truncada para nunca passar de 72 colunas.
- **Spinner com dados**: verbo, tempo decorrido e tokens consumidos em tempo
  real; com movimento reduzido vira um indicador estático, sem piscar.
- **Saída de ferramenta completa**: `⏺ nome arg` seguido de `⎿ N linhas (X KB)`;
  falha aparece como `1 failed` em cor de falha, não como sucesso disfarçado.
- **Seletor de sessões com busca e prévia**: digitar filtra por título/id e a
  dica mostra a primeira mensagem da sessão.

### Corrigido

- **`Ctrl+O` abria as configurações, não a leitura de estado.** `/help` e a dica
  da própria TUI prometiam o painel, mas `panelOpen` nunca recebia `true` e o
  atalho chamava o editor. Agora `Ctrl+O` abre a leitura de estado e `Ctrl+,`
  abre o editor — o que os dois diziam o tempo todo.
- **`/settings` mostrava `—` para modelo, esforço e sessões** mesmo com o estado
  já carregado. Passa a mostrar os valores reais.
- **Raciocínio tardio era descartado.** `commitThink` ignorava deltas que
  chegavam depois do texto; agora aparece no fim do turno em vez de sumir.
- **`Ctrl+,` dependia de um único código de terminal.** Aceita `0x1C`, sequência
  CSI e `Esc ,`.
- **`sessionDir()` e `readSessionExtras()` faziam trabalho repetido**: a pasta
  era redescoberta a cada comando e cada sessão era lida por até 256 KB. Agora
  há cache e a leitura para no primeiro user encontrado (8 KB por fatia).
- **Números e datas divergentes** entre README, CHANGELOG, `docs/estado.md` e
  `package.json` foram unificados; a versão do `package.json` é a única fonte.

### Removido

- A superfície descontinuada, seus lançadores, testes e documentos. O restante
  do repositório foi varrido para que nenhuma referência a ela sobreviva.

## [1.1.1] - 2026-11-19

**Agnosticismo e robustez.** As integrações passaram a ler a configuração do
próprio motor (`~/.pi/`), e a auditoria encontrou três defeitos reais: linha
colorida truncada vazando estilo, sonda de MCP estourando memória e leitura do
texto final do modelo antes da hora.

- `/import`: migração reversível de MCPs e skills para `~/.pi/`, com backup,
  manifesto, merge sem sobrescrever e rollback seletivo.
- `PiClient.promptAndWait`: texto final sem leitura precoce.
- `capLinhas` fecha SGR aberto antes da reticência; `tools/list` em chunks com
  teto de 4 MB.

## [1.1.0] - 2026-11-18

**A CLI polida e as integrações da máquina.** `/settings`, `/theme`, `/swarm`,
`/mode`, `/effort`, seletor de modelo em dois estágios, skills e MCPs locais.
Fim da bancada de testes na interface: a informação de estado ficou na CLI.
Zero dependências npm — o projeto segue 100% Node puro.

## [1.0.1] - 2026-11-18

Fechamento da configuração: o configurador abria por atalho mas não
por clique, e os testes das duas interfaces nunca rodavam no CI. Os dois
passaram a valer.

## [1.0.0] - 2026-11-18

Primeiro lançamento como produto: conversa por CLI, configurações, sessões e
interface responsiva. Sem dependências npm.

## [0.5.0] - 2026-11-17

Primeira versão a fechar o ciclo: detectar uma lacuna, descrever o que falta,
gerar o código, verificar, promover — ou desfazer tudo se a verificação
reprovar. Reúne as fases P, 0, 1, 2, 3, 4 e 5.

Destaques: roteador multi-provider, suíte de evals com gate, memória em três
níveis, núcleo de auto-evolução, sandbox em três camadas, grafo com runtime e
checkpoints, e rotina de evolução contínua.
