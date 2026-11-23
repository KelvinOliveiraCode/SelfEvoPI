# SelfEvoPI — dossiê do produto

> Documento de referência completo. Números medidos em 21/11/2026; cada um
> traz o comando que o produziu. Para o estado corrente, veja `estado.md`.

## 1. A tese

A competência de um agente de código é, em grande parte, uma propriedade do
**harness** — do invólucro que decide o que entra no contexto, quanto tempo se
gasta por turno e o que acontece quando o modelo erram. O mesmo modelo muda de
desempenho quando muda de harness. SelfEvoPI leva isso ao extremo lógico: se o
harness é o produto, ele pode **medir a própria qualidade e construir a
capacidade que falta**.

Daí a definição em uma frase: **um harness agnóstico, agêntico e leve que se
autoevolui, modelável e adaptativo em prol das tarefas e objetivos do usuário.**

Três consequências práticas:

1. **Contexto é orçamento, não recurso.** Cada token do prompt é pago em todos
   os turnos. O acréscimo do SelfEvoPI é de +499 tokens sobre um teto de 1.500.
2. **Latência é feature.** A CLI inicia em ~82 ms; nada pesado carrega no boot.
3. **Qualidade se mede.** "Funciona" não é resultado. `85/87, com a tarefa
   estocástica nomeada` é.

## 2. O que é e o que não é

**É:** uma CLI de conversa para um agente de código; um roteador multi-provider;
uma suíte determinística de evals com gate de regressão; memória persistente;
um sandbox Windows nativo; um núcleo que detecta lacunas e gera o artefato que
as fecha; um produto com marca, idioma e interface próprios.

**Não é:** um fork do motor; um conjunto de scripts de automação; um painel de
métricas; uma distribuição com dependências npm; uma interface que exige
Docker, WSL ou VM.

O motor é a conversa e fica invisível: nenhuma string de interface o nomeia.

## 3. Arquitetura

```
motor (RPC, --no-session)
   │  eventos normalizados: text · tool · settled · error
   ▼
core/agent/pi-rpc.mjs ── cliente fino, único ponto de contato com o protocolo
   ▼
apps/cli.mjs ── REPL, paleta, markdown, atividade, overlays, comandos de barra
   │
   ├── core/router/        perfis, circuit breaker, retry, teto de tokens
   ├── core/forge/         detect → specify → generate → verify → gate → promote
   ├── core/memory/        sessão / projeto / skills, poda por evidência
   ├── core/sandbox/       gate estático + Permission Model + contenção
   ├── core/graph/         grafo validado, checkpoint, pausa e retomada
   ├── core/governance/    rollback verificado e aprovação humana
   └── evals/              29 tarefas, checkers determinísticos, gate
```

### Camadas do núcleo auto-evolutivo

| Etapa | O que faz | Evidence que exige |
|:--|:--|:--|
| detect | aponta uma lacuna | falha repetida, capacidade ausente ou fluxo frágil |
| specify | escreve contrato curto | entradas, saídas, proibições, casos de teste |
| generate | produz o artefato mais leve | `node --check` antes de gravar |
| verify | exercita a interface real | sonda por kind, não smoke test |
| gate | compara com a baseline | tarefa-alvo resolvida e zero regressões |
| promote | commit atômico + memória | `last-known-good` só com verify verde |
| revert | desfaz e revalida | rollback que não passa não atualiza o LKG |

Hierarquia de artefatos, do mais leve ao mais pesado: config de MCP existente →
skill → CLI → extensão → servidor MCP. Se nada casa, o artefato honesto é a
skill — recair para CLI gerava sucesso com a interface errada.

## 4. A CLI

### 4.1 Gramática da tela

- Prompt sempre na última linha; a resposta rola para cima dentro de um bloco
  com rótulo (`╭─ ◆ SelfEvoPI`), borda lateral e fechamento.
- Streaming real de markdown (negrito, listas, código, tabelas). Tabelas largas
  viram pares rótulo/valor empilhados, sem colunas quebradas.
- Atividade de ferramenta: `┊ 📄 read      arquivo`, com o resultado alinhado
  na coluna seguinte; falha aparece como `1 failed`.
- Spinner com asas e verbos rotativos (`⟪◈ ⠋ processando ◈⟫`); em pipe, um único
  frame, sem `\r` nem `\x1b[2K` no log.
- Toda saída de comando passa pelo mesmo crivo dos frames (`makeOut()`): linhas
  longas quebram em ≤ 72 colunas sem reticência e com ANSI balanceado. O aviso
  do motor ao criar sessão nova é filtrado em vez de poluir o topo da tela.
- Erro transitivo (429) seguido de resposta não imprime "não consegui": o erro
  só aparece quando o turno termina sem texto.
- Raciocínio em bloco discreto; `Alt+T` oculta ou mostra, restando uma linha de
  resumo com duração.
- Barra de estado: modo, permissão, modelo, medidor `▰▱` de contexto, tempo do
  turno, branch e id da sessão. Segmentos de baixa prioridade são descartados
  inteiros antes de estourar a largura — nunca há "con…" na borda nem
  sobreposição de texto.
- Paleta quente bronze/ouro, com todos os papéis de texto acima de 7:1 de
  contraste. Sem truecolor, degrada para ANSI-256. Movimento reduzido troca o
  spinner por um indicador estático.
- Hooks de ciclo de vida opcionais (`turn_start`, `turn_end`, `tool_start`,
  `tool_result`, `error`, `compact`): JSON no stdin, sem shell, com timeout e
  ambiente mínimo. `/hooks` mostra a config e os últimos resultados.
- Toda decisão `block`/`warn` do gate vai para um ledger append-only local;
  `/security-log` consulta as últimas entradas sem expor segredos.
- **Mouse e janela**: em TTY, clique executa comando na paleta, escolhe item no
  seletor, abre o modelo na barra de estado e posiciona o cursor no prompt. A
  largura acompanha a janela (`SIGWINCH` redesenha); em pipe, 72 colunas fixas.
- **Queda do modelo**: até 5 tentativas antes do erro; após 3 falhas a sessão do
  motor é reiniciada para que a conversa não fique presa repetindo a mensagem.
- **Code Mode opt-in**: um único tool `run_code` roda um programa curto que
  encadeia chamadas MCP. O contexto não tem `process`, `require`, `fetch`, `eval`
  ou `Function`; há allowlist, limite de chamadas, prazo e teto de saída. Os
  servidores são descobertos da config local em tempo de execução — nenhum nome
  de servidor, comando ou credencial entra no repositório.

### 4.2 Comandos

| Grupo | Comandos |
|:--|:--|
| Núcleo | `/evo`, `/detect`, `/memory`, `/skills`, `/compact`, `/goal` |
| Conversa | `/model`, `/effort`, `/mode`, `/plan`, `/build`, `/ask`, `/clear` |
| Sessão | `/sessions`, `/resume`, `/history`, `/fork`, `/export`, `/undo`, `/redo`, `/copy`, `/diff` |
| Contexto | `/cost`, `/status`, `/context`, `/settings`, `/reload`, `/hooks`, `/security-log` |
| Integrações | `/mcp`, `/plugins`, `/init`, `/import`, `/providers`, `/workspace`, `/explorer` |
| Agentes | `/swarm`, `/subagent`, `/worktree` |
| Aparência | `/theme`, `/language`, `/verbosity` |
| Anexos | `/paste`, `/attach`, `/images` |
| Ajuda | `/help` |

`/` abre a paleta com filtro por prefixo e subsequência. `!comando` executa no
shell do workspace sem passar pelo modelo; `@arquivo` injeta texto e
`@imagem.png` anexa a imagem.

### 4.3 Sessões

Cada abertura cria uma sessão nova e persistida (`--session-id <uuid>`). O
motor não retoma nada automaticamente; o usuário escolhe quando quer continuar:

- `--resume <id>` ou `--session <id>` na linha de comando;
- `/resume` abre o seletor dentro da CLI;
- `/sessions <id>` carrega uma sessão conhecida.

O id ativo aparece em `/status`, no painel de estado e no `/history`. Ferramentas
de verificação (`npm run models:check`) usam sessão efêmera e não gravam arquivo.

### 4.4 Teclado

| Tecla | Ação |
|:--|:--|
| `Ctrl+O` | painel de estado |
| `Ctrl+,` | editor de configuração (inclui idioma) |
| `Ctrl+K` | sessões, com busca e prévia da primeira mensagem |
| `Ctrl+P` | lista de atividade (shells e subagentes) |
| `Ctrl+T` | lista de tarefas da interface |
| `Alt+T` | mostrar/ocultar raciocínio |
| `Ctrl+C` | cancelar o turno; com texto, limpa a linha |
| `Ctrl+D` / `q` | sair |

Enquanto o agente trabalha, o usuário pode continuar digitando: `Enter`
enfileira a mensagem e ela é enviada ao fim do turno.

### 4.5 Modos e permissão

Modo e permissão são eixos distintos e aparecem em linhas separadas na barra.

| Modo | Lê | Escreve | Executa | Pergunta |
|:--|:--:|:--:|:--:|:--|
| plan | sim | não | só leitura | antes de escrever |
| build | sim | sim, no workspace | sim, no workspace | fora do workspace |
| manual | sim | sim, no workspace | sim, no workspace | antes de cada escrita |
| ask | sim | nunca | não | n/a |
| goal | herda | herda | herda | fora do workspace |

`full access` é o tipo de permissão; `auto` é o aprovador. Nenhum dos dois é
um modo.

### 4.6 Idioma

Inglês é o padrão. `/language [en|pt]` troca a interface inteira — ajuda,
paleta, painel, configurações, spinner, raciocínio, ferramentas e mensagens de
erro — sem reiniciar. A preferência fica em `~/.pi/agent/cli-locale.json` e
`SELFEOPI_LOCALE` a sobrescreve por execução. Nada do que é enviado ao modelo
depende dessa preferência.

### 4.7 Detalhamento do feedback

`/verbosity [nível]` controla o que aparece durante um turno:

| Nível | O que aparece |
|:--|:--|
| `minimal` | só a resposta final |
| `tools` | chamadas `⏺` e a resposta final |
| `reasoning` | bloco `⤷` de raciocínio e a resposta final |
| `full` (padrão) | raciocínio, ferramentas, resultados `⎿` e resposta final |
| `verbose` | tudo isso, mais tempo decorrido e contador de tokens |

`/history [n|clear]` mostra a trilha da sessão — ferramentas, resultados,
raciocínio, respostas, fallback e comandos — registrada **mesmo quando o
`/verbosity` escondeu essas peças na hora**. É o recurso para auditar o que o
agente fez sem precisar repetir a tarefa.

A preferência fica em `~/.pi/agent/cli-verbosity.json` e
`SELFEOPI_VERBOSITY` a sobrescreve por execução. `Alt+T` alterna o raciocínio
apenas na sessão corrente, sem mudar a preferência salva. As linhas de
ferramenta mostram o **alvo** (`⏺ write  arquivo.md`), não o conteúdo escrito.

### 4.8 Modelos, provedores e esforço

O catálogo vivo é `~/.pi/agent/models.json`, gerado pelo importador a partir
das configurações locais e enriquecido com os catálogos públicos de OpenRouter
e Kilo Gateway. Cada modelo declara `reasoning`, `thinkingLevelMap`,
`input` e `compat.supportsReasoningEffort`.

A CLI cruza três fontes: a config local, o que o motor reporta
(`get_available_thinking_levels`) e o que o catálogo público diz. Quando o
motor devolve apenas `off` para um modelo que a config marca como de
raciocínio, a config corrige a informação. Caso real: **ERNIE 5.5 Flash Preview
tem raciocínio obrigatório e um único effort aceito, `high`**, nos oito
provedores configurados.

```powershell
npm run models:check    # compara capacidades de todos os modelos, sem chamar a API
npm run models:prompt   # envia um prompt mínimo a cada modelo
```

### 4.9 Imagens

Terminais transmitem texto, não binário. `/paste` lê a área de transferência
do Windows via PowerShell em STA, `/attach <arquivo>` anexa um arquivo e
`@imagem.png` funciona inline. As imagens seguem como blocos `ImageContent`
no `prompt` do motor. `/images clear` remove os anexos pendentes. Se o modelo
atual não declara entrada de imagem, a CLI avisa antes de enviar.

## 5. Qualidade e verificação

| Gate | O que cobre | Como rodar |
|:--|:--|:--|
| Suíte unitária e de interfaces | 1025 testes, 1024 passam, 1 skip | `npm test` |
| Verificação completa | testes + evals A/B/C + 33 URLs | `npm run verify` |
| Gate de regressão | 3 execuções por tarefa vs baseline | `node evals/gate.mjs` |
| Integridade de fontes | todas as URLs citadas respondem 200 | `node scripts/verify-urls.mjs` |
| Contrato de TUI | ≤72 col, ANSI balanceado, overlays | `apps/cli-audit.test.mjs` |
| Modelos | efforts e capacidades de todos os models | `npm run models:check` |

A suíte de evals tem quatro grupos: A (roteador e seleção), B (CLIs geradas e
schemas), C (regressões que nunca podem degradar) e D (tarefas de código fim a
fim com modelo real). O meta-auditorio atacou cada checker com respostas
degeneradas; sete buracos de lookup foram corrigidos com entrada surpresa em
tempo de execução.

## 6. Segurança

- Gate estático de 13 regras antes de qualquer execução: credenciais, rede,
  subprocessos, destruição de arquivos, `eval`, paths fora do workspace.
- Permission Model do Node confina leitura e escrita ao worktree ativo.
- Contenção de processo derruba a árvore inteira ao finalizar.
- `evals/` e `core/governance/` são áreas protegidas: o loop não as edita.
- Rede, credenciais e escrita fora do workspace pausam para uma pergunta humana
  específica, nunca para um "tem certeza?" genérico.
- Nenhuma chave, token ou `.env` vive no repositório. Chaves reais ficam em
  arquivos ACL-restritos fora dele; o repo contém apenas exemplos com
  placeholders.

## 7. Estrutura do repositório

```
apps/               CLI, testes de interface e contratos de tela
core/agent/         cliente do motor, sessões, i18n, temas, anexos, metadados
core/router/        roteador multi-provider
core/forge/         núcleo de auto-evolução e sondas de artefato
core/memory/        memória em três níveis
core/graph/         grafo, runtime e estado
core/sandbox/       isolamento e análise estática
core/governance/    rollback e aprovação
evals/              tarefas, checkers e gate
scripts/            importação, medições, rotinas e verificação de modelos
launcher/           atalho, ícone e instalador da CLI
config/             exemplo de providers (sem segredos)
docs/               documentação, pesquisa e design
docs/vault/         índice navegável em Obsidian
.pi/harness/        estado persistido do harness
```

## 8. Fronteiras atuais

- `/btw`, keybindings customizáveis, hooks e barra de progresso no título não
  existem: exigem roteamento de modelo auxiliar ou camada de config própria.
- Recuperação de skills é lexical (texto e tags), sem embeddings.
- O auto-disparo do loop já existe (`core/forge/auto.mjs`, comando `auto` e
  modo `--watch`), mas ainda não reage a eventos externos: é disparado por
  relógio, ledger ou chamada explícita.
- Alguns modelos do catálogo terminam uma chamada sem texto; a CLI recupera o
  texto final da mensagem e, mesmo assim vazio, reporta o comportamento do
  provedor sem fingir sucesso.

## 9. Como estender sem quebrar

O ponto de entrada para qualquer agente de código é `AGENTS.md` na raiz. Dele
saem os guias operacionais em `docs/agent-guides/`: mapa de donos, como adicionar
provider, ferramenta, comando, idioma/verbosidade e integrações, quais são as
invariantes e como verificar/desfazer. O mesmo índice existe em
`registro.json`, legível por máquina.

A regra que sustenta tudo: **uma fonte de verdade por conceito, áreas protegidas
intocáveis e gate verde antes de qualquer afirmação**. Mudou o comportamento?
O commit atualiza o teste, a baseline quando legítimo, e a documentação.
