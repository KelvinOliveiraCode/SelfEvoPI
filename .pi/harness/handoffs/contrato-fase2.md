# Contrato de integração — Fase 2 (loop evolutivo) e Fase 3 (grafo)

> **Para quem lê:** este arquivo é o combinado entre os agentes. Se você implementar
> uma peça, ela precisa respeitar estas assinaturas — é o que permite que o trabalho
> paralelo de A2/A5/A6/A7/A8 se encaixe sem retrabalho.
>
> **Medida de sucesso:** `node --test core/*/*.test.mjs` verde, `node evals/gate.mjs`
> aprovado, e o loop `node core/forge/cli.mjs evolve --task <id>` rodando ponta a ponta.

---

## 1. Modelo de dados

### Gap (lacuna detectada)

```js
{
  id: "gap-<timestamp>-<seq>",
  kind: "tool-missing" | "tool-failing" | "tool-fragile",
  taskId: "D1-cria-soma",
  goal: "string curta do que a tarefa precisava",
  capability: "soma" | "parse-json" | "web-scrape" | ..., // o que faltou
  evidence: ["linha do ledger", "saída de ferramenta"],  // sempre citável
  severity: "low" | "medium" | "high",
  attempts: 3,          // quantas vezes falhou (só faz sentido em tool-failing)
  createdAt: "ISO",
}
```

### ArtifactRequest (pedido de artefato) — já existe em `core/forge/contract.mjs`

```js
createArtifactRequest({ goal, kind, inputs, outputs, permissions, forbidden, tests })
// kind ∈ ["mcp-config", "skill", "cli", "extension", "mcp-server"]
// forbidden: OBRIGATÓRIO e não-vazio
// tests: OBRIGATÓRIO e não-vazio — [{ name, command, expect? }]
```

### ArtifactResult (resultado validado)

```js
validateArtifactResult(result, request) -> { ok, reasons }
// result = { kind, artifactId, tests: [{name, passed}], violations: [], permissionsUsed: [] }
```

### GateReport (resultado do gatekeeper)

```js
{
  pass: boolean,
  targetTask: string,             // tarefa-alvo do gap
  before: { passed, total, tokens, latencyMs },
  after:  { passed, total, tokens, latencyMs },
  regressions: string[],          // taskIds que passavam e deixaram de passar
  deltaTokens: number,
  reasons: string[],
}
```

---

## 2. Assinaturas

### `core/forge/detect.mjs` (A5)

```js
export const GAP_KINDS = Object.freeze(["tool-missing", "tool-failing", "tool-fragile"]);

/** Cria e valida um gap. */
export function createGap({ kind, taskId, goal, capability, evidence, severity, attempts } = {});

/**
 * Detecta lacunas a partir do ledger de execuções.
 * @param {{ ledger: Array, threshold?: number, maxGaps?: number }} opts
 * @returns {{ gaps: Array<gap>, stats: { runs, tasks, toolFailures, fragile } }}
 *
 * Gatilhos:
 *  - tool-failing: mesma ferramenta (ou mesma tarefa) com >= threshold falhas
 *  - tool-missing: objetivo sem capability coberta por nenhuma ferramenta/skill
 *  - tool-fragile: tarefa acima do teto de tokens ou com fluxo marcado como frágil
 */
export async function detectGaps(opts = {});
```

### `core/forge/gatekeeper.mjs` (A5)

```js
/**
 * Roda os evals com e sem o artefato e compara.
 * @param {{ artifactDir, request, runEvals, baseline, toleranceTokens?, runs? }} opts
 *        runEvals: async ({ artifactDir }) => { passed, total, tokens, latencyMs, perTask }
 * @returns {Promise<GateReport>}
 */
export async function runGate(opts = {});

/**
 * Decide promoção a partir de um GateReport.
 * Promove se: tarefa-alvo resolvida E zero regressões E deltaTokens <= tolerância.
 */
export function decidePromotion(report, { toleranceTokens = 0 } = {});
```

### `core/forge/loop.mjs` (A5)

```js
/**
 * Orquestra o ciclo completo: detect -> specify -> generate -> sandbox -> gate -> promote|rollback.
 * @param {{
 *   detect?, specify?, generate?, verify?, gate?, promote?, rollback?,
 *   workDir, onEvent?, ledger?
 * }} deps   // todos injetáveis; defaults vêm dos módulos reais
 * @returns {{ run: (opts?) => Promise<LoopReport>, state: object }}
 *
 * LoopReport = {
 *   gap, request, artifact: { path, files },
 *   gate: GateReport,
 *   outcome: "promoted" | "rejected" | "rolled-back" | "needs-human",
 *   reasons: string[],
 * }
 */
export async function createEvolutionLoop(deps = {});
```

### `core/governance/rollback.mjs` (A6)

```js
/**
 * Reverte um commit/artefato e confirma o estado verde.
 * @param {{ repoRoot, ref, verify, createTag? }} opts
 * @returns {{ ok, reverted: string|null, verified: boolean, tag: string|null }}
 */
export async function rollbackAndVerify(opts = {});

/** Salva .pi/harness/last-known-good.json com o SHA atual (só se verify passar). */
export async function checkpointGood(opts = {});
```

### `core/governance/approval.mjs` (A6)

```js
/**
 * Política de aprovação humana. Pausa quando o artefato pede rede, credenciais
 * ou escrita fora do workspace.
 * @param {{ request, scan }} opts   // scan = resultado de static-gate evaluate()
 * @returns {{ needsHuman: boolean, reasons: string[], questions: string[] }}
 */
export function reviewApproval(opts = {});
```

### `core/graph/runtime.mjs` (A8)

```js
/**
 * Executor com checkpoint persistente por nó e pausa/retomada.
 * @param {{ graph, runNode, store, autoApprove?, timeoutMs? }} opts
 *        store: { save(state), load() }  (default: arquivo JSON em .pi/harness/graph/)
 * @returns {{ run, pause, resume, status, checkpoints }}
 */
export async function createRuntime(opts = {});
```

### `scripts/refine-loop.mjs` (A7) — Fase 5

```js
// Uso: node scripts/refine-loop.mjs [--apply] [--dry-run] [--report]
// 1. lê o ledger de execuções
// 2. chama proposeDeltas + applyDeltas (core/memory/refine.mjs) só quando --apply
// 3. re-roda o gate para confirmar que o delta não causou regressão
// 4. grava relatório em .pi/harness/reports/refine-<timestamp>.md
```

### `scripts/weekly-report.mjs` (A7) — Fase 5

```js
// Uso: node scripts/weekly-report.mjs [--out <arquivo>]
// Gera .pi/harness/reports/weekly-<timestamp>.md com:
// taxa de sucesso, tokens/tarefa, latência média, lacunas resolvidas, reversões.
```

---

## 3. Regras de convivência

1. **Não editar `evals/` nem `core/governance/` a partir do loop evolutivo.** São
   áreas protegidas: só A2 (evals) e A6 (governance) escrevem nelas, e sempre com
   revisão minha.
2. **Nenhum artefato gerado roda dentro do sandbox.** Quem roda é o `verify.mjs`
   (fora), que invoca o artefato (dentro). Ver `docs/fase2/sandbox.md` §7.
3. **Toda saída de ferramenta é JSON compacto** (uma linha, ou paginada). Nada de
   despejar log inteiro no histórico.
4. **Handoff é contrato, não transcrição.** Cada agente lê este arquivo, não a
   conversa do orquestrador.
5. **Teste antes de entregar.** A entrega só é aceita com o comando exato que a
   verifica e a saída dele.