# CONTRATO — SelfEvoPI 1.1 (TUI polida + integrações)

> Escrito pelo orquestrador. Todo subagente LÊ antes de escrever.
> Divergir daqui é erro, mesmo que "funcione".

## 0. O que muda nesta rodada

O produto tem **duas faces e só duas**: a CLI (terminal) e o desktop (janela).
O painel de métricas `/panel` do desktop **sai** — quem baixar não vê bancada
de teste, vê o produto.

Faltam na CLI: `/effort`, `/mode`, `/theme`, `/settings`, `/swarm`, o logo ASCII,
o seletor de `/model` com provedores, e as skills/MCPs da máquina.

## 1. Integrações com a máquina do usuário

### 1.1 Skills

O OpenCode guarda skills em `~/.config/opencode/skills/<nome>/SKILL.md`
(**331** nesta máquina). O frontmatter é:

```yaml
---
name: accessible-html
description: HTML acessivel em artefatos de design web (foco, contraste, teclado).
compatibility: opencode
---
```

O `/skills` do SelfEvoPI hoje lê `.pi/harness/memory/skills.jsonl` (skills que o
loop gerou) e por isso as suas não aparecem. Ele passa a ler **as duas** fontes e
dizer de onde cada uma veio: `loop` (gerada aqui) ou `pc` (do OpenCode).

### 1.2 MCP

`~/.config/opencode/opencode.jsonc` tem `mcp.servers`. Cada entrada:

```jsonc
"cadcraft": {
  "type": "local",
  "command": ["C:/Program Files/CADCraft/cadcraft-cli.exe", "mcp"],
  "cwd": "C:/Users/Kelvin/Desktop",
  "environment": { "PYTHONUTF8": "1" },
  "timeout": { "startup": 60000, "catalog": 120000, "execution": 300000 }
}
```

O arquivo é **JSONC**: tem comentários. Não use `JSON.parse` cru — remova
comentários antes, e falhe com mensagem clara se não conseguir.

## 2. Módulos e donos (arquivos disjuntos)

| Agente | Arquivo que escreve | Exporta |
|:--|:--|:--|
| A4 | `apps/cli.mjs` | `/model` picker, `/effort`, `/mode` |
| A8 | `core/agent/banner.mjs`, `core/agent/theme.mjs` | logo ASCII, temas |
| A3 | `core/agent/settings-view.mjs` | `/settings` |
| A7 | `core/agent/skills-pc.mjs` | skills do OpenCode |
| A6 | `core/agent/mcp-opencode.mjs` | MCPs do OpenCode |
| A9 | `core/agent/swarm.mjs` | orquestrador swarm |
| A5 | `scripts/desktop.mjs` | remove `/panel` |
| A2 | testes novos | — |

**Ninguém além do A4 toca `apps/cli.mjs`.** Os outros escrevem o módulo e o
teste; eu ligo o comando na CLI (uma linha cada) na integração.

## 3. O que cada comando tem que fazer

### `/model` (A4)
Abre um seletor na TUI:
1. Lista provedores como seções, modelos como itens.
2. `↑`/`↓` navegam, `enter` escolhe, `esc` cancela.
3. Depois do modelo, pergunta o **esforço** (só os níveis que aquele modelo aceita).
4. `/model <nome>` direto continua funcionando (pula o seletor).

### `/effort` (A4)
`off|low|medium|high` — e aceita os nomes que o modelo em uso realmente expõe.
Modelos diferentes têm categorias diferentes; leia do provedor, não imponha.

### `/mode` (A4)
Alterna entre `plan → build → manual → ask → goal`. Mostra o modo novo e
explica em uma linha o que ele permite. `/plan /build /ask` continuam indo
direto ao modo.

### `/theme` (A8)
Troca a paleta da TUI. Temas: `escuro` (padrão), `claro`, `alto-contraste`.
Persiste. Nada de cor decorativa: o tema muda o que a TUI usa, não o que ela é.

### Logo ASCII (A8)
Wordmark em ASCII, alinhado, com o `v1.1.0` ao lado. Nada de arte gigante:
cabe em 72 colunas.

### `/settings` (A3)
Uma visão única do estado: modo, permissão, modelo, esforço, tema, MCPs
conectados, skills encontradas. Cada linha diz o comando que a muda.

### `/swarm` (A9)
`/swarm <tarefa>` — o modelo principal cria N subagentes, distribui a tarefa,
coleta e sintetiza. N configurável (`/swarm <n> <tarefa>`). Subagente nasce de
qualquer provedor configurado; o principal escolhe. Precisa dizer o que cada
subagente fez, com o que ele voltou.

## 4. Restrições

1. **Zero dependência npm.** Só `node:`. Nada de `dependencies` no `package.json`.
2. **Windows nativo.** Sem Docker, WSL, VM.
3. **Nunca** imprimir, commitar ou logar chave/segredo — inclusive
   `~/.pi/agent/auth.json`, `~/.pi/agent/models.json` e as chaves do opencode.
4. **Não invente número.** Métrica sem data é afirmação.
5. **Sem teste demorado.** Nada de suíte completa, nada de clone, nada que
   passe de ~60 s. Teste o módulo que você escreveu e pare.
6. **Não toque** em `evals/`, `core/governance/`, `core/sandbox/`.
7. Não renomeie ID, classe ou função que outro arquivo use.

## 5. Gate de cada entrega

Rode e cole a **última linha**:

```
node --test <seu arquivo>.test.mjs
```

Quem mexer em `apps/cli.mjs`:
```
node apps/cli.mjs --render status
```

Quem mexer no desktop:
```
node scripts/desktop.mjs --no-open --port 7899
```
(confira `/` responde 200 e `/panel` responde 404; encerre depois)

## 6. Reporte

`R=<arquivos> | GATE=<ultima linha> | NOTA=<o que ficou de fora, se ficou>`