# Vault — índice navegável do SelfEvoPI

Esta pasta **não é a fonte de verdade**. É uma camada de navegação por cima da
documentação em `docs/`, da pesquisa em `docs/research/` e do próprio código.
Se o código mudar, a vault é reescrita a partir das fontes — nunca o contrário.

## Como usar

Abra esta pasta como cofre no Obsidian. O cofre depende apenas de uma subpasta
`.obsidian/` com configuração mínima; todo o conteúdo é Markdown com
`[[wikilinks]]` e frontmatter (`tags`, `fonte`).

- `00-Mapa.md` é a porta de entrada.
- O grafo nativo do Obsidian mostra as relações entre notas.
- `10-Glossario.md` resolve termos do projeto.

## Estrutura

| Pasta / nota | O que tem |
|:--|:--|
| `00-Mapa.md` | índice geral: o que existe e por onde começar |
| `01-Arquitetura/` | camadas, fluxo de eventos, fronteiras de responsabilidade |
| `02-Componentes/` | CLI, roteador, forge, sandbox, memória, grafo, governança |
| `03-Comandos/` | comandos de barra e atalhos da CLI |
| `04-Features/` | o que existe, como usar, o que ainda falta |
| `05-Decisoes/` | decisões com data, evidência e gatilho de reavaliação |
| `06-Pesquisa/` | fontes primárias e o que cada uma sustentou |
| `07-Inspiracoes/` | Claude Code, OpenCode, Cursor, Zed, Warp e outros |
| `08-Desempenho/` | números medidos, com data e comando de reprodução |
| `09-Replicacao/` | como montar o projeto do zero, passo a passo |
| `10-Glossario.md` | termos e siglas do projeto |
| `11-Handoff/` | estado atual para quem continua o trabalho |

## Fontes de verdade

1. `README.md` — visão do produto e uso da CLI.
2. `docs/produto.md` — dossiê detalhado (tese, arquitetura, comandos, segurança).
3. `docs/estado.md` — números medidos e limites honestos.
4. `docs/design/CONTRATO-1.1.md` e `docs/design/superficies.md` — gramática da interface.
5. `apps/cli.mjs` e `core/` — comportamento executável.

## Como verificar a vault

```powershell
node -e "const fs=require('fs'),p='docs/vault';const f=[];(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const q=d+'/'+e.name;if(e.isDirectory())w(q);else if(e.name.endsWith('.md'))f.push(q)}})(p);console.log('notas:',f.length);console.log('com wikilink:',f.filter(x=>/\[\[/.test(fs.readFileSync(x,'utf8'))).length)"
```

Rode a partir da raiz do repositório.
