# ============================================================================
#  instalar-atalhos.ps1 - poe os lancadores na Area de Trabalho
#
#  - renomeia os lancadores antigos para *-antigo.cmd (nao apaga nada)
#  - copia os novos .cmd
#  - cria os .lnk com o icone da marca (um .cmd nao carrega icone sozinho;
#    o atalho .lnk e o que carrega)
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

$fonteCli    = Join-Path $PSScriptRoot 'SelfEvoPI.cmd'
$fontePainel = Join-Path $PSScriptRoot 'SelfEvoPI-Painel.cmd'
$icone       = Join-Path $Repo 'assets\selfevopi.ico'

if (-not (Test-Path $fonteCli))    { Morre "faltou $fonteCli" }
if (-not (Test-Path $fontePainel)) { Morre "faltou $fontePainel" }

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

$pares = @(
    @{ cmd = 'SelfEvoPI.cmd';         antigo = 'SelfEvoPI-CLI-antigo.cmd';    lnk = 'SelfEvoPI.lnk';         desc = 'SelfEvoPI - abrir a CLI' }
    @{ cmd = 'SelfEvoPI-Painel.cmd';  antigo = 'SelfEvoPI-Painel-antigo.cmd'; lnk = 'SelfEvoPI-Painel.lnk';  desc = 'SelfEvoPI - abrir o painel' }
)

foreach ($par in $pares) {
    $destCmd    = Join-Path $desktop $par.cmd
    $destAntigo = Join-Path $desktop $par.antigo

    if ((E-Antigo $destCmd) -and (-not (Test-Path $destAntigo))) {
        Rename-Item -LiteralPath $destCmd -NewName $par.antigo
        Write-Host ("  antigo preservado: " + $par.antigo) -ForegroundColor DarkGray
    }
    elseif ((E-Antigo $destCmd) -and (Test-Path $destAntigo)) {
        Write-Host ("  ja havia backup: " + $par.antigo + " (mantido)") -ForegroundColor DarkGray
    }

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
} else {
    Write-Host "  atalhos .lnk ignorados (-NoShortcuts)" -ForegroundColor DarkGray
}

Write-Host ""

if ($temIcone) {
    $tamanho = (Get-Item -LiteralPath $icone).Length
    Write-Host "  icone: assets\selfevopi.ico ($tamanho bytes)"
} else {
    Write-Host "  icone: assets\selfevopi.ico AUSENTE - atalhos ficaram sem icone" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  pronto. dois cliques na Area de Trabalho abrem a CLI e o painel."
Write-Host ""