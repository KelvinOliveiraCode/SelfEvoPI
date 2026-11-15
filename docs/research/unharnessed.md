# Análise: Unharnessed

> **Fonte:** <https://github.com/unharnessed-agent/Unharnessed> (README oficial, seções lidas na íntegra) e o post de lançamento de Rayane Rachid (2026-11-15).
> **Data:** 2026-11-15
> **Pergunta:** o que o SelfEvoPI pode aproveitar, e o que ele contradiz?

## 1. A tese em uma frase

Um único tool — um REPL Python persistente — e o modelo escreve o resto. Sem `read`, `grep`, `edit_file`, `web_fetch`. Rust no host (loop, compactação, goals, failover, sessões), Python no kernel, MIT, VS Code + CLI + ACP. Afirma **SOTA no Terminal-Bench 4.0**.

## 2. As quatro ideias mais fortes

### 2.1 Variáveis em vez de contexto

Com lista de tools, todo resultado vai para o contexto e fica lá. Com kernel, o que o modelo lê cai numa **variável**, e só o que ele imprime entra no contexto.

```python
log = open("server.log").read().splitlines()   # 40.000 linhas, ficam no kernel
errors = [l for l in log if "ERROR" in l]
errors[-10:]                                    # as únicas 10 linhas que o modelo lê
```

**Por que importa para o SelfEvoPI:** economia de contexto é o objetivo central do projeto. Esta é a resposta mais direta ao problema "log gigante polui a sessão" — mais forte que Saídas Compactas (ACI), porque não depende de o tool lembrar de truncar.

### 2.2 `bash()` assíncrono por padrão

Todo comando começa em background e devolve um handle:

```python
build = bash("cargo build --release")   # retorna na hora
result = await build                    # quando precisar do resultado
server.tail(20)                         # últimas linhas sem esperar
```

Cada chamada é um processo novo em seu próprio **process group** (`kill()` derruba a árvore), com *kill-on-close job object no Windows*. Quando um comando sobrevive à célula, o modelo recebe `[bash-done pid:… exit:…]` — e, se a sessão está ociosa, **essa mensagem inicia um novo turno**.

### 2.3 Goal mode: não deixar o modelo dizer que terminou

Um objetivo persiste entre turnos. O modelo só encerra chamando `await goal.complete()` — "dizer que fez" não basta. Cada continuação recebe objetivo + tokens gastos + orçamento restante + ordem de **auditar o estado antes de declarar qualquer coisa**.

Duas travas que valem ouro:

- **3 turnos ociosos seguidos** → goal vira `blocked` com as últimas palavras do modelo como motivo.
- **Orçamento de tokens** acaba → goal vira `budget_limited` e o modelo é instruído a **fechar o trabalho, não a declarar vitória**.

O motivo declarado é ótimo: no Terminal-Bench, um modelo preso respondeu 440 vezes *"Operator action is required, I will not falsely mark the goal complete"* — **US$ 37** numa tarefa em que o Codex oficial gastou US$ 4,82.

### 2.4 Modo autônomo: o portão decide, não o modelo

Você fornece os comandos de gate (`cargo test`, `npm run lint`) e a execução só termina quando todos passam. O harness **tira snapshot do worktree antes de cada gate** — um gate que falhou não é re-executado sobre um workspace intacto, então um modelo que não mudou nada não queima retries.

Limites explícitos: 3 continuações, 12 turnos, 80.000 tokens, 30 min, 3 retries por gate.

## 3. O que ele deixou de fora — e por quê

Esta é a parte mais desconfortável para o SelfEvoPI, porque ataca duas premissas do projeto.

| Omissão | Argumento deles | Tese do SelfEvoPI |
|:---|:---|:---|
| **Sem subagentes** | *"a brief is never the whole task"* — o subagente começa do zero, gasta tokens descobrindo o que o primeiro já sabia, e devolve um resumo. Algo se perde em cada handoff. | 8 subagentes com handoffs JSON, worktrees isolados. |
| **Sem memória** | notas acumulam, são carregadas sempre, ocupam contexto mesmo quando não importam, e **não expiram quando você muda de ideia** — a preferência antiga continua lá, discutindo com o pedido de hoje. | Memória em 3 níveis + `/refine`. |
| **Sem prompts de permissão** | aposta que modelos melhoram em julgar o que é seguro; um harness construído em torno de perguntar teria de ser desmontado depois. | `core/governance/` é área protegida; sandbox obrigatório. |
| **System prompt mínimo** | ~1.700 caracteres, porque toda regra é uma decisão tomada pelo modelo e senta no contexto a cada turno. | < 1.500 tokens. |

## 4. O que aproveitar

| # | Ideia | Onde entra | Decisão |
|:--|:---|:---|:---|
| 1 | `goal.complete()` explícito + bloqueio por 3 turnos ociosos | Runner de tarefas do Forge | **ADOTAR** |
| 2 | Gate externo decide "pronto", com snapshot do worktree antes de cada gate | Gatekeeper (A2) | **ADOTAR** |
| 3 | Orçamento que **degrada** em vez de cortar (`budget_limited`) | `core/router/budget.mjs` | **ADAPTAR** |
| 4 | Variáveis no kernel em vez de despejar saída no contexto | Agentes de eval/forge | **ADOTAR** (experimento) |
| 5 | `bash()` assíncrono com handle + notificação que vira turno | `evals/run.mjs` | **ADAPTAR** |
| 6 | Process group + kill-on-close no Windows | `core/sandbox/run-sandboxed.mjs` | **JÁ FEITO** — valida a abordagem |
| 7 | Kernel sobrevive à compactação | `core/memory/` | **ADAPTAR** |
| 8 | Prompt mínimo com inventário dinâmico | System prompt do SelfEvoPI | **JÁ ALINHADO** |

## 5. O que NÃO aproveitar

- **Ausência de sandbox.** O próprio README avisa: *"the kernel is not a sandbox… run it in a container"*. O SelfEvoPI nasceu para rodar código gerado por modelo no Windows do usuário — sem sandbox seria irresponsável. Divergência deliberada.
- **"Sem subagentes" como dogma.** O argumento é bom, a conclusão não serve aqui: o SelfEvoPI existe para paralelizar entre 8 contas com worktrees disjuntos. Mas o aviso fica: **handoff tem de carregar referência de artefato, não só resumo em prosa.**
- **"Sem memória" como dogma.** Vale o alerta: memória sem decaimento vira ruído. O SelfEvoPI precisa de poda por importância (o `pi-continual-harness` já tem `/harness prune --decay`).

## 6. A tensão que merece atenção

Unharnessed aposta que **menos estrutura vence**. O SelfEvoPI aposta que **estrutura na medida certa vence** — roteador, evals, sandbox, governança.

As duas coisas podem ser verdade em domínios diferentes: um REPL Python é imbatível para *exploração* (um agente, um problema, contexto longo). Multi-agente com handoff é imbatível para *paralelização* (oito frentes independentes, contas diferentes, worktrees separados).

A medição do Harness Leaderboard já mostrou que harness enxuto é mais barato. O que o Unharnessed acrescenta é a evidência de que **um único tool bem desenhado pode superar uma lista de tools** — e isso é testável nos evals do SelfEvoPI, não é artigo de fé.

## 7. Pendência

- [ ] Medir nos evals do SelfEvoPI: um agente com REPL Python vs. a lista atual de tools, nas tarefas do Grupo D.
- [ ] Adaptar `budget.mjs` para degradar em `budget_limited`.
- [ ] Acrescentar decaimento por importância ao `/refine`.