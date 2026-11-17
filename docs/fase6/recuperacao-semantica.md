# Fase 6 — Recuperação semântica de skills

> **Agente:** A7 — Memória e Refine
> **Status:** implementado (`core/memory/embed.mjs` + `core/memory/search.mjs`)
> **Fora de escopo:** embeddings por modelo/rede — este pacote é 100% local.

## 1. O problema

A busca de skills/memória era **lexical** (por termo). "calcular IMC" não achava "índice
de massa corporal" porque as palavras não coincidem. Resultado: o harness "esquecia"
capacidade que ele tinha e **re-gerava** a mesma coisa.

A busca lexical é boa quando o termo é literal ("somar" acha "somar dois números"), e
ruim em sinônimos/paráfrases. A Fase 6 adiciona um caminho semântico **local** que cobre
essa lacuna sem jogar fora a precisão da via literal.

## 2. Como funciona o embedding (`core/memory/embed.mjs`)

Determinístico, sem dependência, sem rede. Passos:

1. **normalização** — minúsculo, sem acento, espaços colapsados;
2. **expansão de sinônimos** — um glossário local (`SYNONYM_GROUPS`) colapsa variantes no
   mesmo canônico (ex.: `imc` / `índice de massa corporal` / `massa corporal` → `imc`);
3. **n-gramas de caractere** (3–5) do texto normalizado+expandido;
4. **feature hashing** (FNV-1a) em `dims` dimensões (padrão 256), com sinal;
5. **normalização L2** → norma 1.

A similaridade entre dois textos é o **máximo** de três medidas robustas:

| medida | o que faz | quando ajuda |
|:---|:---|:---|
| `cosine` | cosseno dos vetores | textos de comprimento comparável |
| `gramContainment` | fração dos n-gramas da consulta presentes na entrada | consulta curta vs. documento longo |
| `tokenContainment` | fração dos tokens (pós-sinônimo) da consulta na entrada | sinônimo/paráfrase exata |

O `cosine` puro cai muito quando a consulta é curta e a entrada é longa (o vetor da
entrada dilui). A contenção resolve isso perguntando "quanto da consulta está dentro da
entrada?" — que é exatamente o caso de busca.

**Garantias:** mesma entrada → mesmo vetor (determinismo); norma 1; zero `import`; zero
rede. Se precisar de rede, está errado.

## 3. Como a busca combina os dois caminhos (`search.mjs`)

```
escore = max(léxico, semântico × 2)
```

- **léxico**: casa no texto (peso 1) e nas tags (peso 3 — sinal curado por alguém), com
  cobertura = fração dos termos que casaram.
- **semântico**: `semanticSimilarity(query, entrada)` acima do piso `semanticFloor` (0.05).
- O multiplicador 2 faz um sinônimo forte pontuar ~2: acima de um casamento literal (1),
  abaixo de uma tag (3) — preservando a precisão léxica quando o termo é literal.

A busca só devolve entradas com `escore >= minScore` (1). Cada resultado traz diagnóstico:
`score`, `lexScore`, `semanticScore`, `via` (`"lexical"` ou `"semantica"`).

## 4. Resultado medido (8 consultas com sinônimos)

Entradas redigidas **sem** o termo literal da consulta (o caso real), 8 capacidades:

| # | consulta | lexical (antes) | semântica (depois) |
|:--|:---|:---|:---|
| 1 | `imc` | #0 ✅ | #0 ✅ |
| 2 | `iniciar servidor` | #1 ✅ | #1 ✅ |
| 3 | `settings` | nada | #2 ✅ |
| 4 | `schema json` | #3 ✅ | #3 ✅ |
| 5 | `analisador sintatico` | nada | #4 ✅ |
| 6 | `cifrar mensagem` | #5 ✅ | #5 ✅ |
| 7 | `arquivo pdf` | #6 ✅ | #6 ✅ |
| 8 | `banco de dados` | #7 ✅ | #7 ✅ |
| — | `adicao de numeros` (controle negativo) | nada | nada ✅ |

**Lexical 6/8 → semântica 8/8.** Os casos #3 (`settings` → configuração) e #5
(`analisador sintático` → parser) que a lexical perdia, a semântica recupera.

## 5. Orçamento de contexto

A busca é **offline** e não entra no prompt — ela roda quando o agente pede
`/mem find` ou `skills <termo>`. O overhead de contexto do SelfEvoPI (medido por
`scripts/measure-selfevopi-overhead.mjs`) **não muda**:

```
pi-puro        8684 tok  (+0)
memoria-vazia  8706 tok  (+22)
memoria-curta  8845 tok  (+161)
memoria-cheia  9191 tok  (+507)   ← pior caso
Orçamento      1500 tokens
Veredito       dentro do orçamento (507 de 1500)
```

## 6. O que NÃO é feito (e por quê)

- **Sem modelo baixado, sem API, sem rede.** O embedding é um hashing determinístico. Se
  o projeto quiser semântica "de verdade" (embeddings neurais), isso é outra fase — este
  pacote não pode baixar nada.
- **Sem dicionário de sinônimos "esperto".** O glossário é mantido à mão e cobre os
  termos do domínio do SelfEvoPI. Ampliá-lo é seguro (só melhora a cobertura) e não muda
  o custo.
- **Nada de embeddings no prompt.** O vetor existe só na busca; o que entra no contexto é
  a lista curta de resultados (`/mem find`).

## 7. Como usar

```bash
# dentro da sessão do PI
/mem find imc

# linha de comando
node core/forge/cli.mjs skills imc
```

## 8. Verificação

```bash
node --test core/memory/*.test.mjs     # 72 testes (12 de embed + 6 de busca semântica)
npm test                               # 389 testes
node scripts/measure-selfevopi-overhead.mjs   # overhead inalterado
```

## 9. Critério de aceite

- `core/memory/embed.mjs` determinístico, norma 1, sem `import`, sem rede.
- Sinônimos com similaridade > não-relacionados (provado em teste).
- Busca semântica integrada ao `search.mjs`, com a lexical mantida como fallback.
- `node --test core/memory/*.test.mjs` sai 0.
- Overhead de contexto inalterado (abaixo do teto).