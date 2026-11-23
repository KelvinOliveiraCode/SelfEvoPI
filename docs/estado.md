# SelfEvoPI — estado do projeto

> **Atualizado:** 2026-11-22 · **Versão:** 1.8.0 (`package.json` é a fonte única)
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
| Testes unitários | **1044** (1043 passam, 1 skip) | 0 falhas | `npm test` |
| `npm run verify` | **exit 0** | exit 0 | `npm run verify` |
| Evals A/B/C | verdes | sem regressão | `node evals/run.mjs --group A` etc. |
| Integridade de fontes | ok=33, fail=0 | todas 200 | `node scripts/verify-urls.mjs` |
| Cold start da CLI | **~82 ms** média (7 execuções, 80–102 ms) | < 150 ms p95 | `node apps/cli.mjs --version` |
| Acréscimo de prompt | **+499 tok** no teto | < 1.500 tok | `node scripts/measure-selfevopi-overhead.mjs --runs 3` |
| Largura da TUI | ≤ 72 col em frames, respostas e saída de comandos | ≤ 72 col | `--render` + logs de tarefas reais |
| Idiomas da interface | en (padrão) + pt | — | `/language` |
| Modelos verificados (capacidades) | 48/48 OK | 0 divergências | `npm run models:check` |
| Modelos com prompt real | 37/48 responderam texto | falhas concentradas em 4 ids | `npm run models:prompt` |
| Sessão na abertura | sempre nova e persistida; retomada só explícita | — | `--resume <id>` / `/resume` |
| Contraste dos papéis de texto | > 7:1 sobre o fundo em todos os temas | ≥ 4,5:1 | teste WCAG em `core/agent/theme.test.mjs` |
| Tarefa real: app Node | 7,4 s, arquivos criados, tool calling OK | — | tarefa em workspace temporário |
| Tarefa real: site HTML | 9,2 s, arquivos criados, tool calling OK | — | tarefa em workspace temporário |
| Dois subagentes em paralelo | 3,1 s, ambos responderam | — | `runSwarmExecution` |
| ERNIE 5.5 Flash Preview | 8/8 provedores responderam; 8 tarefas + 4 tarefas de stress + 72 comandos sem erro de interface | 0 quebras | suíte Ernie (kilo1–4, or1–4) |
| Saída em pipe/CI | zero `\r`/`\x1b[2K`; bloco escrito uma vez | 0 escapes de cursor | logs das 12 tarefas |
| Erro transitivo do modelo | 429 seguido de resposta não vira "não consegui" | 0 falsos negativos | teste em `apps/cli.test.mjs` |
| Hooks de ciclo de vida | 6 eventos, sem shell, timeout, redação; hook real disparou em turno real | 0 falhas fatais | `core/agent/hooks.test.mjs` + teste ponta a ponta |
| Ledger de segurança | decisões `block`/`warn` registradas com excerpt redigido | 0 segredos | `core/sandbox/telemetry.test.mjs` |
| Code Mode | gateway opt-in descobre tools locais em runtime; 7 testes de unidade + 1 de integração | 0 nomes de servidor no repo | `core/agent/code-mode.test.mjs`, `scripts/code-mode-mcp.test.mjs` |
| Reconexão ao modelo | até 5 tentativas; sessão reiniciada após 3 falhas e ao desistir | 0 sessões presas | `apps/cli.test.mjs` |
| Clique no terminal | paleta, seletor, barra de estado, dicas e prompt | 0 cliques virando texto | `parseTerminalReports` em `cli-features.test.mjs` |
| Janela estreita | `frameWidth()` segue as colunas reais; 50 col → 48 úteis, 0 vazamento | ≤ janela | teste de `frameWidth` com `isTTY` simulado |
| Papéis de modelo | 9 papéis, cadeia de fallback, cooldown e escopo por path | 0 mudanças no roteador | `core/router/model-roles.test.mjs` |
| `/rewind` | recorta erros/turnos em nova sessão; original intacta | 0 sobrescritas | `core/agent/rewind.test.mjs` + `apps/cli-rewind.test.mjs` |
| Papéis na TUI | `/role` troca papel, status mostra `◇`, falha alimenta cooldown | 0 erros de locale | `apps/cli-features.test.mjs` |
| LSP | cliente zero-dep + `/lsp` (diagnostics/symbols/hover/rename) | 0 segredos no filho | `core/agent/lsp.test.mjs` (6 testes) |

> Os números são fotografias desta data, não garantia de desempenho. Cada linha
> traz o comando que a produziu.

---

## 3. O que a CLI tem hoje

- **Conversa com streaming**, atividade de ferramenta (`┊` + emoji e resultado alinhado),
  exibição de falha em cor de falha, raciocínio ocultável com `Alt+T`.
- **Barra de estado** com modo, permissão, modelo, esforço, uso de contexto em
  porcentagem e branch; painel de estado em `Ctrl+O`.
- **Paleta** com filtro por prefixo e fuzzy; `/help` e paleta leem a mesma fonte.
- **Sessões**: listar, carregar, bifurcar (`/fork`), recortar (`/rewind`),
  exportar (`/export`), desfazer/refazer trocas (`/undo`, `/redo`) e picker com
  busca e prévia (`Ctrl+K`).
- **Inspeção**: `/diff`, `/cost`, `/status`, `/context`, `/mcp`, `/plugins`,
  `/settings`, `/detect`, `/memory`, `/skills`.
- **Enfileiramento**: digitar enquanto o agente trabalha não perde texto;
  `Enter` enfileira e envia ao fim do turno.
- **Shell e contexto**: `!comando` roda direto no workspace; `@arquivo` injeta
  arquivo no prompt.
- **Idioma**: `/language [en|pt]`. Preferência em `~/.pi/agent/cli-locale.json`,
  sobrescrita por `SELFEOPI_LOCALE`. Inglês por padrão.
- **Temas**: doze embutidos + três slots custom, degradação honesta para ANSI-256.
- **Agentes**: `/swarm`, `/subagent`, A2A, lista de atividade (`Ctrl+P`),
  worktrees (`/worktree`). **Papéis de modelo** (`default`, `smol`, `slow`,
  `plan`, `commit`, `advisor`, `vision`, `task`, `tiny`) escolhem o modelo por
  contexto/custo/raciocínio, com fallback, cooldown e escopo por caminho.

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
| `/btw`, keybindings customizáveis e barra de progresso no título | não implementados: exigem roteamento de modelo auxiliar ou camada de config que ainda não existe. Decisão registrada em `round2.md`. Hooks já existem (`.pi/hooks.json`). |
| Recuperação de skills é lexical | busca por termo em texto e tags, sem embeddings. |
| Auto-disparo do loop evolutivo | `core/forge/auto.mjs` já faz `--once`/`--watch` com dry-run por padrão e travas; falta reagir a eventos externos (webhook, fila, ticket). |
| LSP em posições UTF-16 | cliente LSP novo não converte `character` para UTF-16 code units; servidores reais (tsserver/pyright) não verificados |
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
