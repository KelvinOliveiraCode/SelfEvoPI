# Pesquisa — desktop 1.0 (18/11/2026)

> Feita pelo orquestrador com `donsetch_web_search` + `donsetch_web_fetch`.
> Cada afirmação abaixo tem a fonte que a sustenta. O que não achei está marcado.

## 1. "Já existe?" — sim, o padrão existe

**Fonte:** https://opencode.ai/docs/cli/ (busca 18/11, seção "CLI intro")

> "By default, OpenCode discovers or starts one shared background server for your
> user account. Every local OpenCode client connects to that server, which owns
> sessions, configuration, integrations, permissions, and tool execution."

**O que isso significa para o SelfEvoPI:** a arquitetura certa é **um dono das
sessões, vários clientes**. A OpenCode chegou aí com um servidor por usuário; o
SelfEvoPI já tem o equivalente sem servidor — a pasta
`~/.pi/agent/sessions/<cwd>/` é o dono, e CLI e desktop são clientes dela.

**Decisão:** não copiar o modelo "servidor por usuário". Ele exigiria processo
persistente, descoberta de porta e trabalho de empacotamento que o projeto não
quer (zero dependência, Windows nativo). A visibilidade cruzada vem de graça do
diretório compartilhado — que é o que esta rodada liga.

Outros achados da mesma busca (não aprofundados, ficam como referência de
mercado, não como recomendação):

| Fonte | O que é |
|:--|:--|
| github.com/markes76/claude-code-gui | wrapper desktop não-oficial para Claude Code CLI |
| github.com/NeuralNomadsAI/CodeNomad | GUI para CLI de agente |
| code.claude.com/docs/en/desktop | app desktop oficial (Code como aba) |
| agentsroom.dev/claude-code-gui | "GUI is a graphical interface layered on top of the CLI" |

## 2. Inspiração de interface

**Fonte:** https://code.claude.com/docs/en/desktop (busca 18/11)

Três padrões que valem copiar:

**a) A linha de controle abaixo da caixa de prompt.**
> "Before you send your first message, choose the environment, project folder,
> permission mode, and model in the row under the prompt box"

Ou seja: modo, modelo e permissão ficam **sempre à mão**, não escondidos em
modal. Isso muda o desenho do settings: o que muda com frequência (modo,
modelo) vai para a linha do composer; o resto (padrões, preferências) fica no
painel.

**b) A barra lateral lista sessões e roda várias em paralelo.**
> "The sidebar lists your sessions and lets you run several in parallel."

**c) Estado por sessão, não global.**
> "Each session tracks its own context and changes independently."

## 3. O que eu NÃO verifiquei

- **Não** testei nenhum dos wrappers de terceiros acima. São referência de
  mercado, não recomendação técnica.
- **Não** achei fonte que compare desempenho de Electron × Tauri × WebView2 para
  este caso. Fica em aberto; a escolha atual (Edge em modo `--app`, zero
  dependência) segue valendo por eliminação, não por medição.
- **Não** achei documentação pública do formato de sessão da OpenCode. Só o
  comportamento declarado.