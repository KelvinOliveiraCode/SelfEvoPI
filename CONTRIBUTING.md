# Contribuindo

Como contribuir com o SelfEvoPI. Leia antes de abrir um pull request.

---

## 1. Pré-requisitos

| Ferramenta | Versão | Por quê |
|:---|:---|:---|
| **Windows** | nativo | sem Docker, sem VM, sem WSL — o sandbox usa Job Objects e Permission Model do Windows |
| **Node.js** | ≥ 22.19 (validado em 24.13) | `engines` do `package.json`; ESM puro, sem dependências npm |
| **Git** | ≥ 2.55 | com `core.longpaths true` |

Não há `npm install` a fazer: o projeto não tem dependências externas. Um
`package-lock.json` existe apenas para o CI congelar a ausência delas.

Antes de qualquer coisa:

```powershell
git clone <url-do-repositorio> SelfEvoPI
cd SelfEvoPI
npm run verify
```

Se `npm run verify` não passar numa árvore recém-clonada, o problema é do
clone, não seu. Pare e investigue antes de escrever código.

---

## 2. Verificação antes do PR

**`npm run verify` tem que passar. Sem exceção.**

```powershell
npm run verify
```

É exatamente o que o CI roda (`.github/workflows/ci.yml`), de propósito:
evita o clássico "passa na minha máquina". O comando cobre quatro coisas:

| Etapa | O que prova |
|:---|:---|
| `npm test` | 449 testes unitários (448 passam, 1 skip) — roteador, forge, memória, grafo, governança, sandbox |
| `node evals/run.mjs --group A` | roteador: reviewer, backoff, circuit breaker, retry |
| `node evals/run.mjs --group C` | regressão: segredos fora do repo, testes unitários, documentação |
| `node scripts/verify-urls.mjs` | integridade das fontes citadas na pesquisa |

O que **não** entra no `verify`, e por quê:

- **grupo B** — B9, B10 e B11 chamam modelo real (32.298 tokens medidos) e a
  chave de API não vai para o repositório;
- **grupo D e o gate completo** — mesmo motivo: custam tokens.

O gate inteiro é comando local:

```powershell
node evals/gate.mjs
```

### Mudança de comportamento exige atualizar a baseline

Se você alterou o comportamento de algo que uma tarefa de eval verifica, o gate
vai reprovar — e é para isso que ele existe. Não afrouxe o verificador. Atualize
a baseline **com a justificativa no próprio arquivo**, e regere:

```powershell
node evals/gate.mjs --update
```

Um verificador que passa sempre não verifica nada. Se você está tentado a
enfraquecer uma tarefa para o gate ficar verde, o problema é a mudança.

---

## 3. Como trabalhamos

### Worktrees isolados, uma branch por agente

O trabalho paralelo acontece em worktrees, um por frente:

```
.worktrees/A1   .worktrees/A2   .worktrees/A3   .worktrees/A4
.worktrees/A5   .worktrees/A6   .worktrees/A7   .worktrees/A8
```

Cada worktree tem sua branch (`agent/A1-...`, `agent/A2-...`, …). Duas frentes
nunca editam a mesma árvore, então duas frentes nunca se atropelam.

Regra prática: **trabalhe só dentro do seu worktree.** Não edite a árvore
principal para "aproveitar e já commitar" — é assim que um trabalho paralelo
vira um conflito que ninguém sabe desfazer.

### A regra de ouro

> **Nenhum código de subagente entra sem o orquestrador ler o diff e rodar o
> comando de verificação.**

Um subagente entrega trabalho, não entrega confiança. Antes de qualquer merge:

1. o orquestrador **lê o diff** — não o resumo do diff, o diff;
2. o orquestrador **roda `npm run verify`** na árvore que vai receber o código;
3. só então o código entra.

Um `exit 0` de um subagente não é evidência. A evidência é o comando rodando na
árvore de destino, com o hash do commit que você está revisando.

---

## 4. Áreas protegidas

Três lugares ninguém toca — nem agente, nem orquestrador, nem o loop evolutivo:

| Área | Por quê |
|:---|:---|
| `evals/` | é o juiz. Um juiz que pode ser editado pelo réu não julga nada |
| `core/governance/` | rollback e aprovação. Se o loop edita isso, ele remove o próprio freio |
| `scripts/verify-urls.mjs` | gate de integridade das fontes. Enfraquecê-lo é mentir sobre a pesquisa |

O Núcleo Evolutivo já respeita isso por construção (`core/forge/cli.mjs` consome
`evals/`, não escreve; `core/governance/rollback.mjs` só é chamado, nunca
alterado). Se você precisa mudar uma dessas áreas, é mudança de processo — leva
justificativa no PR e revisão explícita, não uma linha no meio de um `feat`.

---

## 5. Commits

[Conventional Commits](https://www.conventionalcommits.org/pt-br/v1.0.0/), com
escopo no nome da frente:

```
feat(forge): gerador de mcp-server com sonda JSON-RPC
fix(sandbox): Job Object não derrubava subprocesso neto
docs(estado): atualiza métricas da fase 3
chore(ledger): regenera baseline após mudança de comportamento
```

Assunto no imperativo, em minúsculas, sem ponto final. O corpo explica **por
quê**, não **o quê** — o diff já mostra o quê.

### Proibição absoluta

**Nenhum segredo, token, credencial ou caminho pessoal em commit algum.**

| Nunca | Sempre |
|:---|:---|
| caminho absoluto de diretório pessoal | caminho relativo ao repositório |
| token de API, cookie, senha | `process.env.X`, arquivo de exemplo com placeholder |
| e-mail ou nome de pessoa | autor genérico ("SelfEvoPI contributors") |

Vale para código, comentário, mensagem de commit, arquivo de log, entrada de
ledger e relatório. Se um segredo precisa existir para o código rodar, ele
morre no `.env` — que está no `.gitignore` blindado, não no histórico.

O hook de regressão (`grupo C`) pega segredo commitado. Ele pegar significa que
o segredo já entrou: rode `git log -p` e trate como vazamento, não como falha de
CI.

---

## 6. Evals

A suíte de evals é o ativo central do projeto: é ela que decide se um artefato
gerado entra ou volta.

```powershell
node evals/run.mjs                    # todas as tarefas
node evals/run.mjs --group A          # um grupo
node evals/run.mjs --task D1-cria-soma
node evals/gate.mjs                   # gate: compara com a baseline
node evals/report.mjs                 # relatório de acerto, latência, tokens
```

### Por que o grupo D custa tokens

Os grupos A e C são **estruturais**: verificam integridade do projeto sem chamar
modelo — rodam de graça, e por isso estão no CI.

O **grupo D é o único que executa o PI de verdade**. Ele gera código, mede
tokens, e depois valida o resultado rodando o arquivo — não olhando a aparência
dele. É o único grupo que prova que o harness funciona de ponta a ponta, e é
justamente por isso que custa: cada tarefa paga uma chamada de modelo.

É também o único grupo que pode reprovar por regressão de qualidade, não por
quebra estrutural. Quando for rodar o gate completo, reserve tempo e saiba que
ele fala com um modelo — não é um teste unitário disfarçado.

---

## 7. Antes de abrir o PR

- [ ] `npm run verify` passa, e você rodou na sua árvore
- [ ] `node evals/gate.mjs` passa (ou você explica por que não rodou)
- [ ] nenhum segredo, token ou caminho pessoal no diff
- [ ] nenhuma área protegida tocada
- [ ] commit em Conventional Commits, com escopo
- [ ] mudança de comportamento com baseline atualizada e justificativa no arquivo

Dúvida sobre o desenho: leia `README.md` e `CHANGELOG.md` primeiro. Eles registram
o que carrega o projeto e o que mudou em cada versão, inclusive para evitar que
você refaça algo que já foi avaliado e descartado.