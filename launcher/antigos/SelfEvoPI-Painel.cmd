@echo off
rem ==========================================================================
rem  SelfEvoPI - lancador do painel desktop
rem
rem  Abre o app desktop (modo janela) quando ele existe. Se ainda nao existir,
rem  diz isso e cai no navegador. Nunca falha em silencio.
rem
rem  Uso:
rem    SelfEvoPI-Painel.cmd              abre
rem    SelfEvoPI-Painel.cmd --dry-run    mostra o comando, sem executar
rem    SelfEvoPI-Painel.cmd --no-app     forca o modo navegador
rem
rem  A raiz e descoberta como no SelfEvoPI.cmd (SELFEOPI_ROOT, pasta ao lado,
rem  diretorio atual, Area de Trabalho/Documentos/pasta pessoal).
rem ==========================================================================
setlocal EnableExtensions EnableDelayedExpansion
title SelfEvoPI - Painel

set "MODO=texto"
if /i "%~1"=="--dry-run" set "MODO=dry"
if /i "%~1"=="--no-app" set "SEMAPP=1"

rem -------------------------------------------------------------- a raiz ----
set "ROOT="
if defined SELFEOPI_ROOT (
  if exist "%SELFEOPI_ROOT%\package.json" if exist "%SELFEOPI_ROOT%\scripts\desktop.mjs" set "ROOT=%SELFEOPI_ROOT%"
)
if not defined ROOT if exist "%~dp0SelfEvoPI\package.json" if exist "%~dp0SelfEvoPI\scripts\desktop.mjs" set "ROOT=%~dp0SelfEvoPI"
if not defined ROOT if exist "%~dp0package.json" if exist "%~dp0scripts\desktop.mjs" set "ROOT=%~dp0"
if not defined ROOT if exist "%CD%\package.json" if exist "%CD%\scripts\desktop.mjs" set "ROOT=%CD%"
if not defined ROOT if exist "%USERPROFILE%\Desktop\SelfEvoPI\package.json" if exist "%USERPROFILE%\Desktop\SelfEvoPI\scripts\desktop.mjs" set "ROOT=%USERPROFILE%\Desktop\SelfEvoPI"
if not defined ROOT if exist "%USERPROFILE%\Documents\SelfEvoPI\package.json" if exist "%USERPROFILE%\Documents\SelfEvoPI\scripts\desktop.mjs" set "ROOT=%USERPROFILE%\Documents\SelfEvoPI"
if not defined ROOT if exist "%USERPROFILE%\SelfEvoPI\package.json" if exist "%USERPROFILE%\SelfEvoPI\scripts\desktop.mjs" set "ROOT=%USERPROFILE%\SelfEvoPI"

if not defined ROOT goto :semraiz
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

rem -------------------------------------------------------------- o node ----
set "NODE="
for /f "delims=" %%i in ('where node 2^>nul') do (
  set "CAND=%%i"
  if "!CAND:~-4!"==".exe" if not defined NODE set "NODE=!CAND!"
)
if not defined NODE goto :semnode

rem ------------------------------------------------------ o modo --app ------
rem  O --app e a janela do A8. Enquanto ele nao chega, desktop.mjs ignora a
rem  flag em silencio - entao a sonda e feita no proprio arquivo.
set "APP="
if not defined SEMAPP (
  findstr /c:"--app" "%ROOT%\scripts\desktop.mjs" >nul 2>&1 && set "APP=1"
)

if "%MODO%"=="dry" goto :dry

if defined APP (
  echo.
  echo   SelfEvoPI - abrindo em janela propria
  echo   raiz: %ROOT%
  echo.
  cd /d "%ROOT%"
  node "%ROOT%\scripts\desktop.mjs" --app
  set "FIM=%ERRORLEVEL%"
  echo.
  if not "!FIM!"=="0" echo   O app desktop terminou com codigo !FIM!.
  if "!FIM!"=="0" echo   App desktop encerrado.
  goto :fim
)

rem --app ausente: modo navegador
echo.
echo   SelfEvoPI - painel local
echo   raiz: %ROOT%
echo.
echo   Aviso: o modo janela (--app) ainda nao existe neste checkout.
echo   Abrindo no navegador. E o mesmo painel; nada muda no conteudo.
echo   Quando o --app chegar, este atalho passa a abrir a janela sozinho.
echo.
echo   Ctrl+C encerra o painel.
echo.
cd /d "%ROOT%"
node "%ROOT%\scripts\desktop.mjs"
set "FIM=%ERRORLEVEL%"
echo.
echo   Painel encerrado (codigo !FIM!).
goto :fim

rem ------------------------------------------------------------- respostas --
:dry
echo.
echo   raiz:      %ROOT%
echo   node:      %NODE%
if defined APP (
  echo   [dry-run] node "%ROOT%\scripts\desktop.mjs" --app
  echo   modo:     janela propria ^(app desktop^)
) else (
  echo   [dry-run] node "%ROOT%\scripts\desktop.mjs"
  echo   modo:     navegador ^(o --app ainda nao existe neste checkout^)
)
echo.
echo   Nada foi executado.
exit /b 0

:semraiz
echo.
echo   Nao encontrei o SelfEvoPI.
echo.
echo   Procurei em:
echo     - uma pasta SelfEvoPI ao lado deste atalho
echo     - a pasta deste arquivo, a pasta atual,
echo       Area de Trabalho, Documentos e a pasta pessoal
echo     - a variavel de ambiente SELFEOPI_ROOT
echo.
echo   O que fazer:
echo     1. Deixe este atalho junto do repositorio SelfEvoPI, ou
echo     2. Crie a variavel SELFEOPI_ROOT apontando para a raiz do repo.
echo.
pause
exit /b 1

:semnode
echo.
echo   O Node.js nao esta no PATH.
echo.
echo   O SelfEvoPI precisa de Node 22.19 ou mais novo.
echo.
echo   O que fazer:
echo     1. Instale em https://nodejs.org/ (LTS)
echo     2. Na instalacao, deixe marcado "Add to PATH"
echo     3. Feche e abra esta janela de novo
echo.
echo   Para conferir depois:
echo     node --version
echo.
pause
exit /b 1

:fim
echo.
pause
exit /b 0