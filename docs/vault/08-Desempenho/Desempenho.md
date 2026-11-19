---
tags: [desempenho, números]
created: 2026-11-19
---

# Desempenho

> Números medidos, com data e comando.

Medidos em 2026-11-18 no HEAD ee74ed9; testes atualizados em 2026-11-19 no HEAD 01a360c (v1.1.3).

| Métrica | Valor | Meta | Comando |
|:---|:---|:---|:---|
| Cold start, só a CLI | **91 ms** média (mín 82, máx 98) · 7 execuções | < 500 ms | `node apps/cli.mjs --version` |
| Cold start, só o motor | **473 ms** mediana · 1,0–1,8 s na 1ª execução | — | `scripts/measure-overhead.mjs` |
| Prompt do PI puro | **8.685 tok** | — | `node scripts/measure-selfevopi-overhead.mjs --runs 3` |
| Incremento do SelfEvoPI | **+506 tok** (memória no teto) | < 1.500 tok | idem |
| `pi-subagents` (sob demanda) | +1.659 tok | — | idem |
| Evals | **86/87 baseline (98,85%)** · B11 é estocástico | sem regressão | `node evals/gate.mjs` |
| Testes unitários | **961** (960 passam, 1 skip: integração pi-harness) | — | `npm test` (medido em 2026-11-19, HEAD 01a360c, v1.1.3) |
| Integridade das URLs | **ok=33, fail=0** | todas 200 | `node scripts/verify-urls.mjs` |
| Módulos de produção | **65** | — | `Get-ChildItem -Recurse -Filter *.mjs` (apps+core+scripts, excl. testes) |
| Linhas de produção | **18.869** | — | idem |
| Arquivos de teste | **56** | — | `*.test.mjs` |
| Linhas de teste | **10.458** | — | idem |
| Custo | US$ 0,00 (free tier) | — | ledger |
| Verificação de um comando | **exit 0** | — | `npm run verify` |
| Agendamento diário | **SelfEvoPI-Daily** (07:00, Windows Task Scheduler) | — | `node scripts/schedule.mjs --status` |

## Notas

- B11-html-extract é estocástico (2/3 baseline, 3/3 em execução recente)
- O grupo B mistura structural e real: B9/B10/B11 chamam modelo (32.298 tok) e por isso o CI não roda o grupo B
- Job Objects e keep-alive do sandbox foram avaliados e descartados com número na mesa (ver `docs/fase2/sandbox.md`)

Ver [[04-Features/Features]] para como reproduzir.