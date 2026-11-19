# Fase 5 — Evolução contínua (refine evidenciado + relatório semanal)

> **Agente:** A7 — Memória e Refine
> **Status:** implementado (`scripts/refine-loop.mjs`, `scripts/weekly-report.mjs`)
> **Base:** Fase 2 (memória em 3 níveis + refine por regras). Esta fase é a **rotina**
> disciplinada que usa aquela base.

## 1. O que esta fase entrega

A memória já existia e era testada, mas nada a usava de forma disciplinada. A Fase 5
adiciona duas rotinas de linha de comando:

| Script | Papel |
|:---|:---|
| `scripts/refine-loop.mjs` | roda um ciclo de `/refine` com evidência: propõe deltas, aplica com `--apply`, e **re-roda o gate** — delta só sobrevive se não piorar os evals |
| `scripts/weekly-report.mjs` | gera o relatório semanal (taxa de sucesso, tokens/tarefa, latência, lacunas resolvidas, reversões) |

Ambos são determinísticos, sem modelo, sem rede.

## 2. Como rodar

### Refine (loop de memória)

```bash
# dry-run (default): só mostra o que mudaria, não escreve nada
node scripts/refine-loop.mjs --dry-run

# aplica e valida no gate (gate real: node evals/gate.mjs --runs 1)
node scripts/refine-loop.mjs --apply

# aplica e grava relatório
node scripts/refine-loop.mjs --apply --report

# saída JSON compacta
node scripts/refine-loop.mjs --dry-run --json

# nível e diretórios alternativos (útil em teste)
node scripts/refine-loop.mjs --level session --memory-root /tmp/mem --ledger /tmp/ledger.jsonl
```

Comportamento:

1. lê o ledger (`.pi/harness/ledger/evals.jsonl`) e a memória atual do nível (`--level`, padrão `project`);
2. chama `proposeDeltas({ entries })` para ver o que **poderia** mudar;
3. **sem `--apply`** (dry-run é o default): só mostra. Nada é escrito, o gate **não** roda;
4. **com `--apply`:** aplica via `applyDeltas` e re-roda o gate;
   - **gate verde** → mantém o delta;
   - **gate vermelho** → **desfaz** (regrava o estado anterior do nível) e registra a reversão;
5. grava relatório em `.pi/harness/reports/refine-<timestamp>.md` quando `--report` é dado.

### Relatório semanal

```bash
node scripts/weekly-report.mjs
# grava .pi/harness/reports/weekly-<timestamp>.md
node scripts/weekly-report.mjs --out .pi/harness/reports/weekly-teste.md
node scripts/weekly-report.mjs --json
```

Gera um markdown com: taxa de sucesso (por grupo e total), tokens por tarefa (média e
pior caso), latência média, lacunas resolvidas (entradas ativas em `skills`) e reversões
(rollbacks registrados no ledger).

### Agendamento (manual ou automático)

- **Manual:** rode os dois comandos quando quiser. O refine com `--apply` é seguro por
  desenho — reverte sozinho se o gate piorar.
- **Agendado:** um agendador (cron do Windows, `schtasks`, ou o próprio loop do Forge)
  pode chamar `node scripts/refine-loop.mjs --apply` diariamente e
  `node scripts/weekly-report.mjs` uma vez por semana. Como o refine é idempotente e
  revertível, rodar em horário fixo é seguro.

## 3. O que a rotina NUNCA faz

- **Nunca edita `evals/`.** O gate é chamado como subprocesso (`node evals/gate.mjs`),
  não importado — zero acoplamento e zero escrita em área protegida.
- **Nunca edita `core/forge/` nem `core/governance/`.** Só lê a memória e o ledger.
- **Nunca aplica um delta que piore os evals.** Se o gate regride, o estado anterior é
  restaurado e a reversão é registrada no relatório.
- **Nunca remove entrada por índice.** A poda de linhas corrompidas é condição do
  `applyDeltas` (remove inválidas), não seletor de posição — regra da Fase 2.
- **Nunca roda o gate completo (3 execuções) em teste.** O runner de gate é injetável
  (`opts.runGate`); os testes usam um runner sintético que devolve sucesso/falha.

## 4. A regra de ouro

> Um delta de memória só sobrevive se **não piorar** os evals.

É o que separa a Fase 5 de um "faz o que quiser com a memória": a poda de duplicatas e
entradas vazias é tentada, mas o gate é a autoridade final. Se a limpeza derrubar uma
tarefa que passava, ela é desfeita e o relatório registra a reversão para auditoria.

## 5. Integração com o resto do sistema

- **Memória (A7, Fase 2):** `store.mjs` (3 níveis, JSONL) e `refine.mjs`
  (`proposeDeltas`/`applyDeltas`) são a base. A Fase 5 só os orquestra.
- **Evals (A2):** o gate `evals/gate.mjs` é a autoridade de regressão. A Fase 5 o chama
  via `spawnSync`, nunca o importa.
- **Ledger:** `.pi/harness/ledger/evals.jsonl` é a fonte de verdade das execuções. Tanto
  o refine quanto o relatório semanal o leem.
- **Relatórios:** `.pi/harness/reports/` concentra os artefatos gerados
  (`refine-<ts>.md` e `weekly-<ts>.md`).

## 6. Verificação

```bash
# testes (memória + scripts)
node --test core/memory/*.test.mjs scripts/*.test.mjs

# dry-run (não escreve nada)
node scripts/refine-loop.mjs --dry-run

# relatório semanal
node scripts/weekly-report.mjs --out .pi/harness/reports/weekly-teste.md
```

Saída esperada: todos os testes passam; o dry-run lista os deltas propostos sem aplicar;
o relatório semanal é criado com taxa de sucesso, tokens/tarefa, latência, lacunas e
reversões.

## 7. Critério de aceite

- `node --test core/memory/*.test.mjs` sai 0.
- `node scripts/refine-loop.mjs --dry-run` sai 0 e não escreve nada.
- `node scripts/weekly-report.mjs --out <arquivo>` sai 0 e cria o relatório com conteúdo.
- `applyDeltas` idempotente (2ª passada remove 0).
- Gate vermelho reverte (estado anterior restaurado).