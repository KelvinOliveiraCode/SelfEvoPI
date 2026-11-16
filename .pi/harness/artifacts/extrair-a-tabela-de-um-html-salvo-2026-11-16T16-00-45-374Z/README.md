# extrair a tabela de um HTML salvo

CLI local gerado pelo Forge (kind: `cli`).

## Uso

```bash
node cli.mjs --arquivo <valor>
```

## Entradas

- `--arquivo` — arquivo

## Saídas (JSON, uma linha)

- `linhas` — linhas

## O que NÃO pode fazer

- acessar rede
- escrever fora do workspace
- inventar dados

## Verificação

```bash
node verify.mjs
```

Sai 0 somente se todos os testes passarem.
