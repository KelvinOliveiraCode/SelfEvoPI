# Fase 0 — Providers, Git e ambiente

## O que está pronto

| Item | Estado | Evidência |
|:---|:---|:---|
| PI Coding Agent | 1.5.2 instalado | `pi --version` |
| Git | `core.longpaths true`, `core.autocrlf false` | `git config --get core.longpaths` → `true` |
| Branches | `main` (estável) + `dev` (integração) | `git branch -v` |
| Worktrees | `.worktrees/A1` … `A8` com branches `agent/A*` | `git worktree list` |
| Repositório | privado, `KelvinOliveiraCode/SelfEvoPI` | `gh repo view` |
| Providers | 8 contas, 48 modelos, todas respondendo | `node scripts/check-providers.mjs` |

## Os 8 providers

| Conta | Gateway | Modelos | Chave |
|:---|:---|:---:|:---|
| `kilo1` | `ai-gateway.kilo.ai/api/v1` | 5 | presente |
| `kilo2` | `ai-gateway.kilo.ai/api/v1` | 5 | presente |
| `kilo3` | `ai-gateway.kilo.ai/api/v1` | 5 | presente |
| `kilo4` | `ai-gateway.kilo.ai/api/v1` | 5 | presente |
| `or1` | `openrouter.ai/api/v1` | 7 | presente |
| `or2` | `openrouter.ai/api/v1` | 7 | presente |
| `or3` | `openrouter.ai/api/v1` | 7 | presente |
| `or4` | `openrouter.ai/api/v1` | 7 | presente |

Todas as 8 chaves são **distintas** (verificado por fingerprint SHA-256). O modelo `baidu/ernie-5.5-flash-preview:free` está presente nas 8 contas.

## Como regenerar

```powershell
node scripts/import-providers.mjs            # dry-run, nada é escrito
node scripts/import-providers.mjs --apply    # grava ~/.pi/agent/models.json + icacls
node scripts/check-providers.mjs             # GET /models em cada conta (não gasta tokens)
```

O importador:

1. Lê `~/.config/opencode/opencode.jsonc` (remove comentários preservando strings).
2. Extrai somente `kilo1`–`kilo4` e `or1`–`or4`.
3. Converte para o schema oficial do PI (`baseUrl`, `api`, `apiKey`, `models[]`).
4. Faz backup do `models.json` anterior.
5. Aplica `icacls "<arquivo>" /inheritance:r /grant:r "<usuário>:F"`.

## Segurança

- O arquivo real com chaves vive **fora** do repositório: `~/.pi/agent/models.json`.
- O repositório versiona apenas `config/providers.example.json`, com placeholders.
- `.gitignore` bloqueia `*.key`, `.env*`, `credentials.json`, `providers.local.json` e `.pi/agent/`.
- Nenhum script imprime o valor de chave — apenas tamanho e fingerprint truncado.

## Armadilha conhecida

**Não use `%USERNAME%` para conceder ACL.** Em processos de serviço/agente ele pode valer `SYSTEM` enquanto o token real é do usuário logado — o resultado é um arquivo que nem o dono consegue ler. Use `whoami` e corte o domínio:

```js
const account = execFileSync("whoami", { encoding: "utf8" }).trim().split("\\").pop();
```

Foi exatamente isso que aconteceu na primeira tentativa: o `models.json` ficou acessível só para `SYSTEM`, e o PI respondeu `{"status":"invalid","reason":"invalid_state"}` — não porque a chave estivesse errada, mas porque o processo não conseguia ler o arquivo. Corrigido o ACL, o PI passou a responder `{"status":"ready","authType":"api_key"}`.

## Verificação ponta a ponta

```powershell
pi --model "kilo1/nvidia/nemotron-3-ultra-550b-a55b:free" --print "responda exatamente: ok"
# -> ok

pi --model "or1/baidu/ernie-5.5-flash-preview:free" --print "responda exatamente: pronto"
# -> pronto
```

## Próximos passos da Fase 0

- [ ] Roteador com 3 perfis, circuit breaker, retry com backoff e teto de tokens.
- [ ] Suíte de evals determinística (30–50 tarefas, Grupos A/B/C) + ledger JSONL.
- [ ] Baseline oficial no PI puro.