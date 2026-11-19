# Claude Code CLI — Landscape

> **Data da consulta:** 2026-11-17
> **Fonte primária:** [code.claude.com/docs](https://code.claude.com/docs/en/cli-reference) (oficial)
> **Fonte secundária:** [github.com/googlarz/claude-code-commands](https://github.com/googlarz/claude-code-commands) (extração binária, v2.1.92, abril 2026)
> **Fonte terciária:** [smartscope.blog](https://smartscope.blog/en/generative-ai/claude/claude-code-reference-guide/) (guia não-oficial, abril 2026)

---

## 1. Comandos de barra (`/`)

> Comandos são digitados no prompt interativo. A paleta filtra por prefixo. Comandos podem ser `local` (função nativa), `local-jsx` (painel React no terminal), `prompt` (injeção de system prompt + LLM) ou `skill` (workflow SKILL.md).

### Sessão e conversa

| Comando | O que faz | Quando aparece | Fonte |
|:---|:---|:---|:---|
| `/clear` (alias: `/reset`, `/new`) | Limpa histórico da conversa e libera contexto | Sempre | [docs](https://code.claude.com/docs/en/commands) |
| `/compact [instruções]` | Resumo da conversa em contexto, liberando espaço | Sempre | [docs](https://code.claude.com/docs/en/commands) |
| `/branch [nome]` (alias: `/fork`) | Cria ramificação da conversa neste ponto | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/resume [id]` (alias: `/continue`) | Retoma conversa anterior | Sempre | [docs](https://code.claude.com/docs/en/commands) |
| `/rewind` (alias: `/checkpoint`) | Restaura código e/ou conversa a ponto anterior | Sempre | [docs](https://code.claude.com/docs/en/commands) |
| `/rename [nome]` | Renomeia a conversa atual | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/export [arquivo]` | Exporta conversa para arquivo ou clipboard | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/exit` (alias: `/quit`) | Sai do REPL | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/btw <pergunta>` | Pergunta lateral sem interromper a conversa principal | Sempre | [github](https://github.com/googlarz/claude-code-commands) |

### Modelo e performance

| Comando | O que faz | Quando aparece | Fonte |
|:---|:---|:---|:---|
| `/model [modelo]` | Define o modelo de IA (mostra o atual na descrição) | Sempre | [docs](https://code.claude.com/docs/en/commands) |
| `/effort [low\|medium\|high\|max\|auto]` | Define nível de esforço do modelo | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/fast [on\|off]` | Alterna modo rápido (mesmo modelo, saída mais rápida) | Requer capability `fast` | [github](https://github.com/googlarz/claude-code-commands) |
| `/advisor [<modelo>\|off]` | Configura o modelo advisor | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/brief` | Alterna modo brief-only | Gated behind feature flag | [github](https://github.com/googlarz/claude-code-commands) |

### Configuração e settings

| Comando | O que faz | Quando aparece | Fonte |
|:---|:---|:---|:---|
| `/config` (alias: `/settings`) | Abre painel de configuração | Sempre | [docs](https://code.claude.com/docs/en/commands) |
| `/theme` | Muda o tema | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/color <cor>` | Define cor da barra de prompt | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/keybindings` | Abre/cria arquivo de keybindings | Requer suporte de keybinding no terminal | [docs](https://code.claude.com/docs/en/keybindings) |
| `/terminal-setup` | Instala keybindings para Shift+Enter / Option+Enter | Oculto se terminal já suporta nativamente | [github](https://github.com/googlarz/claude-code-commands) |
| `/statusline` | Configura a status line | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/permissions` (alias: `/allowed-tools`) | Gerencia regras de allow/deny de ferramentas | Sempre | [docs](https://code.claude.com/docs/en/commands) |
| `/sandbox` | Configura sandboxing | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/memory` | Edita arquivos de memória do Claude | Sempre | [docs](https://code.claude.com/docs/en/commands) |
| `/hooks` | Visualiza configurações de hooks | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/privacy-settings` | Visualiza/atualiza configurações de privacidade | Requer plano Pro/Max | [github](https://github.com/googlarz/claude-code-commands) |

### Código e Git

| Comando | O que faz | Quando aparece | Fonte |
|:---|:---|:---|:---|
| `/commit` | Cria um commit git | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/commit-push-pr` | Commit, push e abre PR | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/diff` | Visualiza mudanças não commitadas e diffs por turno | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/pr-comments` | Busca comentários de um PR do GitHub | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/security-review` | Revisão de segurança das mudanças pendentes | Sempre | [github](https://github.com/googlarz/claude-code-commands) |

### Planejamento e tarefas

| Comando | O que faz | Quando aparece | Fonte |
|:---|:---|:---|:---|
| `/plan [open\|descrição]` | Ativa plan mode ou mostra o plano atual | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/ultraplan <prompt>` | Plano avançado via Claude Code on the web (10–30 min) | Requer web + feature flag | [github](https://github.com/googlarz/claude-code-commands) |
| `/ultrareview` | Encontra e verifica bugs no branch via web (10–20 min) | Gated behind feature flag | [github](https://github.com/googlarz/claude-code-commands) |
| `/tasks` (alias: `/bashes`) | Lista e gerencia tarefas em background | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/schedule [descrição]` | Cria/atualiza/lista agentes remotos em cron | Sempre | [github](https://github.com/googlarz/claude-code-commands) |

### Diagnóstico e info

| Comando | O que faz | Quando aparece | Fonte |
|:---|:---|:---|:---|
| `/help` | Mostra ajuda e comandos disponíveis | Sempre | [docs](https://code.claude.com/docs/en/commands) |
| `/status` | Status do Claude Code (versão, modelo, conta, conectividade) | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/doctor` | Diagnostica instalação e configurações | Sempre (exceto se `DISABLE_DOCTOR_COMMAND`) | [github](https://github.com/googlarz/claude-code-commands) |
| `/context` | Visualiza uso de contexto como grade colorida | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/cost` | Mostra custo total e duração da sessão | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/usage` | Mostra limites de uso do plano | Apenas claude.ai | [github](https://github.com/googlarz/claude-code-commands) |
| `/stats` | Estatísticas de uso do Claude Code | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/insights` | Gera relatório analisando sessões | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/version` | Mostra a versão em execução | Presente mas desabilitado (`isEnabled: !1`) | [github](https://github.com/googlarz/claude-code-commands) |
| `/release-notes` | Visualiza release notes | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/debug [descrição]` | Habilita debug logging para a sessão | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/copy [N]` | Copia última resposta do Claude para clipboard | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/powerup` | Lições interativas com demos animadas | Sempre | [github](https://github.com/googlarz/claude-code-commands) |

### Integrações e plugins

| Comando | O que faz | Quando aparece | Fonte |
|:---|:---|:---|:---|
| `/mcp [enable\|disable [servidor]]` | Gerencia servidores MCP | Sempre | [docs](https://code.claude.com/docs/en/commands) |
| `/plugin` (alias: `/plugins`, `/marketplace`) | Gerencia plugins do Claude Code | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/reload-plugins` | Ativa mudanças pendentes de plugins | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/skills` | Lista skills disponíveis | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/ide [open]` | Gerencia integrações de IDE e mostra status | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/chrome` | Configurações do Claude in Chrome (Beta) | Apenas claude.ai | [github](https://github.com/googlarz/claude-code-commands) |
| `/install-github-app` | Configura Claude GitHub Actions para repositório | claude.ai + console | [github](https://github.com/googlarz/claude-code-commands) |
| `/install-slack-app` | Instala o app Claude Slack | Apenas claude.ai | [github](https://github.com/googlarz/claude-code-commands) |
| `/init` | Inicializa CLAUDE.md com documentação do codebase | Sempre | [docs](https://code.claude.com/docs/en/commands) |
| `/init-verifiers` | Cria skills de verificação automática | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/add-dir <path>` | Adiciona diretório de trabalho | Sempre | [docs](https://code.claude.com/docs/en/commands) |

### Conta e plataforma

| Comando | O que faz | Quando aparece | Fonte |
|:---|:---|:---|:---|
| `/login` | Login com conta Anthropic (ou troca de conta) | Sempre (exceto `DISABLE_LOGIN_COMMAND`) | [docs](https://code.claude.com/docs/en/commands) |
| `/logout` | Logout da conta Anthropic | Sempre (exceto `DISABLE_LOGOUT_COMMAND`) | [github](https://github.com/googlarz/claude-code-commands) |
| `/upgrade` | Upgrade para Max | Apenas Pro/Max plan | [github](https://github.com/googlarz/claude-code-commands) |
| `/extra-usage` | Configura uso extra para continuar após limites | Requer suporte em `extra-usage` | [github](https://github.com/googlarz/claude-code-commands) |
| `/passes` | Compartilha semana grátis e ganha uso extra | Visível se elegível + cache | [github](https://github.com/googlarz/claude-code-commands) |
| `/rate-limit-options` | Opções quando rate limit é atingido | Apenas quando rate-limited | [github](https://github.com/googlarz/claude-code-commands) |
| `/feedback [report]` (alias: `/bug`) | Envia feedback sobre o Claude Code | Sempre (exceto Bedrock/Vertex) | [docs](https://code.claude.com/docs/en/commands) |
| `/stickers` | Pede stickers do Claude Code | Sempre | [github](https://github.com/googlarz/claude-code-commands) |

### Remoto e cloud

| Comando | O que faz | Quando aparece | Fonte |
|:---|:---|:---|:---|
| `/remote-control` (alias: `/rc`) | Conecta terminal para sessões remote-control | Sempre | [github](https://github.com/googlarz/claude-code-commands) |
| `/remote-env` | Configura ambiente remoto padrão | Requer remote sessions + flag | [github](https://github.com/googlarz/claude-code-commands) |
| `/session` (alias: `/remote`) | Mostra URL/QR code da sessão remota | Requer sessão remota ativa | [github](https://github.com/googlarz/claude-code-commands) |
| `/desktop` (alias: `/app`) | Continua sessão no Claude Desktop | Apenas claude.ai, macOS/Windows | [github](https://github.com/googlarz/claude-code-commands) |
| `/mobile` (alias: `/ios`, `/android`) | QR code para app Claude mobile | Apenas claude.ai | [github](https://github.com/googlarz/claude-code-commands) |
| `/web-setup` | Configura Claude Code on the web | Gated behind feature flag | [github](https://github.com/googlarz/claude-code-commands) |
| `/voice` | Alterna modo de voz | Requer capability de voz | [github](https://github.com/googlarz/claude-code-commands) |

### Skills embutidos (bundled)

| Comando | O que faz | Fonte |
|:---|:---|:---|
| `/batch <instrução>` | Pesquisa e executa mudança em larga escala em 5–30 worktrees paralelos | [github](https://github.com/googlarz/claude-code-commands) |
| `/claude-api` | Carrega referência da API Claude para a linguagem do projeto | [github](https://github.com/googlarz/claude-code-commands) |
| `/loop [intervalo] <prompt>` | Roda prompt/comando em intervalo recorrente | [github](https://github.com/googlarz/claude-code-commands) |
| `/simplify [foco]` | Revisa arquivos recentes para reuso, qualidade e eficiência | [github](https://github.com/googlarz/claude-code-commands) |

### Removidos / deprecados

| Comando | Status | Versão | Substituto | Fonte |
|:---|:---|:---|:---|:---|
| `/tag` | **Removido** | v2.1.92 | Nenhum | [github](https://github.com/googlarz/claude-code-commands) |
| `/vim` | **Removido** | v2.1.92 | `/config` → Editor mode | [github](https://github.com/googlarz/claude-code-commands) |
| `/output-style` | **Deprecado** | v2.1.73 | `/config` | [github](https://github.com/googlarz/claude-code-commands) |
| `/review` | **Deprecado** | — | Plugin `code-review` | [github](https://github.com/googlarz/claude-code-commands) |

---

## 2. Modos (permission modes)

> Claude Code tem 5 modos de permissão, ciclados com `Shift+Tab`. Cada modo define o que Claude pode fazer sem pedir confirmação.

| Modo | Config value | Comportamento | Fonte |
|:---|:---|:---|:---|
| **Manual** | `default` | Pede confirmação antes de quase toda ação (editar arquivos, rodar shell, acessar rede) | [docs](https://code.claude.com/docs/en/permission-modes) |
| **Auto** | `auto` | Um classificador (modelo separado) revisa ações antes de executar; bloqueia o que escalar além do pedido | [docs](https://code.claude.com/docs/en/permission-modes) |
| **Accept edits** | `acceptEdits` | Auto-aprova criação/edição de arquivos no working directory + comandos comuns de FS (`mkdir`, `touch`, `rm`, `mv`, `cp`, `sed`) | [docs](https://code.claude.com/docs/en/permission-modes) |
| **Plan** | `plan` | Claude pesquisa e propõe mudanças sem executá-las; lê arquivos, roda shell para explorar, escreve um plano | [docs](https://code.claude.com/docs/en/permission-modes) |
| **Bypass permissions** | `bypassPermissions` | Pula prompts de permissão; equivalente a `--dangerously-skip-permissions` | [docs](https://code.claude.com/docs/en/permission-modes) |

### Plan mode

- **Entrar:** `Shift+Tab` a partir de Manual, ou prefixar prompt com `/plan`, ou `--permission-mode plan` no CLI.
- **O que muda:** Claude lê, explora, escreve plano — mas não edita código-fonte. Shell commands são permitidos para exploração.
- **Sair:** `Shift+Tab` (sem prompt de aprovação aberto), ou aprovar o plano (o que muda para o modo que o usuário escolher), ou `Esc` no prompt de aprovação.
- **Aprovação:** Quando o plano está pronto, Claude apresenta e pergunta como prosseguir. Opções incluem aprovar (e em qual modo), editar o plano no editor (`Ctrl+G`), ou rejeitar.

Fonte: [docs](https://code.claude.com/docs/en/permission-modes)

### Auto mode (classificador)

- Um segundo modelo (Sonnet 5 por padrão) revisa cada ação antes de rodar.
- Bloqueia ações que escalam além do pedido, miram infraestrutura não reconhecida, ou parecem driven por conteúdo hostil.
- Disponível apenas quando a conta cumpre requisitos (modelo suportado, feature flags, não gerenciado por org com HIPAA).
- Pode ser desativado por managed settings (`disableAutoMode: "disable"`).

Fonte: [docs](https://code.claude.com/docs/en/permission-modes)

---

## 3. Atalhos de teclado

> Fonte primária: [code.claude.com/docs/en/interactive-mode](https://code.claude.com/docs/en/interactive-mode) e [keybindings](https://code.claude.com/docs/en/keybindings)

| Tecla | Comportamento | Fonte |
|:---|:---|:---|
| `Ctrl+R` | Busca reversa no histórico de prompts. Em fullscreen rendering, abre diálogo de busca com preview e scope cycling (`Ctrl+S` alterna entre sessão/projeto/todos). | [docs](https://code.claude.com/docs/en/interactive-mode) |
| `Ctrl+B` | Move comando Bash para background (retorna task ID imediatamente) | [docs](https://code.claude.com/docs/en/interactive-mode) |
| `Ctrl+T` | Não encontrado na doc oficial — **não verificado** | — |
| `Ctrl+O` | Toggle do transcript viewer | [docs](https://code.claude.com/docs/en/interactive-mode) |
| `Ctrl+L` | Limpa a tela | [docs](https://code.claude.com/docs/en/keybindings) |
| `Ctrl+C` | Cancela input/geração; duas vezes fecha diálogo ou sai | [docs](https://code.claude.com/docs/en/keybindings) |
| `Ctrl+D` | Sai (em prompts vazios); duas vezes fecha diálogo | [docs](https://code.claude.com/docs/en/keybindings) |
| `Ctrl+E` | Editor externo (ou toggle show-all no transcript, dependendo do contexto) | [docs](https://code.claude.com/docs/en/keybindings) |
| `Ctrl+G` | Abre editor externo / edita plano no editor default | [docs](https://code.claude.com/docs/en/interactive-mode) |
| `Ctrl+Enter` | Envia mensagens enfileiradas imediatamente (sem esperar o turno atual) | [docs](https://code.claude.com/docs/en/interactive-mode) |
| `Esc` | Interrompe o turno sem enviar o draft. Mantém o que estava enfileirado. | [docs](https://code.claude.com/docs/en/interactive-mode) |
| `Esc` `Esc` | Cancela pergunta em curso (no campo "Other") | [docs](https://code.claude.com/docs/en/interactive-mode) |
| `Shift+Tab` | Cicla permission mode (Manual → Accept edits → Plan → Auto → …) | [docs](https://code.claude.com/docs/en/permission-modes) |
| `!` (no início do input) | Shell mode: prefixa comando Bash; Claude responde ao output automaticamente | [docs](https://code.claude.com/docs/en/interactive-mode) |
| `@` (no início) | Sugestão de arquivos: lista arquivos do projeto que casam com o texto | [docs](https://code.claude.com/docs/en/interactive-mode) |
| `#` (no início) | Memória: adiciona nota à memória do projeto | [docs](https://code.claude.com/docs/en/interactive-mode) |
| `/` (no início) | Paleta de comandos: filtra comandos, skills e plugins por prefixo | [docs](https://code.claude.com/docs/en/interactive-mode) |
| `:` (no início ou após espaço) | Emoji shortcode: `:smile:` vira 😄 | [docs](https://code.claude.com/docs/en/interactive-mode) |
| `Up` (na primeira linha) | Recupera mensagens enfileiradas de volta para o input | [docs](https://code.claude.com/docs/en/interactive-mode) |
| `←` | Move sessão para background (background agents) | [docs](https://code.claude.com/docs/en/interactive-mode) |
| `Tab` (com `/` no meio do prompt) | Lista todos os comandos disponíveis | [docs](https://code.claude.com/docs/en/interactive-mode) |

### Notas sobre atalhos

- `Ctrl+T` não aparece na documentação oficial nem na cheatsheet. **Não verificado.**
- `Ctrl+R` muda de comportamento: inline search (classic renderer) vs. diálogo de busca (fullscreen renderer).
- `Ctrl+B` só funciona quando background tasks estão habilitados (não desativado por `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` ou bare mode).
- `Esc` `Esc` só cancela perguntas no campo "Other"; em vim mode, a primeira pressão muda para NORMAL mode.
- Atalhos são rebinding-áveis via `~/.claude/keybindings.json`, exceto os reservados (`Ctrl+C`, `Ctrl+D`).

---

## 4. Padrões de entrada

### Paleta de comandos (`/`)

- Ao digitar `/`, a paleta lista comandos, skills (embutidas e customizadas) e plugins.
- **Filtro:** por prefixo — só comandos cujo nome começa com as letras digitadas aparecem.
- **Comandos no meio do prompt:** Claude Code só executa um comando se ele começar a mensagem. `/com` no meio de um texto não abre a paleta.
- **Tab** com `/` no meio do prompt lista todos os comandos disponíveis.
- **Mouse:** em fullscreen rendering, hover destaca linha e clique aceita.
- **Skills customizadas:** qualquer `SKILL.md` em `~/.claude/skills/<nome>/SKILL.md` ou `.claude/skills/<nome>/SKILL.md` vira `/<nome>`. Plugins também contribuem skills.
- **MCP prompts:** servidores MCP podem expor prompts como `/mcp__<servidor>__<prompt>`.

Fonte: [docs](https://code.claude.com/docs/en/interactive-mode)

### Shell mode (`!`)

- Prefixar input com `!` executa comando Bash diretamente, sem passar pelo Claude.
- Claude responde ao output automaticamente (custa como um prompt normal).
- Para adicionar output ao contexto sem resposta, setar `respondToBashCommands: false` em settings.

Fonte: [docs](https://code.claude.com/docs/en/interactive-mode)

### Menções de arquivo (`@`)

- Digitar `@` no início do input abre lista de arquivos do projeto.
- Aceitar insere a referência no prompt.
- Funciona em ambos os renderers (classic e fullscreen).

Fonte: [docs](https://code.claude.com/docs/en/interactive-mode)

### Memória (`#`)

- Digitar `#` no início adiciona uma nota à memória do projeto (CLAUDE.md).
- Não verificado em detalhe na doc oficial — comportamento descrito na cheatsheet.

Fonte: [support.claude.com cheatsheet](https://support.claude.com/en/articles/14553413-claude-code-cheatsheet) (não-oficial)

---

## 5. Estados e feedback

### Streaming

- Claude Code usa renderização em tempo real (classic renderer ou fullscreen renderer).
- Indicador de atividade mostra quando Claude está processando (spinner/status).
- Mensagens enfileiradas aparecem em cinza até Claude começar a respondê-las.

Fonte: [docs](https://code.claude.com/docs/en/interactive-mode)

### Chamada de ferramentas

- Ferramentas são executadas com indicador visual (ícone + nome da ferramenta).
- Bash commands podem ser movidos para background com `Ctrl+B`; retornam task ID.
- Tool results aparecem no transcript.

Fonte: [docs](https://code.claude.com/docs/en/interactive-mode)

### Erros

- Erros aparecem no transcript como mensagens de erro.
- Debug mode (`/debug` ou `--debug`) habilita logging detalhado em `~/.claude/debug/<session-id>.txt`.

Fonte: [docs](https://code.claude.com/docs/en/interactive-mode)

### Custo e contexto

- `/cost` mostra custo total e duração da sessão.
- `/context` mostra uso de contexto como grade colorida.
- `/status` mostra versão, modelo, conta, conectividade de API.
- Status bar mostra modo de permissão ativo (`⏸ manual mode on`, `⏵⏵ accept edits on`, etc.).

Fonte: [docs](https://code.claude.com/docs/en/commands)

---

## 6. Modificações do usuário — o que vale copiar

### Cara de produto (vale copiar)

| Elemento | Por quê | Fonte |
|:---|:---|:---|
| Paleta de comandos com filtro por prefixo | UX familiar, descoberta rápida, não precisa decorar | [docs](https://code.claude.com/docs/en/interactive-mode) |
| Ciclo de permission modes com `Shift+Tab` | Controle granular sem configuração; plan mode é genial para "propor antes de fazer" | [docs](https://code.claude.com/docs/en/permission-modes) |
| Shell mode com `!` | Transparência: usuário roda comando direto e Claude interpreta | [docs](https://code.claude.com/docs/en/interactive-mode) |
| Indicador de modo na status bar | Feedback sempre visível do que Claude pode fazer sem perguntar | [docs](https://code.claude.com/docs/en/permission-modes) |
| `/cost` e `/context` | Transparência de custo e contexto — o usuário sabe o que está gastando | [docs](https://code.claude.com/docs/en/commands) |
| `/rewind` (checkpoint) | Recuperação de estado — "desfazer" conversa e código | [docs](https://code.claude.com/docs/en/commands) |
| `/branch` (fork de conversa) | Ramificar sem perder contexto — útil para explorar alternativas | [github](https://github.com/googlarz/claude-code-commands) |
| Skills customizadas via SKILL.md | Extensibilidade sem código — qualquer `SKILL.md` vira comando | [docs](https://code.claude.com/docs/en/interactive-mode) |
| `Ctrl+R` busca reversa no histórico | Recuperar prompts antigos sem scroll manual | [docs](https://code.claude.com/docs/en/interactive-mode) |
| Background tasks com `Ctrl+B` | Não bloquear o prompt enquanto comando roda | [docs](https://code.claude.com/docs/en/interactive-mode) |

### Ruído (não copiar)

| Elemento | Por quê | Fonte |
|:---|:---|:---|
| 76+ comandos de barra | Overwhelming para novos usuários; muitos são específicos de conta/plano | [github](https://github.com/googlarz/claude-code-commands) |
| Comandos sazonais/promocionais (`/stickers`, `/passes`, `/think-back`) | Poluição visual na paleta | [github](https://github.com/googlarz/claude-code-commands) |
| Comandos hidden/dev-only (`/heapdump`, `/bridge-kick`) | Confusão se descobridos acidentalmente | [github](https://github.com/googlarz/claude-code-commands) |
| Feature flags e gating complexo | Dificulta saber o que está disponível e por quê | [github](https://github.com/googlarz/claude-code-commands) |
| Auto mode com classificador server-side | Opacidade — usuário não sabe exatamente o que o classificador vai bloquear | [docs](https://code.claude.com/docs/en/permission-modes) |
| Múltiplos renderers (classic vs fullscreen) | Comportamento inconsistente de atalhos entre renderers | [docs](https://code.claude.com/docs/en/interactive-mode) |

---

## Referências

1. [code.claude.com/docs/en/cli-reference](https://code.claude.com/docs/en/cli-reference) — referência oficial de CLI (comandos, flags)
2. [code.claude.com/docs/en/commands](https://code.claude.com/docs/en/commands) — referência oficial de comandos `/`
3. [code.claude.com/docs/en/interactive-mode](https://code.claude.com/docs/en/interactive-mode) — modo interativo, atalhos, entrada
4. [code.claude.com/docs/en/permission-modes](https://code.claude.com/docs/en/permission-modes) — modos de permissão
5. [code.claude.com/docs/en/keybindings](https://code.claude.com/docs/en/keybindings) — keybindings customizáveis
6. [github.com/googlarz/claude-code-commands](https://github.com/googlarz/claude-code-commands) — extração binária de comandos `/` (v2.1.92, abril 2026, não-oficial)
7. [support.claude.com cheatsheet](https://support.claude.com/en/articles/14553413-claude-code-cheatsheet) — cheatsheet não-oficial
8. [smartscope.blog](https://smartscope.blog/en/generative-ai/claude/claude-code-reference-guide/) — guia de referência não-oficial (abril 2026)