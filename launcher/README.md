# Lançador da CLI

O SelfEvoPI tem **uma** superfície: a CLI. O atalho da Área de Trabalho aponta
para `SelfEvoPI.cmd`, que só descobre a raiz do repositório e chama o Node.

## Instalar

```powershell
pwsh launcher/instalar-atalhos.ps1
```

O script copia `SelfEvoPI.cmd` para a Área de Trabalho, cria `SelfEvoPI.lnk`
com o ícone da marca e adiciona esta pasta ao PATH do usuário. Depois disso,
tanto o atalho quanto `selfevopi` em qualquer terminal abrem a CLI.

Use `-NoShortcuts` para não criar o `.lnk`, ou `-Repo "D:\...\SelfEvoPI"` para
instalar apontando para outro checkout.

## Como a raiz é descoberta

1. variável de ambiente `SELFEOPI_ROOT`;
2. pasta `SelfEvoPI` ao lado do arquivo;
3. a pasta onde o arquivo está;
4. o diretório atual;
5. Área de Trabalho, Documentos e pasta pessoal do usuário.

Se nada casar, o lançador diz onde procurou e para — nunca abre um terminal vazio.

## Sessão

O projeto é agnóstico: a conversa é do motor e fica em
`~/.pi/agent/sessions/<cwd-codificado>/`. O `cd /d "%ROOT%"` no lançador é o que
faz a CLI retomar sempre a mesma conversa.

## Verificação

```powershell
launcher\SelfEvoPI.cmd --dry-run
```

Mostra raiz, Node e alvo sem executar nada.
