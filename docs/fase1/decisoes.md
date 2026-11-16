# Fase 1 — decisões tomadas e evidência

> **Data:** 2026-11-16
> **Autorização:** decisões recomendadas aplicadas; família `or` mantida desativada.

---

## 1. `verify.mjs` × gate estático

**Decisão:** o `verify.mjs` gerado pelo Forge roda **fora** do sandbox; o artefato que ele invoca roda **dentro**.

**Motivo:** o sandbox existe para conter o artefato, não o testador. Abrir exceção no gate para arquivos chamados `verify.mjs` criaria um buraco que qualquer artefato poderia explorar renomeando-se.

Detalhe completo em `docs/fase2/sandbox.md` §7.

---

## 2. Linhas corrompidas de JSONL

**Decisão:** podar entradas inválidas quando o `applyDeltas` encontra um `drop` sem id.

**Motivo:** `store.query()` esconde entradas inválidas e ordena por data — índice de posição não corresponde ao arquivo. Remover por condição (`invalid: true`) é determinístico e independente de ordem.

**Correção adicional:** `store.query()` ganhou `includeInvalid: true`, para que a manutenção consiga ver o que vai podar.

Teste: `core/memory/refine.test.mjs` → 9/9.

---

## 3. Família `or` desativada

**Decisão:** mantida fora da rotação.

**Motivo:** OpenRouter free tier = 50 req/dia; ao esgotar responde **exit 0, corpo vazio, zero token** — falha silenciosa que faz tarefa parecer passar.

**Gatilho de reavaliação:** reauditar se a cota voltar a ser confiável, ou se uma conta paga for adicionada. Reativar é remover `"or"` de `DISABLED_FAMILIES` em `core/router/router.mjs`.

---

## 4. Extensões nos evals — erro de medição encontrado e corrigido

**Descoberta:** os evals rodavam em `os.tmpdir()`, fora do repositório. O PI só procura `.pi/settings.json` no **cwd** e não sobe a árvore. Resultado: as tarefas mediam o **PI puro**, não o harness com extensões.

Medição que revelou o problema:

| Contexto | Prompt |
|:---|:---|
| `os.tmpdir()` | 8.679 tokens |
| subdiretório do repo | 8.684 tokens |
| repo + `--approve` | 10.554 tokens |
| temp + `-e <bundle>` | 10.342 tokens |

**Decisão:** o executor carrega as extensões do projeto explicitamente com `-e` (via `projectExtensions()`), e os workdirs passam a viver em `.pi/harness/tmp/` (ignorado pelo Git).

Antes disso, a afirmação "gate com extensão ativa" era falsa.

---

## 5. `pi-subagents` — custo medido, benefício não medido

Com a extensão ativa, o grupo D passou de ~9.200 para **10.846 tokens** por tarefa, com acurácia **inalterada** (2/2). A baseline inteira subiu de 54.657 para **64.802 tokens**.

**Leitura:** nas tarefas atuais (criar um módulo, corrigir um bug), delegar não ajuda — são tarefas pequenas demais para justificar o overhead. O valor do `pi-subagents` só aparece em tarefas que precisam de revisão paralela ou investigação longa, que ainda não temos nos evals.

**Decisão:** **manter instalado**, porque a Fase 3 (grafo de execução) depende de subagentes, mas **registrar o custo** e reavaliar quando houver tarefas que exijam delegação. O carregamento lazy que ele já faz limita parte do dano.

---

## 6. `billion-context` — mantido o descarte

A2 mediu: acurácia 100% → 100%, tokens 18.268 → 32.196, latência +15% a +83%. **DESCARTAR** conforme o critério do plano.

O `scripts/test-compression.mjs` fica como instrumento reutilizável.

---

## 7. Estado da medição

| Métrica | Valor |
|:---|:---|
| Evals | 14 tarefas, 42/42 |
| Tokens da suíte (com extensão) | 64.802 |
| Testes unitários | 172 |
| Baseline | regenerada em 2026-11-16 |

## 8. Pendências

- [ ] Crescer a suíte para ~25 tarefas que quebrem de verdade (não decorativas).
- [ ] Medir o incremento do prompt do SelfEvoPI (meta < 1.500 tokens).
- [ ] Reavaliar `pi-subagents` quando houver tarefas de delegação.
- [ ] Resolver a política de keep-alive do sandbox (definida, não implementada).