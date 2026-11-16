# Fase 0 — Providers, Git e ambiente

## O que está pronto

| Item | Estado | Evidência |
|:---|:---|:---|
| PI Coding Agent | 1.5.2 instalado | `pi --version` |
| Git | `core.longpaths true`, `core.autocrlf false` | `git config --get core.longpaths` → `true` |
| Branches | `main` (estável) + `dev` (integração) | `git branch -v` |
| Worktrees | `.worktrees/A1` … `A8` com branches `agent/A*` | `git worktree list` |
| Repositório | privado, `KelvinOliveiraCode/SelfEvoPI` | `gh repo view` |
| Providers **ativos** | 4 contas (`kilo1`–`kilo4`), 20 modelos | `node scripts/check-providers.mjs` |
| Providers desativados | `or1`–`or4` (OpenRouter, free tier) — ver abaixo | `DISABLED_FAMILIES` em `router.mjs` |

## Os 4 providers ativos

| Conta | Gateway | Modelos | Chave |
|:---|:---|:---:|:---|
| `kilo1` | `ai-gateway.kilo.ai/api/v1` | 5 | presente |
| `kilo2` | `ai-gateway.kilo.ai/api/v1` | 5 | presente |
| `kilo3` | `ai-gateway.kilo.ai/api/v1` | 5 | presente |
| `kilo4` | `ai-gateway.kilo.ai/api/v1` | 5 | presente |

## Por que os `or` saíram do projeto

As quatro contas `or1`–`or4` (OpenRouter, free tier) têm **cota diária de 50 requisições**. Quando esgota, o provider responde **exit 0, corpo vazio e zero token** — uma falha silenciosa que fazia tarefas de modelo real parecerem passar.

Decisão: **nenhum perfil do roteador seleciona a família `or`**. Elas continuam no `models.json` (são chaves do usuário), mas `DISABLED_FAMILIES` em `core/router/router.mjs` as mantém fora da rotação. Se a cota voltar a ser confiável, basta remover `"or"` da lista.

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