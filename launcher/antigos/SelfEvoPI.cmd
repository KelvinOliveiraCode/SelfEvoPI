@echo off
rem ==========================================================================
rem  SelfEvoPI - lancador da CLI
rem
rem  Este arquivo NAO tem menu proprio: quem tem menu e a CLI (apps/cli.mjs).
rem  Ele descobre a raiz do repositorio e chama o Node. So isso.
rem
rem  Uso:
rem    SelfEvoPI.cmd              abre a CLI
rem    SelfEvoPI.cmd --dry-run    mostra o que abriria, sem executar
rem
rem  A raiz e descoberta nesta ordem (nenhum caminho pessoal fixo aqui):
rem    1. variavel de ambiente SELFEOPI_ROOT
rem    2. uma pasta SelfEvoPI ao lado deste arquivo
rem    3. a pasta onde este arquivo esta (se ele estiver dentro do repo)
rem    4. o diretorio atual
rem    5. Area de Trabalho, Documentos e pasta pessoal do usuario
rem
rem  Se nada casar, ele diz e para. Nunca abre um menu vazio.
rem ==========================================================================
setlocal EnableExtensions EnableDelayedExpansion
title SelfEvoPI

set "MODO=texto"
if /i "%~1"=="--dry-run" set "MODO=dry"

rem -------------------------------------------------------------- a raiz ----
set "ROOT="
if defined SELFEOPI_ROOT (
  if exist "%SELFEOPI_ROOT%\package.json" if exist "%SELFEOPI_ROOT%\core\forge" set "ROOT=%SELFEOPI_ROOT%"
)
if not defined ROOT if exist "%~dp0SelfEvoPI\package.json" if exist "%~dp0SelfEvoPI\core\forge" set "ROOT=%~dp0SelfEvoPI"
if not defined ROOT if exist "%~dp0package.json" if exist "%~dp0core\forge" set "ROOT=%~dp0"
if not defined ROOT if exist "%CD%\package.json" if exist "%CD%\core\forge" set "ROOT=%CD%"
if not defined ROOT if exist "%USERPROFILE%\Desktop\SelfEvoPI\package.json" if exist "%USERPROFILE%\Desktop\SelfEvoPI\core\forge" set "ROOT=%USERPROFILE%\Desktop\SelfEvoPI"
if not defined ROOT if exist "%USERPROFILE%\Documents\SelfEvoPI\package.json" if exist "%USERPROFILE%\Documents\SelfEvoPI\core\forge" set "ROOT=%USERPROFILE%\Documents\SelfEvoPI"
if not defined ROOT if exist "%USERPROFILE%\SelfEvoPI\package.json" if exist "%USERPROFILE%\SelfEvoPI\core\forge" set "ROOT=%USERPROFILE%\SelfEvoPI"

if not defined ROOT goto :semraiz
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

rem -------------------------------------------------------------- o node ----
rem  So aceito linha que termina em .exe: um AutoRun (chcp) ou qualquer outro
rem  comando no perfil pode imprimir texto antes, e isso viraria "caminho".
set "NODE="
for /f "delims=" %%i in ('where node 2^>nul') do (
  set "CAND=%%i"
  if "!CAND:~-4!"==".exe" if not defined NODE set "NODE=!CAND!"
)
if not defined NODE goto :semnode

rem --------------------------------------------------------------- a CLI ----
if "%MODO%"=="dry" goto :dry
if not exist "%ROOT%\apps\cli.mjs" goto :semcli

cd /d "%ROOT%"
node "%ROOT%\apps\cli.mjs" %*
set "FIM=%ERRORLEVEL%"
if not "%FIM%"=="0" echo   A CLI terminou com codigo %FIM%.
exit /b %FIM%

rem ------------------------------------------------------------- respostas --
:dry
echo.
echo   [dry-run]  node "%ROOT%\apps\cli.mjs"
echo   raiz:      %ROOT%
echo   node:      %NODE%
if exist "%ROOT%\apps\cli.mjs" (echo   alvo:      apps\cli.mjs OK) else (echo   alvo:      apps\cli.mjs AINDA NAO EXISTE)
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
echo   Exemplo (Prompt de Comandos):
echo     setx SELFEOPI_ROOT "D:\projetos\SelfEvoPI"
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

:semcli
echo.
echo   Achei o repositorio, mas a CLI ainda nao esta neste checkout.
echo.
echo   raiz:    %ROOT%
echo   faltou:  apps\cli.mjs
echo.
echo   A CLI esta em construcao. Enquanto isso:
echo.
echo     npm run verify                     suite de verificacao
echo     node core\forge\cli.mjs status     estado do harness
echo     SelfEvoPI-Painel.cmd               painel grafico
echo.
pause
exit /b 1