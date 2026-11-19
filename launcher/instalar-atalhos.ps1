# ============================================================================
#  instalar-atalhos.ps1 - poe os lancadores na Area de Trabalho
#
#  - preserva os lancadores antigos como *-antigo.cmd (nunca apaga nada)
#  - copia os dois .cmd novos (SelfEvoPI.cmd e SelfEvoPI-Desktop.cmd)
#  - cria os .lnk com o icone da marca (um .cmd nao carrega icone sozinho;
#    o atalho .lnk e o que carrega)
#
#  Os dois atalhos abrem a MESMA conversa: rodam com o mesmo cwd (o repositorio),
#  e o pi guarda a sessao em ~/.pi/agent/sessions/<cwd-codificado>/.
#
#  Uso:
#    pwsh launcher/instalar-atalhos.ps1
#    pwsh launcher/instalar-atalhos.ps1 -Repo "D:\projetos\SelfEvoPI"
#    pwsh launcher/instalar-atalhos.ps1 -NoShortcuts
#
#  Idempotente: rodar de novo nao perde o backup antigo.
# ============================================================================

[CmdletBinding()]
param(
    [string]$Repo,
    [switch]$NoShortcuts
)

$ErrorActionPreference = 'Stop'

if (-not $Repo) {
    $Repo = Split-Path -Parent $PSScriptRoot
}
$Repo = [System.IO.Path]::GetFullPath($Repo)

function Morre($msg) {
    Write-Host ""
    Write-Host "  erro: $msg" -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------- validacao --
if (-not (Test-Path (Join-Path $Repo 'package.json'))) {
    Morre "nao achei package.json em $Repo"
}
if (-not (Test-Path (Join-Path $Repo 'core\forge'))) {
    Morre "nao achei core\forge em $Repo (parece nao ser o SelfEvoPI)"
}

$fonteCli      = Join-Path $PSScriptRoot 'SelfEvoPI.cmd'
$fonteDesktop  = Join-Path $PSScriptRoot 'SelfEvoPI-Desktop.cmd'
$icone         = Join-Path $Repo 'assets\selfevopi.ico'

if (-not (Test-Path $fonteCli))     { Morre "faltou $fonteCli" }
if (-not (Test-Path $fonteDesktop)) { Morre "faltou $fonteDesktop" }

$desktop = [Environment]::GetFolderPath('Desktop')
if (-not $desktop -or -not (Test-Path $desktop)) {
    Morre "nao achei a Area de Trabalho"
}

Write-Host ""
Write-Host "  SelfEvoPI - instalando lancadores"
Write-Host "  repositorio : $Repo"
Write-Host "  area de trabalho: $desktop"
Write-Host ""

# ------------------------------------------------------- lancadores antigos --
#  Um arquivo antigo e reconhecido por NAO ter SELFEOPI_ROOT dentro: os novos
#  descobrindo a raiz, os antigos tinham caminho fixo.
function E-Antigo($caminho) {
    if (-not (Test-Path $caminho)) { return $false }
    $txt = Get-Content -LiteralPath $caminho -Raw -ErrorAction SilentlyContinue
    if (-not $txt) { return $true }
    return ($txt -notmatch 'SELFEOPI_ROOT')
}

#  Cada par: cmd (arquivo no repo), antigo (nome do backup na Area de Trabalho),
#  legado (nomes anteriores que este atalho substitui e que merecem backup),
#  lnk (atalho) e desc (texto do .lnk).
$pares = @(
    @{
        cmd    = 'SelfEvoPI.cmd'
        antigo = 'SelfEvoPI-CLI-antigo.cmd'
        legado = @()
        lnk    = 'SelfEvoPI.lnk'
        desc   = 'SelfEvoPI - abrir a CLI'
    }
    @{
        cmd    = 'SelfEvoPI-Desktop.cmd'
        antigo = 'SelfEvoPI-Painel-antigo.cmd'
        legado = @('SelfEvoPI-Painel.cmd')
        lnk    = 'SelfEvoPI-Desktop.lnk'
        desc   = 'SelfEvoPI - abrir o desktop'
    }
)

foreach ($par in $pares) {
    $destCmd    = Join-Path $desktop $par.cmd
    $destAntigo = Join-Path $desktop $par.antigo

    # 1. nomes legados (ex.: SelfEvoPI-Painel.cmd) viram *-antigo.cmd
    foreach ($nomeLegado in $par.legado) {
        $caminhoLegado = Join-Path $desktop $nomeLegado
        if (-not (Test-Path $caminhoLegado)) { continue }

        if (Test-Path $destAntigo) {
            Write-Host ("  ja havia backup: " + $par.antigo + " (mantido)") -ForegroundColor DarkGray
        }
        else {
            Rename-Item -LiteralPath $caminhoLegado -NewName $par.antigo
            Write-Host ("  legado preservado: " + $nomeLegado + " -> " + $par.antigo) -ForegroundColor DarkGray
        }
    }

    # 2. arquivo antigo sem SELFEOPI_ROOT (caminho fixo) tambem vira backup
    if ((E-Antigo $destCmd) -and (-not (Test-Path $destAntigo))) {
        Rename-Item -LiteralPath $destCmd -NewName $par.antigo
        Write-Host ("  antigo preservado: " + $par.antigo) -ForegroundColor DarkGray
    }
    elseif ((E-Antigo $destCmd) -and (Test-Path $destAntigo)) {
        Write-Host ("  ja havia backup: " + $par.antigo + " (mantido)") -ForegroundColor DarkGray
    }

    # 3. copia a versao nova
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $par.cmd) -Destination $destCmd -Force
    Write-Host ("  instalado: " + $par.cmd) -ForegroundColor Green
}

# --------------------------------------------------------------- atalhos ----
$temIcone = Test-Path -LiteralPath $icone

if (-not $NoShortcuts) {
    $ws = New-Object -ComObject WScript.Shell

    foreach ($par in $pares) {
        $lnkPath = Join-Path $desktop $par.lnk
        $alvo    = Join-Path $desktop $par.cmd

        $lnk = $ws.CreateShortcut($lnkPath)
        $lnk.TargetPath = $alvo
        $lnk.WorkingDirectory = $Repo
        $lnk.Description = $par.desc
        $lnk.WindowStyle = 1
        if ($temIcone) { $lnk.IconLocation = "$icone,0" }
        $lnk.Save()

        $estado = if ($temIcone) { "com icone" } else { "SEM icone" }
        Write-Host ("  atalho: " + $par.lnk + " ($estado)") -ForegroundColor Green
    }
}
else {
    Write-Host "  atalhos .lnk ignorados (-NoShortcuts)" -ForegroundColor DarkGray
}

Write-Host ""

if ($temIcone) {
    $tamanho = (Get-Item -LiteralPath $icone).Length
    Write-Host "  icone: assets\selfevopi.ico ($tamanho bytes)"
}
else {
    Write-Host "  icone: assets\selfevopi.ico AUSENTE - atalhos ficaram sem icone" -ForegroundColor Yellow
}

# ------------------------------------------------------------------ PATH ----
#  Adiciona o diretorio do launcher ao PATH do usuario (sem admin), para que
#  "selfevopi" funcione de qualquer diretorio no terminal. Idempotente: se
#  ja estiver la, nao duplica. O usuario precisa reabrir o terminal para
#  que a mudanca tenha efeito.

$launcherDir = $PSScriptRoot
$pathUsuario = [Environment]::GetEnvironmentVariable('Path', 'User')

if ($pathUsuario -notlike "*$launcherDir*") {
    $novoPath = "$pathUsuario;$launcherDir"
    [Environment]::SetEnvironmentVariable('Path', $novoPath, 'User')
    Write-Host "  PATH: adicionado $launcherDir (reabra o terminal)" -ForegroundColor Green
} else {
    Write-Host "  PATH: $launcherDir ja esta no PATH" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "  pronto. dois cliques na Area de Trabalho abrem a CLI e o desktop."
Write-Host "  os dois rodam de $Repo, entao compartilham a mesma sessao."
Write-Host "  digite 'selfevopi' no terminal (qualquer pasta) para abrir a CLI."
Write-Host ""