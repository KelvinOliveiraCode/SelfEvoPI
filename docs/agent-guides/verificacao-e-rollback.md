# Verificação, rollback e auto-reparo

## Pirâmide de verificação

| Comando | O que prova | Quando rodar |
|:--|:--|:--|
| `node --test <arquivo>.test.mjs` | o módulo que você escreveu | imediatamente após editar |
| `npm test` | todas as unidades e interfaces | antes de qualquer commit |
| `npm run verify` | testes + evals A/B/C + 33 URLs | antes de PR e sempre na árvore de destino |
| `npm run models:check` | efforts/capacidades dos 48 modelos | após mexer em provider/modelo |
| `node evals/gate.mjs` | gate completo com modelo real | local, quando o comportamento muda |
| `node apps/cli.mjs --render status` | frame headless, ≤ 72 col | após mexer na TUI |

`npm run verify` é exatamente o que o CI roda (`.github/workflows/ci.yml`).
Se passa aqui e falha lá, a diferença é ambiente — investigue, não ignore.

## Interpretando falhas

| Sintoma | Causa provável | Ação |
|:--|:--|:--|
| Teste de largura falhou | linha > 72 ou reticência | use `wrapAnsi`/`capLinhas`, nunca `truncateVisible` na saída |
| `ANSI_balance = 1` | SGR aberto no fim da linha | feche com `\x1b[0m` ao quebrar |
| Gate reprovou | comportamento mudou | legítimo: justifique e `node evals/gate.mjs --update`; não enfraqueça o checker |
| `DIVERGE` em models | config e motor discordam | corrija `models.json`, não o verificador |
| `ERRO Agent is already processing` | prompt anterior preso | reinicie a CLI / chame `abort()` |
| Comando não aparece | fora de `COMMANDS` ou sem chave i18n | adicione nos dois lugares |

## Desfazer

```powershell
git status --short                 # o que mudou
git diff                           # leia o diff, não o resumo
git checkout -- <arquivo>          # descarta mudança não commitada
git revert --no-edit <sha>         # desfaz commit já publicado
npm run verify                     # sempre revalide depois de desfazer
```

Checkpoints usam tags `ckpt/pre-<operacao>` e o estado
`.pi/harness/last-known-good.json`. O LKG só é atualizado **depois** que o
verify passa. Um rollback que reverte limpo mas deixa a suíte vermelha não
conta como recuperação.

Para restaurar config de modelo:
`~/.pi/agent/models.json.bak-<timestamp>` — o importador cria o backup antes de
sobrescrever.

## Protocolo de auto-reparo do agente

1. **Pare.** Não faça outra edição em cima do erro.
2. **Meça.** Rode o menor comando que reproduz a falha, com o hash do commit.
3. **Isole.** `git diff` — a mudança culpada costuma estar nas últimas linhas.
4. **Refute.** Tente explicar a falha de outra forma antes de aceitar a primeira
   hipótese; procure o contraexemplo no código.
5. **Desfaça ou corrija.** Prefira `git checkout --` quando a mudança é sua e
   pequena; `git revert` quando já entrou.
6. **Revalide.** `npm test` e `npm run verify` na árvore de destino.
7. **Registre.** Se a causa era desconhecida, escreva no handoff
   (`docs/vault/11-Handoff/Estado-Atual.md`) o sintoma, a causa e o comando que
   prova a correção.

## Regra final

> Nunca "conserte" um teste para ele passar. Ou o código estava errado, ou o
> teste estava desatualizado — e a segunda opção exige justificativa escrita.
