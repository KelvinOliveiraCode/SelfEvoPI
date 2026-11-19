# Alternativas Windows — o que existe, o que mudou, o que criar

> **Data:** 2026-11-15
> **Método:** registro npm (`/latest`, autoritativo para existência e versão) + README oficial de cada projeto.
> **Pergunta:** o que o plano aponta não existe, está desatualizado ou é incompatível com Windows — e o que usar no lugar.

---

## 1. Desktop — o problema era falso, mas a resposta mudou

A auditoria anterior classificou `pi-native-app` como "desktop macOS Apple Silicon". **Está errado**, e a correção importa:

| Pacote | O que é hoje | Windows |
|:---|:---|:---|
| `pi-native-app` 0.2.2 | **Cliente web** (AG-UI + Pi SDK em Node). O app desktop Tauri antigo foi removido; existe pin em `0.1.15` | Sim, roda no navegador |
| **Pi-Harness** (wangmiaozero) | Superset operacional: Runs, Trace, Replay, Evaluation, Policy, Budget, Checkpoints, Recovery, Agent Teams, Task DAG, Worktrees | **Sim** — instalador `.exe` x64; inclui Pi e Node |
| **Pi Agent Desktop** (pi-desktop.app) | Desktop empacotado com Pi 1.5.0 + Herdr v0.8.2 | **Sim** — Win 10/11 x64 (beta não assinado) |
| `pi-webapp` 0.1.56 | Workspace no navegador: chat, arquivos, terminais reais, review Git, Excalidraw | Sim |

### Recomendação para a Fase 4

**Pi-Harness como base, não `pi-native-app`.** Motivos:

1. Já cobre Fase 3 **e** Fase 4 do plano: grafo de agentes, checkpoints, recuperação, worktrees e avaliação.
2. Roda em Windows x64 com instalador — não depende de Tauri, Rust ou macOS.
3. Herda sessões, skills e extensões do Pi, então nada do SelfEvoPI precisa ser reescrito.

**Fallback:** `Pi Agent Desktop`, que traz algo que nenhum outro oferece — terminais contidos por **Job Objects** (ver §2).

---

## 2. Isolamento nativo — já existe pronto, em parte

| Mecanismo | O que entrega | Fonte |
|:---|:---|:---|
| **Job Objects** (`KILL_ON_JOB_CLOSE`) | Encerra a árvore inteira; herança de job por padrão | Win32 oficial |
| **Herdr v0.8.2** (no Pi Agent Desktop) | "Job Object-contained terminals" + Fleet + Agent control | pi-desktop.app |
| `pi-deltabox` 168K/mo | Sessões sandbox com diff/commit/abort | npm |
| `cc-safety-net` 45K/mo | Hook que bloqueia comandos destrutivos e acesso a segredos | npm |
| `@gotgenes/pi-permission-system` 42K/mo | Enforcement de permissões para o Pi | npm |
| `pi-agent-computer-use` 0.1.5 (MIT, 77,6 MB) | Automação de apps Windows via árvore de acessibilidade + input real | pi.dev |

**Recomendação:** **ADOTAR** `cc-safety-net` e/ou `pi-permission-system` como primeira camada (barato, imediato) e **construir** apenas o que faltar: a política de processos por tarefa (`kill-tree` vs `keep-alive`) e o gate estático com Semgrep/ESLint. O Node Permission Model continua sendo o cinto, não a solução.

**Atenção:** o `pi-agent-computer-use` é 77,6 MB e desenhado para automação de desktop, não para sandbox. Serve ao Forge (automação web/UI sem screenshots), não à segurança.

---

## 3. Orquestração — três candidatos reais, versões confirmadas

| Pacote | Versão | Licença | O que faz |
|:---|:---|:---|:---|
| `pi-subagents` | **0.88.1** | MIT | Delegação e workflows; agentes prontos; lazy schema |
| `pi-agent-orchestrator` | **0.2.1** | MIT | Jobs de shell em background + child agents + notificação de conclusão + activity dock |
| `@arhen/pi-core-subagent` | **1.4.3** | MIT | Subagentes in-process com **scheduler por grafo de dependências** (arestas carregam saída do upstream), background runs, intercom e mailbox |

`@arhen/pi-core-subagent` é o mais alinhado ao SelfEvoPI: o scheduler por dependências já resolve a ordenação de tarefas que o plano pretendia construir no coordenador.

`@tintinweb/pi-subagents` (66,7K/mo) e `@quintinshaw/pi-dynamic-workflows` (65,2K/mo, já com worktree isolation e token accounting) ficam como reserva.

---

## 4. Memória e `/refine` — dois pacotes, não um

| Pacote | Versão | Abordagem |
|:---|:---|:---|
| `pi-continual-harness` | ativo | Camada online: harness-state store + `/refine` com deltas estruturados (CRUD com evidência) |
| `pi-continual` | **0.1.0** | REPL Python persistente + subagentes `rlm()` + CRUD continual-harness + `/refine` + **metas autônomas limitadas** |

`pi-continual` tem uma peça que o outro não tem: **bounded autonomous goals** — diretamente relevante para a Fase 5 (evolução contínua). Vale entrar no bake-off como candidato complementar, não como substituto.

---

## 5. Compressão de contexto — atenção ao `mysql2`

`billion-context` 0.1.215 declara duas dependências: `zod` e **`mysql2`**. Um plugin de compressão que carrega um driver MySQL merece investigação antes de entrar em produção: pode ser dependência transitiva ociosa ou requisito real de storage.

**Ação (P2-4):** revisar o código antes de adotar; se `mysql2` for necessário em runtime, o custo fere o objetivo de leveza.

---

## 6. Grafo — existe colisão de nomes

| Pacote | Versão | Descrição |
|:---|:---|:---|
| `@shying/pi-graph` | 0.2.0 | LangGraph-inspired, nós `human`, checkpoints, contextos isolated/thread/shared |
| `pi-graph` | **0.2.3** | "Durable DAG execution with owned Pi SDK child agents" (HeathHe) |

São pacotes **diferentes com o mesmo nome curto**. O bake-off precisa comparar os dois explicitamente — e o nome ambíguo é um risco de supply-chain (instalar o errado por engano).

---

## 7. Pacotes antes não verificados — agora confirmados

| Pacote | Versão | Status |
|:---|:---|:---|
| `pi-agent-orchestrator` | 0.2.1 | ✓ existe, MIT, ativo |
| `@arhen/pi-core-subagent` | 1.4.3 | ✓ existe, MIT, ativo |
| `pi-continual` | 0.1.0 | ✓ existe, MIT, ativo |
| `@rahularya01/pi-essentials` | 0.1.0 | ✓ existe, MIT — bundle com MCP, web, subagentes, todos, ask-user |
| `pi-agent-extensions` | 0.5.6 | ✓ existe, MIT — 17 extensões + 4 temas |
| `pi-native-app` | 0.2.2 | ✓ existe (cliente web) |
| `pi-webapp` | 0.1.56 | ✓ existe, MIT |
| `pi-gui` | — | ✗ npm 404; existe só como repositório |

---

## 8. Síntese — o que muda no plano

| Item do plano | Antes | Agora |
|:---|:---|:---|
| Desktop Fase 4 | `Pi-Harness` ou `pi-native-app` (macOS?) | **Pi-Harness** (Windows x64) como base; `pi-native-app` virou cliente web |
| Sandbox | construir tudo | **adotar** `cc-safety-net` / `pi-permission-system` + construir só keep-alive e gate estático |
| Orquestração | 3 candidatos sem versão | 3 candidatos com versão e licença; `@arhen` lidera por ter scheduler DAG |
| Refine | 1 candidato | 2 candidatos (`pi-continual-harness` + `pi-continual`) |
| Compressão | adotar sem ressalva | **investigar `mysql2` antes** |
| Grafo | 1 candidato | **2 pacotes com nome colidindo** — comparar ambos |

---

## 9. Fontes

- <https://registry.npmjs.org/pi-agent-orchestrator/latest>
- <https://registry.npmjs.org/@arhen/pi-core-subagent/latest>
- <https://registry.npmjs.org/pi-continual/latest>
- <https://registry.npmjs.org/@rahularya01/pi-essentials/latest>
- <https://registry.npmjs.org/pi-agent-extensions/latest>
- <https://registry.npmjs.org/pi-native-app/latest>
- <https://registry.npmjs.org/pi-webapp/latest>
- <https://registry.npmjs.org/billion-context/latest>
- <https://registry.npmjs.org/pi-graph/latest>
- <https://github.com/shengxiao20/pi-app>
- <https://github.com/wangmiaozero/pi-harness>
- <https://pi-desktop.app/en/download/>
- <https://pi.dev/packages/pi-agent-computer-use>
- <https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects>