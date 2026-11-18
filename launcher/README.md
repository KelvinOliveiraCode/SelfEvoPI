# Lançadores da Área de Trabalho

Dois atalhos que abrem o SelfEvoPI e **enxergam a mesma conversa**. Nenhum dos dois tem menu próprio: a CLI tem o dela, e o desktop é o desktop.

| Arquivo | O que faz |
|:---|:---|
| `SelfEvoPI.cmd` | abre a CLI (`apps/cli.mjs`) |
| `SelfEvoPI-Desktop.cmd` | abre o desktop (`scripts/desktop.mjs --app`) |
| `instalar-atalhos.ps1` | instala na Área de Trabalho e cria os `.lnk` com ícone |
| `gerar-icone.py` | gera `assets/selfevopi.ico` a partir de `assets/logo.svg` (só dev) |
| `SelfEvoPI-Painel.cmd` | nome antigo do desktop: só repassa para `SelfEvoPI-Desktop.cmd` |

## Os dois olham a mesma sessão

O pi guarda a sessão em `~/.pi/agent/sessions/<cwd-codificado>/`. O `<cwd-codificado>` é o diretório de trabalho — **não** é um caminho fixo no script.

Por isso os dois lançadores fazem `cd /d "%ROOT%"` e usam a **mesma raiz** (`SELFEOPI_ROOT`, ou a descoberta na seção abaixo). Se as raízes divergirem, CLI e desktop abrem sessões diferentes sem avisar. Ao mudar a raiz de um, mude a do outro.

## A janela do desktop

`scripts/desktop.mjs --app` procura Edge e depois Chrome, e abre `http://127.0.0.1:7777` em modo `--app` (1280×820, sem barra de endereço) com um perfil dedicado em `.pi/harness/tmp/app-profile`.

Se **nenhum** dos dois existir, o próprio `desktop.mjs` detecta e chama o navegador padrão — a decisão fica em um lugar só. O lançador não duplica essa lógica: ele passa `--app` e deixa o script decidir.

- `--no-app` força o modo navegador;
- `--dry-run` mostra o comando e o modo, sem executar nada.

O lançador faz a sonda (Edge/Chrome) apenas para **dizer o modo** no `--dry-run`, não para escolher.

## Por que existe um `.lnk` além do `.cmd`

Um `.cmd` não carrega ícone no Windows — o Explorer mostra o ícone genérico de lote. O ícone vem do atalho (`.lnk`), que aponta para o `.cmd`. Por isso a instalação cria os dois:

```
Desktop\SelfEvoPI.lnk         -> Desktop\SelfEvoPI.cmd         (ícone da marca)
Desktop\SelfEvoPI-Desktop.lnk -> Desktop\SelfEvoPI-Desktop.cmd (ícone da marca)
```

O `.cmd` continua sendo o arquivo de verdade: ele funciona sozinho, sem `.lnk`, mesmo se você copiá-lo para outro lugar.

## Como a raiz é descoberta

Nenhum caminho pessoal fixo. A ordem é:

1. variável de ambiente `SELFEOPI_ROOT`;
2. uma pasta `SelfEvoPI` **ao lado** do `.cmd`;
3. a pasta onde o `.cmd` está (se ele estiver dentro do repo);
4. o diretório atual;
5. Área de Trabalho, Documentos e pasta pessoal do usuário.

A validação não é só "existe `package.json`": o candidato precisa ter `core\forge` (na CLI) ou `scripts\desktop.mjs` (no desktop). Assim, uma pasta qualquer chamada `SelfEvoPI` não é aceita por engano.

Se nada casar, o lançador **diz e para**. Ele nunca abre um menu vazio.

## Modo `--dry-run`

Os dois aceitam `--dry-run`: mostram o comando que abririam, a raiz resolvida, o `node` usado, a sessão e se o alvo existe — sem executar nada.

```powershell
SelfEvoPI.cmd --dry-run
SelfEvoPI-Desktop.cmd --dry-run
```

## Ícone

`assets/selfevopi.ico`, 6 tamanhos (16 a 256), fundo transparente, tinta `#111111` — a cor da marca, sem recolorir (`docs/design/marca.md`, seções 1 e 4).

Gerado com `launcher/gerar-icone.py`, que precisa de Python + Pillow e de um Chromium (Chrome ou Edge) para rasterizar o SVG. **Só desenvolvimento**: o `.ico` é commitado, e nada disso é necessário para usar o SelfEvoPI.

## Detalhe de Windows que vale saber

Esta máquina tem `AutoRun = chcp 65001` em `HKCU\Software\Microsoft\Command Processor`. Isso faz todo `cmd` filho imprimir `Página de código ativa: 65001`. Dois efeitos:

1. a linha aparece antes da saída do lançador — é do seu Windows, não do SelfEvoPI;
2. um `for /f` que captura saída de comando também captura essa linha.

Por isso a detecção do Node aceita **só linha que termina em `.exe`**. Sem esse filtro, `%NODE%` viraria "Página de código ativa: 65001" e o caminho do Node se perderia.

Os `.cmd` são ASCII puro, de propósito: sem `chcp` no script, sem risco de acento embaralhado em codepage diferente.

## Depois de um merge

Os `.lnk` guardam o caminho do ícone e a pasta de trabalho **do repo de onde a instalação rodou**. Se você instalou a partir de um worktree, rode de novo a partir da árvore principal:

```powershell
pwsh launcher/instalar-atalhos.ps1
```

É idempotente: não perde o backup dos antigos, reaponta ícone e pasta, e preserva o `SelfEvoPI-Painel.cmd` antigo da Área de Trabalho como `SelfEvoPI-Painel-antigo.cmd`.