# Fase 2 — Sandbox Windows e Governança

> **Escopo:** as três camadas de isolamento do SelfEvoPI e a política de processos.
> **Implementado:** `core/sandbox/static-gate.mjs` (camada 1) e `core/sandbox/run-sandboxed.mjs` (camada 2). Camada 3 é especificação.

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

### Política de keep-alive por tarefa

Este é o ponto onde a maioria dos harnesses erra. Encerrar a árvore inteira **sempre** parece seguro, mas quebra tarefas legítimas:

> Medição do Harness Leaderboard (nov/2026): o DeepSeek Harness encerra todo processo de background ao terminar. Em três tarefas do Terminal-Bench que exigem um servidor vivo após a saída do agente, passou **2 de 36** — custo de 1,5 a 1,7 ponto por avaliação, maior que sua vantagem real sobre o líder.

A política do SelfEvoPI é **por tarefa**:

| Modo | Quando | Comportamento |
|:---|:---|:---|
| `kill-tree` | padrão | Job Object encerra tudo ao fim da tarefa |
| `keep-alive` | tarefa que deixa serviço no ar | o job sobrevive; um coletor decide quando encerrar |

A decisão pertence a quem declara a tarefa, não ao sandbox. O sandbox executa a política; não a inventa.

## 5. Como as camadas se combinam

```
artefato gerado
   │
   ├─ 1. gate estático ──────► block? descarta, não gasta execução
   │                            warn? segue com registro
   ├─ 2. node --permission ──► fs restrito ao worktree, sem filho, preload fecha a rede
   │                            timeout ⇒ taskkill /T /F na árvore
   └─ 3. Job Object ─────────► kill-tree ou keep-alive, conforme a tarefa
```

Um artefato só é promovido se passar nas três. Falhar em qualquer uma devolve o artefato ao loop com o motivo, e o gatekeeper registra a regressão.

## 6. Estado

| Item | Estado |
|:---|:---|
| Gate estático + 13 regras | implementado, 44 testes |
| Classificação de caminho | implementado |
| Máscara de comentários/literais | implementado |
| Camada 2 (Permission Model + preload + taskkill) | implementado, 15 testes |
| Camada 3 (Job Objects) | especificada |
| Política keep-alive | definida, não implementada |

### Comandos

```powershell
node --test core/sandbox/static-gate.test.mjs      # 44 passam
node --test core/sandbox/run-sandboxed.test.mjs    # 15 passam
```

O teste de timeout mata a árvore e confirma no `after()` que nenhum pid sobreviveu; se sobrasse um, a suíte falha.