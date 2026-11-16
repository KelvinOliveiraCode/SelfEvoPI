# calcular o IMC a partir de peso e altura

CLI local gerado pelo Forge (kind: `cli`).

## Uso

```bash
node cli.mjs --peso --altura <valor>
```

## Entradas

- `--peso` — peso
- `--altura` — altura

## Saídas (JSON, uma linha)

- `imc` — imc
- `classificacao` — classificacao

## O que NÃO pode fazer

- acessar rede
- escrever fora do workspace

## Verificação

```bash
node verify.mjs
```

Sai 0 somente se todos os testes passarem.
