---
tags: [replicação]
created: 2026-11-19
---

# Replicação

> Como montar o SelfEvoPI do zero, 1:1.

## Pré-requisitos

- Windows 10/11 x64
- Node.js 24.13+
- Git

## Passo a passo

### 1. Clonar o repositório

```powershell
git clone <repo-privado> SelfEvoPI
cd SelfEvoPI
```

### 2. Instalar o PI Coding Agent

```powershell
npm install -g @earendil-works/pi-coding-agent
```

Ou usar o instalador: https://pi.dev/install.ps1

### 3. Configurar providers

```powershell
node scripts/import-providers.mjs --apply
```

Gera `~/.pi/agent/models.json` com as contas configuradas.

### 4. Verificar

```powershell
npm test
npm run verify
node evals/gate.mjs
```

### 5. Agendar rotina diária

```powershell
node scripts/schedule.mjs --install
```

Registra `SelfEvoPI-Daily` no Task Scheduler (07:00 diário).

### 6. (Opcional) Launcher no PATH

```powershell
pwsh launcher/instalar-atalhos.ps1
```

Adiciona o `launcher/` ao PATH do usuário (sem admin, idempotente) e cria atalhos
na Área de Trabalho. Depois, `selfevopi` abre a CLI de qualquer terminal.

## Estrutura de diretórios

```
SelfEvoPI/
├── apps/              CLI
├── core/              Roteador, forge, sandbox, memória, grafo, governança
├── scripts/           Automação (daily, schedule, measure, etc.)
├── evals/             Suíte de evals determinística
├── docs/              Documentação
├── .pi/harness/       Estado do harness (LKG, ledger, sessões)
└── package.json       Zero dependências
```

## Verificação pós-instalação

| Comando | Esperado |
|:---|:---|
| `node apps/cli.mjs --version` | versão do SelfEvoPI |
| `node apps/cli.mjs --help` | lista de comandos |
| `node scripts/schedule.mjs --status` | "SelfEvoPI-Daily: agendado" |
| `node scripts/daily.mjs --dry-run` | diagnóstico sem aplicar |

Ver [[00-Mapa]] para navegar pelo resto da vault.