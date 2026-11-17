# Fase 6 — Recuperação de capacidades em 3 camadas

> **Agente:** A7 — Memória e Refine
> **Status:** implementado (`core/memory/embed.mjs`, `core/memory/ppmi.mjs`, `core/memory/search.mjs`)
> **Fora de escopo:** embeddings por modelo/rede — este pacote é 100% local.

## 1. O problema e a correção honesta

A busca de skills era **lexical** (por termo). "calcular IMC" não achava "índice de massa
corporal". A primeira tentativa de resolver isso virou, na prática, um **glossário de
substituição disfarçado de semântica**: `cosine("settings","arquivo de configuracao")`
devolvia `1.0000` porque ambos caíam no mesmo canônico — identidade após substituição,
não semelhança. Isso é lookup table, não recuperação semântica.

Esta fase corrige o problema de raiz: **três camadas separadas, nomeadas e medidas
independentemente**, sem fingir que uma é a outra.

## 2. As três camadas

| camada | módulo | técnica | o que compra | limitação honesta |
|:---|:---|:---|:---|:---|
| 1. lexical | `search.mjs` | casa termos no texto e tags (tag 3×) | precisão no literal | não liga sinônimos |
| 2. PPMI | `ppmi.mjs` | co-ocorrência termo↔termo **aprendida do corpus** | sinônimos que aparecem juntos nos registros; melhora com o corpus | corpus pequeno = sinal fraco |
| 3. glossário | `embed.mjs` (`glossarySimilarity`) | glossário curado à mão (`SYNONYM_GROUPS`) | cobre o que foi escrito, determinístico | **não aprende**; só cobre o que está no glossário |

### Camada 1 — n-gramas crus (`embed.mjs`)

`embed()` / `cosine()` / `rawSimilarity()`: *feature hashing* (FNV-1a) de n-gramas de
caractere (3–5) em 256 dimensões, norma L2. É fuzzy de forma. **Não liga sinônimos** —
`cosine("imc","indice de massa corporal")` dá ~0, e isso é o comportamento correto e
verificado. É o piso real e o fallback de precisão.

### Camada 2 — PPMI sobre o corpus (`ppmi.mjs`)

Aprende co-ocorrência termo↔termo dos textos do próprio store. Se dois termos aparecem
nos mesmos registros, ficam próximos. Fórmula: `PPMI(a,b) = max(0, log2( P(a,b)/(P(a)·P(b)) ))`.
A consulta vira um vetor sobre os vizinhos PPMI dos seus termos; compara por cosseno.
**Local, determinístico, zero dependência.** Só aprende o que o corpus contém — e melhora
conforme a memória cresce.

### Camada 3 — glossário (bootstrap, NÃO é semântica)

`glossarySimilarity()` expande sinônimos de um glossário curado (`SYNONYM_GROUPS`) antes de
comparar. É **tabela de substituição**, não aprendizado. A função se chama
`glossarySimilarity` (não `semanticSimilarity`) justamente para não confundir.

## 3. Combinação

```
score = max(lexScore, PPMI_SCALE×ppmi, GLOSSARY_SCALE×glossário)
```

Cada resultado traz `lexScore`, `ppmiScore`, `glossaryScore`, `rawScore` e `via` (qual
camada decidiu). Qualquer um vê quanto cada camada compra.

## 4. Tabela honesta (7 positivos + 2 negativos)

| # | consulta | tipo | lexical | raw(cam1) | ppmi(cam2) | glossário(cam3) | busca achou? |
|:--|:---|:---|:---|:---|:---|:---|:---|
| 1 | `imc` | glossário | nada | 0.00 | 0.00 | 1.00 | ✅ |
| 2 | `start server` | glossário | nada | 0.22 | 0.00 | 0.50 | ✅ |
| 3 | `settings` | glossário | nada | 0.00 | 0.00 | 1.00 | ✅ |
| 4 | `analisador sintatico` | glossário | nada | 0.06 | 0.00 | 0.50 | ✅ |
| 5 | `cifrar mensagem` | glossário | nada | 0.13 | 0.00 | 1.00 | ✅ |
| 6 | `excluir item` | PPMI | ok | 0.50 | 0.85 | 0.50 | ✅ |
| 7 | `gerar novo arquivo` | PPMI | ok | 0.40 | 0.49 | 0.40 | ✅ |
| 8 | `tocar violao` | **não coberto** | nada | 0.00 | 0.00 | 0.00 | ✅ vazio |
| 9 | `receita de bolo` | **não coberto** | nada | 0.00 | 0.00 | 0.00 | ✅ vazio |

**Leitura:**
- cam1 fica ~0 nos sinônimos — **correto**: forma não liga "imc" a "índice de massa corporal".
- cam2 sobe para 0.49–0.85 **quando o corpus tem os termos juntos** no mesmo registro
  (é o caso do `promote`, que grava `capability — artefato em ...`). Aprende dos dados.
- cam3 dá 1.00 no que cobre e 0.00 no que não cobre (linhas 8–9).
- **Sinônimos não cobertos dão vazio** — a busca não inventa casamento.

## 5. Orçamento de contexto

A busca é **offline** e não entra no prompt — roda só quando o agente pede `/mem find` ou
`skills <termo>`. O overhead de contexto (medido por `scripts/measure-selfevopi-overhead.mjs`)
**não muda**:

```
pi-puro        8684 tok  (+0)
memoria-vazia  8706 tok  (+22)
memoria-curta  8845 tok  (+161)
memoria-cheia  9191 tok  (+507)   ← pior caso
Orçamento      1500 tokens
Veredito       dentro do orçamento (507 de 1500)
```

## 6. Como usar

```bash
# dentro da sessão do PI
/mem find imc

# linha de comando
node core/forge/cli.mjs skills imc
```

## 7. Verificação

```bash
node --test core/memory/*.test.mjs     # 83 testes (12 embed + 6 ppmi + 6 busca + ...)
npm test
node scripts/measure-selfevopi-overhead.mjs
```

## 8. O que NÃO é feito (e por quê)

- **Sem modelo baixado, sem API, sem rede.** As três camadas são determinísticas.
- **O glossário é nomeado como glossário** no código (`SYNONYM_GROUPS`, `glossarySimilarity`)
  e na doc — nunca como "semântica".
- **Sinônimos não cobertos dão vazio** — há teste que prova isso; a busca não inventa.
- **Corpus pequeno = PPMI fraco.** É o preço de não baixar modelo; documentado e medido.

## 9. Critério de aceite

- `core/memory/embed.mjs`: determinístico, norma 1, sem `import`, sem rede.
- Camada crua NÃO liga sinônimos (provado em teste).
- Glossário nomeado como glossário; cobre só o que foi escrito.
- PPMI aprende co-ocorrência do corpus (provado em teste).
- `node --test core/memory/*.test.mjs` sai 0.
- Overhead de contexto inalterado (abaixo do teto).