# Vault do Obsidian — SelfEvoPI

Esta pasta não é a documentação. É o **índice navegável** da documentação.

A documentação de verdade mora em `docs/` (32 arquivos), `docs/research/cli-landscape/`
(11 arquivos com URL e trecho literal), `docs/design/` (contratos) e no próprio
código (`apps/`, `core/`, `scripts/`, `evals/`). A vault **deriva** daí — não é fonte
de verdade, é uma camada de navegação por cima.

## Onde fica

```
C:\Users\Kelvin\Documents\SelfEvoPI-Vault
```

Uma pasta comum do Obsidian. O Obsidian só exige que exista uma subpasta `.obsidian/`
com a configuração mínima (`app.json`, `appearance.json`, `core-plugins.json`). O
restante é markdown com `[[wikilinks]]` e frontmatter.

## O que ela é

Documentação navegável do projeto, com:

- **`[[wikilinks]]`** entre notas — o Obsidian resolve sozinho, sem caminho relativo;
- **frontmatter** com `tags` e `fonte` para filtrar e auditar de onde cada nota saiu;
- **mapa de conteúdo** (`00-Mapa.md`) como porta de entrada;
- **grafo de relações** (o grafo nativo do Obsidian) para ver o que liga em quê.

## Por que existe

Porque o usuário quer **navegar e reencontrar**, não ler um arquivo só. E porque o
projeto é grande e ramificado: são 7 fases, dezenas de arquivos de doc, 11 de
pesquisa, 8 agentes com escopos distintos. Um monte de markdown solto não escala;
uma vault com índice e links, sim.

E porque o conteúdo tem que ser **replicável 1:1 no futuro**: a nota
`09-Replicacao/Replicacao.md` descreve como montar o projeto do zero.

## Estrutura

| Pasta / nota | O que tem |
|:---|:---|
| `00-Mapa.md` | índice geral: o que existe, por onde começar |
| `01-Arquitetura/` | camadas, fluxo, o que é de quem |
| `02-Componentes/` | CLI, desktop, roteador, forge, sandbox, memória, grafo |
| `03-Comandos/` | os comandos da CLI e o que cada um faz |
| `04-Features/` | o que existe, como usar, o que ainda falta |
| `05-Decisoes/` | decisões com data e motivo |
| `06-Pesquisa/` | fontes com URL e o que cada uma sustentou |
| `07-Inspiracoes/` | Claude Code, OpenCode, Cursor, Zed, Warp |
| `08-Desempenho/` | números medidos, com data e comando |
| `09-Replicacao/` | como montar do zero, passo a passo, 1:1 |
| `10-Glossario.md` | termos do projeto |

## Como regenerar

A vault é **derivada** de `docs/` e do código. Não é fonte de verdade — é índice.
Se o código mudar, a vault não muda sozinha: ela é reescrita a partir das fontes.

1. Leia `docs/estado.md` (estado autoritativo).
2. Leia `docs/design/CONTRATO-1.1.md` e `CONTRATO-desktop-1.0.md`.
3. Reescreva as notas uma por vez, com `[[wikilinks]]` entre elas.
4. **Não** copie o "Plano do Projeto" (não existe no repo público e não vai para a
   vault).

## Como verificar

```powershell
# conta notas e quantas têm wikilink (navegação)
node -e "const fs=require('fs');const p='C:/Users/Kelvin/Documents/SelfEvoPI-Vault';const f=[];(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const q=d+'/'+e.name;if(e.isDirectory())w(q);else if(e.name.endsWith('.md'))f.push(q)}})(p);console.log('notas:',f.length);console.log('com wikilink:',f.filter(x=>/\[\[/.test(fs.readFileSync(x,'utf8'))).length)"
```