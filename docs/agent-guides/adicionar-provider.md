# Adicionar provider, modelo ou effort

## Onde mexer

| Arquivo | Papel |
|:--|:--|
| `~/.pi/agent/models.json` | **config real**, fora do repo. Nunca versionada. |
| `config/providers.example.json` | exemplo versionado, **só placeholder** (`$CHAVE`). |
| `scripts/import-providers.mjs` | importa de OpenCode/PI e enriquece com catálogos públicos (OpenRouter e Kilo). |
| `core/agent/model-metadata.mjs` | deriva `effortLevelsFor()` de `reasoning` + `thinkingLevelMap`. |
| `core/agent/providers.mjs` | `listProviders`, `addProvider`, `removeProvider`, `fetchModels` (via `/providers`). |
| `core/router/` | perfis, retry, circuit breaker, teto de tokens. |
| `core/agent/pi-rpc.mjs` | `listConfiguredModels()` lê só id/nome — nunca chaves. |
| `core/agent/provider-discovery.mjs` | descobre modelos e infere efforts/imagem/variantes a partir de endpoint+chave. |
| `core/agent/models-config.mjs` | leitura/escrita segura de `models.json`, backup e ACL. |
| `scripts/providers-setup.mjs` | assistente interativo e modo agente (JSON/flags). |

## O que não mexer

- **Nunca** coloque `apiKey` real em nenhum arquivo versionado. Use `$ENV_VAR`.
- **Nunca** improvise `thinkingLevelMap`. A lista vem do catálogo público; se
  o catálogo disser `supported_efforts: ["high"]`, o mapa marca `high` como
  string e todos os outros níveis como `null`.
- Não edite `evals/` se o gate reprovar por mudança de comportamento — regenere
  a baseline com justificativa (`node evals/gate.mjs --update`).

## Duas formas de configurar

**Humano (TTY):** rode `node scripts/providers-setup.mjs` sem argumentos. O
assistente pede endpoint, nome da variável com a chave, id do provider e quais
modelos adicionar (`enter` = todos, `f` = free/fast, ou números). Ele mostra
efforts, imagem e variantes antes de gravar.

**Agente (sem TTY):** use flags e JSON:

```powershell
node scripts/providers-setup.mjs --base-url https://gateway/v1 `
  --api-key-env MINHA_CHAVE --json --all            # dry-run
node scripts/providers-setup.mjs --base-url https://gateway/v1 `
  --api-key-env MINHA_CHAVE --json --free-only --apply
node scripts/providers-setup.mjs --add-model id/modelo --provider meu `
  --efforts low,high --image --apply
node scripts/providers-setup.mjs --remove-model id/modelo --provider meu --apply
node scripts/providers-setup.mjs --list --json
```

Também dá para descobrir pela CLI: `/providers discover <url> [ENV_DA_CHAVE]`.

O padrão é **dry-run**; `--apply` grava. A chave nunca aparece na saída — só
`{ present, length }`. `core/agent/provider-discovery.mjs` normaliza catálogos
OpenRouter, Kilo, Nous e genéricos, infere efforts, reasoning, imagem e variantes
`free`/`fast`, e tenta Bearer antes de `X-API-Key`.

## Repositório público vs privado

O repositório público **não vem com provider pré-configurado**. Quem baixar
configura o primeiro provider no início, pelos comandos acima. Overrides
específicos do mantenedor vivem em `config/providers.private.json` (ignorado pelo
Git), lidos por `scripts/import-providers.mjs`. Nunca copie esse arquivo para o
repositório público.

## Passos

1. Descubra os metadados na fonte primária:
   `https://openrouter.ai/api/v1/models` ou `https://ai-gateway.kilo.ai/api/v1/models`.
   Confira `reasoning.supported_efforts`, `architecture.input_modalities`,
   `context_length` e `top_provider.max_completion_tokens`.
2. Rode o importador em seco e depois aplique:
   ```powershell
   npm run providers:dry
   npm run providers:import
   ```
   O importador faz backup, grava com ACL restrita e enriquece os metadados.
3. Se for provider novo de verdade (endpoint novo), use `/providers add <id>
   <baseUrl> [apiKey]` na CLI — `core/agent/providers.mjs` faz a escrita segura.
4. Se um modelo novo precisar de regra especial de effort, acrescente em
   `model-metadata.mjs` **e** no exemplo `config/providers.example.json`.
5. Documente em `docs/estado.md` e no CHANGELOG.

## Verificação

```powershell
npm run models:check          # 48/48 capacidades, 0 divergências
npm run providers:check       # contas e chaves (sem imprimir valores)
node --test core/agent/*.test.mjs
npm run verify
```

Se `models:check` disser `DIVERGE`, a config e o motor discordam: corrija a
config, não o verificador.

## Se quebrar

- `DIVERGE efforts`: restaure o backup `~/.pi/agent/models.json.bak-<timestamp>`
  e reaplique o importador.
- `ERRO Agent is already processing`: um prompt anterior ficou preso; reinicie a
  CLI (cada sessão tem seu próprio processo de motor).
- Modelo sem `reasoning` no config aparece como `off` — isso é correto, não erro.
