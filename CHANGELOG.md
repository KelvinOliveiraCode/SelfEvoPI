# Changelog

Todas as mudanças notáveis neste projeto são documentadas neste arquivo.
O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e
[Versionamento Semântico](https://semver.org/lang/pt-BR/).

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
- **Overrides privados** saem do código: `config/providers.private.json` (fora
  do release público) é lido por `scripts/import-providers.mjs`. O provider
  `nous` do mantenedor vive aí, não no repositório público.
- Release público sem providers pré-configurados; o download fica só no repo
  privado até virar asset do site.

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
