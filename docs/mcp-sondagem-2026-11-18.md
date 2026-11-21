# Sondagem dos MCPs do OpenCode — 29 servidores reais

> **Data da execução:** 2026-11-19
> **Máquina:** Windows, Node **24.13.0**
> **Configuração:** `~/.config/opencode/opencode.jsonc`
> **Ferramenta:** `scripts/probe-mcps.mjs` (usa `core/agent/mcp-probe.mjs`)
> **Comando do gate:** `node scripts/probe-mcps.mjs`

---

## 1. Resumo

| Resultado | Quantos | O que significa |
|:---|:---:|:---|
| `ok` | **20** | handshake + catálogo de tools |
| `parcial` | **3** | handshake ok, catálogo não veio no orçamento do probe |
| `remoto` | **2** | servidor remoto: não há processo local para sondar |
| `timeout` | **2** | não respondeu ao `initialize` |
| `erro` | **2** | o processo não abriu (`.cmd` sem shell) |
| **Total** | **29** | |

Com o teto de 8 s do briefing: **20 ok, 3 parciais, 2 remotos, 4 com falha**.

> **Nenhuma das 4 falhas é defeito do SelfEvoPI.** Duas são do probe, uma é lida de
ambiente, uma é lenta. O detalhe está na §4.

---

## 2. A tabela

`node scripts/probe-mcps.mjs` (timeout 8000 ms, paralelo 4):

| nome | tipo | status | tools | ms | motivo |
|:---|:---|:---|:---:|:---:|:---|
| basic-memory | local | timeout | - | 8984 | não respondeu ao initialize em 8000 ms |
| cadcraft | local | ok | 12 | 648 | |
| context7 | local | ok | 2 | 2638 | |
| craft-anything | local | ok | 30 | 703 | |
| deckcraft | local | ok | 25 | 622 | |
| designcraft | local | ok | 26 | 619 | |
| donsetch | local | ok | 4 | 661 | |
| earshot | local | ok | 16 | 4417 | |
| effectcraft | local | ok | 27 | 781 | |
| figcraft | local | ok | 19 | 712 | |
| filmcraft | local | ok | 17 | 762 | |
| gridcraft | local | ok | 22 | 631 | |
| hotmart | remote | remoto | - | 17 | servidor remoto: sem processo local |
| lightcraft | local | parcial | - | 2970 | initialize ok, mas tools/list não respondeu a tempo |
| materialcraft | local | ok | 20 | 1129 | |
| microsandbox | local | erro | - | 49 | spawn EINVAL (`.cmd` sem shell) |
| n8n | local | erro | - | 25 | spawn EINVAL (`.cmd` sem shell) |
| n8n-instance | remote | remoto | - | 46 | servidor remoto: sem processo local |
| open-design | local | ok | 22 | 2512 | |
| pdfcraft | local | parcial | - | 3049 | initialize ok, mas tools/list não respondeu a tempo |
| phone-control | local | ok | 34 | 4682 | |
| photocraft | local | ok | 26 | 1241 | |
| searxng | local | timeout | - | 8420 | não respondeu ao initialize; stderr com aviso do `uv` |
| serena | local | ok | 30 | 5584 | |
| solidcraft | local | ok | 21 | 1549 | |
| soundcraft | local | parcial | - | 2628 | initialize ok, mas tools/list não respondeu a tempo |
| texturecraft | local | ok | 22 | 936 | |
| vectorcraft | local | ok | 33 | 1395 | |
| wordcraft | local | ok | 18 | 588 | |

Somente **nomes** de variáveis declaradas, nunca valores: `earshot` (EARSHOT_THREADS), `microsandbox` (MSB_HOME), `n8n` (N8N_API_KEY, N8N_API_URL, MCP_MODE, LOG_LEVEL, WEBHOOK_SECURITY_MODE, DISABLE_CONSOLE_OUTPUT, npm_config_cache), `phone-control` (PHONE_ALLOW_SHELL, PHONE_PROFILE, PYTHONUTF8), `searxng` (SEARXNG_URL).

---

## 4. O motivo de cada falha

### 4.1 `basic-memory` — lento, não quebrado

```
node scripts/probe-mcps.mjs --only basic-memory --timeout 45000
→ ok, 12 tools, 10501 ms
```

Responde em ~10,5 s. O teto de 8 s do briefing é curto para este servidor. **Não é defeito.**

### 4.2 `lightcraft`, `pdfcraft`, `soundcraft` — catálogo existe, o probe não recebe

Os três são `*-cli.exe` (LightCraft, PdfCraft, SoundCraft) e **respondem ao `initialize`** (o probe marca `parcial`, não `erro`).

Sondados por fora do módulo, com a mesma sequência JSON-RPC:

| Servidor | initialize | tools/list | tools |
|:---|:---:|:---:|:---:|
| soundcraft | 38 ms | 40 ms | **17** |
| lightcraft | 47 ms | 61 ms | **409** |
| pdfcraft | 44 ms | 62 ms | **208** |

Reproduzi o probe do módulo num arquivo isolado (`replica.mjs`, mesma sequência, mesmo ambiente mínimo, mesmo cwd): `initialize: ok em 41 ms` → `tools/list: nada em 5065 ms`. Mandando o `tools/list` **de dentro do handler de stdout** (como o `diag` faz), o catálogo chega em 33–62 ms.

**Conclusão:** os servidores estão sãos; a estratégia de envio do probe (responder ao `initialize` via polling e só então escrever o `tools/list`) não funciona com eles. É defeito do `core/agent/mcp-probe.mjs`, não do MCP. Ver §5, item 1.

### 4.3 `microsandbox`, `n8n` — `.cmd` sem shell

Os dois apontam para `C:/Program Files/nodejs/npx.cmd`. `spawn` no Windows recusa `.cmd`/`.bat` sem `shell: true` (proteção do Node contra injeção de comando), e devolve `EINVAL`. O OpenCode não sofre disso porque ele mesmo lança o processo com o mecanismo certo.

**Não é defeito do servidor.** Ver §5, item 2.

### 4.4 `searxng` — o probe não passa o ambiente que ele precisa

O servidor é `WindowsApps\python.exe` (alias do Microsoft Store) rodando `searxng_mcp.py`. O stderr mostra `[WARNING] Failed to read unmanaged installs: expected str, bytes or os.PathLike object, not NoneType` — é o `uv` reclamando do ambiente.

Teste comparativo, mesmo comando:

| Ambiente | Resultado |
|:---|:---|
| allowlist do probe (PATH, SystemRoot, TEMP, LANG…) | **sai com código 1 em 821 ms**, sem responder |
| ambiente completo do usuário | **responde initialize em 5119 ms** |

**Não é defeito do servidor.** É a allowlist de ambiente do probe. Ver §5, item 3.

> Este foi o servidor que baixou um Python 3.15 para `./Python` dentro do worktree
> durante a sondagem (166 MB). A pasta foi removida; ver §6.

### 4.5 `hotmart`, `n8n-instance` — remotos

Não têm processo local. Não são falha: o probe os marca como `remoto` e eles não derrubam o código de saída.

---

## 5. Defeitos encontrados no `core/agent/mcp-probe.mjs`

Não corrigidos — este pacote era para sondar e relatar.

| # | Onde | O que acontece | Evidência |
|:--|:---|:---|:---|
| 1 | `core/agent/mcp-probe.mjs:597-608` | O `tools/list` é enviado depois do `initialize` resolvido por polling; com `lightcraft`, `pdfcraft` e `soundcraft` o catálogo nunca chega, embora chegue em 40–60 ms quando enviado do handler de stdout | §4.2 |
| 2 | `core/agent/mcp-probe.mjs:499` | `spawn(command, args)` sem `shell`. `.cmd` (npx.cmd) devolve `EINVAL` no Windows | §4.3 |
| 3 | `core/agent/mcp-probe.mjs:57` (`ENV_BASE`) | A allowlist omite `APPDATA`/`LOCALAPPDATA` e as variáveis que ferramentas `uv`/Python usam; o `searxng` morre com código 1 | §4.4 |
| 4 | `core/agent/mcp-probe.mjs:601` | O teto de `tools/list` é `Math.min(2_000, restante)`, fixo. A config do servidor declara `timeout.catalog: 120000` e o módulo ignora | `lightcraft`, `pdfcraft`, `soundcraft` declaram `catalog: 120000` |

---

## 6. Efeito colateral: a pasta `Python/`

Durante a sondagem, o `uv` baixou um **Python 3.15 completo** para `.worktrees/A6/Python` (2401 arquivos, **166,5 MB**, criado às 11:24). Isso não é código do SelfEvoPI e **não pode** entrar no repositório.

A pasta foi removida. Nenhum dos meus 2 arquivos foi commitado junto.

---

## 7. Segurança

- **Nenhum valor de `environment` foi impresso**, em nenhum momento — só nomes de variáveis.
- O probe passa ao filho uma allowlist de ambiente, não o `process.env` do harness.
- `stderr` dos servidores aparece no relatório **como evidência** (é o que explica a falha), e não contém segredo: o do `searxng` é um aviso do `uv`.

---

## 8. Como reproduzir

```powershell
node scripts/probe-mcps.mjs                       # tabela, 8 s por servidor
node scripts/probe-mcps.mjs --json                # saída de máquina
node scripts/probe-mcps.mjs --only serena         # um servidor
node scripts/probe-mcps.mjs --timeout 45000       # teto maior
node scripts/probe-mcps.mjs --concurrency 1       # sequencial
```

Código de saída: `0` se nenhum servidor **local** falhou, `1` caso contrário. Remoto não conta como falha.