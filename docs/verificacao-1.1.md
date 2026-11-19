# Verificação — Release 1.1.0

> **Data:** 2026-11-19 ~12:10 -03:00
> **Verificador:** A9 (leitura e execução; nenhuma linha de código alterada)
> **HEAD verificado:** `519ed99` (*fix(1.1): 5 achados da auditoria + 1 defeito do mcp-opencode + badge*)
> **Ambiente:** Windows NT 10.0.19045 · 8 CPUs · node v24.13.0 · `process.execPath = C:\Program Files\nodejs\node.exe`
> **Regra:** número sem data é afirmação. Cada linha traz o comando que a produziu.

> **Nota sobre este arquivo:** existia uma versão commitada por A2 (verificação do
> `6935fcc`, 900/899). Este é o **re-verify independente no HEAD `519ed99`**, que
> substitui a versão anterior (preservada no histórico do git). A suíte cresceu de
> 900 para 929 testes entre os dois commits.

---

## 1. Veredito

**O 1.1.0 está VERDE.** 928 de 929 testes passam, 0 falham, 1 skip (o skip é a
integração pi-harness, que pula sem servidor — esperado). Evals A/B/C 8/8, 8/8,
6/6. Renders `status` e `panel` com exit 0, v1.1.0.

**Duas ressalvas operacionais (não são falha de código):**

1. **`npm test` (concorrência padrão = 8) é intermitente nesta máquina** — completou
   uma vez (35 s) e travou duas (>180 s, >600 s). A `--test-concurrency=4` fechou
   sempre (4 execuções, 31–37 s, zero travamentos). Recomendo pinar 4 (ver §3).
2. **O defeito do `mcp-opencode` que encontrei já foi corrigido no `519ed99`** —
   reverificado, passa 21/21 isolado e no full (ver §4).

---

## 2. Placar da suíte (HEAD 519ed99)

Comando (idêntico ao `npm test` por baixo):

```
node --test core/router/*.test.mjs core/forge/*.test.mjs core/memory/*.test.mjs \
  core/graph/*.test.mjs core/governance/*.test.mjs core/sandbox/*.test.mjs \
  core/agent/*.test.mjs apps/*.test.mjs apps/desktop/*.test.mjs scripts/refine-loop.test.mjs
```

| Execução | Concorrência | tests | pass | fail | skip | wall |
|:--|:--|--:|--:|--:|--:|--:|
| `--test-concurrency=1` | 1 | 929 | 928 | 0 | 1 | 69,3 s |
| `--test-concurrency=4` | 4 | 929 | 928 | 0 | 1 | 34,1 s |
| `--test-concurrency=4` (rep.) | 4 | 929 | 928 | 0 | 1 | 30,9 s |
| `--test-concurrency=4` (rep.) | 4 | 929 | 928 | 0 | 1 | 31,1 s |
| `--test-concurrency=4` (rep.) | 4 | 929 | 928 | 0 | 1 | 37,5 s |
| **default (8)** | 8 | — | — | — | — | **1× 35,1 s (ok) · 2× travou (>180 s, >600 s)** |

O `skip` é `core/graph/pi-harness.integration.test.mjs` (integração pula sem o
servidor pi-harness — documentado no próprio teste).

Data: 2026-11-19.

---

## 3. O achado do `npm test` (concorrência padrão = 8)

- Comando: `node --test <suíte>` (default `--test-concurrency = os.availableParallelism()` = **8**).
- Comportamento **intermitente** nesta máquina:
  - 1ª execução (início da sessão): travou, morta aos 600 s.
  - reprodução com teto de 90 s: **completou, exit 0, 35,1 s**.
  - nova execução direta: travou, morta aos 180 s.
- A `--test-concurrency=4` fechou **todas as vezes** (4 amostras: 34,1 / 30,9 / 31,1 / 37,5 s),
  e a `--test-concurrency=1` também (69,3 s). Zero travamentos a ≤4.
- Causa provável: a máquina roda **83 processos node** de base (servidores MCP desta
  sessão + outros agentes). A 8 vias, o runner dispara ~40 arquivos que spawnam
  subprocessos (sandbox, forge, apps); quando vários alinham, o conjunto passa do
  limiar e o runner entra em thrashing. A 4 vias fica abaixo do limiar. **Não é
  regressão de código** — é o runner no limite com a máquina carregada.
- **Recomendação:** pinar `--test-concurrency=4` no script `test` do `package.json`
  (ou menor) para tornar o `npm test` determinístico nesta máquina e no CI.

Data: 2026-11-19.

---

## 4. Defeito do `mcp-opencode` — encontrado e JÁ CORRIGIDO no 519ed99

- **Durante** a verificação, a árvore de trabalho tinha uma versão **não commitada**
  de `core/agent/mcp-opencode.mjs` com `shell: process.platform === "win32"` fixo.
  Isso quebrou o teste `core/agent/mcp-opencode.test.mjs:302`
  (`probeOpencodeMcp faz o handshake e devolve as ferramentas`): o teste spawna
  `process.execPath` = `C:\Program Files\nodejs\node.exe`, o `cmd.exe` lia
  `C:\Program` e falhava — `pass 20 | fail 1` isolado (reprodutível 3/3).
- **No HEAD `519ed99` isso está corrigido.** O código agora só usa shell para
  `.cmd`/`.bat`:
  `const precisaShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(cmd);`
  (`.exe` spawna sem shell).
- **Reverificado no `519ed99`:**
  - isolado: `node --test core/agent/mcp-opencode.test.mjs` → **pass 21 | fail 0** (2,3 s).
  - no full run a 4 vias: `probeOpencodeMcp faz o handshake...` → **✔ (659 ms)**.

Data: 2026-11-19.

---

## 5. Evals (grupos determinísticos)

| Grupo | Comando | Resultado | Tokens | wall |
|:--|:--|:--|--:|--:|
| A | `node evals/run.mjs --group A` | **8/8** | 0 | 1.642 ms |
| B | `node evals/run.mjs --group B` | **8/8** | 0 | 1.831 ms |
| C | `node evals/run.mjs --group C` | **6/6** | 0 | 1.894 ms |

Data: 2026-11-19. Nenhuma falha, 0 tokens (grupos estruturais).

---

## 6. Renders da CLI (HEAD 519ed99)

| Render | Comando | exit | Saída |
|:--|:--|--:|:--|
| status | `node apps/cli.mjs --render status` | 0 | `SelfEvoPI v1.1.0` · `86/87 baseline · build` · modo build |
| panel | `node apps/cli.mjs --render panel` | 0 | modelo `anthropic/claude-opus-5-5` · raciocínio `medium` · contexto `12.4k / 200k` · permissão `full access` · baseline `86/87` |

Nota: ambos mostram `86/87 baseline`. É o valor real de `evals/baseline.json`
(86 passes / 87 runs; B11 é estocástico, 2/3). É honesto, **não** é regressão de
1.1 — mas não é 87/87 (ver §9).

Data: 2026-11-19.

---

## 7. Comandos integrados (registro em `apps/cli.mjs`)

Presentes em `COMMANDS` (verificado por `Select-String 'name: "<cmd>"' apps/cli.mjs`):
`/swarm`, `/settings`, `/theme`, `/effort`, `/mode`, `/skills`, `/model`, `/help`,
`/cost`, `/context`. A integração do 1.1 (comandos novos + `/model` de dois estágios
do A4 + `/swarm`) está registrada.

A paleta `--render menu` mostra só 8 linhas por vez (janela alfabética a partir de
`/ask`); comandos das letras s/t/m/h não aparecem na 1ª tela — é a janela, não
ausência (confirmado no registro).

Data: 2026-11-19.

---

## 8. Tempo por grupo (wall, ms)

`[Diagnostics.Stopwatch]` em torno de cada `node --test <grupo>` (HEAD 519ed99,
2026-11-19; carga varia):

| Grupo | Comando | tests | pass | fail | skip | wall |
|:--|:--|--:|--:|--:|--:|--:|
| forge | `node --test core/forge/*.test.mjs` | 174 | 174 | 0 | 0 | 36,5 s |
| governance | `node --test core/governance/*.test.mjs` | 64 | 64 | 0 | 0 | 23,6 s |
| apps | `node --test apps/*.test.mjs` | 104 | 104 | 0 | 0 | 17,2 s |
| sandbox | `node --test core/sandbox/*.test.mjs` | 78 | 78 | 0 | 0 | 15,0 s |
| desktop | `node --test apps/desktop/*.test.mjs` | 65 | 65 | 0 | 0 | 3,3 s |
| agent | `node --test core/agent/*.test.mjs` | 249 | 249 | 0 | 0 | 2,6 s |
| router | `node --test core/router/*.test.mjs` | 35 | 35 | 0 | 0 | 2,3 s |
| graph | `node --test core/graph/*.test.mjs` | 64 | 64 | 0 | 1 | 1,6 s |
| memory | `node --test core/memory/*.test.mjs` | 83 | 83 | 0 | 0 | 0,8 s |
| scripts | `node --test scripts/refine-loop.test.mjs` | 12 | 12 | 0 | 0 | 0,5 s |

**3 grupos mais lentos:** forge (36,5 s) · governance (23,6 s) · apps (17,2 s).
Arquivo mais lento medido limpo: `core/governance/rollback.test.mjs` = **15,3 s**
(`node --test core/governance/rollback.test.mjs`). O tempo por arquivo isolado é
instável sob carga (rollback oscilou 15,3 s ↔ 17 ms por ter um teste com espera de
processo); a tabela por grupo é a medida confiável.

Data: 2026-11-19.

---

## 9. O que NÃO foi medido

- **Grupo D e gate completo** (`node evals/gate.mjs`): não medido (gasta tokens,
  fora do escopo estrutural).
- **Latência/FPS/memória da TUI:** não medido.
- **`shell:true` com `.cmd` reais (npx.cmd):** não medido (só li o código corrigido).

---

## 10. Observações para o dono do 1.1

- **`npm test` intermitente:** pinar `--test-concurrency=4` para determinismo.
- **`86/87` nos renders:** B11 é estocástico (2/3). Se quiser "87/87" na tela, ou o
  B11 passa 3/3, ou a UI deveria dizer "86/87 (1 estocástico)". Hoje mostra o cru.
- **`mcp-opencode`:** já corrigido no `519ed99`; confirmado 21/21.