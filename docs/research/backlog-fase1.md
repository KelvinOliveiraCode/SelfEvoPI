# Backlog FASE 1 — derivado da auditoria (FASE P)

> **Origem:** `docs/research/inspiracoes.md` (decisões ADOTAR/ADAPTAR/CONSTRUIR/DESCARTAR).
> **Regra de ouro herdada da pesquisa:** cada item precisa de **comando de verificação** antes de ser aceito. Sem comando, não é tarefa — é intenção.
> **Donos:** A1–A8 conforme a topologia do Master Prompt.

---

## 1. Ordem de execução (dependências)

```
P0 (verificação de existência)  ──┐
                                  ├─► P1 (fundação + evals) ─► P2 (bake-off) ─► P3 (núcleo)
P0 (docs/links)                   ──┘
```

Bake-off (P2) **não começa** antes de P1 fechar, porque o bake-off precisa da suíte de evals para medir.

---

## 2. Itens

### P0 — Desbloqueio (bloqueia o bake-off)

| ID | Tarefa | Dono | Critério de aceite (comando) |
| :-- | :--- | :--- | :--- |
| P0-1 | ~~Verificar existência, versão e licença dos pacotes não confirmados~~ **Concluído 2026-11-15** | A4 | `pi-agent-orchestrator` 0.2.1 · `@arhen/pi-core-subagent` 1.4.3 · `pi-continual` 0.1.0 · `@rahularya01/pi-essentials` 0.1.0 · `pi-agent-extensions` 0.5.6 — todos MIT e ativos |
| P0-5 | Decidir a base desktop: **Pi-Harness** (Windows x64) vs `Pi Agent Desktop` (Job Objects) | A8 | Decisão registrada em `docs/research/alternativas-windows.md` com justificativa |
| P0-2 | Verificar `Inspect AI` como alternativa de runner de eval | A2 | URL oficial aberta + decisão ADOTAR/DESCARTAR registrada |
| P0-3 | Confirmar requisito mínimo de Node (22.19.1) e registrar em `docs/environment.md` | A1 | `node --version` ≥ 22.19.1 documentado |
| P0-4 | Revisão de código dos pacotes finalistas do bake-off (segurança) | A6 | Checklist de revisão assinado por pacote em `docs/bakeoff-report.md` |

### P1 — Fundação, providers e evals (Fase 0 do plano)

| ID | Tarefa | Dono | Critério de aceite (comando) |
| :-- | :--- | :--- | :--- |
| P1-1 | Estrutura Windows: `git init`, `core.longpaths true`, `.gitignore` blindado, `.pi/harness/` | A1 | `git config core.longpaths` retorna `true`; `git status` limpo |
| P1-2 | Importar **somente** `k1–k4` e `or1–or4` do OpenCode (Windows) + traduzir para formato PI via `pi-ai` | A1 | 8 contas respondem (resposta curta + 1 tool call + streaming); segredos fora do repo; `icacls` aplicado |
| P1-3 | Roteador fino: perfis `orchestrator`/`worker`/`reviewer` + **seleção por modelo** + circuit breaker + teto de tokens | A3 | Simular falha em 1 provider → troca automática; revisor ≠ provider do autor |
| P1-4 | Suíte de evals: 30–50 tarefas determinísticas (Grupos A/B/C) | A2 | `node evals/run.mjs` executa e produz JSON por tarefa |
| P1-5 | Ledger JSONL: acurácia, tokens, TTFT, latência total, **US$/tarefa resolvida** | A2 | `node evals/report.mjs` gera relatório reproduzível (2 execuções, mesma saída) |
| P1-6 | Baseline oficial no PI puro + roteador | A2 | Números publicados em `docs/baseline-f0.md` |
| P1-7 | Telemetria: **ADOTAR `@earendil-works/pi-telemetry`** (não construir) | A2 | Eventos de agente/tool/LLM aparecem no ledger |
| P1-8 | Script de checkpoint/rollback Git + `last-known-good.json` | A1 | `node scripts/checkpoint.mjs create` e `restore` testados em branch descartável |
| P1-9 | GitHub: `gh auth status`, `gh repo create`, branches `main`/`dev`, 8 worktrees | A1 | `git push` OK; `.worktrees/A1..A8` criados |

### P2 — Bake-off (Fase 1 do plano)

| ID | Tarefa | Dono | Critério de aceite (comando) |
| :-- | :--- | :--- | :--- |
| P2-1 | Bake-off orquestração: `pi-subagents` vs `pi-agent-orchestrator` vs `@arhen/pi-core-subagent` | A4 | 1 vencedor por função, com acurácia + tokens extras + latência |
| P2-2 | Bake-off memória: `pi-continual-harness` vs `pi-continual` | A4 | vencedor fixado com versão exata |
| P2-3 | Bake-off essenciais: `pi-mcp-adapter` (lazy), `pi-web-access`, `billion-context` | A4 | `docs/bakeoff-report.md` com tabela comparativa |
| P2-4 | Teste empírico do `billion-context` contra evals | A2 | Só manter se **preservar ou melhorar** acurácia reduzindo tokens |
| P2-5 | Memória persistente em `.pi/harness/` (fatos, convenções, decisões) | A7 | Memória sobrevive a `pi` reiniciado |
| P2-6 | Lazy-loading: carregar schema de ferramenta **só** quando autorizado | A4 | Inspecionar prompt: schema completo ausente até a 1ª invocação |
| P2-7 | Medir cold-start da CLI | A1 | `< 500 ms` medido (média de 10 execuções) |

### P3 — Núcleo Evolutivo (Fase 2 do plano)

| ID | Tarefa | Dono | Critério de aceite (comando) |
| :-- | :--- | :--- | :--- |
| P3-1 | Detector de lacunas (`Observer`): 3 gatilhos (falha 3×, falta de ferramenta, fluxo frágil) | A5 | Lacuna simulada detectada e registrada no ledger |
| P3-2 | `SpecWriter`: contrato curto antes do código (entrada/saída JSON/permissões/o que NÃO pode) | A5 | Spec gerada com seção explícita de restrições |
| P3-3 | Hierarquia de artefatos revisada: ferramenta existente (MCP **ou** CLI/SKILL) → skill → CLI → extensão → MCP novo | A5 | Decisão registrada com justificativa de tokens |
| P3-4 | Sandbox Windows: `--permission` + `--permission-audit` + token restrito + **keep-alive por tarefa** | A6 | Artefato malicioso (rede/disco externo) bloqueado; tarefa com servidor vivo passa |
| P3-5 | Gate estático (Semgrep/ESLint/tree-sitter) | A6 | Payload com `reg.exe`/`Remove-Item -Recurse -Force`/leitura de `.ssh` reprovado |
| P3-6 | Job Objects com política configurável (`kill-tree` vs `keep-alive`) | A6 | Processo filho morto no `kill-tree`; preservado no `keep-alive` |
| P3-7 | Gatekeeper: eval com e sem artefato, **0 regressões** | A2 | Artefato que regride é reprovado automaticamente |
| P3-8 | Rollback automático (`git revert` + ledger) | A6 | Regressão proposital revertida sem intervenção manual |
| P3-9 | `/refine` sobre `pi-continual-harness` (ADAPTAR, não construir) | A7 | Delta aplicado só se vencer o eval |
| P3-10 | Resolver ≥ 3 lacunas reais do Grupo B sem regressão | A5 | Relatório com 3 casos + evals verdes |

---

## 3. Áreas protegidas (ninguém edita sem aprovação humana)

- `evals/` — suíte de avaliação e verificadores.
- `core/governance/` — sandbox, permissões, git recovery, regras de aprovação.
- `scripts/verify-urls.mjs` — gate de integridade de fontes.

---

## 4. Definição de "pronto" (herdada da pesquisa)

1. **Comando de verificação existe e passa.** Sem comando, não está pronto.
2. **Zero regressão** nos evals (acurácia, tokens e latência dentro do baseline).
3. **Revisão cruzada** por agente de provider diferente do autor.
4. **Custo medido** (US$/tarefa resolvida), não apenas acurácia.
5. **Sem segredo** em log, prompt, commit ou relatório.