# ============================================================================
#  Instala o lancador da CLI na Area de Trabalho.
#  Idempotente: rodar de novo nao duplica nada e preserva backups antigos.
#
#  Uso:
#    pwsh launcher/instalar-atalhos.ps1
#    pwsh launcher/instalar-atalhos.ps1 -Repo "D:\projetos\SelfEvoPI"
#    pwsh launcher/instalar-atalhos.ps1 -NoShortcuts
# ============================================================================

[CmdletBinding()]
param(
    [string]$Repo,
    [switch]$NoShortcuts
)

$ErrorActionPreference = 'Stop'

if (-not $Repo) { $Repo = Split-Path -Parent $PSScriptRoot }
$Repo = [System.IO.Path]::GetFullPath($Repo)

function Morre($msg) {
    Write-Host ""
    Write-Host "  erro: $msg" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path (Join-Path $Repo 'package.json'))) { Morre "nao achei package.json em $Repo" }
if (-not (Test-Path (Join-Path $Repo 'core\forge'))) { Morre "nao achei core\forge em $Repo" }

$fonteCli = Join-Path $PSScriptRoot 'SelfEvoPI.cmd'
$icone = Join-Path $Repo 'assets\selfevopi.ico'
if (-not (Test-Path $fonteCli)) { Morre "faltou $fonteCli" }

$areaTrabalho = [Environment]::GetFolderPath('Desktop')
if (-not $areaTrabalho -or -not (Test-Path $areaTrabalho)) { Morre "nao achei a Area de Trabalho" }

Write-Host ""
Write-Host "  SelfEvoPI - instalando o lancador da CLI"
Write-Host "  repositorio   : $Repo"
Write-Host "  area de trabalho: $areaTrabalho"
Write-Host ""

$destCmd = Join-Path $areaTrabalho 'SelfEvoPI.cmd'
$backup = Join-Path $areaTrabalho 'SelfEvoPI-CLI-antigo.cmd'

# Um lancador antigo e reconhecido por NAO ter SELFEOPI_ROOT dentro.
$antigo = $false
if (Test-Path $destCmd) {
    $txt = Get-Content -LiteralPath $destCmd -Raw -ErrorAction SilentlyContinue
    $antigo = (-not $txt) -or ($txt -notmatch 'SELFEOPI_ROOT')
}
if ($antigo) {
    if (-not (Test-Path $backup)) { Rename-Item -LiteralPath $destCmd -NewName 'SelfEvoPI-CLI-antigo.cmd' }
    Write-Host "  antigo preservado como SelfEvoPI-CLI-antigo.cmd" -ForegroundColor DarkGray
}

Copy-Item -LiteralPath $fonteCli -Destination $destCmd -Force
Write-Host "  instalado: SelfEvoPI.cmd" -ForegroundColor Green

$temIcone = Test-Path -LiteralPath $icone
if (-not $NoShortcuts) {
    $ws = New-Object -ComObject WScript.Shell
    $lnkPath = Join-Path $areaTrabalho 'SelfEvoPI.lnk'
    $lnk = $ws.CreateShortcut($lnkPath)
    $lnk.TargetPath = $destCmd
    $lnk.WorkingDirectory = $Repo
    $lnk.Description = 'SelfEvoPI - abrir a CLI'
    $lnk.WindowStyle = 1
    if ($temIcone) { $lnk.IconLocation = "$icone,0" }
    $lnk.Save()
    $estado = if ($temIcone) { "com icone" } else { "SEM icone" }
    Write-Host "  atalho: SelfEvoPI.lnk ($estado)" -ForegroundColor Green
}

# "selfevopi" de qualquer diretorio no terminal.
$launcherDir = $PSScriptRoot
$pathUsuario = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($pathUsuario -notlike "*$launcherDir*") {
    [Environment]::SetEnvironmentVariable('Path', "$pathUsuario;$launcherDir", 'User')
    Write-Host "  PATH: adicionado $launcherDir (reabra o terminal)" -ForegroundColor Green
}

Write-Host ""
Write-Host "  pronto. o atalho abre a CLI em $Repo."
Write-Host "  digite 'selfevopi' no terminal (qualquer pasta) para abrir a CLI."
Write-Host ""
