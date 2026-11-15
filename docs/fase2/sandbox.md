# Fase 2 — Sandbox Windows e Governança

> **Escopo:** as três camadas de isolamento do SelfEvoPI e a política de processos.
> **Implementado:** `core/sandbox/static-gate.mjs` (camada 1). Camadas 2 e 3 são especificação.

## 1. Por que três camadas

Nenhum mecanismo isolado cobre os três modos de falha. Cada um resolve um problema diferente:

| Camada | Mecanismo | O que impede | O que não impede |
|:---|:---|:---|:---|
| **1. Prevenção** | Gate estático (AST/regex) | Que o código perigoso chegue a rodar | Código que engana a análise |
| **2. Contenção** | Node `--permission` + token restrito | Que o processo触触 leia/escreva fora do worktree | Código malicioso — é cinto, não cofre |
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

O Node oferece `--permission` (estável desde 22.13/23.5) com:

- `--allow-fs-read` / `--allow-fs-write` restritos ao worktree
- `--allow-net` **omitido** (sem rede)
- `--allow-child-process` **omitido** (sem subprocesso)
- `--allow-worker` omitido
- API `process.permission.has(scope)` e `process.permission.drop(scope)` (irreversível)

Dois usos práticos:

1. **Modo auditoria** (`--permission-audit`): descobre quais permissões o artefato realmente pede, sem bloquear. Serve para calibrar a allowlist antes de endurecer.
2. **Modo enforce**: nega com `ERR_ACCESS_DENIED`.

**Limite conhecido:** o próprio manual diz que o modelo é um cinto de segurança para código confiável, e que código malicioso pode contorná-lo. Ele precisa vir acompanhado do token de baixa integridade.

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
   ├─ 2. node --permission ──► fs restrito ao worktree, sem rede, sem filho
   │                            auditoria primeiro para calibrar
   └─ 3. Job Object ─────────► kill-tree ou keep-alive, conforme a tarefa
```

Um artefato só é promovido se passar nas três. Falhar em qualquer uma devolve o artefato ao loop com o motivo, e o gatekeeper registra a regressão.

## 6. Estado

| Item | Estado |
|:---|:---|
| Gate estático + 13 regras | implementado, 44 testes |
| Classificação de caminho | implementado |
| Máscara de comentários/literais | implementado |
| Camada 2 (Permission Model) | especificada |
| Camada 3 (Job Objects) | especificada |
| Política keep-alive | definida, não implementada |