# Bake-off — orquestração de subagentes

> **Data:** 2026-11-15
> **Duas medições, não uma:**
> - **§1–§5 — estática:** `node scripts/bakeoff.mjs …` — tamanho e metadados do
>   tarball, sem instalar nada.
> - **§6 — runtime:** `node scripts/bakeoff-run.mjs` — overhead real dentro de
>   uma sessão Pi: TTFT, tokens de prompt/tools, tools expostas, tempo de tarefa.
>
> **Nenhum número deste documento foi estimado.** Os estáticos vêm da extração
> real com `tar` e do `npm view --json`; os de runtime vêm do system message
> persistido em cada sessão, medido com o **estimador de tokens do próprio Pi**.

---

## 1. Resultado estático

| Pacote | Versão | Licença | Descomprimido | Tarball | Arquivos | Deps runtime | Peer deps | Razão |
|:---|:---|:---|--:|--:|--:|--:|--:|--:|
| `pi-subagents` | 0.88.1 | MIT | 11.266.106 B (10,74 MiB) | 2.627.516 B (2.565,9 KiB) | **801** | **5** | 5 | 0,2332 |
| `pi-agent-orchestrator` | 0.2.1 | MIT | 293.269 B (0,28 MiB) | 79.606 B (77,7 KiB) | **18** | **0** | 3 | 0,2714 |
| `@arhen/pi-core-subagent` | 1.4.3 | MIT | 265.745 B (0,25 MiB) | 80.367 B (78,5 KiB) | **24** | **0** | 5 | 0,3024 |

**Razão** = tarball ÷ descomprimido (quanto menor, mais o pacote é texto comprimível).

### Dependências runtime declaradas

| Pacote | Dependências |
|:---|:---|
| `pi-subagents` | `jiti` 2.7.0 · `yaml` 2.8.3 · `acorn` 8.18.0 · `undici` 8.12.4 · `@js-temporal/polyfill` 0.5.1 (todas com versão exata) |
| `pi-agent-orchestrator` | nenhuma |
| `@arhen/pi-core-subagent` | nenhuma |

### O que vai para o disco

| Pacote | Composição medida |
|:---|:---|
| `pi-subagents` | `src/` 696 arq / 6.080.373 B · `bundle/` 58 arq / 4.095.066 B · `docs/` 10 arq / 418.924 B · `agents/` 13 arq / 23.874 B · `skills/` 5 arq / 30.969 B · `prompts/` 6 arq / 20.844 B · CHANGELOG.md 500.366 B |
| `pi-agent-orchestrator` | `extensions/` 10 arq / 220.894 B · `docs/` 5 arq / 54.463 B · README.md 14.386 B |
| `@arhen/pi-core-subagent` | `src/` 21 arq / 231.751 B · README.md 31.601 B |

---

## 2. O que pesa no contexto — previsão estática

> **Ver §6 para a medição real.** Esta seção registra o que a leitura do
> manifesto sugeria **antes** de rodar. Duas das três conclusões abaixo
> estavam erradas, e a §6 mostra quais.

| Pacote | Manifesto `pi` | Injeção estática | Tools no contexto do pai |
|:---|:---|:---|:---|
| `pi-subagents` | `extensions` + **`skills`** + **`prompts`** | 2 skills (frontmatter 216 B + 232 B; corpos de 4.334 B e 9.173 B sob invocação) · 6 prompts / 20.844 B · 13 agents com 4.026 B de frontmatter | não verificável (bundle minificado) |
| `pi-agent-orchestrator` | `extensions` apenas | **nenhuma** | **7** (`shell`, `shell_output`, `subagent`, `job_status`, `job_wait`, `job_background`, `job_cancel`) + comando `agents` |
| `@arhen/pi-core-subagent` | `extensions` apenas | **1.360 B** no system prompt de cada child (`subagentInstruction`, `src/manager.ts`) | **9** + comando `subagents` + 4 tools de child |

---

## 3. Risco

| Risco | `pi-subagents` | `pi-agent-orchestrator` | `@arhen/pi-core-subagent` |
|:---|:---|:---|:---|
| Superfície de supply-chain | **Alta** — 5 deps runtime (inclui `undici`, rede) + 801 arquivos | Baixa — 0 deps, 18 arquivos | Baixa — 0 deps, 24 arquivos |
| Carga em disco | **10,74 MiB**, 40× os outros dois | 0,28 MiB | 0,25 MiB |
| Formato do entrypoint | `bundle/index.js` pré-bundleado | TypeScript cru (`extensions/*.ts`) | TypeScript cru (`src/index.ts`) |
| Carga no runtime (medido) | **8,5 s de TTFT** (§6) | 4,0 s | 4,0 s |
| Acoplamento | peers Pi + `typebox` | peers Pi + `typebox` | peers Pi + `typebox` |
| Superfície de orquestração | workflows/scripted + 13 agents prontos | jobs de shell em background + child agents + activity dock | **scheduler DAG** + worktree isolation + intercom/mailbox |

**Dependência de loader TypeScript — descartada pela medição (§6).** Os dois
menores declaram `pi.extensions` apontando para `.ts` e não empacotam `dist/`,
o que me levou a levantar o risco de transpilation no load. **Os três carregaram
sem erro no Pi 1.5.2.** O motivo está documentado em
`node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:211`:
*"Extensions are loaded via jiti, so TypeScript works without compilation"*.

**Alinhamento de política (medido no código do `@arhen`).** O `subagentInstruction`
que ele injeta em todo child já contém, em texto:

- proíbe `git switch/checkout/branch/worktree` dentro do worktree;
- proíbe `npm/bun/yarn/pnpm install` e `rm -rf node_modules`, porque
  `node_modules` é symlink compartilhado e a escrita escaparia do worktree.

É exatamente a política que A6 (sandbox) precisa construir. Adotar `@arhen`
significa herdar essa política pronta em vez de reescrevê-la.

---

## 4. Recomendação (revista depois da medição)

**Esta seção foi reescrita após a §6. A recomendação anterior era `@arhen`, e ela
se apoiava em duas premissas que a medição derrubou.** Ver §6.4 para o
raciocínio completo; o resumo é:

| Critério medido | Vencedor |
|:---|:---|
| Menor overhead de contexto **por turno** | `pi-subagents` (+1.808 t) |
| Menor custo de **startup** | `@arhen` / `pi-agent-orchestrator` (~4,0 s) |
| Menor custo de **carregar** (disco + deps) | `@arhen` / `pi-agent-orchestrator` |
| Único com **scheduler DAG** no código entregue | `@arhen` |

**Se o requisito é custo por turno:** `pi-subagents`.
**Se o requisito é ordenação por dependências pronta:** `@arhen`, aceitando
+1.044 t/turno sobre o `pi-subagents` e 4,7 s a mais de startup.

A escolha depende de qual desses dois custos pesa mais no SelfEvoPI — e isso é
uma decisão de produto, não de medição. O que a medição **não** faz é decidir
qualidade de orquestração: ela mede o preço, não o resultado.

---

## 5. Reprodução (estática)

```powershell
node scripts/bakeoff.mjs pi-subagents pi-agent-orchestrator @arhen/pi-core-subagent
```

Imprime JSON no stdout (`ok`, `version`, `license`, `unpackedBytes`,
`tarballBytes`, `compressionRatio`, `files`, `deps`, `engines`,
`peerDependencies`) e sai 0. Pacote inexistente vira
`{ ok: false, error: "pacote inexistente no npm (404)" }` e a rodada continua.

Nada é instalado: `npm pack` baixa o tarball para um diretório temporário e a
medição é feita na extração.

---

## 6. Overhead real medido (runtime)

Medição em sessão Pi **1.5.2** real. Estimador de tokens:
`@earendil-works/pi-ai/utils/estimate` (`chars/3.5`) — o mesmo cálculo que o
Pi usa para decidir compactação e para o rodapé de contexto. Não é uma conta
minha; é a unidade em que o custo aparece de verdade.

### 6.1 Método

Para cada pacote:

1. `npm install --ignore-scripts --no-audit --no-fund --prefix <tmp> <pacote>`
   — nada vai para o sistema.
2. **Sessão de controle:** mesmo modelo, mesmo prompt, **nenhuma** extensão.
3. **Sessão de tratamento:** `pi -e <caminho do pacote>`.
4. O system message persistido em cada sessão (JSONL) é lido e medido:
   `estimateMessageTokens()` para o total, contagem de `toolsAdded` para as
   tools, bytes por seção para o prompt.

**Modelo:** `kilo1/reflection/beam-free` — o mesmo nas duas sessões; sem isso a
comparação não vale nada. **Prompt:** `Reply with exactly: ok`.

`~/.pi/agent/models.json` é **apenas lido**. Cada sessão recebe uma **cópia**
num `PI_CODING_AGENT_DIR` temporário, removido ao final (inclusive em erro).

### 6.2 Controle (baseline)

| Métrica | Valor |
|:---|--:|
| Tools | 4 — `read`, `bash`, `edit`, `write` |
| Tokens de prompt | 8.614 |
| Tokens de tool schemas | 849 |
| Tokens totais | 9.463 |
| TTFT | 2.281 – 3.091 ms |
| Tempo total | 2.379 – 3.144 ms |

O baseline inclui **27.857 B de skills embutidas no próprio Pi**. É constante em
todas as sessões e **cancela na subtração** — por isso o overhead é a comparação
válida, não o número absoluto.

### 6.3 Medição por pacote

| Pacote | TTFT | Tempo total | Tools | Novas tools | Tokens prompt | Tokens tools | **Overhead/turno** |
|:---|--:|--:|--:|--:|--:|--:|--:|
| `pi-subagents` | **7.111 – 9.343 ms** | 7.298 – 8.804 ms | 8 | 4 | 8.891 (+277) | 2.380 (+1.531) | **+1.808** |
| `pi-agent-orchestrator` | 3.617 – 4.301 ms | 3.744 – 4.440 ms | 11 | 7 | 9.274 (+660) | 2.328 (+1.479) | **+2.139** |
| `@arhen/pi-core-subagent` | 3.812 – 4.070 ms | 3.972 – 4.212 ms | 13 | 9 | 9.161 (+547) | 3.154 (+2.305) | **+2.852** |

**Todos os três carregaram** (`exit 0`, `loaded: true`) — inclusive os dois que
entregam TypeScript cru.

Novas tools por pacote, nomeadas:

| Pacote | Novas tools expostas |
|:---|:---|
| `pi-subagents` | `subagent`, `contact_supervisor`, `bg_wait`, `subagent_supervisor` |
| `pi-agent-orchestrator` | `shell`, `subagent`, `job_status`, `job_wait`, `job_background`, `job_cancel`, `shell_output` |
| `@arhen/pi-core-subagent` | `subagent_models`, `subagent`, `subagent_status`, `subagent_result`, `await_subagent`, `reply_subagent`, `steer_subagent`, `resume_subagent`, `subagent_cancel` |

As contagens estáticas da §2 bateram exatamente com as medidas, com uma correção:
as 7 tools do `pi-agent-orchestrator` previstas foram confirmadas, as 9 do
`@arhen` também, e o `pi-subagents` — que a leitura estática não conseguiu
contar por causa do bundle minificado — expõe **4**.

### 6.4 De onde vem o overhead de prompt

Diferença de bytes por seção do system message, contra o controle:

| Pacote | Seções alteradas |
|:---|:---|
| `pi-subagents` | `skills` **+867 B** · `tools` +98 B · `cwd` +3 B |
| `pi-agent-orchestrator` | `rules` **+2.093 B** · `tools` +214 B · `cwd` +12 B |
| `@arhen/pi-core-subagent` | `rules` **+1.600 B** · `tools` +305 B · `cwd` +14 B |

Cada pacote paga o contexto de um jeito diferente:

- **`pi-subagents` cobra pelas descrições das skills** (+867 B), não pelos corpos.
  Os 20.844 B de prompts que a §2 contou **não entram aqui**: prompts do Pi são
  comandos `/`, carregados sob invocação.
- **`pi-agent-orchestrator` injeta um bloco de `rules` de 2.093 B** — o maior
  texto autoral dos três no system prompt.
- **`@arhen` injeta `rules` de 1.600 B mais 9 schemas de tool** — o maior custo
  de ferramentas (+2.305 t).

### 6.5 Custo de startup (TTFT)

Cinco rodadas para controle, `pi-subagents` e `pi-agent-orchestrator`; quatro
para `@arhen`. Mesmo modelo em todas.

| Pacote | TTFT (3 rodadas) | Leitura |
|:---|:---|:---|
| controle | 2.281 · 2.424 · 2.480 · 2.736 · 3.091 ms | — |
| `pi-subagents` | 7.111 · 8.305 · 8.563 · 8.571 · 9.343 ms | **7,1 – 9,3 s; sempre ~2× o controle** |
| `pi-agent-orchestrator` | 3.617 · 3.913 · 3.991 · 4.072 · 4.301 ms | ~3,6 – 4,3 s |
| `@arhen/pi-core-subagent` | 3.812 · 3.869 · 4.030 · 4.070 ms | ~3,8 – 4,1 s |

São 5 rodadas para controle, `pi-subagents` e `pi-agent-orchestrator`, e 4 para
`@arhen` (a primeira rodada dele foi descartada por um problema do meu script,
não do pacote). O TTFT do `pi-subagents` é **reprodutível, não ruído**: o `bundle/index.js`
pré-bundleado tem 4.095.066 B e o custo aparece em toda rodada. É o preço do
pacote pré-empacotado — ele troca tempo de carregamento por não depender de
transpilação. A ordem entre os três é a mesma em todas as rodadas.

### 6.6 O que a medição mudou

1. **A ressalva do TypeScript está descartada.** Os três carregam.
2. **A previsão estática de contexto estava errada na direção.** A §2 concluiu
   que o `pi-subagents` era o mais caro, por "20.844 B de prompts + 2 skills".
   Medido, ele é o **mais barato por turno** (+1.808 t): prompts não entram no
   system prompt e as skills entram só com descrições (+867 B).
3. **O `@arhen` é o mais caro por turno** (+2.852 t, 58% acima do
   `pi-subagents`), por causa de 9 schemas de tool.
4. **Startup e contexto são custos de naturezas diferentes.** O TTFT se paga
   **uma vez por sessão**; o overhead de contexto se paga **a cada turno**. Em
   sessão longa o custo por turno domina; em muitas sessões curtas, o TTFT
   domina.

### 6.7 O que esta medição não cobre

Capacidade. Foi medido o **preço**, não a **qualidade** da orquestração. A
ordenação por grafo de dependências do `@arhen` continua sendo a única que
resolve o problema da Fase 3 no código entregue — mas isso é evidência de leitura
de código (§3), não de runtime. Esta medição não a valida nem a substitui.

---

## 7. Reprodução (runtime)

```powershell
node scripts/bakeoff-run.mjs
node scripts/bakeoff-run.mjs --model=kilo1/reflection/beam-free
node scripts/bakeoff-run.mjs pi-subagents @arhen/pi-core-subagent
```

Imprime o overhead medido por pacote (TTFT, tokens, tools, seções) e sai 0.
Pacote que não carrega é **resultado**, não falha — aparece com `loaded: false` e
o erro no `stderr` capturado.

Nada é instalado no sistema: `npm pack` e `npm install` escrevem só em diretório
temporário, removido ao final. Nenhum `npm i -g`, nenhuma alteração em
`models.json`.