# Changelog

Todas as mudanças notáveis neste projeto são documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
e este projeto adota [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [0.5.0] - 2026-11-17

Primeira versão em que o SelfEvoPI fecha o ciclo completo: detectar uma lacuna,
descrever o que falta, gerar o código, verificar, e só então promover — ou
desfazer tudo se a verificação reprovar.

Reúne o que as fases P, 0, 1, 2, 3, 4 e 5 entregaram.

### Adicionado

**Pesquisa e auditoria (Fase P).** Levantamento do que já existe, do que mudou e
do que ficou por construir, com fontes verificadas. Inclui o gate de integridade
das fontes citadas (`scripts/verify-urls.mjs`), que roda no CI.

**Roteador multi-provider (Fase 0).** Um único comando escolhe entre os
provedores configurados e cai para o próximo quando um deles falha. Backoff,
circuit breaker e retry com reviewer: o roteador segura a fila quando o provedor
responde e volta sozinho quando ele melhora.

**Suíte de evals com gate (Fase 0).** 29 tarefas com verificador automático,
agrupadas pelo que medem: código, lacunas resolvidas, regressão e modelo real. O
gate compara a execução atual com a baseline e reprova qualquer regressão —
incluindo regressão de qualidade, não só de quebra.

**Memória em 3 níveis (Fase 1).** `session`, `project` e `skills`, com teto de
tokens por turno e poda de linhas corrompidas por condição. O artefato promovido
é registrado na memória — sem isso ele existe e ninguém o encontra depois.

**Núcleo de auto-evolução (Fase 2).** O ciclo
`detect → specify → generate → verify → gate → promote/revert`, com cada passo
injétavel e parada honesta quando não há evidência. O detector não inventa
lacuna: sem evidência, não afirma nada. O gerador escreve código real para CLI,
servidor MCP e extensão — e valida com `node --check` antes de gravar.

**Sandbox em 3 camadas (Fase 2).** Gate estático que bloqueia acesso a
credencial, rede, subprocesso e destruição de arquivo antes da execução; Node
Permission Model confinando leitura e escrita ao worktree; e contenção de
processo que derruba a árvore inteira quando a execução termina.

**Grafo de execução com runtime (Fase 3).** Grafo validado com ordem
topológica, executor com timeout e gate humano, checkpoint por nó, pausa e
retomada sem re-rodar o que já passou. Um painel local — ASCII e HTML
autocontido — mostra o andamento lendo o estado das execuções.

**Ponte de estado para o desktop (Fase 4).** Formato git-nativo de
`harness-state`: o que um desktop precisa ler para mostrar o que o grafo está
fazendo, sem que o desktop precise executar nada. A ponte está entregue e
testada; validar contra o aplicativo real fica para quando ele estiver na
máquina.

**Rotina de evolução contínua (Fase 5).** Diagnóstico → aplicação com autogate →
relatório. A rotina desfaz o próprio delta se a aplicação regredir, e não roda o
gate quando não há nada a aplicar.

### Contexto da versão

Métricas **medidas em 2026-11-16** e publicadas em `docs/estado.md`. São
fotografia daquela data, não garantia de desempenho:

| Métrica | Valor medido |
|:---|:---|
| Cold start | 433 ms (mín. 399, máx. 492) |
| Prompt do PI puro | 8.684 tokens |
| Incremento do SelfEvoPI | +501 tokens (memória no teto) |
| `pi-subagents`, sob demanda | +1.654 tokens |
| Evals | 29 tarefas, 87/87 (100%) |
| Testes unitários | 371 |

O orçamento de prompt é requisito, não aspiração: o limite é 1.500 tokens de
acréscimo, e as medições acima são o que mantém o projeto dentro dele. A extensão
de subagentes saiu do prompt padrão e passou a carregar sob demanda — sozinhos,
seus 1.654 tokens estouravam o orçamento.

### Mudanças de comportamento

- **Família de provedores `or` desativada.** O free tier responde `exit 0` com
  corpo vazio ao esgotar a cota — falha silenciosa que o roteador não deveria
  confiar. Gatilho de reavaliação registrado em `docs/fase1/decisoes.md`.
- **A sonda de interface substituiu o smoke test.** Um smoke test que sempre
  passa promoveu um artefato com a interface errada. Agora cada artefato é
  exercitado do jeito que é chamado: um servidor stdio não recebe flags, uma
  extensão não se executa pela linha de comando.
- **Kind sem gerador é erro, não recaída.** Quando nenhuma capacidade casa, o
  artefato honesto é a `skill` (sempre produzível). Recair para `cli` gerava o
  artefato errado com cara de sucesso.
- **`verify.mjs` roda fora do sandbox; o artefato que ele invoca roda dentro.**
  Uma exceção no gate criaria um buraco explorável por renomeação.
- **`pi-subagents` venceu o bake-off, mas ficou sob demanda.** A medição mostrou
  +1.654 tokens por turno sem ganho de acurácia. `billion-context` foi descartado
  pelo mesmo motivo (18.268 → 32.196 tokens, latência +15% a +83%, acurácia
  igual).

### Segurança

- Papel de cada fronteira documentado em `SECURITY.md`: gate estático,
  Permission Model, contenção de processo, política de aprovação, áreas
  protegidas e tratamento de credenciais.
- Política de aprovação pausa para um humano quando algo precisa de rede,
  credencial ou escrita fora do workspace — com uma pergunta específica, não um
  "tem certeza?".
- O Núcleo Evolutivo não edita `evals/` nem `core/governance/`: ele os consome.

### Verificação

```powershell
npm test              # 371 testes unitários
npm run verify        # testes + evals A/C + integridade das URLs
node evals/gate.mjs   # gate completo (grupo D inclui chamada de modelo)
```

[0.5.0]: #050---2026-11-17