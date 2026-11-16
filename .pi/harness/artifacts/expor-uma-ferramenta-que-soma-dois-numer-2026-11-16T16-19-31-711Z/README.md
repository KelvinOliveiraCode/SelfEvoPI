# expor uma ferramenta que soma dois numeros

CLI local gerado pelo Forge (kind: `cli`).

## Uso

```bash
node cli.mjs --a --b <valor>
```

## Entradas

- `--a` — a
- `--b` — b

## Saídas (JSON, uma linha)

- `soma` — soma

## O que NÃO pode fazer

- acessar rede
- escrever fora do workspace
- inventar dados

## Verificação

```bash
node verify.mjs
```

Sai 0 somente se todos os testes passarem.
