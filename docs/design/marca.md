# SelfEvoPI — sistema de marca

> Deriva de duas fontes: a marca do SelfEvoPI (`logos selfevopi/` — monocolor `#111`)
> e o sistema do portfólio pessoal (`GitHub/portfolio/css/tokens.css`), que dá a
> **paleta, a tipografia, a escala e a disciplina**.
>
> O portfólio é a referência de gosto. A marca do SelfEvoPI é a identidade. Onde
> divergirem, vale o portfólio no *como* e o SelfEvoPI no *quem*.

## 1. Princípio

Preto absoluto, texto branco, cinza para o secundário, linhas a 8% e 18%.
Superfícies planas. **Sem acento cromático** — a ênfase é o próprio branco.

Se uma cor não significa algo, ela não entra.

## 2. Paleta

| Token | Hex | Uso |
|:--|:--|:--|
| `--bg` | `#000000` | fundo absoluto |
| `--bg-2` | `#0d0d0d` | superfície plana de seção alternativa |
| `--bg-3` | `#1a1a1a` | painel, hover, seleção |
| `--fg` | `#ffffff` | texto principal |
| `--muted` | `#787878` | secundário — 4,7:1 sobre preto (AA) |
| `--line` | `rgba(255,255,255,.08)` | divisória |
| `--line-strong` | `rgba(255,255,255,.18)` | divisória reforçada, borda de foco |
| `--accent` | `#ffffff` | acento é o próprio branco |
| `--accent-soft` | `rgba(255,255,255,.1)` | fundo de destaque suave |

### A única exceção: cor de estado

O portfólio não tem cor. Um harness precisa dizer "passou / atenção / falhou" sem
que o operador leia texto. Então — e só então — entram três cores, **restritas a
indicadores**: um ponto de 8 px, um badge pequeno, uma borda de 2 px.

| Estado | Hex | Onde pode aparecer |
|:--|:--|:--|
| `--ok` | `#3FB950` | bolinha de "passou", badge de promovido |
| `--warn` | `#D29922` | bolinha de "estocástico", badge de "precisa de humano" |
| `--fail` | `#F85149` | bolinha de "falhou", badge de bloqueado |

**Proibido:** usar essas cores em texto corrido, em fundo de seção, em gradiente, em
borda de card inteiro, ou como acento decorativo. Elas são um ponto e um rótulo, e
nada mais. Se você precisar de mais que isso para comunicar, o problema é o layout.

## 3. Tipografia

Uma única família para tudo. Sem mono, sem serif — igual ao portfólio.

```
--font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif
```

Pesos: **400** para tudo, **500** para título e destaque. Nada de 600/700.

Escala medida (baseada na referência @1440):

| Token | Valor | Uso |
|:--|:--|:--|
| `--fs-0` | `0.75rem` (12px) | microrrótulo, eyebrow |
| `--fs-1` | `0.8125rem` (13px) | legenda, rodapé |
| `--fs-2` | `0.96875rem` (15.5px) | corpo |
| `--fs-3` | `1.0625rem` (17px) | secundário |
| `--fs-4` | `1.234rem` (19.74px) | lead |
| `--fs-5` | `1.5rem` (24px) | título de seção |
| `--fs-6` | `1.9375rem` (31px) | título grande |

Números grandes (métricas) usam **400**, não 500 — a referência faz assim e fica
mais elegante que negrito.

## 4. Espaçamento, raio, movimento

```
--s-2: 8px    --s-3: 16px   --s-4: 24px   --s-5: 32px
--s-6: 48px   --s-7: 64px   --s-8: 96px   --s-9: 128px
--gutter: clamp(20px, 5vw, 72px)
--r-1: 2px    --r-2: 8px
--shadow-1: 0 1px 0 rgba(255,255,255,.06)
--shadow-2: 0 8px 24px rgba(0,0,0,.55)
--t: 200ms    --ease: cubic-bezier(.22, 1, .36, 1)
--measure: 860px
```

Movimento é **200 ms com saída suave**. Nada de bounce, nada de elástico.
Hover muda `background` para `--bg-3` e a borda para `--line-strong`; é só isso.

## 5. O logo

- **Símbolo** (`logo.svg`): anel aberto com o glifo `p`. Ícone, favicon, bullet de
  seção. Sempre quadrado, nunca esticado.
- **Wordmark** (`wordmark-pi.svg`): "SelfEvoPI" desenhado. Banner do CLI, cabeçalho
  do desktop. Largura mínima 240 px.
- **Wordmark em anel** (`wordmark-pi-circulo.svg`): lockup fechado. Tela de abertura.
- **No escuro**: o traço original é `#111` e desaparece contra `#000`. Use branco
  (`currentColor` com `color: #fff`) — o SVG já foi desenhado para isso.
- **Nunca**: recolorir fora da paleta, girar, somar sombra, ou pôr sobre imagem sem
  contraste verificado.

## 6. CLI — anatomia

```
  ◍  SelfEvoPI                                         v0.5.0
  ────────────────────────────────────────────────────────────────
  pronto · 443 ms a frio · 29 tarefas · baseline 86/87
  ────────────────────────────────────────────────────────────────

   ESTADO DO HARNESS
   Último estado verde em 17/11, 10:42.
   Nenhum gap acionável.

   > 1  Estado do harness
     2  Detectar lacunas
     3  Rodar evals estruturais
     4  Verificação completa
     5  Gate de regressão
     6  O que já foi gerado
     7  Abrir painel
     q  Sair

  ────────────────────────────────────────────────────────────────
  ↑↓ navegar   enter escolher   q sair
```

Regras:
- 72 colunas; em 80 não pode quebrar.
- Sem caixa de tracejado grosso. Se usar linha, é `─` e `│`.
- Cor só em estado (o ponto de 8 px ou o rótulo) e na linha de seleção (fundo `--bg-3`).
- Sem spinner decorativo. Se precisar indicar espera, mostre progresso real.
- Toda tela tem rodapé com as teclas disponíveis.
- `q` sai de qualquer tela; `Esc` volta.

## 7. Desktop — anatomia

Janela de app (Edge/Chrome em `--app`), 1280×820, sem barra de endereço.

```
┌──────────────────────────────────────────────────────────────────┐
│  ◍  SelfEvoPI                                     127.0.0.1:7777 │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   449                86/87                 443 ms                │
│   testes             baseline              cold start            │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  TAXA POR GRUPO                                                  │
│   A  ████████████ 8/8    B  ████████████ 8/8                     │
│   C  ██████████ 6/6      D  ███████████ 7/7                      │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  ÚLTIMAS EXECUÇÕES                                               │
│   ...                                                            │
└──────────────────────────────────────────────────────────────────┘
```

- Fundo `--bg`, cartões `--bg-2`, hover `--bg-3`.
- Linhas a 8%. Sem sombra nos cartões — só a borda.
- Números grandes em 400, cinza `--muted` para o rótulo.
- Cor de estado só nas bolinhas de status.
- Nenhuma animação além da transição de 200 ms.

## 8. O que não fazer

- Não inventar cor que não esteja na tabela da seção 2.
- Não usar as cores de estado como decoração.
- Não usar emoji como ícone.
- Não usar gradiente para "dar profundidade".
- Não pôr texto sobre o traço do logo.
- Não usar peso 600/700.
- Não usar fonte mono — nem para número, nem para código.
- Não fazer a CLI depender de `pi` instalado.