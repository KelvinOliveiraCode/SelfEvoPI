# SelfEvoPI — estado do projeto

> **Atualizado:** 2026-11-21 · **Versão:** 1.2.4 (`package.json` é a fonte única)
> **Superfície:** apenas a CLI. Inglês é o idioma padrão da interface.
> **Verificação:** todos os comandos abaixo foram executados nesta data.

---

## 1. O que é

Um harness de agente de código **leve, agnóstico, agêntico e auto-evolutivo**.
Não faz fork do motor: acrescenta a ele um roteador multi-provider, uma suíte de
evals com gate de regressão, memória persistente, sandbox Windows nativo e um
núcleo que detecta lacunas, gera o artefato que as fecha e só promove o que não
causa regressão. A característica central é a **adaptabilidade**: o harness é
modelável pelas próprias tarefas e objetivos.

O produto é a CLI. Nada mais.

---

## 2. Números medidos

| Métrica | Valor | Meta | Comando |
|:--|:--|:--|:--|
| Testes unitários | **1041** (1040 passam, 1 skip) | 0 falhas | `npm test` |
| `npm run verify` | **exit 0** | exit 0 | `npm run verify` |
| Evals A/B/C | verdes | sem regressão | `node evals/run.mjs --group A` etc. |
| Integridade de fontes | ok=33, fail=0 | todas 200 | `node scripts/verify-urls.mjs` |
| Cold start da CLI | **~82 ms** média (7 execuções, 80–102 ms) | < 150 ms p95 | `node apps/cli.mjs --version` |
| Acréscimo de prompt | **+499 tok** no teto | < 1.500 tok | `node scripts/measure-selfevopi-overhead.mjs --runs 3` |
| Largura da TUI | ≤ 72 col em todas as telas | ≤ 72 col | medição sobre `--render` |
| Idiomas da interface | en (padrão) + pt | — | `/language` |
| Modelos verificados (capacidades) | 48/48 OK | 0 divergências | `npm run models:check` |
| Modelos com prompt real | 37/48 responderam texto | falhas concentradas em 4 ids | `npm run models:prompt` |
| Tarefa real: app Node | 7,4 s, arquivos criados, tool calling OK | — | tarefa em workspace temporário |
| Tarefa real: site HTML | 9,2 s, arquivos criados, tool calling OK | — | tarefa em workspace temporário |
| Dois subagentes em paralelo | 3,1 s, ambos responderam | — | `runSwarmExecution` |
| ERNIE 5.5 Flash Preview | effort `high` único nos 8 provedores, 8/8 responderam | — | `npm run models:prompt` |

> Os números são fotografias desta data, não garantia de desempenho. Cada linha
> traz o comando que a produziu.

---

## 3. O que a CLI tem hoje

- **Conversa com streaming**, atividade de ferramenta (`⏺` + `⎿` com linhas/KB),
  exibição de falha em cor de falha, raciocínio ocultável com `Alt+T`.
- **Barra de estado** com modo, permissão, modelo, esforço, uso de contexto em
  porcentagem e branch; painel de estado em `Ctrl+O`.
- **Paleta** com filtro por prefixo e fuzzy; `/help` e paleta leem a mesma fonte.
- **Sessões**: listar, carregar, bifurcar (`/fork`), exportar (`/export`),
  desfazer/refazer trocas (`/undo`, `/redo`) e picker com busca e prévia
  (`Ctrl+K`).
- **Inspeção**: `/diff`, `/cost`, `/status`, `/context`, `/mcp`, `/plugins`,
  `/settings`, `/detect`, `/memory`, `/skills`.
- **Enfileiramento**: digitar enquanto o agente trabalha não perde texto;
  `Enter` enfileira e envia ao fim do turno.
- **Shell e contexto**: `!comando` roda direto no workspace; `@arquivo` injeta
  arquivo no prompt.
- **Idioma**: `/language [en|pt]`. Preferência em `~/.pi/agent/cli-locale.json`,
  sobrescrita por `SELFEOPI_LOCALE`. Inglês por padrão.
- **Temas**: três embutidos + três slots custom, degradação honesta para ANSI-256.
- **Agentes**: `/swarm`, `/subagent`, A2A, lista de atividade (`Ctrl+P`),
  worktrees (`/worktree`).

---

## 4. O núcleo auto-evolutivo

`detect → specify → generate → verify → gate → promote / revert`, com cada
etapa injetável. Hierarquia de artefatos, do mais leve ao mais pesado:

| Kind | Como é testado |
|:--|:--|
| `mcp-config` | JSON válido + chaves |
| `skill` | existe e descreve a capacidade |
| `cli` | sonda com as flags do contrato |
| `mcp-server` | sonda JSON-RPC 2.0 sobre stdio |
| `extension` | sonda importa com host falso |

A sonda por kind substituiu o smoke test: um CLI que lia argumentos posicionais
em vez das flags do contrato foi promovido pelo smoke test e desfeito depois.
A sonda pega isso antes.

---

## 5. Segurança

- Gate estático (13 regras), Permission Model do Node e contenção de árvore de
  processos.
- Arquivos protegidos: `evals/` e `core/governance/` — o loop não os edita.
- Rede, credenciais e escrita fora do workspace pausam para aprovação humana
  específica.
- Nenhum segredo é impresso, logado ou comitado.

---

## 6. Limites honestos

| Item | Situação |
|:--|:--|
| `/btw`, keybindings customizáveis, hooks e barra de progresso no título | não implementados: exigem roteamento de modelo auxiliar ou camada de config que ainda não existe. Decisão registrada em `round2.md`. |
| Recuperação de skills é lexical | busca por termo em texto e tags, sem embeddings. |
| Auto-disparo do loop evolutivo | `core/forge/auto.mjs` já faz `--once`/`--watch` com dry-run por padrão e travas; falta reagir a eventos externos (webhook, fila, ticket). |
| Grupo B do gate com chamadas reais de modelo | não roda no CI; fica local para quem tem credencial. |
| 4 modelos do catálogo não devolvem texto ao prompt mínimo | `stealth/crouton-alpha`, `thinkingmachines/inkling-2-small`, `inclusionai/ling-3.2-flash` e `liquid/lfm-3-1.7b` terminam `settled` sem texto em parte dos provedores. A CLI recupera `get_last_assistant_text`; quando ainda assim vem vazio, é comportamento do provedor, não divergência de capacidade. |

---

## 7. Como verificar

```powershell
npm test
npm run verify
node evals/gate.mjs
node apps/cli.mjs --render status
node apps/cli.mjs --render palette
node core/forge/cli.mjs status
node scripts/daily.mjs --dry-run
```
