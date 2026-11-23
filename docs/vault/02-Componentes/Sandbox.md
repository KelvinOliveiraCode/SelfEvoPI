---
tags: [componentes, sandbox]
created: 2026-11-19
---

# Sandbox

> Gate estático + Node Permission Model + Job Objects.

## Camadas

1. **Gate estático** (`core/sandbox/static-gate.mjs`) — analisa código antes de executar. Bloqueia `fetch`, `child_process`, leitura de credenciais, registry, paths fora do workspace.
2. **Node Permission Model** — isolamento em runtime. Recusa `fs.readFile` fora do workdir, `fetch`, `net.connect`, `child_process`.
3. **Job Objects** (Windows) — contenção de processos. Descartado com número na mesa (ver `docs/fase2/sandbox.md`).

`core/sandbox/keepalive.mjs` registra processos de fundo e decide na saída entre manter e encerrar. A política usa relógio e executor injetáveis, e a CLI liga o executor ao `killTree`. Isso evita o erro medido em outras harnesses de matar ao sair um servidor que uma tarefa ainda precisava.

## Observabilidade

`core/sandbox/telemetry.mjs` registra toda decisão `block`/`warn` em
`.pi/harness/ledger/blocked.jsonl` (caminho relativo, excerpt redigido, sem
segredos). A gravação é best-effort e não muda a decisão do gate. O comando
`/security-log` consulta as últimas entradas. O gate permanece puro: quem
registra é `core/sandbox/run-sandboxed.mjs`, no ponto em que a decisão já foi
tomada.

## O que o gate bloqueia

| Regra | Exemplo |
|:---|:---|
| `ssh-access` | `fs.readFileSync(path.join(os.homedir(), '.ssh/...'))` |
| `credential-store` | `fs.readFileSync('.pi/auth.json')` |
| `registry-exe` | `reg.exe add HKCU\...` |
| `recursive-force-delete` | `Remove-Item -Recurse -Force C:\...` |
| `child-process` | `execSync('dir')` |
| `network-access` | `fetch('https://...')` |
| `dynamic-eval` | `new Function('...')` |
| `secret-env-read` | `process.env.GITHUB_TOKEN` |
| `embedded-secret` | `"sk-abcdefghijklmnopqrstuvwx"` |
| `pi-state-access` | `fs.readFileSync('.pi/settings.json')` |
| `outside-workspace-path` | `fs.readFileSync('D:\dados\...')` |

## Modos

Ver [[05-Decisoes/Modos]] para os 5 modos (plan/build/manual/ask/goal).

## Princípio

`verify.mjs` roda fora do sandbox; o artefato que ele invoca roda dentro. Exceção no gate criaria um buraco explorável por renomeação.