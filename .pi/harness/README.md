# `.pi/harness/` — estado persistente do SelfEvoPI

Tudo que precisa sobreviver entre sessões do PI vive aqui. Nada disto é código-fonte: é estado versionado, revisável e descartável.

## Níveis de memória

| Nível | Onde | O que guarda | Ciclo de vida |
|:---|:---|:---|:---|
| 1. Sessão | memória do agente | contexto da tarefa em curso | termina com a sessão |
| 2. Projeto | este diretório | fatos, convenções, decisões, débitos | sobrevive a sessões |
| 3. Skills | `.pi/skills/` + pacotes | capacidades executáveis indexadas | promovido após passar no gate |

## Arquivos

| Caminho | Papel |
|:---|:---|
| `last-known-good.json` | SHA do último commit com 100% dos evals verdes |
| `decisions.md` | decisões de arquitetura com data e motivo |
| `ledger/` | trilha JSONL de execuções (trajetória, tokens, latência) |
| `tmp/` | rascunho efêmero (ignorado pelo Git) |

## Regras

2. **Artefato promovido** ganha commit atômico aqui e atualiza `last-known-good.json`.
3. **Regressão** dispara `git revert` e marca o artefato como `reverted` no ledger.
4. **Áreas protegidas** (`evals/`, `core/governance/`) não são editáveis pelo loop autônomo.

## Estado atual

Fase P concluída. `last-known-good.json` aponta para o commit inicial verificado pelo gate de fontes (`scripts/verify-urls.mjs`).