# Modos de CLI de agente — o que "modo" significa de verdade

> **Data da consulta:** 2026-11-17
> **Método:** leitura das páginas oficiais de cada ferramenta, com foco nas seções que descrevem permissões e modos. Cada linha da tabela carrega a URL da fonte. O que a página não diz está marcado como **não verificado**.
> **Pergunta:** quando o usuário pede `/plan`, `/build`, `/goal`, o que ele está pedindo que mude de fato?

---

## 1. Tabela

"Modo" aqui significa uma de duas coisas, e a diferença importa: **um conjunto de permissões** (o que o agente pode fazer sem perguntar) ou **um papel na conversa** (quem propõe e quem executa). As duas coexistem na maioria das ferramentas.

### Claude Code

| Modo | Lê | Escreve | Executa | Fonte |
|:---|:---|:---|:---|:---|
| `default` (Manual) | sim | pede antes de cada ação que edita arquivo | pede antes de cada comando | [permission-modes](https://code.claude.com/docs/en/permission-modes) |
| `acceptEdits` | sim | sim, dentro do working directory, sem perguntar | Bash de filesystem comuns auto-aprovados: `mkdir`, `touch`, `rm`, `rmdir`, `mv`, `cp`, `sed` | [permission-modes](https://code.claude.com/docs/en/permission-modes) |
| `plan` | sim — arquivos e shell | **não.** "does not edit your source"; as edições ficam bloqueadas até você aprovar o plano | só o conjunto read-only embutido; comando fora dele pede aprovação | [permission-modes](https://code.claude.com/docs/en/permission-modes) |
| `auto` | sim | sim | sim; um segundo modelo (classificador) revisa em vez de você | [permission-modes](https://code.claude.com/docs/en/permission-modes) |
| `bypassPermissions` | sim | sim | sim, sem perguntar (regras `deny` continuam valendo) | [permission-modes](https://code.claude.com/docs/en/permission-modes) |

### Codex CLI

Dois eixos independentes: `sandbox_mode` (o que o sistema operacional permite) e `approval_policy` (quando ele pergunta).

| sandbox_mode | Lê | Escreve | Executa | Fonte |
|:---|:---|:---|:---|:---|
| `read-only` | sim | não | comandos dentro do sandbox read-only | [agent-approvals-security](https://learn.chatgpt.com/docs/agent-approvals-security) |
| `workspace-write` | sim | dentro do workspace | dentro do workspace; fora pede aprovação | idem |
| `danger-full-access` | sim | sim | sim, sem pedir | idem |

| approval_policy | Efeito | Fonte |
|:---|:---|:---|
| `on-request` | roda o que o sandbox permite; pede para o resto | idem |
| `never` | nunca pergunta (usado com `read-only` em CI) | idem |
| `granular` | ajusta por tipo: `sandbox_approval`, `rules`, `mcp_elicitations`, `request_permissions`, `skill_approval` | idem |
| `untrusted` | **aposentado** — "Codex CLI 0.149 retired the untrusted approval policy and now refuses to start on it" | [blakecrosley.com](https://blakecrosley.com/blog/codex-untrusted-approval-policy-retired) (secundária) |

### Aider

| Modo | Lê | Escreve | Executa | Papel | Fonte |
|:---|:---|:---|:---|:---|:---|
| `code` | sim | sim | sim | faz as mudanças | [usage/modes](https://aider.chat/docs/usage/modes.html) |
| `architect` | sim | sim | sim | "an architect model will propose changes and an editor model will translate that proposal into specific file edits" | idem |
| `ask` | sim | **nunca** | — | discute e responde, sem mudar | idem |
| `help` | — | — | — | não verificado em detalhe | idem |

### OpenCode

| Agente | Modo | Lê | Escreve | Executa | Fonte |
|:---|:---|:---|:---|:---|:---|
| **Build** (`build`) | `primary` | sim | sim; "sensitive environment-file reads ask for approval" | sim | [agents](https://opencode.ai/docs/agents/) |
| **Plan** (`plan`) | `primary` | sim | **não** nos arquivos do projeto; "may write OpenCode plan files when asked" | shell sob controle de permissão | [agents](https://opencode.ai/docs/agents/), [permissions](https://opencode.ai/docs/permissions/) |
| **General** (`general`) | `subagent` | sim | sim | sim; "cannot launch more subagents" | idem |
| **Explore** (`explore`) | `subagent` | sim | **não** | só shell, leituras, globs, grep, web fetch, web search, diretórios externos; pede para `.env` | idem |

A política do agente `plan`, na íntegra: "Allows questions; denies edits except files under `~/.opencode/plan`". A do `explore`: "Denies everything except shell, reads, globs, grep, web fetches, web searches, and external directories; asks for `.env` reads". ([permissions](https://opencode.ai/docs/permissions/))

### Gemini CLI

| Modo | Lê | Escreve | Executa | Fonte |
|:---|:---|:---|:---|:---|
| `default` | sim | pede aprovação | pede aprovação | [configuration](https://geminicli.com/docs/reference/configuration/) |
| `auto_edit` | sim | sim ("auto-approves edit tools (replace, write_file)") | pede para os demais | idem |
| `plan` | sim | **não** ("read-only mode for tool calls") | não | idem |
| `yolo` | sim | sim | sim ("auto-approve all actions") | idem |

Ressalva da própria documentação: `plan` "requires experimental planning to be enabled" e "is currently under development and not yet fully functional". ([configuration](https://geminicli.com/docs/reference/configuration/))

### Cline

| Modo | Lê | Escreve | Executa | Fonte |
|:---|:---|:---|:---|:---|
| **Plan** | sim — "can read your codebase, run searches, and discuss strategy" | **não** — "cannot modify any files" | **não** — "cannot … execute commands" | [plan-and-act](https://docs.cline.bot/core-workflows/plan-and-act) |
| **Act** | sim | sim | sim | idem |

Cline documenta também modelos separados por modo ("a stronger reasoning model for planning and a faster model for implementation") e `/deep-planning` para "an extended planning session".

### Objetivo persistente (`/goal`)

| Ferramenta | O que é | Fonte |
|:---|:---|:---|
| Claude Code `/goal` | "sets a completion condition and Claude keeps working toward it without you prompting each step. After each turn, a model checks whether the condition holds." Limpa sozinho quando a condição é atingida, quando o avaliador julga impossível, ou quando um turno falha por erro que você precisa corrigir. | [goal](https://code.claude.com/docs/en/goal) |
| Codex `/goal` | "Goals are persistent objectives in Codex that keep a thread working toward a defined outcome across turns. A Goal gives Codex a completion condition: what should be true, how success should be checked, and what constraints must stay intact." | [using_goals_in_codex](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex) |

---

## 2. Os eixos que aparecem

### Eixo A — leitura vs escrita

É o eixo mais universal, e o único que aparece nas seis ferramentas. Quatro delas têm um modo que lê tudo e não escreve nada: Claude Code `plan`, OpenCode `plan`, Gemini `plan`, Cline `Plan`.

O que muda entre elas é o que "não escrever" cobre:

- **Claude Code**: bloqueia a edição do código-fonte e permite rodar shell (um conjunto read-only). A documentação diz que o agente "writes a plan" e que "edits stay blocked until you approve the plan"; **não verificado** se esse plano é gravado em arquivo ou apenas apresentado na conversa.
- **OpenCode**: bloqueia edição dos arquivos do projeto, mas **permite escrever** um arquivo de plano em `~/.opencode/plan`. Ou seja: "não escrever" aqui significa "não tocar no projeto", não "não tocar em disco".
- **Cline**: bloqueia as duas coisas — nem arquivo nem comando. É o `plan` mais estrito dos quatro.
- **Gemini**: read-only no nível de tool call, e ainda experimental.

Nenhuma delas usa a palavra "seguro" para se vender: o que muda é uma lista de ações, não uma promessa.

### Eixo B — sugestão vs execução

Aqui está a diferença mais mal compreendida, porque duas ferramentas chamam de "plan" coisas opostas:

- **Claude Code**: o modo `plan` **segura** a execução. O agente propõe e as edições ficam bloqueadas até você aprovar o plano ("edits stay blocked until you approve the plan").
- **Cline**: o modo `plan` também não executa, mas a passagem é manual — a doc diz para "switch to Act mode" depois de alinhar o plano; **não verificado** se há um portão de aprovação explícito dentro do modo Plan.
- **Aider `architect`**: o modo **não segura nada** — ele já escreve. O que muda é quem escreve: um modelo arquiteto propõe, um modelo editor converte a proposta em diffs ("an architect model will propose changes and an editor model will translate that proposal into specific file edits"). É separação de **papéis**, não de **momento**.
- **Aider `ask`**: separa por papel também, mas do outro lado — nunca escreve.

A distinção prática: `plan` (Claude Code) é um **portão**; `architect` (Aider) é uma **divisão de trabalho**. Um retém a escrita até o humano decidir; o outro já escreveu e usou dois cérebros.

### Eixo C — escopo curto vs persistente

Modos duram a sessão ou o turno. Objetivos duram até uma condição.

- Um **modo** (`plan`, `build`, `acceptEdits`) é um estado em que a sessão está agora.
- Um **objetivo** (`/goal`) é uma condição que sobrevive a vários turnos, e um avaliador separado decide quando ela foi satisfeita.

Claude Code é explícito sobre por que isso é uma peça diferente: "`/goal` adds a separate evaluator that checks your condition after every turn, so completion is decided by a fresh model rather than the one doing the work." ([goal](https://code.claude.com/docs/en/goal))

E o modo não muda: "A goal doesn't change your permission mode." Ou seja, objetivo e modo são ortogonais e podem ser combinados — **leitura minha**, não afirmação da doc: em `plan` o agente não escreve, então a condição dificilmente avança; em `auto` ele roda sozinho até o avaliador aprovar.

### Eixo D — eixo oculto: sandbox vs aprovação

O Codex expõe o que as outras ferramentas misturam: **o que o processo consegue alcançar** (sandbox, nível OS) é diferente de **quando o agente pergunta** (approval policy). A mesma tarefa pode ser `read-only` + `on-request` (lê tudo, pergunta para sair) ou `workspace-write` + `never` (roda sem perguntar, mas só dentro da pasta).

A consequência para um projeto como o SelfEvoPI: "bloquear" e "perguntar" são decisões separadas, e uma política só de perguntas não impede nada — o processo ainda alcança. É o mesmo raciocínio das três camadas do sandbox: o modo pergunta, o sandbox limita, o Job Object encerra.

---

## 3. Como se transita e como o usuário sabe em qual está

| Ferramenta | Como entra | Como sabe que está | Fonte |
|:---|:---|:---|:---|
| Claude Code | `Shift+Tab` cicla entre modos; `/plan` para um prompt único; `--permission-mode plan` na largada; `permissions.defaultMode` no settings | barra de status: `⏸ manual mode on` (manual) e `⏵⏵ accept edits on` (acceptEdits), ambas literais na doc; **não verificado** o texto exato do indicador em `plan` | [permission-modes](https://code.claude.com/docs/en/permission-modes) |
| Codex | flags na largada (`--sandbox`, `--ask-for-approval`); `/permissions` durante a sessão | não verificado nesta página | [agent-approvals-security](https://learn.chatgpt.com/docs/agent-approvals-security) |
| Aider | `/chat-mode <modo>`, `--chat-mode <modo>`, atalho `--architect` | não verificado | [usage/modes](https://aider.chat/docs/usage/modes.html) |
| OpenCode | agente selecionado na sessão; `mode: primary \| subagent \| all` no config | não verificado | [agents](https://opencode.ai/docs/agents/) |
| Gemini | `--approval-mode <modo>`, `--yolo`, ou `general.defaultApprovalMode` no settings.json | não verificado | [configuration](https://geminicli.com/docs/reference/configuration/) |
| Cline | alternar Plan/Act na interface; modelos separados por modo | não verificado | [plan-and-act](https://docs.cline.bot/core-workflows/plan-and-act) |
| `/goal` (Claude Code) | `/goal <condição>`, até 4.000 caracteres; `/goal` mostra o estado; `/goal clear` (alias `stop`, `off`, `reset`, `none`, `cancel`) | indicador `◎ /goal active` com o tempo de execução; veredito do avaliador no transcript | [goal](https://code.claude.com/docs/en/goal) |

Um detalhe que só o Claude Code documenta e que vale copiar: **o modo é visível**. A barra de status diz em que modo a sessão está (`⏸ manual mode on`). Sem isso, "mudei para plan" é uma afirmação que ninguém pode conferir.

---

## 4. Recomendação para o SelfEvoPI

### O teste que separa modo de enfeite

Um modo só existe se mudar **pelo menos um** destes três: o que o agente pode **ler**, o que pode **escrever**, o que pode **executar** — ou **quando ele pergunta**. Se um modo não muda nenhum dos quatro, ele é um rótulo, e o usuário vai descobrir isso na primeira vez que o agente escrever um arquivo em "modo plan".

### Modos que valem a pena (todos com lastro)

| Modo | Significado em uma linha | Lastro |
|:---|:---|:---|
| `/plan` | lê e executa só leitura; propõe; **não escreve** até aprovação explícita — e o indicador de modo aparece na interface | Claude Code `plan`, Cline `Plan`, OpenCode `plan`, Gemini `plan` (experimental) |
| `/build` | escreve e executa dentro do workspace, com o sandbox limitando o alcance; fora do workspace, pede | Claude Code `acceptEdits`, OpenCode `build`, Cline `Act`, Codex `workspace-write` |
| `/ask` | responde sobre o código e **nunca** toca em disco | Aider `ask`, OpenCode `explore` |
| `/goal` | define uma condição de conclusão; um avaliador separado checa após cada turno e o loop continua até ela valer | Claude Code `/goal`, Codex `/goal` |
| `/review` | lê um diff e devolve achados, sem editar | parcial: OpenCode documenta um agente `reviewer` de exemplo com `edit: deny` ([agents](https://opencode.ai/docs/agents/)) — não é um modo nomeado |

### O que eu não faria

- **`/yolo` ou equivalente "sem perguntas".** Existe em todas as ferramentas (`bypassPermissions`, `yolo`, `danger-full-access`) e é exatamente o que o SelfEvoPI não deve expor: o valor do projeto está nas camadas, não em desligá-las. Se um dia existir, que seja uma flag de laboratório com aviso, não um modo.
- **Um modo que só muda o prompt do modelo.** Se `/build` não muda permissão nem sandbox, é decoração. É o caso do `plan` experimental do Gemini — e a própria doc avisa que "not yet fully functional".

### Onde o SelfEvoPI tem lastro real e onde teria de inventar

- **`/plan`, `/build`, `/ask`** — lastro direto e idêntico em pelo menos três ferramentas cada.
- **`/goal`** — lastro em duas (Claude Code e Codex), e é o encaixe mais natural para o loop auto-evolutivo: a condição de conclusão é o que o coordenador já tenta inferir hoje, e um avaliador separado evita que o mesmo modelo que executou julgue o próprio trabalho.
- **Um modo de "evolução assistida" (o humano aprova cada artefato antes de promover)** — **invenção nossa**, sem equivalente nomeado nas ferramentas pesquisadas. Se faltar lastro, o significado honesto é: um `/build` cujo `verify()` e cuja promoção passam por `core/governance/approval.mjs`, com a pausa devolvendo perguntas objetivas. Não é um modo novo de permissão; é o modo `build` com o portão de aprovação ligado.

### A regra de ouro

Todo modo precisa de três coisas, e as três são verificáveis: **muda uma permissão**, **aparece na interface**, e **diz o que não faz**. Modo que não diz o que não faz vira promessa; modo que não aparece na interface vira boato.

---

## 5. Fontes

- Claude Code — permission modes: <https://code.claude.com/docs/en/permission-modes>
- Claude Code — `/goal`: <https://code.claude.com/docs/en/goal>
- Codex — agent approvals & security: <https://learn.chatgpt.com/docs/agent-approvals-security>
- Codex — using Goals: <https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex>
- Codex — `untrusted` aposentado (secundária): <https://blakecrosley.com/blog/codex-untrusted-approval-policy-retired>
- Aider — chat modes: <https://aider.chat/docs/usage/modes.html>
- Aider — architect (anúncio): <https://aider.chat/2024/09/26/architect.html>
- OpenCode — agents: <https://opencode.ai/docs/agents/>
- OpenCode — permissions: <https://opencode.ai/docs/permissions/>
- Gemini CLI — configuration: <https://geminicli.com/docs/reference/configuration/>
- Cline — plan & act: <https://docs.cline.bot/core-workflows/plan-and-act>