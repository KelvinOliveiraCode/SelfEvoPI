# expor uma ferramenta de soma

Servidor MCP autogerado pelo Forge (kind: `mcp-server`), sem dependências.

## Uso

```bash
node server.mjs
```

Fala JSON-RPC 2.0 sobre stdio: `initialize`, `tools/list`, `tools/call`.

## Ferramentas

- `a` — a
- `b` — b

## Saídas

- `soma` — soma

## O que NÃO pode fazer

- acessar rede
- escrever fora do workspace
- inventar dados

## Verificação

```bash
node verify.mjs
```

