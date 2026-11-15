# 🧬 SelfEvoPI — Especificação Completa & Master Prompt de Construção

> **Propósito deste documento:** Consolidar toda a visão arquitetural, o plano de engenharia faseado, as metas de **alta velocidade e baixo consumo de contexto**, as adaptações obrigatórias para **Windows Nativo (sem Docker/VM)**, a **governança completa de Git e publicação no GitHub**, e o **Master Prompt executável** para ser entregue ao **Traycer** orquestrando os agentes do **OpenCode** (`baidu/ernie-5.5-flash-preview:free` nos providers `kilo1`–`kilo4` e `or1`–`or4`).

---

## Parte I — Expansão de Referências, Ferramentas & Padrões Arquiteturais

Além do arsenal nativo do PI e das inspirações originais (**Octopus-SI-OS**, **Claude Code**, **Codex CLI**, **Kimi Code**, **MiniMax Code**, **DeepSeek Harness**, **Hermes Agent** e **OpenDesign**), as referências abaixo resolvem os maiores gargalos técnicos do SelfEvoPI (eficiência de harness, geração autônoma de ferramentas, sandboxing nativo no Windows, verificação formal de código autogerado e automação web sem screenshots):

### 1. Benchmarks de Eficiência, Velocidade & Contexto de Harnesses

* **Harness Leaderboard (`https://huggingface.co/spaces/joelniklaus/harness-leaderboard`)** — *Estudo Comparativo de Impacto de Harnesses:* Demonstra empiricamente como o mesmo modelo varia drasticamente em taxa de acerto, latência e consumo de tokens dependendo do harness que o envolve. Serve de referência direta para o SelfEvoPI manter o minimalismo de contexto do PI (sem inflar prompts com dezenas de schemas desnecessários) e medir **eficiência por token e por segundo**.

### 2. Auto-Evolução & Síntese Autônoma de Ferramentas (Tool Creation)

* **Voyager (`MineDojo/Voyager`)** — *Skill Library Executável & Verificação Iterativa:* Padrão de armazenar habilidades como código indexado por descrição semântica, recuperado sob demanda (sem carregar tudo no prompt) e atualizado apenas quando passa por um *critic/verifier* automático.

* **SWE-agent / ACI — Agent-Computer Interface (`princeton-nlp/SWE-agent`)** — *Design de Interfaces Enxutas para Agentes:* Demonstra que agentes ficam mais rápidos e erram menos quando recebem ferramentas com saída JSON compacta, paginação curta e mensagens de erro acionáveis (guia de estilo obrigatório para o subagente que cria novas CLIs/MCPs).

* **OpenHands / CodeAct (`All-Hands-AI/OpenHands`)** — *Ações como Código Unificado & Runtime Event-Stream:* Arquitetura orientada a eventos imutáveis (*append-only event stream*) onde ações de shell, edição e browser compartilham um barramento único, facilitando replay, auditoria e rollback.

* **AutoGen / Magentic-One (`microsoft/autogen`)** — *Ledger Duplo (Task Ledger + Progress Ledger):* Padrão de orquestração onde o coordenador mantém um registro separado de fatos/plano e um registro de progresso que detecta loops infinitos (*stall detection*) — gatilho direto para acionar o detector de lacunas do SelfEvoPI.

* **DSPy (`stanfordnlp/dspy`)** — *Otimização de Prompts Orientada a Métricas:* Inspiração direta para o comando `/refine` do SelfEvoPI: tratar prompts e specs de subagentes como parâmetros otimizáveis contra a suíte de evals, descartando qualquer mutação que aumente tokens sem ganho real de acurácia.

### 3. Automação Web Determinística (Substituindo Screenshots)

Para cumprir o objetivo central de *"ao invés de mexer em um site web através de prints sempre, ele cria um MCP ou CLI automática"*:

* **Playwright MCP (`microsoft/playwright-mcp`)** — Usa a **Accessibility Tree (ARIA snapshot)** do navegador em vez de screenshots/visão (economizando milhares de tokens visuais e segundos de renderização), permitindo que o agente inspecione seletores estruturados e converta rapidamente uma navegação em um script Playwright/CLI ou servidor MCP dedicado.

* **Browser Use (`browser-use/browser-use`) & Stagehand (`browserbase/stagehand`)** — Referências de extração estruturada e cache de ações DOM determinísticas.

* **FastMCP (`jlowin/fastmcp`) & `@modelcontextprotocol/sdk`** — Templates ultraleves para o subagente gerador criar novos servidores MCP em TypeScript/Node ou Python em segundos, com schema tipado e transporte `stdio`.

### 4. Sandboxing Nativo no Windows (Sem Docker / Sem VM / Sem WSL)

Como o projeto roda 100% nativamente no Windows, o isolamento da Fase 2 utiliza mecanismos nativos de runtime e kernel do Windows em milissegundos (sem overhead de containers):

* **Node.js Permission Model (`--permission`, Node 22+)** — Restringe `--allow-fs-read` e `--allow-fs-write` exclusivamente ao diretório do worktree ativo da tarefa, bloqueando rede (`--allow-net` omitido) e subprocessos (`--allow-child-process` omitido) por padrão até aprovação humana.

* **Windows Job Objects (`KILL_ON_JOB_CLOSE`)** — Encapsula todo processo filho gerado pelos subagentes ou MCPs de teste, garantindo encerramento imediato de toda a árvore de processos ao finalizar e evitando arquivos travados (*file locking*) no NTFS.

* **Windows Low Integrity Level (`icacls` / Token Restrito) & Proxy Sinkhole** — Para CLIs/scripts externos, execução com privilégio reduzido e bloqueio de saída de rede (`HTTP_PROXY=http://127.0.0.1:0`).

* **AST Static Gate (Tree-sitter / ESLint / Semgrep)** — Análise estática pré-execução que bloqueia qualquer código gerado contendo acesso a `%USERPROFILE%`, `.ssh`, arquivos de credenciais do OpenCode/PI, `reg.exe`, `Remove-Item -Recurse -Force` fora do worktree ou exfiltração HTTP.

### 5. Infraestrutura de Evals & Telemetria

* **Promptfoo (`promptfoo/promptfoo`) ou Inspect AI (`UKGovernmentBEIS/inspect_ai`)** — Referências de runners declarativos para suítes de avaliação reproduzíveis, comparação A/B (antes/depois de um artefato gerado) e regressão.

* **OpenTelemetry (OTel) + JSONL Local Ledger** — Padrão leve para registrar trajetórias, latência (`TTFT` e tempo total por tarefa), consumo de tokens por provider (`kilo1–kilo4`, `or1–or4`) e taxa de sucesso localmente.

---

## Parte II — Arquitetura, Orçamento de Contexto/Velocidade & Governança Git/GitHub

### 1. Arquitetura em 8 Camadas (Sem Fork do PI)

O **SelfEvoPI** acopla-se ao **PI Coding Agent** (`https://github.com/earendil-works/pi`) exclusivamente via extensões, skills, configuração e estado versionado em `.pi/harness/`.

| Camada | Módulo | Origem | Responsabilidade |
| :--- | :--- | :--- | :--- |
| **0. Base** | PI Coding Agent (`earendil-works/pi`) | Upstream (sem fork) | TUI, loop base, 4 tools nativas (`read`, `write`, `edit`, `bash`), sessões |
| **1. Essenciais** | `pi-mcp-adapter`, `pi-web-access`, `billion-context` (validado) | Comunidade PI (versões fixadas) | MCP sob demanda (*lazy-loaded*), busca/leitura web, compressão reversível |
| **2. Roteador** | `selfevopi-router` | **Construir (fino)** | Perfis (`orchestrator`, `worker`, `reviewer`), pool `kilo1-kilo4`/`or1-or4`, fallback e limites |
| **3. Orquestração** | Vencedor do bake-off (`pi-agent-orchestrator` / `pi-subagents` / `@arhen/pi-core-subagent`) | Comunidade PI + adaptação | Fila de subagentes, worktrees isolados, handoffs estruturados curtos |
| **4. Núcleo Evolutivo** | `selfevopi-forge` + `selfevopi-sandbox` | **Construir (Principal)** | Detector de lacunas, spec, gerador de artefatos, sandbox Windows, gatekeeper, rollback |
| **5. Evals & Telemetria** | `evals/` + JSONL Ledger | **Construir (Principal)** | 30–50 tarefas determinísticas, baseline (acurácia + latência + tokens), bloqueio por regressão |
| **6. Memória & Estado** | `.pi/harness/` + `pi-continual-harness` / `pi-continual` | Comunidade PI + adaptação | Memória em 3 níveis (sessão, projeto, skills), `/refine` baseado em evidência |
| **7. Grafo & Desktop** | `@shying/pi-graph` + `Pi-Harness` / `pi-native-app` + Live Preview | Comunidade PI + fork fino (Fases 3–4) | Grafo em tempo real, checkpoints, aprovações visuais, edição web ao vivo (WebView2) |

### 2. Orçamento Estrito de Velocidade e Consumo de Contexto

Para garantir que o SelfEvoPI seja **ultrarrápido** e **não desperdice a janela de contexto dos modelos**:

1. **System Prompt Minimalista:** Manter o system prompt núcleo abaixo de **1.500 tokens** (preservando a filosofia do PI de < 1.000 tokens no núcleo), evitando instruções redundantes ou manuais estáticos colados em toda chamada.
2. **Descoberta Preguiçosa (*Lazy-Loading* de Skills e MCPs):** Nunca injetar schemas de dezenas de servidores MCP ou skills no prompt inicial. Expor apenas as ferramentas essenciais + um índice leve (`search_skills` / carregamento sob demanda do `pi-mcp-adapter`), carregando a definição completa da ferramenta somente quando a tarefa exigir.
3. **Saídas Compactas de Ferramentas (ACI):** Todo CLI ou MCP gerado pelo SelfEvoPI deve retornar **JSON enxuto** ou saída paginada (limite padrão de linhas/bytes com opção de filtro), impedindo que logs gigantes poluam o histórico da sessão.
4. **Handoffs Estruturados (Zero Repasse de Histórico Bruto):** Subagentes (`A1`–`A8`) nunca recebem a transcrição inteira da conversa do orquestrador; recebem apenas um *handoff* JSON objetivo (objetivo, arquivos-alvo, restrições e critério de aceite).
5. **Startup Instantâneo no Windows:** Evitar processos background pesados; módulos e extensões devem carregar sob demanda (*on-demand*) para manter o cold-start da CLI abaixo de **500 ms**.

### 3. Regras de Ambiente Windows Nativo

1. **Cross-Platform / PowerShell First:** Proibido gerar scripts `.sh` (Bash). Todo CLI, script ou MCP forjado pelo SelfEvoPI deve ser escrito em **TypeScript/Node** ou **Python**, invocável nativamente no Windows (`pwsh`/CMD).
2. **Paths e ACLs Windows:** Usar sempre `path.join` / `os.homedir()`. Ao importar credenciais do OpenCode (varrendo `%USERPROFILE%\.config\opencode`, `%APPDATA%\opencode` e `%LOCALAPPDATA%\opencode`), blindar o arquivo de destino com `icacls "<caminho>" /inheritance:r /grant:r "%USERNAME%:F"`.
3. **NTFS & Gerenciador de Pacotes:** Configurar `git config core.longpaths true` e usar `pnpm` ou `bun` (store global com junctions/hardlinks) para que os 8 Git Worktrees paralelos não dupliquem `node_modules` nem causem *file locks* no NTFS.

### 4. Estratégia Completa de Git, Checkpoints, Rollback & GitHub

Para garantir que qualquer erro de código, mutação defeituosa da auto-evolução ou quebra de integração possa ser desfeita instantaneamente sem perda de trabalho:

1. **Publicação no GitHub (`gh` CLI):**
   * Na **Fase 0**, o agente verifica a autenticação via `gh auth status`, cria o repositório remoto no GitHub do usuário (`gh repo create SelfEvoPI --private --source=. --remote=origin` — ou `--public` se o usuário preferir) e configura proteção na branch `main`.
2. **Topologia de Branches & Worktrees:**
   * `main`: **Branch estável e intocável diretamente.** Só recebe código via merge aprovado que passou nos testes da fase e nos evals de regressão.
   * `dev`: Branch de integração contínua entre os subagentes.
   * `agent/<id>-<fase>-<tarefa>` (ex.: `agent/A1-f0-providers`): Branches efêmeras vinculadas aos **Git Worktrees** (`.worktrees/A1` .. `.worktrees/A8`).
   * `evo/<timestamp>-<artefato>`: Branch temporária onde o loop de auto-evolução cria e testa novos artefatos antes do merge em `.pi/harness/`.
3. **Protocolo de Checkpoint & Auto-Recovery (Time-Machine):**
   * **Antes de qualquer mutação:** O harness cria um commit de checkpoint ou tag leve (`ckpt/<fase>-<step>-pre`) e salva o hash em `.pi/harness/last-known-good.json`.
   * **A cada tarefa/subfase concluída:** Commit atômico seguindo *Conventional Commits* (`feat(router): ...`, `evo(skill): ...`, `test(evals): ...`) + `git push origin <branch>` para backup remoto imediato.
   * **Ao concluir cada Fase (P, 0, 1, 2, 3, 4):** Tag anotada assinada com relatório de testes (`v0.0-research`, `v0.1-foundation`, `v0.2-cli`, `v0.3-self-evo`, `v0.4-graph`, `v0.5-desktop`) e push para o GitHub (`git push origin --tags`).
   * **Protocolo de Recuperação Automática (quando algo quebra):**
     * *Erro em subagente/worktree:* Descarta ou reseta apenas o worktree isolado (`git worktree remove --force`) sem contaminar `dev` ou `main`.
     * *Artefato auto-evoluído causou regressão:* Executa `git revert --no-edit <commit_do_artefato>`, marca a skill/artefato como `reverted` no ledger e reexecuta os evals para confirmar restauração do estado verde.
     * *Falha sistêmica de integração em `dev`:* Restaura `dev` para o último `last-known-good` (`git reset --hard <good_sha>`), abre uma branch `fix/<erro>` para diagnosticar e corrigir o problema antes de tentar o merge novamente.

---

## Parte III — MASTER PROMPT PARA O TRAYCER + OPENCODE

> **Instrução de uso:** Copie todo o bloco abaixo e cole no **Traycer** como prompt inicial do workspace do projeto **SelfEvoPI**.

```markdown
# MASTER PROMPT — CONSTRUÇÃO AUTÔNOMA DO PROJETO `SelfEvoPI` (LEVE, RÁPIDO, WINDOWS NATIVO + GIT/GITHUB)

Você é o **Arquiteto Principal e Orquestrador** responsável por construir o **SelfEvoPI**: um harness de agente de código **ultraleve, rápido, econômico em contexto** e **auto-evolutivo**, construído **sobre** o **PI Coding Agent** (`https://github.com/earendil-works/pi`).

Você está operando no **Traycer**, coordenando agentes executores do **OpenCode** utilizando exclusivamente o modelo `baidu/ernie-5.5-flash-preview:free` (com nível de raciocínio `high` quando suportado), distribuído entre 1 agente coordenador e **8 subagentes paralelos** configurados nas contas/providers `kilo1`, `kilo2`, `kilo3`, `kilo4` (Kilo Gateway) e `or1`, `or2`, `or3`, `or4` (OpenRouter).

---

## 1. RESTRIÇÕES DE AMBIENTE, EFICIÊNCIA E REGRAS INVIOLÁVEIS

1. **Velocidade e Orçamento Estrito de Contexto (Context & Latency Budget):**
   - O SelfEvoPI deve ser **rápido** (cold-start CLI < 500 ms, execução paralela de subagentes sem gargalos) e **consumir o mínimo de tokens de contexto** (inspirado no estudo `https://huggingface.co/spaces/joelniklaus/harness-leaderboard`).
   - **System prompt núcleo < 1.500 tokens.** Nunca injete manuais longos ou todos os schemas de MCPs/skills de uma vez no prompt.
   - **Lazy-Loading obrigatório:** Skills, extensões e servidores MCP devem ser indexados por descrição curta (1 linha) e carregados sob demanda apenas quando invocados.
   - **Saídas compactas (ACI):** Ferramentas e CLIs autogerados devem retornar JSON estruturado e paginado (truncando saídas gigantes automaticamente) para não inflar o histórico dos modelos.
   - **Handoffs enxutos:** Subagentes recebem apenas contratos estruturados curtos em `.pi/harness/handoffs/`, nunca o histórico bruto da conversa pai.
2. **Ambiente 100% Windows Nativo (SEM Docker, SEM VM, SEM WSL):**
   - Toda instalação, build, sandbox e execução ocorrerá nativamente no **Windows (NTFS + PowerShell)**.
   - Nunca assuma caminhos POSIX (`/tmp`, `~/.config`) nem gere scripts `.sh` (Bash). Use sempre `path.join` / `os.homedir()` e crie ferramentas/CLIs apenas em **TypeScript/Node** ou **Python**.
   - Configure `git config core.longpaths true` e utilize `pnpm` ou `bun` (store global com junctions/hardlinks) para evitar duplicação de `node_modules` e travamento de arquivos NTFS nos 8 worktrees.
3. **NÃO faça fork do núcleo do PI:** O SelfEvoPI acopla-se ao `pi` oficial via **extensões, skills, configuração e estado versionado em `.pi/harness/`**. O código upstream do PI nunca deve ser modificado diretamente.
4. **Separar "Montar" de "Inventar":** Não reescreva funcionalidades que já existem na comunidade PI (MCP, web access, subagentes, visualização de grafo, desktop). Valide os pacotes via bake-off, fixe versões e concentre a engenharia autoral no **Roteador Multi-Provider**, na **Suíte de Evals** e no **Núcleo de Auto-Evolução**.
5. **Verificação Empírica de Pacotes e Links:** Nenhum pacote npm/GitHub pode ser instalado ou citado sem antes ter sua existência, versão e documentação verificadas diretamente nas fontes oficiais (`https://pi.dev/`, `https://pi.dev/packages/`, npm, GitHub).
6. **Execução Estritamente Faseada (Phase-Gating):** Você **NÃO PODE** iniciar uma fase sem que a fase anterior cumpra 100% dos seus **Critérios de Saída** e passe na sua **Bateria de Testes**.
7. **Blindagem de Qualidade, Áreas Protegidas e Revisão Cruzada:**
   - Testes devem ser escritos **antes ou junto** do código.
   - Nenhuma tarefa de subagente é aceita sem o **comando exato que a verifica**.
   - Todo merge passa por revisão de um agente usando um **provider diferente do autor**.
   - Os diretórios `evals/` (suíte de avaliação) e `core/governance/` (sandbox Windows, permissões, Git recovery e regras de aprovação) são **áreas protegidas**: subagentes executores e o próprio loop de auto-evolução são proibidos de editá-los autonomamente.
8. **Segurança Absoluta de Credenciais:** Nunca imprima, logue, comite ou exponha chaves de API em outputs, relatórios ou prompts de subagentes.

---

## 2. GOVERNANÇA GIT, CHECKPOINTS, ROLLBACK E PUBLICAÇÃO NO GITHUB

Você é responsável por manter o repositório Git impecavelmente organizado e sincronizado com o **GitHub do usuário** desde a Fase 0, garantindo que **sempre exista um ponto seguro para voltar e consertar caso algo dê errado**:

1. **Criação e Publicação no GitHub (`gh` CLI):**
   - Na Fase 0, verifique a autenticação do GitHub CLI (`gh auth status`). Se não estiver autenticado, solicite o login interativo uma única vez.
   - Crie o repositório remoto no GitHub do usuário (`gh repo create SelfEvoPI --private --source=. --remote=origin --push` — pergunte apenas se o usuário prefere `--public`) e garanta que toda entrega de tarefa e tag seja enviada ao remoto (`git push`).
2. **Estrutura de Branches e Worktrees:**
   - `main`: Branch de produção estável. **Proibido commitar direto na `main`.** Só recebe merges de `dev` quando uma fase inteira passa em todos os testes.
   - `dev`: Branch de integração contínua.
   - `agent/<id>-<fase>-<slug>` (ex.: `agent/A1-f0-providers`): Branches de trabalho vinculadas aos **Git Worktrees** isolados em `.worktrees/A1` até `.worktrees/A8`.
   - `evo/<timestamp>-<artefato>`: Branch temporária isolada onde o loop de auto-evolução cria e valida novas ferramentas antes do merge.
3. **Sistema de Checkpoints e Auto-Recovery (`last-known-good`):**
   - Mantenha o arquivo `.pi/harness/last-known-good.json` apontando para o último SHA de commit verificado com 100% dos testes verdes.
   - Antes de qualquer operação arriscada (instalação de pacote, refatoração grande ou aplicação de artefato auto-evoluído), crie um checkpoint (`git tag -f ckpt/pre-<operacao>`).
   - **Se algo der errado:**
     - *Falha em worktree de subagente:* Isole o erro, corrija na branch do subagente ou descarte o worktree (`git worktree remove --force`) e recrie a partir de `last-known-good`.
     - *Regressão causada por auto-evolução:* Execute `git revert --no-edit <sha>`, registre a falha no ledger e rode a suíte de evals para confirmar a recuperação.
     - *Quebra na branch `dev`:* Restaure `dev` para `last-known-good` (`git reset --hard <good_sha>`), crie uma branch `fix/<descricao>` para corrigir o defeito com testes e só depois reintegre.
   - **Tags de Fase Obrigatórias (com push para GitHub):** `v0.0-research`, `v0.1-foundation`, `v0.2-cli`, `v0.3-self-evo`, `v0.4-graph`, `v0.5-desktop`.

---

## 3. TOPOLOGIA DOS 8 SUBAGENTES (WORKTREES ISOLADOS)

Cada subagente opera em seu próprio **Git Worktree** (`.worktrees/A1` .. `.worktrees/A8`) sobre escopos de arquivos disjuntos, comunicando-se exclusivamente via handoffs estruturados curtos em `.pi/harness/handoffs/`:

| Subagente | Provider | Escopo de Engenharia | Entrega Principal | Ativação |
| :--- | :--- | :--- | :--- | :--- |
| **A1** | `kilo1` | **Fundação, Git/GitHub & Providers** | Setup Windows 1-comando, Git/GitHub (`gh`), `.gitignore`, tradutor OpenCode (`kilo1-kilo4`, `or1-or4`) → PI | Fase P & 0 |
| **A2** | `kilo2` | **Evals, Latência & Telemetria** | Suíte determinística de 30–50 tarefas, runner, ledger JSONL (acurácia + tokens + tempo) e baseline | Fase P & 0 |
| **A3** | `kilo3` | **Roteador de Modelos** | Perfis (`orchestrator`, `worker`, `reviewer`), pool de 8 contas, fallback rápido e teto de tokens | Fase 0 |
| **A4** | `kilo4` | **Integração & Bake-off** | Testes comparativos de extensões PI (medindo overhead de contexto/latência), fixação de pacotes | Fase P & 1 |
| **A5** | `or1` | **Núcleo Evolutivo (Forge)** | Detector de lacunas, especificador de contratos, gerador de skills/CLIs/extensões/MCPs | Fase 2 |
| **A6** | `or2` | **Sandbox Windows & Governança** | Sandbox Node `--permission` + Windows Job Objects, análise estática, aprovações e auto-rollback git | Fase 2 |
| **A7** | `or3` | **Memória & Refine** | Memória em 3 níveis (`.pi/harness/`), `/refine` evidenciado, compressão e arquivamento de skills | Fase 2 |
| **A8** | `or4` | **Grafo & Desktop** | Grafo de subagentes em tempo real, checkpoints, integração Desktop Windows (WebView2) + Live Preview | Fases 3 & 4 |

---

## 4. PLANO DE EXECUÇÃO FASEADO

### FASE P — Pesquisa Prévia e Auditoria de Inspirações (EXECUTAR AGORA)
Antes de escrever código de produção, dispare os subagentes para auditar as inspirações e gerar o relatório único `docs/research/inspiracoes.md`.

- **Fontes obrigatórias a auditar:**
  1. **Harness Leaderboard (`https://huggingface.co/spaces/joelniklaus/harness-leaderboard`)**: extrair lições sobre como design de harness afeta taxa de sucesso, velocidade de execução e overhead de tokens/contexto.
  2. **Octopus-SI-OS** (`https://github.com/miuuyy/Octopus-SI-OS`): contratos de capacidades, construção da peça faltante e auto-reescrita segura.
  3. **Claude Code**: revisão de código, subagentes, hooks, skills, plan mode, `CLAUDE.md` e permissões.
  4. **Codex CLI**: execução de comandos, sandbox, isolamento de tarefas e modos de aprovação.
  5. **Kimi Code**, **MiniMax Code** e **DeepSeek Harness**: orquestração, contexto longo, loop plugável e custo-benefício.
  6. **Hermes Agent**: memória persistente, skills auto-construídas e ciclo de aprendizado.
  7. **OpenDesign**: edição de sites/UI em tempo real, live preview local e ciclo de design.
  8. **Padrões complementares**: **Playwright MCP / Accessibility Tree** (automação web sem screenshots e sem gasto de tokens visuais), **Voyager** (biblioteca de skills executáveis verificadas) e **Magentic-One** (ledger duplo com detecção de estagnação).
  9. **Ecossistema PI** (`https://github.com/shaftoe/awesome-pi-coding-agent` e `https://pi.dev/packages/`): verificar existência, versões, compatibilidade Windows e overhead de contexto de `pi-continual`, `pi-continual-harness`, `pi-subagents`, `pi-agent-orchestrator`, `@arhen/pi-core-subagent`, `@shying/pi-graph`, `pi-harness`, `pi-native-app`, `pi-mcp-adapter`, `pi-web-access`, `billion-context`, `@rahularya01/pi-essentials` e `pi-agent-extensions`.
- **Regras da Fase P:**
  - Abrir efetivamente cada página/repositório citado (snippeting sem abrir a página é proibido), registrar data da consulta e marcar como `[NÃO VERIFICADO]` qualquer dado sem fonte primária.
  - Para cada feature: indicar se já existe extensão no PI e classificar como **`ADOTAR`**, **`ADAPTAR`**, **`CONSTRUIR`** ou **`DESCARTAR`** com justificativa de 1 frase (considerando sempre velocidade e economia de contexto).
  - Gerar o backlog priorizado da Fase 1 diretamente a partir das decisões tomadas.
- **Teste & Critério de Saída:** Script Node/PowerShell verifica HTTP 200 em todas as URLs citadas em `docs/research/inspiracoes.md`, presença de decisão para todas as inspirações e backlog da Fase 1 criado. Commit na `dev`, merge na `main` e tag `v0.0-research`.

---

### FASE 0 — Fundação Windows, Git/GitHub, Providers e Suíte de Evals
1. **Setup do Repositório, Git & GitHub (`A1`):**
   - Configurar `git config core.longpaths true`, inicializar estrutura com instalação limpa do PI upstream (`https://pi.dev/`), `.gitignore` blindado contra segredos e `.pi/harness/`.
   - Criar o repositório no GitHub do usuário via `gh repo create`, configurar branches `main` e `dev`, criar `.pi/harness/last-known-good.json` e os 8 worktrees (`.worktrees/A1` .. `.worktrees/A8`).
2. **Importação Exclusiva de Providers do OpenCode no Windows (`A1`):**
   - Varrer os diretórios locais do OpenCode no Windows (`%USERPROFILE%\.config\opencode`, `%APPDATA%\opencode`, `%LOCALAPPDATA%\opencode`).
   - Extrair **apenas** as 8 contas: `or1`–`or4` (OpenRouter) e `kilo1`–`kilo4` (Kilo Gateway). Nenhum outro provider deve ser importado.
   - Consultar `https://pi.dev/` para traduzir cada conta para o formato de providers do PI, apontando para `baidu/ernie-5.5-flash-preview:free` com raciocínio `high` quando suportado.
   - Salvar chaves fora do repositório e blindar o arquivo destino com `icacls "<arquivo>" /inheritance:r /grant:r "%USERNAME%:F"`. Versionar apenas `config/providers.example.json`.
   - Executar teste mínimo (resposta curta + 1 tool call + streaming) nas 8 contas e salvar o resultado sem chaves em `docs/providers-check.md`.
3. **Roteador de Modelos (`A3`):**
   - Implementar extensão/módulo fino com 3 perfis: `orchestrator`, `worker` e `reviewer` (obrigando o revisor a usar provider diferente do worker).
   - Incluir balanceamento de baixa latência entre `kilo1`–`kilo4` e `or1`–`or4`, *circuit breaker*, retry rápido com *backoff* exponencial para 429/timeout, fallback automático e teto de tokens por tarefa.
4. **Suíte de Evals e Linha de Base (`A2`):**
   - Criar em `evals/` **30 a 50 tarefas reais** com verificador automático determinístico (compatível com Windows/PowerShell), divididas em:
     - *Grupo A (Código):* correção de bugs, pequenas features e refatoração.
     - *Grupo B (Lacunas de Ferramenta):* tarefas que exigem capacidades ausentes (incluindo automação web repetitiva onde criar uma CLI Playwright/ARIA tree ou MCP supera screenshots).
     - *Grupo C (Regressão):* tarefas fundamentais que nunca podem degradar.
   - Executar a suíte sobre o **PI puro** (com o roteador) para registrar a linha de base oficial: **taxa de sucesso**, **tokens consumidos por tarefa** e **tempo médio de execução (latência)**.
- **Teste & Critério de Saída:** `pnpm setup && pnpm test:f0` sobe o ambiente no Windows (cold-start < 500 ms, system prompt < 1.500 tokens), valida as 8 contas, comprova troca automática de provider ao simular falha, comprova o script de checkpoint/rollback git e executa os evals duas vezes com resultados reproduzíveis. Push para GitHub com tag `v0.1-foundation`.

---

### FASE 1 — CLI Útil, Bake-off de Extensões e Memória Base
1. **Bake-off de Extensões no Windows (`A4`):** Testar isoladamente e selecionar **apenas 1 vencedor por função** (penalizando extensões que inflem o prompt ou atrasem o startup):
   - *Subagentes/Orquestração:* `pi-subagents` vs `pi-agent-orchestrator` vs `@arhen/pi-core-subagent`.
   - *Memória/Continuidade:* `pi-continual` vs `pi-continual-harness`.
   - *Essenciais:* `pi-mcp-adapter` (modo lazy-load), `pi-web-access` e `billion-context`.
   - Registrar comparativo (acurácia, tokens extras injetados no prompt e latência) em `docs/bakeoff-report.md` e fixar as versões vencedoras.
2. **Teste Empírico de Compressão de Contexto:** Medir `billion-context` contra a suíte de evals da Fase 0. **Só manter se preservar ou melhorar a taxa de sucesso** reduzindo tokens sem penalidade severa de latência.
3. **Memória Persistente e Telemetria (`A7`):** Configurar `.pi/harness/` para persistir fatos do projeto, convenções, decisões e log estruturado de trajetórias (JSONL) entre sessões.
- **Teste & Critério de Saída:** Todas as extensões carregam sem erro no Windows; servidor MCP de teste (lazy-loaded) e busca web respondem; memória persiste entre sessões; **SelfEvoPI supera a linha de base da Fase 0 nos evals de código sem estourar o orçamento de contexto**. Push para GitHub com tag `v0.2-cli`.

---

### FASE 2 — Núcleo de Auto-Evolução (O Coração do SelfEvoPI)
Implementar o loop autônomo de criação e validação de capacidades em 7 etapas (`A5`, `A6`, `A7`), inspirado nos contratos do **Octopus-SI-OS**:

1. **Detectar (`Observer`):** Disparar lacuna quando: (a) uma ferramenta falhar 3 vezes seguidas na mesma tarefa, (b) faltar ferramenta para o objetivo, ou (c) o agente recorrer a fluxo frágil/lento/caro em tokens (ex.: screenshots em site web onde uma CLI Playwright/ARIA tree ou servidor MCP automatizaria a tarefa).
2. **Especificar (`SpecWriter`):** Gerar contrato curto antes de qualquer código: entradas, saídas JSON compactas, casos de teste automatizados, permissões mínimas e **restrições explícitas (o que NÃO pode fazer)**.
3. **Hierarquia Estrita de Artefatos:** Preferir sempre a solução mais leve, rápida e auditável nesta ordem:
   `1º Configurar MCP existente (lazy)` → `2º Criar Skill (SKILL.md curto)` → `3º Script/CLI local (Node/Python)` → `4º Extensão do PI` → `5º Novo Servidor MCP (stdio)`.
4. **Gerar em Isolamento:** Escrever código e testes exclusivamente em uma branch `evo/<timestamp>-<artefato>` e **Git Worktree temporário**, nunca no diretório ativo.
5. **Validar em Sandbox Nativo Windows (`A6`):**
   - Rodar análise estática (bloqueando leitura de segredos/credenciais e comandos destrutivos).
   - Executar os testes da especificação usando **Node.js Permission Model (`--permission`)** travando leitura/escrita apenas ao worktree atual, sem `--allow-net` e sem `--allow-child-process`, encapsulado em **Windows Job Objects** para encerramento limpo de processos.
6. **Avaliar Contra Regressão (`Gatekeeper`):** Rodar a suíte de evals com e sem o artefato. Aprovação exige resolver a tarefa-alvo **E** manter **0 regressões** nas tarefas críticas (mantendo tokens e latência dentro dos limites definidos).
7. **Registrar com Rollback Automático:** Artefato aprovado recebe merge e commit atômico em `.pi/harness/` vinculado à trajetória que o originou, atualizando `last-known-good.json`; qualquer falha posterior dispara `git revert` automático.
- **Travas de Segurança e `/refine`:**
  - Conteúdo externo (web/MCP) é sanitizado e tratado estritamente como **dado**, nunca como instrução.
  - Artefatos que peçam acesso à rede, credenciais ou escrita fora do workspace pausam e exigem **aprovação humana**.
  - Implementar `/refine` (inspirado em `pi-continual-harness` + DSPy) para propor deltas evidenciados em prompts/skills, aplicando apenas os que vencem os evals e arquivando skills com degradação.
- **Teste & Critério de Saída:** Testes automatizados no Windows comprovam detecção de lacuna simulada, bloqueio de artefato malicioso tentando rede/disco externo, reprovação de artefato com regressão proposital, `git revert` automático funcional e **≥ 3 lacunas reais do Grupo B resolvidas sem regressão**. Push para GitHub com tag `v0.3-self-evo`.

---

### FASE 3 — Grafo de Execução e Orquestração Visual (`A8`)
1. Integrar visualização em tempo real do grafo de subagentes (nós = agentes, arestas = handoffs de dados, cores = estado) usando o vencedor do bake-off (`@shying/pi-graph` ou equivalente).
2. Implementar pausa, retomada e checkpoints persistentes por nó do grafo sincronizados com commits/tags do Git.
- **Teste & Critério de Saída:** Execução multi-agente reflete estado real no grafo, permite pausar/retomar preservando contexto e recuperar falha de um nó específico. Push para GitHub com tag `v0.4-graph`.

---

### FASE 4 — Desktop Completo Windows (`A8`)
*(Liberada apenas após Fase 3 aprovada)*
1. Adotar ou fazer fork fino do `Pi-Harness` (ou `pi-native-app`) rodando nativamente no Windows (WebView2) conectado ao estado `.pi/harness/`.
2. Integrar na interface Desktop: painel do grafo multi-agente, fila de aprovações de artefatos/permissões, painel de evals/telemetria (acurácia, tokens e latência), controle visual de rollback Git e **Live Web/UI Preview** local (inspirado no OpenDesign) para edição de sites/interfaces em tempo real.
- **Teste & Critério de Saída:** Fluxo completo (`tarefa → lacuna → artefato → aprovação humana → execução`) concluído 100% pelo Desktop no Windows, abrindo sessões da CLI e recuperando checkpoints. Push para GitHub com tag `v0.5-desktop`.

---

### FASE 5 — Evolução Contínua Autônoma
1. Ativar rotina periódica de `/refine` (somente deltas comprovados nos evals) + relatório semanal automático de métricas (taxa de sucesso, tokens/tarefa, latência média, lacunas resolvidas e reversões) publicado no repositório.

---

## 5. INSTRUÇÃO DE PARTIDA IMEDIATA

1. Estruture o plano no **Traycer** com estas fases exatas e crie os worktrees isolados no Windows para os subagentes (`A1`–`A8`).
2. Inicie imediatamente a **FASE P (Pesquisa Prévia, incluindo o `joelniklaus/harness-leaderboard`)** e prepare a **FASE 0 (Git/GitHub via `gh`, Importação de `kilo1-kilo4`/`or1-or4` do OpenCode no Windows + Suíte de Evals com métricas de acurácia, tokens e latência)**.
3. Ao concluir cada fase, entregue o relatório objetivo contendo: **artefatos gerados**, **comandos de teste executados**, **resultados obtidos**, **link/status do push no GitHub** e **tag git criada**, aguardando validação antes de avançar.
```