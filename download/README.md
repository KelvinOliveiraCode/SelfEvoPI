# Download do SelfEvoPI 2.0.0

## O que está aqui

`SelfEvoPI.exe` abre a CLI do SelfEvoPI no Windows. Ele entra na pasta da
aplicação e chama `apps/cli.mjs` com o `node.exe` incluído no zip. Se o zip
não trouxer o Node, ele usa o `node.exe` do PATH. Não tem menu próprio, não
guarda chave e não faz rede por conta própria.

Para usar fora do repositório, baixe `SelfEvoPI-2.0.0.zip` da página de
release. O zip já traz a aplicação inteira com o executável na raiz.

## Requisitos

Windows e o motor CLI instalado à parte. O zip inclui Node 22.19.1, então não
é preciso instalar Node separadamente. Sem Docker, WSL ou máquina virtual.
O SelfEvoPI não faz fork do motor.

## Como abrir

Duplo clique em `SelfEvoPI.exe`, ou na pasta do zip execute:

```
SelfEvoPI.exe --version
SelfEvoPI.exe --help
```

## Configurar um provider em uma entrada

Dentro da CLI:

```
/providers quick https://openrouter.ai/api/v1 NOME_DA_VARIAVEL_COM_A_CHAVE
```

O comando puxa todos os modelos do endpoint, grava a configuração no perfil
do usuário e deixa o provider pronto. Depois use `/model` para escolher.

Fora da CLI, com a chave digitada sem aparecer na tela:

```
node scripts/providers-setup.mjs --quick
```

O assistente pergunta o endpoint e a chave, descobre os modelos e grava.
A chave nunca é impressa nem entra no repositório.
