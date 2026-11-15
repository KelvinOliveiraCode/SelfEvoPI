# FASE P — Auditoria de Inspirações, Arquitetura e Engenharia

> **Projeto:** SelfEvoPI — harness auto-evolutivo, leve e Windows-nativo sobre o PI Coding Agent.
> **Data da auditoria:** 2026-11-15 (todas as URLs foram abertas nesta data; nenhuma fonte foi citada sem abertura).
> **Método:** abertura direta de cada repositório/documentação oficial + leitura do README/docs primários. Dados secundários (notícias, agregadores) são marcados como `[SECUNDÁRIO]`. Dados sem fonte primária são marcados como `[NÃO VERIFICADO]`.
> **Saída esperada da fase:** este documento + `backlog-fase1.md` + `scripts/verify-urls.mjs` (ver critério de saída no fim).

---

## 0. Sumário executivo — as 12 decisões que mudam o plano

| # | Descoberta | Impacto no plano |
| :-- | :--- | :--- |
| 1 | **O PI não tem sistema de permissões embutido.** O README oficial diz: *"Pi does not include a built-in permission system… by default, it runs with the permissions of the user"*. | A camada de sandbox (Camada 4) **não é opcional**: é o único controle de segurança do SelfEvoPI. Sobe de prioridade na Fase 2. |
| 2 | **`@earendil-works/pi-ai` já é uma API LLM multi-provider unificada** e `@earendil-works/pi-telemetry` já traz contratos de telemetria vendor-neutral. | O Roteador (A3) e a Telemetria (A2) devem **ADOTAR** o core em vez de construir do zero. Reduz risco e código. |
| 3 | **`pi-subagents` já implementa lazy-loading de schema** (`subagents_enable` só expõe o schema completo após autorização) e traz agentes prontos (`scout`, `worker`, `reviewer`, `oracle`…). | É o **padrão de referência** para a regra "lazy-loading obrigatório". ADOTAR o padrão; concorrer no bake-off com `pi-agent-orchestrator` / `@arhen/pi-core-subagent`. |
| 4 | **`pi-continual-harness` já entrega `/refine` com deltas estruturados** (CRUD com evidência), ancorado em dois papers (Continual Harness + ACE). | A7 (Memória & Refine) passa a **ADAPTAR** em vez de construir. Ganho direto de 1 fase. |
| 5 | **Harness Leaderboard (nov/2026):** Pi = **49,4%** de resolução a **US$ 0,29/tarefa resolvida**; mini-swe-agent = 51,4% a **US$ 0,53**; OpenCode = **US$ 3,35** (11,7× Pi). 10 harnesses, 28.849 trials. | Valida empiricamente a tese central do projeto (eficiência > inchaço). O orçamento de contexto do SelfEvoPI deixa de ser opinião e vira meta medida. |
| 6 | **O melhor harness depende do modelo** (mini-swe-agent no GLM, Hermes Agent no DeepSeek, Kimi Code no Flint). | O Roteador (A3) deve escolher **harness/perfil por modelo**, não fixar um perfil único para os 8 providers. |
| 7 | **DeepSeek Harness perdeu 1,5–1,7 ponto por matar processos de background ao sair** (2/36 em tarefas que exigem servidor vivo). | O sandbox SelfEvoPI precisa de **política explícita de keep-alive**. Matar a árvore inteira por padrão (Job Objects) *causa* falha de eval. |
| 8 | **`microsoft/autogen` está ARQUIVADO** (sem manutenção). O sucessor é o **Microsoft Agent Framework**. | ADOTAR o *padrão* Magentic-One (ledger duplo), **DESCARTAR** a biblioteca. |
| 9 | **`pi-native-app` é desktop para macOS Apple Silicon.** | A Fase 4 (Desktop Windows) não pode depender dele. Caminho: `Pi-Harness` (desktop superset) ou construir shell Windows. |
| 10 | **Playwright recomenda CLI + SKILLS em vez de MCP** para coding agents ("more token-efficient… avoid loading large tool schemas"). | Reforça a hierarquia de artefatos do plano, mas **inverte o 1º nível**: CLI+SKILL medido antes de criar MCP novo. |
| 11 | **Node Permission Model é "cinto de segurança", não sandbox**: o próprio doc diz que *"does not protect against malicious code"*. | Não basta `--permission`. Exige **token restrito + gate estático + keep-alive policy**. A6 precisa dos três. |
| 12 | **OpenDesign já suporta Pi nativamente** (`od mcp install pi`) e é Apache-2.0, local-first. | A Fase 4 pode **integrar** o live preview em vez de reimplementar. |

---

## 1. Tabela de decisões

Legenda: **ADOTAR** = usar como está · **ADAPTAR** = usar com modificação · **CONSTRUIR** = engenharia autoral · **DESCARTAR** = não usar.

| Fonte | Camada SelfEvoPI | Decisão | Justificativa (1 frase) |
| :--- | :--- | :--- | :--- |
| PI Coding Agent (`earendil-works/pi`) | 0 — Base | **ADOTAR** | É o núcleo; instalação Windows oficial via `irm https://pi.dev/install.ps1 \| iex`. |
| `@earendil-works/pi-ai` | 2 — Roteador | **ADOTAR** | API multi-provider unificada (OpenAI/Anthropic/Google…) evita reescrever camada de provider. |
| `@earendil-works/pi-telemetry` | 5 — Telemetria | **ADOTAR** | Contratos vendor-neutral + suíte de conformidade já existem no core. |
| `pi-mcp-adapter` (lazy) | 1 — Essenciais | **ADOTAR** | Adapter MCP com carregamento sob demanda; 2,1M/mo, mantido ativo. |
| `pi-web-access` | 1 — Essenciais | **ADOTAR** | Busca/URL/PDF/vídeo; 1,4M/mo; cobre a necessidade de web do projeto. |
| `billion-context` | 1 — Essenciais | **ADAPTAR** | Compressão reversível 5×; só manter se o eval provar ganho (Fase 1, teste empírico). |
| `pi-subagents` | 3 — Orquestração | **ADOTAR** (candidato A) | Delegação + workflows; lazy schema; agentes builtin; 972K/mo. |
| `pi-agent-orchestrator` | 3 — Orquestração | **ADAPTAR** `[NÃO VERIFICADO: repo/npx]` | Concorrente no bake-off; precisa de verificação de existência/versão. |
| `@arhen/pi-core-subagent` | 3 — Orquestração | **ADAPTAR** `[NÃO VERIFICADO: repo/npx]` | Subagentes in-process rápidos (snippet awesome-pi); mesmo bake-off. |
| `@tintinweb/pi-subagents` | 3 — Orquestração | **ADAPTAR** (backup) | Variante Claude-Code-like com fleet view; 66,7K/mo. |
| `@quintinshaw/pi-dynamic-workflows` | 3 — Orquestração | **ADAPTAR** (backup) | Já traz roteamento real, worktree isolation e token accounting — quase o A3+A4. |
| `pi-continual-harness` | 6 — Memória | **ADOTAR** | `/refine` com deltas estruturados + harness-state store; cumpre A7 quase inteiro. |
| `pi-memory` / `pi-reflect` / `pi-mem` | 6 — Memória | **ADAPTAR** | Camada de armazenamento durável; compor, não reinventar. |
| `@shying/pi-graph` | 7 — Grafo | **ADOTAR** | LangGraph-inspired, durável, com nós `human` e checkpoints — exatamente a Fase 3. |
| `Pi-Harness` (`wangmiaozero/pi-harness`) | 7 — Desktop | **ADAPTAR** | Superset desktop (workspace, run history, recovery, agent teams). |
| `pi-native-app` | 7 — Desktop | **DESCARTAR** | Desktop macOS Apple Silicon — incompatível com Windows nativo. |
| OpenDesign (`nexu-io/open-design`) | 7 — Desktop | **ADOTAR** | Apache-2.0, local-first, `od mcp install pi`; live preview pronto. |
| `pi-acp` | 7 — Desktop | **ADAPTAR** | Adapter ACP (Agent Client Protocol) pode padronizar handoff com o desktop. |
| Octopus-SI-OS | 4 — Núcleo Evolutivo | **ADAPTAR** | Arquitetura é macOS+Rust (inutilizável direto), mas o modelo "capacidades como contratos" é a espinha do Forge. |
| Voyager (`MineDojo/Voyager`) | 4 — Núcleo Evolutivo | **ADAPTAR** | Skill library executável + verifier iterativo; aplicar ao detector de lacunas. |
| SWE-agent / mini-swe-agent | 4 — Núcleo Evolutivo | **ADOTAR** (padrão ACI) | Guia de ACI: saída JSON compacta, paginação, erro acionável. |
| OpenHands (Agent Canvas) | 3/7 | **ADAPTAR** | Control center ACP; padrão de event stream para replay/auditoria. |
| Magentic-One (padrão) | 3 — Orquestração | **ADOTAR** (padrão) | Ledger duplo (task + progress) e detecção de estagnação. |
| AutoGen (biblioteca) | — | **DESCARTAR** | Repositório arquivado e sem manutenção pela Microsoft. |
| Microsoft Agent Framework | 3 — Orquestração | **ADAPTAR** `[SECUNDÁRIO]` | Sucessor do AutoGen; referência de orquestração multi-agente. |
| DSPy / GEPA | 6 — Refine | **ADAPTAR** | Otimização de prompts orientada a métrica; usar só o que vence o eval. |
| Playwright MCP | 4 — Forge | **ADOTAR** | Árvore de acessibilidade (sem screenshots) — economia massiva de tokens. |
| Playwright **CLI + SKILLS** | 4 — Forge | **ADOTAR** (preferir) | A própria Microsoft diz ser mais eficiente em tokens para coding agents. |
| FastMCP (Python/TS) | 4 — Forge | **ADOTAR** | Gerador de MCP; 1.0 no SDK oficial; TS em `@prefecthq/fastmcp-ts`. |
| Node Permission Model | 4 — Sandbox | **ADAPTAR** | Cinto de segurança, não protege contra código malicioso — somar token restrito. |
| Windows Job Objects | 4 — Sandbox | **ADOTAR** | `KILL_ON_JOB_CLOSE` encerra a árvore; herança de job por padrão. |
| `icacls` / Low Integrity / proxy sinkhole | 4 — Sandbox | **ADOTAR** | Isolamento nativo Windows sem Docker/VM. |
| Tree-sitter / ESLint / Semgrep | 4 — Sandbox | **ADOTAR** (gate estático) | Bloqueio pré-execução de acesso a segredos e comandos destrutivos. |
| Promptfoo | 5 — Evals | **ADAPTAR** | Evals declarativos + CI; agora é OpenAI, MIT. Não substitui o runner determinístico. |
| Inspect AI | 5 — Evals | **ADAPTAR** `[NÃO VERIFICADO]` | Alternativa de runner; decidir no bake-off da Fase 0. |
| OpenTelemetry + JSONL | 5 — Telemetria | **ADOTAR** | Padrão leve para trajetórias, latência e tokens por provider. |
| DeepSeek Harness | 4 — Sandbox | **ADAPTAR** (lição) | "Everything is a plugin" inspira o Forge; o bug de keep-alive vira requisito. |
| Hermes Agent | 6 — Memória | **ADAPTAR** | Loop de aprendizado (skills auto-criadas + busca FTS5) e Windows nativo. |
| Claude Code / Codex CLI | 3 — Orquestração | **ADOTAR** (padrões) | Hooks, skills, plan mode, aprovações, `CLAUDE.md`/`AGENTS.md`. |
| Kimi Code / MiniMax Code | 3 — Orquestração | **DESCARTAR** `[NÃO VERIFICADO]` | Sem fonte primária localizável nesta auditoria; reavaliar só com doc oficial. |

---

## 2. Auditoria por fonte

### 2.1 Harness Leaderboard — a métrica que valida o projeto

- **Fonte primária:** <https://huggingface.co/spaces/joelniklaus/harness-leaderboard> (Space; conteúdo renderizado por JS — não lido diretamente).
- **Fonte primária alternativa:** <https://huggingface.co/buckets/joelniklaus/harness-leaderboard> (bucket público de trajetórias).
- **Cobertura `[SECUNDÁRIO]`:** <https://aicoder.com/news/news-20261105-joel-niklaus-hf-harness-leaderboard-28849-trials-mini-swe-agent-51-4> e <https://aicoder.com/news/news-20261111-hf-harness-leaderboard-adds-deepseek-harness-dsh-tied-first-all-five-evals-deepswe-2nd-terminal-bench-6th>.

**Método do leaderboard:** fixa modelo, provider e *reasoning effort*; troca **apenas o harness**; 3 tentativas por tarefa; benchmarks **Terminal-Bench 2.1** e **DeepSWE v1.1**.

**Números reportados pelo autor (nov/2026):**

| Harness | Resolve (%) | Custo / tarefa resolvida |
| :--- | ---: | ---: |
| mini-swe-agent | ~51,4% | ~US$ 0,53 |
| **Pi** | **~49,4%** | **~US$ 0,29** (≈45% mais barato) |
| DeepSeek Harness | 2º em DeepSWE / 6º em Terminal-Bench | ~US$ 0,53 |
| OpenClaw | ~27,3% | — |
| OpenCode | — | ~US$ 3,35 (11,7× Pi) |

Escala: **28.849 trials**, ~US$ 4.746 de inferência, 9–10 harnesses, modelos GLM-5.3-Flash, DeepSeek-V4.1-Flash e Flint.

**Lições para o SelfEvoPI:**

1. **A tese do projeto está empiricamente correta:** harness enxuto ≈ 45% mais barato por tarefa resolvida que o baseline de referência. O "orçamento de contexto" (Parte II, §2) é meta medida, não preferência estética.
2. **Custo é métrica de primeira classe.** A suíte de evals (A2) deve registrar **US$/tarefa resolvida** e **tokens/tarefa**, não só acurácia.
3. **Não existe harness universal vencedor** → justifica o Roteador por modelo/perfil (A3) em vez de um perfil único.
4. **"Looks up answers / copying transcripts / special-casing the grader" = fail.** O SelfEvoPI precisa de isolar o agente do grader (evitar que o agente leia a suíte de evals).
5. **Ponto cego revelado:** tarefas que exigem **serviço vivo após o fim do agente** derrubam harnesses que limpam processos (ver 2.17). O SelfEvoPI deve ter keep-alive explícito.

---

### 2.2 PI Coding Agent — o núcleo

- **Fonte primária:** <https://github.com/earendil-works/pi> (README).
- **Docs/packages:** <https://pi.dev/packages/>.

**Fatos verificados:**

- Instalação Windows: `powershell -c "irm https://pi.dev/install.ps1 | iex"`; npm: `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`.
- Requer **Node.js ≥ 22.19.1** (o plano fala Node 22+; confirmar 22.19.1 como mínimo).
- Pacotes do monorepo: `pi-ai` (API LLM multi-provider), `pi-agent-core` (runtime + state), `pi-coding-agent` (CLI), `pi-tui`, `pi-durable`, `pi-telemetry`, `chord` (runtime de apps).
- **Não tem sistema de permissões embutido** → roda com as permissões do usuário. Containerização é documentada à parte (`docs/containerization.md`).
- Filosofia: *"minimal, extensible agent harness… Pi ships with powerful defaults but skips features like sub-agents and plan mode."*
- Extensões, skills, prompt templates e temas empacotáveis como **Pi packages** (npm/git).
- Modos: interativo (TUI), print/JSON, RPC e SDK TypeScript.

**Decisão:** núcleo adotado sem fork. O SelfEvoPI vive em extensões + skills + config + `.pi/harness/`.

---

### 2.3 Ecossistema PI — verificação de pacotes

Fontes: <https://pi.dev/packages/> (5.339 pacotes), <https://awesome-pi.site/extensions/> (14.779 entradas), <https://github.com/shaftoe/awesome-pi-coding-agent> (183★, diretório auto-descoberto).

| Pacote | Versão / status | Evidência | Nota para o SelfEvoPI |
| :--- | :--- | :--- | :--- |
| `billion-context` | 3,5M/mo | listado | Compressão 5×; testar antes de adotar. |
| `pi-mcp-adapter` | 2,1M/mo | listado | Lazy MCP. |
| `pi-web-access` | 1,4M/mo | listado | Web/fetch/PDF. |
| `pi-mcp-extension` | 1,1M/mo | listado | Alternativa com OAuth 2.1 + lazy/eager lifecycles. |
| `pi-subagents` | **0.88.1** (13-nov-2026), 972,8K/mo, 10,7 MB, MIT, Pi ≥ 1.2.0 | página do pacote | Candidato A do bake-off. |
| `pi-continual-harness` | ativo | repo + página | Candidato único para `/refine`. |
| `@shying/pi-graph` | **0.2.0** (25-ago-2026), 1,8 MB, MIT | página do pacote | Candidato único para Fase 3. |
| `@tintinweb/pi-subagents` | 66,7K/mo | listado | Backup. |
| `@quintinshaw/pi-dynamic-workflows` | 65,2K/mo | listado | Backup (já tem worktree + cost accounting). |
| `pi-harness` | ativo | repo `wangmiaozero/pi-harness` | Desktop superset. |
| `pi-native-app` | snippet: desktop macOS Apple Silicon | `[SECUNDÁRIO]` awesome-pi | **Incompatível com Windows** → descartar. |
| `pi-agent-orchestrator` | `[NÃO VERIFICADO]` | — | Verificar existência antes do bake-off. |
| `@arhen/pi-core-subagent` | `[NÃO VERIFICADO]` (snippet "fast in-process subagents") | `[SECUNDÁRIO]` | Verificar antes do bake-off. |
| `@rahularya01/pi-essentials` | `[NÃO VERIFICADO]` | — | Baixa prioridade. |
| `pi-agent-extensions` | `[NÃO VERIFICADO]` | — | Baixa prioridade. |
| `pi-acp` | 1,15M/mo | listado | Adapter ACP para handoff desktop. |
| `@gotgenes/pi-permission-system` | 42,6K/mo | listado | **Relevante**: enforcement de permissões para Pi. |
| `cc-safety-net` | 45,4K/mo | listado | Hook que bloqueia comandos destrutivos/segredos. |
| `pi-deltabox` | 168K/mo | listado | Sandbox de sessão com diff/commit/abort — padrão para o Forge. |

**Aviso de segurança (do próprio catálogo):** *"Pi packages can execute code and influence agent behavior. Review the source before installing third-party packages."* → todo pacote do bake-off deve passar por revisão de código antes de entrar em produção.

---

### 2.4 Octopus-SI-OS — o modelo mental do Núcleo Evolutivo

- **Fonte primária:** <https://github.com/miuuyy/Octopus-SI-OS>.

**Fatos verificados:**

- Kernel em **Rust (~45.000 linhas)**; **exige macOS 14+**, Node 24, Rust e conta ChatGPT → **inutilizável no Windows** como dependência.
- *"Self-evolution means shaping the conditions of future work"*: sob política, o agente cria/revisa objetivos, muda interfaces (triggers), adiciona ferramentas, organiza workers e arruma contexto/ambiente — e **essas mudanças persistem entre tarefas**.
- **Capacidades são contratos** na arquitetura (não add-ons): o sistema pode crescer em qualquer direção.
-引 Entrevista com o autor: *"Neither the model nor the agent loop sits at the center."*
- Honestidade do projeto: *"for an ordinary coding task Octopus gives you nothing that Codex CLI does not already give you"* — é research preview.

**Decisão:** **ADAPTAR** o modelo (capacidades como contratos + ambiente moldado pela política), **DESCARTAR** o binário (macOS/Rust).

---

### 2.5 Voyager — skill library verificável

- **Fonte primária:** <https://github.com/MineDojo/Voyager>.

**Fatos verificados:** três componentes — currículo automático, **skill library de código executável** indexada por descrição, e **prompting iterativo com feedback do ambiente + erros de execução + auto-verificação**. Skills são composáveis e reduzem *catastrophic forgetting*. Licença MIT.

**Decisão:** **ADAPTAR** → o Forge (A5) guarda artefatos como código indexado semanticamente, só promovido após passar no verifier (gatekeeper). Isso é exatamente o "Registrar com Rollback Automático" da Fase 2.

---

### 2.6 SWE-agent / ACI — o guia de estilo das ferramentas

- **Fonte primária:** <https://github.com/SWE-agent/SWE-agent> (paper NeurIPS 2024, arXiv 2405.15793).

**Fatos verificados:** o desenvolvimento migrou para **mini-swe-agent**, que *"matches the performance of SWE-agent while being much simpler"* — 65% em SWE-bench verified com **100 linhas de Python** (jul/2026).

**Decisão:** **ADOTAR** o princípio ACI (Agent-Computer Interface): ferramentas com saída JSON compacta, paginação e erro acionável. Alerta: **preferir a versão mínima** — complexidade de harness não se traduz em acerto (reforçado pelo Harness Leaderboard).

---

### 2.7 OpenHands / CodeAct — event stream e control center

- **Fonte primária:** <https://github.com/OpenHands/OpenHands>.

**Fatos verificados:** o projeto pivots para **Agent Canvas** — *self-hosted developer control center* que roda OpenHands, Claude Code, Codex, Gemini, **Pi**, OpenCode ou qualquer agente compatível com **ACP** (Agent-Client Protocol), em backends locais/remotos/cloud. Node ≥ 24; sandbox opcional (Docker) com aviso explícito de que sem sandbox o agente tem acesso total ao filesystem.

**Decisão:** **ADAPTAR** → (a) event stream append-only para replay/auditoria do Forge; (b) ACP como protocolo candidato de handoff com o desktop (evita reinventar IPC); (c) aviso de segurança reforça a necessidade do sandbox Windows.

---

### 2.8 AutoGen / Magentic-One — o padrão do ledger duplo

- **Fonte primária:** <https://github.com/microsoft/autogen> → **ARQUIVADO**.
- **Fonte do padrão:** <https://www.microsoft.com/en-us/research/articles/magentic-one-a-generalist-multi-agent-system-for-solving-complex-tasks/> (PDF oficial) e <https://arxiv.org/abs/2411.04468>.

**Fatos verificados:** *"This project has been archived and is no longer actively maintained by Microsoft"* → migrar para **Microsoft Agent Framework**. Magentic-One usa um **Orchestrator** que planeja, **rastreia progresso** e **recupera de erros via ledger**.

**Decisão:** **DESCARTAR** a biblioteca; **ADOTAR** o padrão de ledger duplo (Task Ledger + Progress Ledger) no coordenador do SelfEvoPI, como gatilho do detector de lacunas (stall detection).

---

### 2.9 DSPy / GEPA — otimização orientada a métrica

- **Fonte primária:** <https://github.com/stanfordnlp/dspy>.

**Fatos verificados:** *"programming—not prompting"*; algoritmos de otimização de prompts e pesos; papers GEPA (jul/2025) e "Prompts as Auto-Optimized Training Hyperparameters" (jun/2024). Licença MIT.

**Decisão:** **ADAPTAR** no `/refine` (A7): tratar prompts e specs de subagentes como parâmetros, aplicar **somente** deltas que vencem a suíte de evals, descartando os que aumentam tokens sem ganho.

---

### 2.10 Playwright MCP vs CLI+SKILLS — automação web sem screenshots

- **Fonte primária:** <https://github.com/microsoft/playwright-mcp>.

**Fatos verificados (literal do README):**

> *"Modern coding agents increasingly favor CLI-based workflows exposed as SKILLs over MCP because CLI invocations are more token-efficient: they avoid loading large tool schemas and verbose accessibility trees into the model context."*
> *"MCP remains relevant for specialized agentic loops that benefit from persistent state, rich introspection, and iterative reasoning over page structure."*

**Decisão:** **ADOTAR os dois, em ordem:** (1) CLI + SKILL como caminho padrão (token-efficient); (2) MCP quando o loop precisa de estado persistente/introspecção. Isso **refina a hierarquia de artefatos** da Fase 2 (ver §4).

---

### 2.11 FastMCP — geração de servidores MCP

- **Fonte primária:** <https://github.com/PrefectHQ/fastmcp>.

**Fatos verificados:** o projeto **mudou de `jlowin/fastmcp` para `PrefectHQ/fastmcp`**; FastMCP 1.0 foi incorporado ao SDK oficial Python do MCP em 2024; *"powers 70% of MCP servers across all languages"*; TypeScript em `@prefecthq/fastmcp-ts`. Gera schema/validação/docs automaticamente.

**Decisão:** **ADOTAR** como template do subagente gerador (A5), nas duas linguagens.

---

### 2.12 Node.js Permission Model — limites reais

- **Fonte primária:** <https://nodejs.org/api/permissions.html> (v26.13.1).

**Fatos verificados:**

- Estável desde **v23.5.0 / v22.13.0**; flag `--permission`.
- Restringe: `fs` read/write, rede, `child_process`, `worker_threads`, addons, WASI, FFI, inspector.
- Flags: `--allow-fs-read`, `--allow-fs-write`, `--allow-net`, `--allow-child-process`, `--allow-worker`, `--allow-addons`, `--allow-wasi`, `--allow-ffi`.
- API runtime: `process.permission.has(scope[, ref])` e `process.permission.drop(scope[, ref])` (**irreversível**).
- **Modo auditoria:** `--permission-audit` (violações vão para `diagnostics_channel` sem bloquear) — útil para descobrir permissões mínimas antes de endurecer.
- **Limite explícito:** *"It does not provide security guarantees in the presence of malicious code… a 'seat belt' approach."*

**Decisão:** **ADAPTAR** — usar `--permission` + `--permission-audit` para descobrir o mínimo, **mas somar** token de baixa integridade + gate estático (Semgrep/ESLint) + keep-alive policy. Não confiar isoladamente.

---

### 2.13 Windows Job Objects — encerramento determinístico

- **Fonte primária:** <https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects>.

**Fatos verificados:** `CreateJobObject` + `AssignProcessToJobObject`; processos filhos **herdam o job por padrão**; `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` / `JOB_OBJECT_LIMIT_BREAKAWAY_OK` / `SILENT_BREAKAWAY_OK`; `TerminateJobObject` encerra tudo; jobs aninháveis desde Windows 8/Server 2012; `IsProcessInJob` para consultar.

**Decisão:** **ADOTAR**, com uma ressalva crítica: o encerramento deve ser **configurável por tarefa** (ver 2.17 — DSH perdeu pontos por matar processos que deveriam sobreviver).

---

### 2.14 AST Static Gate

Fontes: Tree-sitter, ESLint, Semgrep (padrões amplamente conhecidos; não versionados nesta auditoria).

**Decisão:** **ADOTAR** como pré-execução obrigatória, bloqueando: leitura de `%USERPROFILE%`, `.ssh`, configs do OpenCode/PI, `reg.exe`, `Remove-Item -Recurse -Force` fora do worktree, exfiltração HTTP, `child_process` não autorizado.

---

### 2.15 Promptfoo / Inspect AI

- **Fonte primária:** <https://github.com/promptfoo/promptfoo>.

**Fatos verificados:** CLI + lib de eval/red-team; configs declarativas; CI/CD; **agora parte da OpenAI**, mantendo licença MIT; execução 100% local.

**Decisão:** **ADAPTAR** — usar para evals declarativos e comparação A/B, mas o **runner determinístico** (Windows/PowerShell) continua sendo a espinha (A2), porque o SelfEvoPI precisa de verificadores determinísticos, não de julgamento por LLM.

---

### 2.16 OpenTelemetry + JSONL

**Decisão:** **ADOTAR** — ledger JSONL local como fonte de verdade (trajetória, TTFT, latência total, tokens por provider, sucesso) e OTel como formato de exportação quando houver backend.

---

### 2.17 DeepSeek Harness — a lição de engenharia mais valiosa

- **Fonte primária:** <https://github.com/deepseek-ai/deepseek-harness>.

**Fatos verificados:**

- Arquitetura **"everything is a plugin"**, construída sobre **Cordis**; MIT; **developer preview** com breaking changes; UI web em `127.0.0.1:3080`.
- **Falha medida `[SECUNDÁRIO]`:** DSH encerra **todo processo de background** ao terminar. Em 3 tarefas do Terminal-Bench que exigem um servidor vivo após a saída do agente, passou **2 de 36** — custo de **1,5–1,7 ponto por avaliação**, maior que sua vantagem real (1,3 ponto). Resultado: 6º em Terminal-Bench apesar de 1º (empatado) nas 5 avaliações.

**Requisito derivado para o SelfEvoPI:** a política de processos precisa ser **por tarefa**:
- `kill-tree` (padrão) para CLIs/MCPs efêmeros;
- `keep-alive` explícito para tarefas que deixam serviço no ar (servidor, watcher, preview);
- o sandbox nunca deve matar processos que o *grader* precisa.

---

### 2.18 Hermes Agent — aprendizado contínuo + Windows nativo

- **Fonte primária:** <https://github.com/NousResearch/hermes-agent>.

**Fatos verificados:** *"self-improving AI agent"* com **loop de aprendizado fechado**: cria skills a partir de experiência, melhora skills durante o uso, *nudges* para persistir conhecimento, busca FTS5 em conversas antigas, modela o usuário. **Windows nativo oficial** (`iex (irm https://hermes-agent.nousresearch.com/install.ps1)`), instalando em `%LOCALAPPDATA%\hermes`. Compatível com o padrão aberto **agentskills.io**. Subagentes isolados com provider/modelo/limites configuráveis.

**Decisão:** **ADAPTAR** → padrão de skill auto-criada + busca semântica local para A7; e **confirmação de viabilidade** do caminho Windows nativo (útil para desalinhar o risco do plano).

---

### 2.19 OpenDesign — live preview pronto

- **Fonte primária:** <https://github.com/nexu-io/open-design>.

**Fatos verificados:** Apache-2.0, **local-first**, workspace de design; gera protótipos/decks/imagens/vídeos; artefatos HTML single-page que leem `DESIGN.md` e renderizam em iframe sandboxado; **suporta Pi Agent** (`od mcp install pi`) e também DeepSeek Harness como runtime nativo; daemon com proteção SSRF no edge.

**Decisão:** **ADOTAR** na Fase 4 — integrar em vez de construir live preview autoral.

---

### 2.20 Claude Code e Codex CLI — padrões de produto

- **Fontes primárias:** <https://code.claude.com/docs/en/overview> e <https://github.com/openai/codex>.

**Fatos verificados:**

- **Claude Code:** engine único com superfícies (terminal, VS Code, JetBrains, desktop, web); `CLAUDE.md`, settings e MCP compartilhados entre superfícies; **fallback de shell**: sem Git for Windows, usa PowerShell como shell tool (relevante para o ambiente Windows do projeto).
- **Codex CLI:** instalador Windows `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"`; binários por plataforma; Apache-2.0; app desktop e IDE.

**Decisão:** **ADOTAR** os padrões de produto (hooks, skills, plan mode, aprovações, arquivo de contexto de projeto), não o código.

---

### 2.21 Kimi Code / MiniMax Code — `[NÃO VERIFICADO]`

Nenhuma fonte primária localizável nesta auditoria (busca retornou vazia). **Ação:** reauditar apenas com documentação oficial; até lá, tratar como referência de *produto* (não técnica) e **não** citar como fonte de arquitetura.

---

## 3. Lições transversais de engenharia

1. **Eficiência é funcionalidade, não otimização.** O Harness Leaderboard mostra 45% de diferença de custo por tarefa resolvida entre harnesses com o mesmo modelo. O orçamento de contexto é requisito de primeira classe.
2. **Harness mínimo vence harness complexo.** mini-swe-agent (100 linhas) ≈ SWE-agent; Pi (minimal) ≈ 49,4% a 45% menos custo. Preferir simplicidade.
3. **Lazy-loading é padrão consolidado, não inovação.** `pi-subagents` já faz (schema só após autorização); `pi-continual-harness` carrega módulos sob demanda (~30 ms de custo marginal).
4. **Segurança em camadas, nunca em um único mecanismo.** Node Permission Model é cinto; Job Objects é limpeza; gate estático é prevenção; token restrito é contenção. Um só não basta.
5. **Política de processos afeta resultado de benchmark.** Matar background processes indiscriminadamente custa pontos (DSH). Keep-alive deve ser decisão de projeto.
6. **Não reinventar o que a comunidade já entregou.** `pi-ai`, `pi-telemetry`, `pi-continual-harness`, `pi-graph`, OpenDesign cobrem camadas inteiras. Foco autoral: Roteador, Evals, Núcleo Evolutivo.
7. **Segurança de pacotes é parte do design.** O catálogo do PI avisa que pacotes executam código; todo pacote do bake-off precisa de revisão de código antes de produção.

---

## 4. Divergências com o plano original (correções propostas)

| # | Plano original | Correção proposta | Motivo (fonte) |
| :-- | :--- | :--- | :--- |
| 1 | Hierarquia de artefatos: `1º Configurar MCP existente (lazy)` | `1º Configurar ferramenta existente (MCP **ou** CLI/SKILL lazy)` | Playwright: CLI+SKILL é mais eficiente em tokens para coding agents. |
| 2 | Node `--permission` como sandbox principal | `--permission` + `--permission-audit` **+ token restrito + gate estático + keep-alive policy** | Node docs: não protege contra código malicioso. |
| 3 | Roteador com 3 perfis fixos | Perfis **+ seleção por modelo** | Harness Leaderboard: melhor harness varia por modelo. |
| 4 | Telemetria autoral | **ADOTAR `@earendil-works/pi-telemetry`** + ledger JSONL | Já existe no core do PI. |
| 5 | `/refine` autoral | **ADAPTAR `pi-continual-harness`** | Já implementado com deltas estruturados. |
| 6 | Desktop via `pi-native-app` | `Pi-Harness` ou shell próprio + **integrar OpenDesign** | `pi-native-app` é macOS Apple Silicon. |
| 7 | AutoGen como referência de orquestração | Padrão Magentic-One via **Microsoft Agent Framework** | AutoGen arquivado. |
| 8 | "cold-start < 500 ms" sem métrica | Medir **TTFT + cold start + tokens/tarefa + US$/tarefa** no baseline | Harness Leaderboard / OTel. |
| 9 | Sandbox encerra árvore de processos | Encerramento **configurável por tarefa** (`kill-tree` vs `keep-alive`) | DSH perdeu 1,5–1,7 ponto por isso. |
| 10 | "Nunca assuma POSIX" (ok) | Reforçar: **Node ≥ 22.19.1** como mínimo | PI exige 22.19.1. |

---

## 5. Riscos abertos

| Risco | Severidade | Como resolver |
| :--- | :--- | :--- |
| `pi-agent-orchestrator` e `@arhen/pi-core-subagent` não confirmados | Médio | Verificar existência/versão antes do bake-off (Fase 1). |
| `billion-context` pode degradar qualidade | Médio | Teste empírico contra evals da Fase 0; só manter com ganho. |
| `pi-native-app` macOS-only deixa Fase 4 sem caminho pronto | Alto | Decidir cedo: `Pi-Harness` vs shell próprio. |
| Node Permission Model não é sandbox de segurança | Alto | Nunca usá-lo isolado; combinar com token restrito + gate. |
| Pacotes de terceiros executam código | Médio | Revisão de código obrigatória antes de produção. |
| Kimi Code / MiniMax Code sem fonte primária | Baixo | Reauditar com doc oficial. |
| Escala do catálogo (5.339 / 14.779 entradas) gera paralisia | Médio | Bake-off com critério fixo (acurácia + tokens + latência). |

---

## 6. Backlog derivado

Ver **`docs/research/backlog-fase1.md`** (gerado a partir das decisões acima).

---

## 7. Critério de saída da Fase P

- [x] Todas as fontes obrigatórias abertas e registradas (2026-11-15).
- [x] Decisão (`ADOTAR`/`ADAPTAR`/`CONSTRUIR`/`DESCARTAR`) para cada inspiração.
- [x] Backlog da Fase 1 criado a partir das decisões.
- [ ] `node scripts/verify-urls.mjs` retorna HTTP 200 (ou 401/403 identificado como *wall*) em todas as URLs citadas.

---

## 8. Fontes

**Primárias (abr. 2026-11-15):**

1. <https://github.com/earendil-works/pi>
2. <https://pi.dev/packages/>
3. <https://pi.dev/packages/pi-subagents>
4. <https://pi.dev/packages/@shying/pi-graph>
5. <https://github.com/pungggi/pi-continual-harness>
6. <https://github.com/shaftoe/awesome-pi-coding-agent>
7. <https://awesome-pi.site/extensions/>
8. <https://github.com/miuuyy/Octopus-SI-OS>
9. <https://github.com/MineDojo/Voyager>
10. <https://github.com/SWE-agent/SWE-agent>
11. <https://github.com/OpenHands/OpenHands>
12. <https://github.com/microsoft/autogen>
13. <https://github.com/stanfordnlp/dspy>
14. <https://github.com/microsoft/playwright-mcp>
15. <https://github.com/PrefectHQ/fastmcp>
16. <https://nodejs.org/api/permissions.html>
17. <https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects>
18. <https://github.com/promptfoo/promptfoo>
19. <https://github.com/deepseek-ai/deepseek-harness>
20. <https://github.com/NousResearch/hermes-agent>
21. <https://github.com/nexu-io/open-design>
22. <https://code.claude.com/docs/en/overview>
23. <https://github.com/openai/codex>

**Secundárias (assinaladas no texto):**

24. <https://aicoder.com/news/news-20261105-joel-niklaus-hf-harness-leaderboard-28849-trials-mini-swe-agent-51-4>
25. <https://aicoder.com/news/news-20261111-hf-harness-leaderboard-adds-deepseek-harness-dsh-tied-first-all-five-evals-deepswe-2nd-terminal-bench-6th>
26. <https://www.microsoft.com/en-us/research/articles/magentic-one-a-generalist-multi-agent-system-for-solving-complex-tasks/>
27. <https://gitdiagram.com/earendil-works/pi>