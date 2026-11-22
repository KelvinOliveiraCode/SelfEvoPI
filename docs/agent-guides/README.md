# Guias para agentes — índice

Este diretório existe para uma coisa: **reduzir o custo de uma mudança segura**.
Cada guia responde "o que eu toco, o que eu não toco e como eu sei que acertei".

Leia `AGENTS.md` na raiz primeiro. Depois venha aqui.

| Guia | Quando usar |
|:--|:--|
| `mapa-e-dono.md` | antes de qualquer mudança: onde vive cada responsabilidade |
| `adicionar-provider.md` | novo provedor, modelo, effort ou catálogo |
| `adicionar-ferramenta.md` | nova capacidade via Forge (skill, CLI, MCP, extensão) |
| `adicionar-comando.md` | novo comando de barra, picker ou atalho |
| `idioma-e-verbosity.md` | traduzir strings, adicionar nível de detalhamento |
| `conexoes-e-eventos.md` | integrar sistema externo, webhook, fila ou workflow |
| `hooks-e-seguranca.md` | hooks de ciclo de vida, ledger de decisões do gate, novos eventos |
| `invariantes.md` | revisão final: o que nunca pode mudar |
| `verificacao-e-rollback.md` | rodar gates, interpretar falha, desfazer, se reparar |
| `registro.json` | versão machine-readable dos mesmos ponteiros |

## Como usar

1. Escolha o guia pelo tipo de mudança.
2. Siga a ordem: **localizar → editar → verificar → documentar**.
3. Se o gate reprovar, não enfraqueça o verificador: a seção "se quebrar" do
   guia de verificação diz como diagnosticar e desfazer.
4. Se o guia estiver desatualizado, corrija o guia no mesmo commit da mudança —
   ele é parte do contrato, não decorativo.

## Convenção dos guias

Cada guia tem quatro seções fixas:

- **Onde mexer** — arquivos reais, com o que cada um faz.
- **O que não mexer** — areas protegidas e armadilhas.
- **Passos** — sequência curta e executável.
- **Verificação** — comandos que provam que a mudança está correta.
