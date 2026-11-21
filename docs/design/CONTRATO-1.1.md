# CONTRATO — SelfEvoPI 1.2 (CLI polida)

> Escrito pelo orquestrador. Todo subagente LÊ antes de escrever.
> Divergir daqui é erro, mesmo que "funcione".

## 0. O que muda nesta rodada

O produto tem **uma face e só uma**: a CLI. O que não era conversa saiu. A
interface fala inglês por padrão e `/language` troca o idioma.

## 1. Integrações com a máquina do usuário

### 1.1 Skills

Skills do usuário ficam em `~/.pi/skills/<nome>/SKILL.md`. O parser de
frontmatter não depende de nenhum harness específico. `/skills` lê as duas
fontes (loop e máquina) e diz de onde veio cada uma.

### 1.2 MCP

A config fica em `~/.pi/settings.json`, chave `mcpServers`, com compatibilidade
legada `mcp.servers`. O arquivo pode ser JSONC: remova comentários antes de
parsear e falhe com o **número da linha** quando não der.

## 2. Módulos e donos

| Agente | Arquivo que escreve | Exporta |
|:--|:--|:--|
| CLI | `apps/cli.mjs` | REPL, paleta, comandos de barra |
| I18N | `core/agent/i18n.mjs` | `t()`, `getLocale`, `setLocale` |
| TEMA | `core/agent/theme.mjs`, `theme-custom.mjs` | paleta e slots |
| SESSÕES | `core/agent/sessions.mjs` | listar, carregar, bifurcar |
| TESTES | `apps/*.test.mjs`, `core/agent/*.test.mjs` | regressões |

## 3. O que cada comando tem que fazer

### `/model`
Seletor em dois estágios: provedores → modelos → esforço. Setas navegam,
`enter` escolhe, `esc` cancela. `/model <nome>` pula o seletor.

### `/effort`
`off|low|medium|high`, aceitando os nomes que o modelo em uso realmente expõe.

### `/mode`
Alterna `plan → build → manual → ask → goal`, mostrando uma linha do que o modo
permite.

### `/theme`
Troca a paleta. Três temas embutidos mais três slots custom. Nada de cor
decorativa.

### `/language`
`en` (padrão) ou `pt`. Persiste fora do repositório. Troca ajuda, paleta, barra
de estado, painel de estado, configurações, spinner, raciocínio, ferramentas e
mensagens de erro.

### `/settings`
Uma visão única do estado: modo, permissão, modelo, esforço, tema, MCPs,
skills e sessões. Cada linha diz o comando que a muda.

### `/fork`, `/diff`, `/export`, `/undo`, `/redo`, `/copy`, `/reload`
Comandos de sessão e inspeção. Cada um com teste próprio e saída em voz do
produto, nunca com erro cru.

## 4. Restrições

1. **Zero dependência npm.** Só `node:`.
2. **Windows nativo.** Sem Docker, WSL ou VM.
3. **Nunca** imprimir, commitar ou logar chave/segredo.
4. **Não invente número.** Métrica sem data é afirmação.
5. **Nada de suíte demorada** por entrega: teste o módulo que você escreveu.
6. **Não toque** em `evals/`, `core/governance/` ou `core/sandbox/`.
7. Não renomeie ID, classe ou função que outro arquivo use.

## 5. Gate de cada entrega

```
node --test <seu arquivo>.test.mjs
node apps/cli.mjs --render status
```

## 6. Reporte

`R=<arquivos> | GATE=<última linha> | NOTA=<o que ficou de fora, se ficou>`
