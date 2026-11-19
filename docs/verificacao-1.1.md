# Verificação — Release 1.1.0

> **Data:** 2026-11-19 11:57:34 -03:00
> **Verificador:** A9 (leitura e execução; nenhuma linha de código alterada)
> **HEAD no momento:** `86bfd3e`
> **Ambiente:** Windows NT 10.0.19045 · 8 CPUs · node v24.13.0 · `process.execPath = C:\Program Files\nodejs\node.exe`
> **Regra:** número sem data é afirmação. Cada linha traz o comando que a produziu.

---

## 1. Veredito

**O 1.1.0 está VERDE na suíte, com uma ressalva operacional e um risco latente:**

- A suíte inteira passa: **928 passam, 0 falham, 1 skip** (929 testes) — medida a
  `--test-concurrency=1` e a `--test-concurrency=4`.
- **`npm test` (concorrência padrão = 8) NÃO completa nesta máquina** — trava por
  oversubscription (83 processos node vivos, ver §3). Não é falha de teste; é o
  runner no limite com a máquina carregada.
- **Um teste isolado falha de forma não-determinística** (`mcp-opencode`), causado
  por uma mudança **não commitada** (`shell:true`) que não aspira caminhos com
  espaço — risco real para MCPs cujo executável está em `C:\Program Files\...`
  (ver §4). A suíte inteira mascara isso; a execução isolada expõe.

---

## 2. Placar da suíte

Comando (idêntico ao `npm test` por baixo):

```
node --test core/router/*.test.mjs core/forge/*.test.mjs core/memory/*.test.mjs \
  core/graph/*.test.mjs core/governance/*.test.mjs core/sandbox/*.test.mjs \
  core/agent/*.test.mjs apps/*.test.mjs apps/desktop/*.test.mjs scripts/refine-loop.test.mjs
```

| Execução | Comando | tests | pass | fail | skip | wall |
|:--|:--|--:|--:|--:|--:|--:|
| Serial | `node --test --test-concurrency=1 <suíte>` | 929 | 928 | 0 | 1 | 69.310 ms (69,3 s) |
| 4 vias | `node --test --test-concurrency=4 <suíte>` | 929 | 928 | 0 | 1 | 34.099 ms (34,1 s) |
| 4 vias (rep.) | `node --test --test-concurrency=4 <suíte>` | 929 | 928 | 0 | 1 | 30.925 ms (30,9 s) |
| 4 vias (rep.) | `node --test --test-concurrency=4 <suíte>` | 929 | 928 | 0 | 1 | 37.518 ms (37,5 s) |
| **8 vias (default)** | `node --test <suíte>` (npm test) | — | — | — | — | **não completa (>600 s, morto)** |

O `skip` é o `core/graph/pi-harness.integration.test.mjs` (integração pula sem o
servidor pi-harness de pé — comportamento esperado, documentado no próprio teste).

Data: 2026-11-19.

---

## 3. O achado do `npm test` (concorrência padrão)

- Comando: `node --test <suíte>` (default `--test-concurrency` = `os.availableParallelism()` = **8** nesta máquina).
- Resultado: **não terminou em 600 s** (morto com SIGTERM). Numa reprodução com
  teto de 150 s, continuava rodando (morto aos 150 s); o stdout mostrava testes
  executando (`REPL /model: seletor abre...`), ou seja, não era erro de argumento.
- Causa: a máquina tinha **83 processos node vivos** no momento
  (`Get-Process node | Measure`), muitos são os servidores MCP desta sessão
  (serena, basic-memory, etc.) e outros são filhos de execuções de teste
  anteriores. A 8 vias, o runner dispara ~40 arquivos que por sua vez spawnam
  subprocessos (sandbox, forge, apps) → dezenas de processos node sobre 8 CPUs →
  thrashing. A 4 vias e a 1 via o mesmo conjunto fecha (34 s e 69 s).
- **Recomendação:** pinar `--test-concurrency=4` no script `test` do `package.json`
  (ou menor), ou garantir máquina limpa no CI. Num host sem os ~70 processos MCP,
  a concorrência 8 provavelmente fecharia; aqui, não.

Data: 2026-11-19.

---

## 4. Risco latente — `mcp-opencode.test.mjs` e o `shell:true` não commitado

- **Comando que falha (isolado):**
  `node --test core/agent/mcp-opencode.test.mjs` → `pass 20 | fail 1` (~7 s),
  reprodutível 3/3 vezes.
- **Teste:** `core/agent/mcp-opencode.test.mjs:302` —
  `"probeOpencodeMcp faz o handshake e devolve as ferramentas"`.
- **Asserção (linha 320):** `assert.equal(r.ok, true, ...)` → `actual: false`.
- **Erro observado:** `ok deveria ser true, erro=o servidor não respondeu ao
  initialize em 5000 ms — stderr: 'C:\Program' não é reconhecido como um comando
  interno`.
- **Causa:** `core/agent/mcp-opencode.mjs` está **modificado no working tree, não
  commitado** (`git diff HEAD` = +4 linhas), adicionando
  `shell: process.platform === "win32"` ao `spawn`. Com `shell:true` no Windows,
  o Node passa `cmd.exe /c "<cmd> <args>"` **sem aspirar o caminho do executável**;
  o teste spawna `process.execPath` = `C:\Program Files\nodejs\node.exe`, o
  `cmd.exe` lê `C:\Program` e falha. O handshake nunca acontece → timeout 5 s.
- **Por que some na suíte inteira:** no full run a 4 vias esse mesmo teste **passou**
  (659 ms). Ou seja, o comportamento é **não-determinístico / sensível ao contexto**
  de execução. Isso não o torna inofensivo: a mesma mudança quebra qualquer MCP
  cujo comando tenha espaço no caminho — e o próprio `CONTRATO-1.1.md` cita o
  CADCraft em `C:\Program Files\CADCraft\cadcraft-cli.exe` como exemplo real.
- **Intenção vs. efeito:** o comentário do autor ("um .cmd é recusado por spawn sem
  shell: EINVAL") é legítimo para `npx.cmd`/`uv.cmd`, mas a implementação não
  aspira o caminho e derruba `.exe` com espaço. **Não corrigi** (escopo: só medir).
- **Ação sugerida a quem é dono (A6):** ao usar `shell:true` no Windows, aspirar o
  executável (envolver `command[0]` em aspas) ou preferir `spawn` sem shell para
  `.exe` e reservar `shell` só para `.cmd`/`.bat`.

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

## 6. Renders da CLI

| Render | Comando | exit | Observação |
|:--|:--|--:|:--|
| status | `node apps/cli.mjs --render status` | 0 | `SelfEvoPI v1.1.0`, `86/87 baseline · build`, modo build |
| panel | `node apps/cli.mjs --render panel` | 0 | modelo `anthropic/claude-opus-5-5`, raciocínio `medium`, contexto `12.4k / 200k`, baseline `86/87` |

Nota: ambos mostram `86/87 baseline` — é o valor real de `evals/baseline.json`
(86 passes / 87 runs; B11 é estocástico 2/3). É dado honesto, **não** é regressão
de 1.1; mas o número exibido não é 87/87 (ver observação no fim).

Data: 2026-11-19.

---

## 7. Comandos integrados (registro em `apps/cli.mjs`)

Verificado por `Select-String 'name: "<cmd>"' apps/cli.mjs` (todos presentes em
`COMMANDS`): `/swarm`, `/settings`, `/theme`, `/effort`, `/mode`, `/skills`,
`/model`, `/help`, `/cost`, `/context`.

A paleta `--render menu` mostra só 8 linhas por vez (janela alfabética a partir de
`/ask`), então os comandos das letras s/t/m/h não aparecem na primeira tela — não é
ausência, é a janela de 8 linhas. Confirmado no registro.

Data: 2026-11-19.

---

## 8. Tempo por grupo (wall, ms)

Medido com `[Diagnostics.Stopwatch]` em torno de cada `node --test <grupo>`
(uma amostra, 2026-11-19; a carga da máquina varia):

| Grupo | Comando | tests | pass | fail | skip | wall |
|:--|:--|--:|--:|--:|--:|--:|
| forge | `node --test core/forge/*.test.mjs` | 174 | 174 | 0 | 0 | 36.531 ms |
| governance | `node --test core/governance/*.test.mjs` | 64 | 64 | 0 | 0 | 23.615 ms |
| apps | `node --test apps/*.test.mjs` | 104 | 104 | 0 | 0 | 17.202 ms |
| sandbox | `node --test core/sandbox/*.test.mjs` | 78 | 78 | 0 | 0 | 15.010 ms |
| desktop | `node --test apps/desktop/*.test.mjs` | 65 | 65 | 0 | 0 | 3.288 ms |
| agent | `node --test core/agent/*.test.mjs` | 249 | 249 | 0 | 0 | 2.602 ms |
| router | `node --test core/router/*.test.mjs` | 35 | 35 | 0 | 0 | 2.338 ms |
| graph | `node --test core/graph/*.test.mjs` | 64 | 64 | 0 | 1 | 1.578 ms |
| memory | `node --test core/memory/*.test.mjs` | 83 | 83 | 0 | 0 | 0.806 ms |
| scripts | `node --test scripts/refine-loop.test.mjs` | 12 | 12 | 0 | 0 | 0.465 ms |

**3 grupos mais lentos:** forge (36,5 s) · governance (23,6 s) · apps (17,2 s).

Arquivo mais lento medido individualmente de forma limpa:
`core/governance/rollback.test.mjs` = **15.269 ms** (15,3 s)
(`node --test core/governance/rollback.test.mjs`). O tempo por arquivo isolado é
instável sob carga (rollback mediu 15,3 s numa execução e 17 ms noutra, por ter um
teste com espera de processo), então a tabela por grupo acima é a medida confiável.

Data: 2026-11-19.

---

## 9. O que NÃO foi medido

- **Grupo D e gate completo** (`node evals/gate.mjs`): não medido (custa tokens e
  depende de credencial; fora do escopo desta verificação estrutural).
- **Latência/FPS/memória da TUI:** não medido.
- **Comportamento do `shell:true` em `.cmd` reais (npx.cmd):** não medido (só
  inferido do código e do erro observado).

---

## 10. Observação para o dono do 1.1

- **`86/87` nos renders:** o `baseline.json` tem 86/87 (B11 estocástico). Se o
  produto quer exibir "87/87", ou o B11 precisa passar 3/3, ou a UI deveria dizer
  "86/87 (1 estocástico)". Hoje mostra o número cru, que é honesto mas pode parecer
  regressão.
- **`shell:true` não commitado (mcp-opencode):** resolver antes de fechar — quebra
  caminho com espaço (CADCraft, node) e o teste já falha isolado.
- **`npm test` travando:** pinar `--test-concurrency=4` para não depender da carga
  da máquina.