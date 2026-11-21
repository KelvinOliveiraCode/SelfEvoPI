# Adicionar ferramenta / capacidade

## Onde mexer

| Arquivo | Papel |
|:--|:--|
| `core/forge/contract.mjs` | define os 5 kinds e a ordem de leveza. |
| `core/forge/detect.mjs` | só aponta lacuna com **evidência** (falha repetida, ausência, fluxo frágil). |
| `core/forge/specify.mjs` | transforma lacuna em contrato: entradas, saídas, proibições, testes. |
| `core/forge/generate-*.mjs` | um gerador por kind. |
| `core/forge/probe.mjs` | exercita o artefato **como ele é chamado** (flags, JSON-RPC, host falso). |
| `core/forge/gatekeeper.mjs` | exige tarefa resolvida + zero regressões + delta de tokens. |
| `core/forge/promote.mjs` | commit atômico, LKG, registro na memória. |
| `core/sandbox/`, `core/governance/` | isolamento e aprovação — consumidos, nunca editados. |

## Ordem de leveza (não pule)

1. `mcp-config` — configurar algo que já existe.
2. `skill` — procedimento, sem código.
3. `cli` — automação local.
4. `extension` — UI dentro do motor.
5. `mcp-server` — novo servidor de ferramentas.

Se nenhum kind casa, o artefato honesto é `skill`. Recair para `cli` gera a
interface errada com cara de sucesso.

## O que não mexer

- Não aceite "teste exit 0" como prova. Use a sonda por kind.
- Não promova sem gate verde. `last-known-good` só é atualizado com verify verde.
- Não edite `evals/` nem `core/governance/` para fazer o gate passar.
- Não dê rede, credencial ou escrita fora do workspace sem aprovação humana.

## Passos

1. Escreva o contrato: `goal`, `kind`, `inputs`, `outputs`, `permissions`,
   `forbidden` (não-vazio) e `tests` (não-vazio).
2. Rode em seco:
   ```powershell
   node core/forge/cli.mjs evolve --goal "..." --kind cli --inputs "a,b" --outputs "c" --dry-run
   ```
3. Só depois com execução real e gate:
   ```powershell
   node core/forge/cli.mjs evolve --goal "..." --kind cli --llm
   node core/forge/cli.mjs gate --artifact <dir> --task <id>
   ```
4. Se quiser autonomia, use `node core/forge/cli.mjs auto --watch` (dry-run por
   padrão; `--auto` é obrigatório para agir).

## Limite conhecido

O Forge **valida** o artefato, mas ainda não o **instala** no motor em uso: um
`extension` gerado fica em `.pi/harness/artifacts/` e não recebe `--extension`;
um `.mcp.json` gerado não é mesclado em `~/.pi/settings.json`. Se sua mudança
precisa que o artefato entre em vigor, implemente o passo de ativação descrito
em `conexoes-e-eventos.md` — e cubra com teste.

## Verificação

```powershell
node --test core/forge/*.test.mjs
node --test core/sandbox/*.test.mjs
npm run verify
```

## Se quebrar

- `node --check` recusou o código: corrija o gerador, não o artefato.
- Gate reprovou por regressão real: `core/governance/rollback.mjs` reverte e
  revalida. Rode `npm run verify` depois.
- O detector inventou lacuna: exija evidência no ledger — sem evidência, não
  afirme nada.
