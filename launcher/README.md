# Lançadores da Área de Trabalho

Dois atalhos que abrem o SelfEvoPI. Nenhum dos dois tem menu próprio: a CLI tem
o dela, e o painel é o painel.

| Arquivo | O que faz |
|:---|:---|
| `SelfEvoPI.cmd` | abre a CLI (`apps/cli.mjs`) |
| `SelfEvoPI-Painel.cmd` | abre o app desktop (`scripts/desktop.mjs --app`) |
| `instalar-atalhos.ps1` | instala na Área de Trabalho e cria os `.lnk` com ícone |
| `gerar-icone.py` | gera `assets/selfevopi.ico` a partir de `assets/logo.svg` (só dev) |

## Por que existe um `.lnk` além do `.cmd`

Um `.cmd` não carrega ícone no Windows — o Explorer mostra o ícone genérico de
lote. O ícone vem do atalho (`.lnk`), que aponta para o `.cmd`. Por isso a
instalação cria os dois:

```
Desktop\SelfEvoPI.lnk        -> Desktop\SelfEvoPI.cmd        (ícone da marca)
Desktop\SelfEvoPI-Painel.lnk -> Desktop\SelfEvoPI-Painel.cmd (ícone da marca)
```

O `.cmd` continua sendo o arquivo de verdade: ele funciona sozinho, sem `.lnk`,
mesmo se você copiá-lo para outro lugar.

## Como a raiz é descoberta

Nenhum caminho pessoal fixo. A ordem é:

1. variável de ambiente `SELFEOPI_ROOT`;
2. uma pasta `SelfEvoPI` **ao lado** do `.cmd`;
3. a pasta onde o `.cmd` está (se ele estiver dentro do repo);
4. o diretório atual;
5. Área de Trabalho, Documentos e pasta pessoal do usuário.

A validação não é só "existe `package.json`": o candidato precisa ter
`core\forge` (ou `scripts\desktop.mjs`, no painel). Assim, uma pasta qualquer
chamada `SelfEvoPI` não é aceita por engano.

Se nada casar, o lançador **diz e para**. Ele nunca abre um menu vazio.

## Modo `--dry-run`

Os dois aceitam `--dry-run`: mostram o comando que abririam, a raiz resolvida, o
`node` usado, e se o alvo existe — sem executar nada.

```powershell
SelfEvoPI.cmd --dry-run
SelfEvoPI-Painel.cmd --dry-run
```

O painel também aceita `--no-app` para forçar o modo navegador.

## A sonda do `--app`

O `desktop.mjs` de hoje ignora flags desconhecidas em silêncio. Então o lançador
não tenta rodar `--app` para descobrir se ele existe: ele faz a sonda no
próprio arquivo (`findstr /c:"--app"`). Se a flag não estiver lá, avisa e cai no
navegador. Quando o A8 entregar o `--app`, a sonda passa a encontrar e o mesmo
atalho abre a janela — sem você mexer em nada.

## Ícone

`assets/selfevopi.ico`, 6 tamanhos (16 a 256), fundo transparente, tinta
`#111111` — a cor da marca, sem recolorir (`docs/design/marca.md`, seção 1 e 4).

Gerado com `launcher/gerar-icone.py`, que precisa de Python + Pillow e de um
Chromium (Chrome ou Edge) para rasterizar o SVG. **Só desenvolvimento**: o
`.ico` é commitado, e nada disso é necessário para usar o SelfEvoPI.

## Detalhe de Windows que vale saber

Esta máquina tem `AutoRun = chcp 65001` em
`HKCU\Software\Microsoft\Command Processor`. Isso faz todo `cmd` filho imprimir
`Página de código ativa: 65001`. Dois efeitos:

1. a linha aparece antes da saída do lançador — é do seu Windows, não do SelfEvoPI;
2. um `for /f` que captura saída de comando também captura essa linha.

Por isso a detecção do Node aceita **só linha que termina em `.exe`**. Sem esse
filtro, `%NODE%` viraria "Página de código ativa: 65001" e o caminho do Node se
perderia.

Os `.cmd` são ASCII puro, de propósito: sem `chcp` no script, sem risco de
acento embaralhado em codepage diferente.

## Depois de um merge

Os `.lnk` guardam o caminho do ícone e a pasta de trabalho **do repo de onde a
instalação rodou**. Se você instalou a partir de um worktree, rode de novo a
partir da árvore principal:

```powershell
pwsh launcher/instalar-atalhos.ps1
```

É idempotente: não perde o backup dos antigos, e reaponta ícone e pasta.