# Fase 2 — Governança: rollback verificado e aprovação humana

> **Escopo:** as três peças que impedem o loop evolutivo de degradar o projeto sem volta.
> **Implementado:** `core/governance/rollback.mjs`, `approval.mjs` e `modes.mjs`. 46 testes.
> **Área protegida:** `core/governance/` só é escrito por A6. O loop evolutivo nunca edita aqui.

## 1. O problema

O loop é autônomo por desenho: detecta lacuna → gera artefato → testa → promove. Autonomia sem freio tem três modos de falha:

| Modo | Exemplo | Consequência |
|:---|:---|:---|
| **Regressão silenciosa** | o artefato novo passa no teste dele e quebra o resto | o projeto fica pior e ninguém volta |
| **Decisão tomada no escuro** | o artefato pede rede, credencial ou escrita fora da árvore | o loop concede o que não deveria conceder |

O primeiro se resolve com **rollback verificado**. O segundo, com **pausa obrigatória**. O terceiro — deixar o agente agir além do combinado — com **modos de permissão**.

## 2. As três peças

| Peça | Arquivo | Pergunta que responde |
|:---|:---|:---|
| Rollback verificado | `core/governance/rollback.mjs` | "reverti; **e agora está verde**?" |
| Aprovação | `core/governance/approval.mjs` | "isto precisa de um humano antes de rodar?" |
| Modos | `core/governance/modes.mjs` | "o que este modo deixa o agente fazer?" |

A ordem no loop é: escolher o modo → aprovar → executar → verificar → promover. Se qualquer etapa falha, o rollback devolve o projeto ao último estado verde e o artefato volta para o loop com o motivo.

## 3. Rollback verificado

```js
import { rollbackAndVerify, checkpointGood } from "./core/governance/rollback.mjs";

const r = await rollbackAndVerify({
  repoRoot,          // raiz do repositório
  ref,               // sha / tag / branch do artefato auto-evoluído
  verify,            // verificação injetada pelo gate
  createTag: true,   // cria ckpt/pre-revert-<timestamp> antes de reverter
  checkpoint: true,  // grava last-known-good se passar
});
// { ok, reverted, verified, tag, sha, checkpointed? , error? }
```

### O fluxo

```
ref existe? ──não──► ok:false, reverted:false, árvore intacta
   │sim
   ├─ createTag ──► tag ckpt/pre-revert-<timestamp> apontando para o HEAD atual
   ├─ git revert --no-edit <ref>
   │     └─ conflito? ──► git revert --abort ──► ok:false, reverted:false, árvore limpa
   ├─ verify()
   │     └─ falhou? ──► ok:false, reverted:true, verified:false ──► last-known-good NÃO é tocado
   └─ checkpoint ──► grava last-known-good com o novo SHA
```

O ponto que sustenta a peça: **`reverted` e `verified` são campos separados**. Reverter é fácil; reverter e ficar verde é a afirmação. Um `ok:true` que significasse só "o git voltou" seria uma mentira útil para o loop.

### `checkpointGood`

```js
await checkpointGood({
  repoRoot,
  verify,
  label: "fase2-integra",
  checks: [{ name: "unit-tests", command: "node --test core/governance/*.test.mjs", result: "pass" }],
});
```

Grava `.pi/harness/last-known-good.json` **só se `verify()` passar**, no formato que o projeto já usa:

```json
{
  "version": 1,
  "sha": "b88db16",
  "branch": "agent/A6-f2-sandbox",
  "verifiedAt": "2026-11-16",
  "phase": "2",
  "checks": [{ "name": "rollback-verified", "command": "git revert --no-edit <ref>", "result": "pass" }],
  "notes": "rollback verificado de <ref>",
  "label": "revert <ref>",
  "tag": "ckpt/pre-revert-1763..."
}
```

A escrita é atômica: arquivo temporário no mesmo diretório + `rename`. Um `last-known-good.json` truncado no meio de uma falha de disco seria pior que um arquivo velho.

### Verificação: o que conta como passar

`verify()` pode ser síncrona ou assíncrona, e três formatos valem:

| Resposta | Veredito |
|:---|:---|
| `true`, `undefined`, `null` | passa |
| `{ ok: true }`, `{ pass: true }`, `{ success: true }` | passa |
| `false`, `{ ok: false }`, `{ errors: [...] }` | falha |
| `throw` | falha, com a mensagem |
| qualquer outra coisa | **falha** |

Verificação ambígua não é verificação. Um objeto `{ status: "ok" }` que ninguém documentou não vira `ok:true` por otimismo.

### Segurança

- `git` roda com `execFileSync` e **array de argumentos**. Sem shell, sem string interpolada: `ref` vem de dentro do loop evolutivo, e um `ref` começando com `-` seria lido como flag — por isso é recusado antes de chegar ao git.
- `verify` roda com `cwd` na raiz do repositório, para o verificador enxergar a árvore que acabou de mudar.
- Revert com conflito é abortado, para não deixar a árvore meio-revertida (o teste prova isso com `git status --porcelain` vazio).

## 4. Aprovação

```js
import { reviewApproval } from "./core/governance/approval.mjs";

const r = reviewApproval({ request, scan });
// { needsHuman, reasons, questions, triggers }
```

### Duas fontes, e as duas contam

| Fonte | O que é | Peso |
|:---|:---|:---|
| `request` | o que o artefato **pede** (spec, mode, access) | declaração |
| `scan` | resultado de `static-gate.evaluate(código)` | evidência |

Pedido vazio não significa "nada acontece": significa "nada foi declarado". Por isso o scan entra sempre, e um artefato que pede rede sem declarar ainda pausa.

### Gatilhos

| Gatilho | Vem do pedido | Vem do scan |
|:---|:---|:---|
| `network` | `network: true`, `requiresNetwork` | `network-access` |
| `credentials` | `credentials`, `secrets`, `tokens`, `envSecrets` | `credential-store`, `secret-env-read`, `ssh-access`, `userprofile-config`, `embedded-secret` |
| `write-outside-workspace` | `writesOutside: true`, `access.write: "outside"` | `outside-workspace-path`, `recursive-force-delete` (bloqueio = fora da árvore) |
| `gate-block` | — | bloqueio do gate por regra **que nenhum outro gatilho explica** |

O `gate-block` existe para o resto: `registry-exe`, `dynamic-eval`, `child-process` e companhia. Um `fetch` que já pede rede não aparece duas vezes — se o bloqueio está totalmente explicado, o gatilho genérico não dispara.

### Perguntas

Nada de "você tem certeza?". Cada gatilho tem perguntas objetivas, que o humano responde em uma linha:

| Gatilho | Pergunta |
|:---|:---|
| `network` | "Qual domínio ou serviço este artefato precisa acessar?" + "A chamada pode ser feita offline, contra um arquivo ou fixture local?" |
| `credentials` | "Quais credenciais ele precisa e de qual serviço ou repositório?" + "O acesso pode ser feito por um token de escopo mínimo, com validade curta?" |
| `write-outside-workspace` | "Qual caminho fora do workspace precisa ser escrito, e por quê?" + "O artefato pode escrever dentro do workspace e copiar o resultado depois?" |
| `gate-block` | "Qual regra do gate é falso positivo aqui, e qual trecho do código justifica liberar?" + "Se a regra estiver certa, o artefato deve ser reescrito em vez de aprovado?" |

### Exemplo

```js
reviewApproval({
  request: { mode: "cli" },
  scan: evaluate('const r = await fetch("https://api.example.com");', { file: "rede.mjs" }),
});
// {
//   needsHuman: true,
//   reasons: ["network: o scan aponta network-access@1"],
//   questions: ["Qual domínio ou serviço este artefato precisa acessar?", "…"],
//   triggers: ["network"]
// }
```

## 5. Modos de permissão — `core/governance/modes.mjs`

A terceira peça. Um modo não é um rótulo de prompt: é um conjunto de permissões. O critério (docs/research/cli-landscape/modos.md §4) é objetivo — **um modo só existe se mudar ler, escrever, executar ou quando-pergunta**. O módulo se recusa a registrar um modo que não mude nenhum dos quatro.

```js
import { resolveMode, guard, guardWrite } from "./core/governance/modes.mjs";

resolveMode("plan");  // { name, canRead, canWrite, canExec, execScope, ask, base }
guard({ mode: "plan", action: "write", path, workspace });
// { decision: "allow" | "ask" | "block", mode, action, reason, questions }
```

| Modo | Lê | Escreve | Executa | Quando pausa | `execScope` |
|:---|:---:|:---:|:---:|:---|:---|
| `plan` | sim | **não** | só leitura | quando tentam escrever | `readonly` |
| `build` | sim | sim, no workspace | sim, no workspace | fora do workspace | `workspace` |
| `ask` | sim | **não** | **não** | nunca | `none` |
| `manual` | sim | sim, **mas confirma** | sim, no workspace | **toda escrita**, mesmo dentro | `workspace` |
| `goal` | sim | herda da base | herda | herda | herda (`build` por padrão) |

### O meio-termo: `manual`

`build` escreve livre dentro do workspace e `plan` não escreve de jeito nenhum. Faltava o meio-termo, e é o que o usuário pede quando diz "ask": **`manual` tem as permissões do `build` e devolve `ask` em toda escrita**, inclusive a que está dentro do workspace. A diferença não está nas permissões — está no `guard`, que é onde a pergunta acontece antes de executar.

É o "Pergunta sempre" do Claude Code (`default`/Manual), e o rótulo na TUI é `Confirma cada escrita`: ele diz o que dispara a pausa (escrever), não "a cada passo", porque a execução em `manual` continua livre como no `build`.

**Fica para depois: `/review`.** A `matriz.md` §3 lista `/review` (ler um diff e devolver achados, sem editar) como modo que vale a pena. Não entrou: é modo novo com semântica nova, e a TUI do A2 ainda está fechando. O registro já aceita uma entrada nova sem refactor — falta decidir se ele lê diff do Git ou de um patch proposto.

### Três desfechos, não dois

| `decision` | Significado |
|:---|:---|
| `allow` | executa |
| `ask` | não executa ainda; um humano decide e pode liberar (`questions` diz o quê) |
| `block` | não executa; o modo proíbe (`questions` diz o que destravaria) |

`plan` + escrita é `block` — a ação não chega a rodar. É a diferença entre "segurar" e "recusar": em `build`, escrever **fora** do workspace é `ask` (o modo permite escrever, mas não ali); em `plan`, é `block`, porque escrever não é permitido de forma alguma.

### Como conversa com o resto

- **static-gate**: `classifyPath` decide dentro/fora do workspace. Não reimplementa a comparação.
- **approval.mjs**: quando o modo deixa passar mas o `scan` indica gatilho de rede/credencial/escrita externa, o desfecho vira `ask` e as perguntas vêm de lá. Um `block` do modo **nunca** é convertido em `ask` — proibição não é negociável.
- **sandbox**: o alcance de `execScope: "workspace"` quem limita é o `run-sandboxed` (Permission Model + preload), não o modo.

### O que não existe de propósito

**Não há `yolo`, `bypass` ou `danger-full-access`.** `resolveMode("yolo")` lança erro. É exatamente o que o SelfEvoPI não deve expor: o valor do projeto está nas camadas, não em desligá-las.

Também não existe modo que só mude o prompt. `assertRegistroTemSentido()` roda no import e lança se algum modo não diferir de outro em permissão — o que deixa o `goal` passar é declarar `base` (ele muda escopo, não permissão, como o Claude Code: "A goal doesn't change your permission mode").

## 6. Como as três peças entram no loop

```
               ┌──────────────────────────────────────────────┐
               │  loop evolutivo (detecção → spec → geração)  │
               └───────────────────┬──────────────────────────┘
                                   │ artefato + spec
                                   ▼
                    ┌──────────────────────────────┐
                    │ reviewApproval(request,scan) │
                    └───────┬───────────────┬──────┘
                 needsHuman │               │ seguro
                            ▼               ▼
                  ┌─────────────────┐   ┌──────────────────────┐
                  │  fila do humano │   │ runSandboxed (gate + │
                  │  perguntas      │   │ permission + timeout)│
                  └────────┬────────┘   └──────────┬───────────┘
                           │ aprovado              │ verify()
                           └───────────┬───────────┘
                                       ▼
                          ┌──────────────────────────┐
                          │ rollbackAndVerify(       │
                          │   ref, verify)           │
                          └───────┬──────────┬───────┘
                             ok:true        ok:false
                                  ▼            ▼
                    ┌──────────────────┐  revert + LKG intacto
                    │ checkpointGood / │  artefato volta ao loop
                    │ promote          │  com o motivo
                    └──────────────────┘
```

A regra que fecha o desenho: **o loop nunca promove o que ele mesmo reprovou**. O `last-known-good.json` é a única fonte de "estava verde", e só `checkpointGood`/`rollbackAndVerify` escrevem nele.

## 7. O que isto não é

- **Não é sandbox.** A contenção é a camada 2 (`core/sandbox/run-sandboxed.mjs`); aqui só se decide se vale rodar e se o que rodou pode ficar.
- **Não é aprovação automática de risco.** `needsHuman: true` devolve perguntas; quem responde é gente. O módulo não aprova nada sozinho.
- **Não é auditoria Git.** Não faz `push`, não faz `merge`, não substitui o `scripts/checkpoint.mjs` (que continua sendo a interface CLI para `status|create|restore|verify`).

## 8. Testes

```powershell
node --test core/governance/*.test.mjs    # 26 passam
node --test core/sandbox/*.test.mjs       # 59 passam\nnode --test core/governance/modes.test.mjs # 35 passam (modos)
```

O teste de rollback cria repositórios Git reais em diretórios temporários e prova os dois caminhos:

| Caminho | Prova |
|:---|:---|
| feliz | `arquivo.txt` volta ao conteúdo do primeiro commit e `novo.txt` desaparece; o log tem 3 commits (1, 2, revert) |
| verify falha | `ok:false`, `reverted:true`, e o `last-known-good.json` fica **byte a byte** igual ao anterior |
| revert com conflito | `ok:false`, `reverted:false` e `git status --porcelain` vazio (o abort funcionou) |
| ref inexistente | `ok:false` e HEAD inalterado |
| ref começando com `-` | recusado antes de virar flag |

## 9. Decisões tomadas (para revisão)

| Decisão | Por quê |
|:---|:---|
| `verify()` ambígua conta como falha | otimismo aqui escreveria um `last-known-good` falso |
| `reverted` e `verified` separados | reverter não é ficar verde; um campo só esconderia a diferença |
| `createTag: true` por padrão | revert é reversível, mas o estado anterior não; a tag custa nada |
| `gate-block` só quando o bloqueio não é explicado | um `fetch` não deve aparecer como "rede" e "gate" ao mesmo tempo |
| `ref` com `-` recusado | vem do loop evolutivo; não dita flags do git |
| escrita atômica no `last-known-good.json` | arquivo truncado é pior que arquivo velho |
| `plan` + escrita é `block`, não `ask` | o modo proíbe; `ask` é para o que o modo permite mas não ali |
| classificador de leitura é conservador | na dúvida vira `ask`, nunca `allow` |
| `goal` herda a base em vez de ter permissão própria | é o que a pesquisa mostrou; sem isso seria decoração |
| `manual` pergunta na escrita, não no passo | o rótulo tem de dizer o que dispara a pausa; execução segue livre |
| rótulo vem da capacidade, não do nome | `goal` e `manual` herdam sem `if` especial; a linha descreve o que vai acontecer |