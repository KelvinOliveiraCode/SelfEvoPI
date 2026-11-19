# Auditoria da CLI — SelfEvoPI 1.1

> Varredura de bugs e gargalos. Escopo: ler tudo, escrever só `apps/cli-audit.test.mjs`.
> Formato: `F=<arquivo:linha> | SEV=alta|media|baixa | <o que quebra> | <como reproduzir>`
> Data: 2026-11-19 · HEAD de referência: `e29a763`

## Achados

F=core/agent/init.mjs:67 | SEV=media | O rascunho de `/init` cita o motor ("construído sobre o PI Coding Agent"), ferindo a regra de marca "nunca cite o motor em string de saída" | `node apps/cli.mjs` → `/init`

F=apps/cli.mjs:1328 | SEV=media | `/goal <arg>` ecoa o argumento cru sem teto de largura; um argumento longo (ou colado) estoura as 72 colunas e suja a tela | `/goal ` + 400 caracteres → a linha "goal definida: …" passa de 72 col

F=apps/cli.mjs:1224 | SEV=media | `runSessions` chama `sessionDir()` sem cache; cada `/sessions`, `/cost`, `/compact` varre as subpastas de `~/.pi/agent/sessions` e lê o 1º `.jsonl` de cada (≈109 ms, 159 leituras nesta máquina; 741 subpastas / 975 arquivos) | meça: abrir a lista de sessões e cronometrar; ou `/cost` repetido

F=apps/cli.mjs:1143 | SEV=baixa | `readSessionExtras` abre e lê até 256 KB de **cada** `.jsonl` do projeto para extrair `client` + 1ª mensagem; o custo escala com o nº de sessões e soma-se ao `sessionDir()` não cacheado | `/sessions` (overlay Ctrl+K) num projeto com muitas sessões

F=apps/cli.mjs:2415 | SEV=baixa | `--render menu` não existe (sai 2); a varredura pediu a tela `menu`, mas o contrato 1.1 não a lista — provável tela presumida, não violación de contrato | `node apps/cli.mjs --render menu`

## Saneamento (não são bugs)

- `--render` de `status`, `panel`, `busy`, `palette`, `help` sai 0 e ≤72 col (medido 74–100 ms por chamada, dominado pelo boot do Node; sem gargalo).
- Comando com argumento vazio / lixo / muito longo: **nenhum** lança exceção crua — todos respondem em voz de produto (`/skills`, `/memory`, `/model`, `/cost`, `/context`, `/status`, `/mcp`, `/sessions`, `/compact`, `/goal`, `/plan`, `/build`, `/ask`, `/forge`, `/init`, `/comando-inexistente`).
- `sessionDir()` não é exportado (só testável via `runSlash`/`readSessionExtras`); o overlay (Ctrl+K) já usa `sessionsDirCache`, mas o caminho `/sessions` (linha 1224) não — por isso o gargalo persiste.

## Severidade (contagem)

- alta: 0
- media: 3  (init.mjs:67, cli.mjs:1328, cli.mjs:1224)
- baixa: 2  (cli.mjs:1143, cli.mjs:2415)

## Regressões (apps/cli-audit.test.mjs)

Cada bug tem um teste que afirma o comportamento **correto**; enquanto o bug existir, o teste falha e nomeia o bug; corrigido o código, o teste passa sozinho (sem afrouxar asserção).

- `BUG1 /goal ecoa argumento sem teto (deveria truncar em 72 col)` — FALHA agora
- `BUG2 /init não pode citar o motor ('PI Coding Agent') no rascunho` — FALHA agora
- `BUG3 --render menu deveria existir` — FALHA agora
- `GARGALO4 readSessionExtras: listar N sessões pequenas deve ser barato` — PASSA (teto 500 ms; ~100 ms hoje)
- `renders existentes ≤72 col e exit 0` — PASSA

## Não corrigi nada

Conforme a regra: reporto, não conserto. `apps/cli.mjs`, `evals/`, `core/governance/`, `core/sandbox/` intocados. Os 3 bugs de severidade média são a fila do orquestrador.