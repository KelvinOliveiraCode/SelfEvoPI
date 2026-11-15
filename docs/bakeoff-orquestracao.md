# Bake-off — orquestração de subagentes

> **Data:** 2026-11-15
> **Método:** medição estática do tarball, sem instalar nada no sistema.
> `node scripts/bakeoff.mjs pi-subagents pi-agent-orchestrator @arhen/pi-core-subagent`
> **Medição:** extração real com `tar` (contagem de arquivos e bytes descomprimidos
> medidos, não estimados). Nenhum número abaixo foi estimado; os três saem do
> `unpackedSize`/`files` medidos no diretório extraído e do `npm view --json`.

---

## 1. Resultado medido

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

## 2. O que pesa no contexto

Custo de contexto é o que entra na janela do modelo a cada turno — não o que
ocupa disco. Medido separadamente:

| Pacote | Manifesto `pi` | Injeção estática medida | Tools no contexto do pai |
|:---|:---|:---|:---|
| `pi-subagents` | `extensions` + **`skills`** + **`prompts`** | 2 skills (frontmatter 216 B + 232 B sempre; corpos de 4.334 B e 9.173 B só quando invocadas) · 6 prompts / 20.844 B · 13 agents com 4.026 B de frontmatter no roster | não verificável por leitura estática (bundle minificado) |
| `pi-agent-orchestrator` | `extensions` apenas | **nenhuma** — sem skills, prompts ou agents | **7** (`shell`, `shell_output`, `subagent`, `job_status`, `job_wait`, `job_background`, `job_cancel`) + comando `agents` |
| `@arhen/pi-core-subagent` | `extensions` apenas | **1.360 B** no system prompt de **cada child** (`subagentInstruction`, `src/manager.ts`) | **9** (`subagent`, `subagent_models`, `subagent_status`, `subagent_result`, `await_subagent`, `reply_subagent`, `steer_subagent`, `resume_subagent`, `subagent_cancel`) + comando `subagents` + 4 tools de child |

Leitura:

- **`pi-subagents` é o único que injeta conteúdo autoral no contexto.** É o
  único com `pi.skills` e `pi.prompts` no manifesto. As duas skills são o
  produto central dele — o custo é real, mas é *o que se está comprando*: sem
  a skill, sobra um pacote de 10,74 MiB que não faz nada sozinho.
- **`pi-agent-orchestrator` tem o menor custo de contexto dos três:** zero texto
  autoral, 7 schemas de tool. Ele não descreve tarefas; ele executa shell e
  dispara filhos.
- **`@arhen/pi-core-subagent` fica no mesmo patamar** (9 schemas contra 7) e
  acrescenta 1.360 B por child. É a diferença entre "7 tools" e "9 tools" — não
  é um salto de custo.

---

## 3. Risco

| Risco | `pi-subagents` | `pi-agent-orchestrator` | `@arhen/pi-core-subagent` |
|:---|:---|:---|:---|
| Superfície de supply-chain | **Alta** — 5 deps runtime (inclui `undici`, rede) + 801 arquivos | Baixa — 0 deps, 18 arquivos | Baixa — 0 deps, 24 arquivos |
| Carga em disco | **10,74 MiB**, 40× os outros dois | 0,28 MiB | 0,25 MiB |
| Formato do entrypoint | `bundle/index.js` **pré-bundleado** — sem transpilação no load | TypeScript cru (`extensions/*.ts`) | TypeScript cru (`src/index.ts`) |
| Acoplamento | peers Pi + `typebox` | peers Pi + `typebox` | peers Pi + `typebox` |
| Superfície de orquestração | workflows/scripted + 13 agents prontos | jobs de shell em background + child agents + activity dock | **scheduler DAG** + worktree isolation + intercom/mailbox |

**Dependência de loader TypeScript.** Os dois menores declaram
`pi.extensions` apontando para `.ts` e não empacotam `dist/`. Isso transfere ao
loader do Pi a responsabilidade de transpilar no load. É o risco que precisa de
verificação antes de fechar a escolha — não é motivo para eliminar, é motivo
para um smoke test.

**Alinhamento de política (medido no código do `@arhen`).** O `subagentInstruction`
que ele injeta em todo child já contém, em texto:

- proíbe `git switch/checkout/branch/worktree` dentro do worktree;
- proíbe `npm/bun/yarn/pnpm install` e `rm -rf node_modules`, porque
  `node_modules` é symlink compartilhado e a escrita escaparia do worktree.

É exatamente a política que A6 (sandbox) precisa construir. Adotar `@arhen`
significa herdar essa política pronta em vez de reescrevê-la — e ela vem
validada contra o modo de falha que o próprio projeto teme.

---

## 4. Recomendação

**Adotar `@arhen/pi-core-subagent` primeiro.**

Justificativa, em ordem de peso:

1. **É o único que resolve o problema da Fase 3 dentro do código entregue.**
   O scheduler por grafo está no tarball: `resolveNeeds`, `waveNotation` e
   `applyUpstream` em `src/graph.ts`. A aresta não só bloqueia o dependente —
   ela **entrega a saída do upstream** como entrada. Isso elimina a classe de
   falha "o coordenador esqueceu de passar X", que é justamente o que o
   coordenador próprio do SelfEvoPI teria que acertar do zero.
2. **Custo de contexto no mesmo patamar do mais barato.** 9 schemas de tool
   contra 7 do `pi-agent-orchestrator`, mais 1.360 B por child. Contra os
   20.844 B de prompts e as 2 skills do `pi-subagents`, é irrelevante.
3. **Risco de supply-chain baixo e medido:** zero dependências runtime, 24
   arquivos, 265.745 B. Os peers são todos do próprio Pi.
4. **Reduz trabalho da Fase 6.** A política de worktree e de "não instale
   dependências" já está no system prompt dos children, com a justificativa
   técnica correta (symlink compartilhado). A6 herda em vez de reescrever.
5. **Modo de falhar previsível.** Grafo inválido — id desconhecido, auto-aresta,
   ciclo — é rejeitado **na chamada**, antes de spawnar qualquer filho. Custo
   de erro zero em tokens.

**Segundo: `pi-agent-orchestrator`.** Não é substituto — é complemento. Ele cobre
jobs de shell longos em background e um activity dock, que é o que o Forge vai
querer em algum momento. Adotar depois, e por um motivo específico (jobs
longos), não como orquestrador.

**Terceiro: `pi-subagents`.** É outro produto: workflows em script + catálogo de
agents + skills. Pesa 40× mais em disco, traz 5 dependências runtime (incluindo
`undici`, que é rede) e injeta 20.844 B de prompts no contexto. Só vale entrar
se o catálogo de skills/agents for economicamente decisivo — e aí a decisão é de
produto, não de orquestração.

### Condição para fechar

O `@arhen` entrega TypeScript cru e depende do loader do Pi para transpilar.
Antes de fixar a versão no `models.json`, um smoke test de carga no Pi real
(existe precedente: `docs/fase0/evals.md` documenta o `.cmd` e o congelamento
de stdout como armadilhas já resolvidas). Se a carga falhar, o candidato
substituto é o `pi-agent-orchestrator` — 0 deps, mesmo formato `.ts`, superfície
menor — aceitando que a ordenação por dependências teria que ser construída.

---

## 5. Reprodução

```powershell
node scripts/bakeoff.mjs pi-subagents pi-agent-orchestrator @arhen/pi-core-subagent
```

O script imprime JSON no stdout (`ok`, `version`, `license`, `unpackedBytes`,
`tarballBytes`, `compressionRatio`, `files`, `deps`, `engines`,
`peerDependencies`) e sai 0. Pacote inexistente vira `{ ok: false, error:
"pacote inexistente no npm (404)" }` e a rodada continua. O diretório
temporário é removido ao final — inclusive em caso de erro.

Nada é instalado: `npm pack` baixa o tarball para um diretório temporário e a
medição é feita na extração. Nenhum `npm i -g`, nenhuma alteração em
`models.json`.