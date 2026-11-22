# SelfEvoPI 1.2.6 — pacote organizado

Harness de agente de código **agnóstico, agêntico, leve e auto-evolutivo**.
Uma superfície: a CLI. Inglês por padrão; `/language pt` troca o idioma.

## Como abrir

- Duplo clique em **`SelfEvoPI.lnk`** (ou em `SelfEvoPI.cmd`).
- Ou, na pasta: `node apps/cli.mjs`.
- Para criar o atalho na Área de Trabalho apontando para esta pasta:
  `pwsh instalar-atalhos.ps1`.

Requisitos: Windows, Node ≥ 22.19.1, motor instalado, Git ≥ 2.55 com
`core.longpaths true`. Nada de Docker, WSL ou VM. Zero dependências npm.

## Estrutura desta pasta

| Caminho | Conteúdo |
|:--|:--|
| `SelfEvoPI.cmd` / `SelfEvoPI.lnk` | executável e atalho da CLI |
| `assets/` | ícone e marca |
| `apps/` | REPL, paleta, comandos e testes de interface |
| `core/` | agente, roteador, forge, memória, grafo, sandbox, governança |
| `evals/` | suíte determinística e gate de regressão |
| `scripts/` | importação de providers, medições, verificação de modelos |
| `config/` | exemplo de providers — **sem chaves reais** |
| `docs/` | documentação, pesquisa, design e vault |
| `launcher/` | fontes do lançador |
| `VERIFICACAO.md` | resultados medidos e como reproduzir |

O estado vivo da CLI (`~/.pi/agent/models.json`, sessões e preferência de
idioma) fica fora desta pasta, no perfil do usuário. Nenhuma chave de API faz
parte do pacote.

## Primeiros passos

```
/                 abra a paleta e veja todos os comandos
/evo <meta>       modo principal: o harness evolui rumo à meta
/model            escolha provedor, modelo e esforço
/language pt      troque o idioma da interface
/paste            anexe uma imagem da área de transferência
Ctrl+O            painel de estado
Ctrl+K            sessões com busca e prévia
```

## Documentação

Comece por `README.md`, depois `docs/produto.md` (dossiê completo) e
`docs/estado.md` (números medidos e limites). A vault em `docs/vault/` é um
índice navegável, não fonte de verdade.
