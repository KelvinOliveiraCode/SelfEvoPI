@echo off
rem ==========================================================================
rem  SelfEvoPI - lancador do desktop
rem
rem  Abre o painel SelfEvoPI. Com --app, pede a janela propria (Edge/Chrome em
rem  modo --app). Se nenhum dos dois existir, o proprio scripts/desktop.mjs
rem  chama o navegador padrao - a escolha fica em um lugar so, e este lancador
rem  nunca falha em silencio.
rem
rem  Uso:
rem    SelfEvoPI-Desktop.cmd              abre (janela, ou navegador padrao)
rem    SelfEvoPI-Desktop.cmd --dry-run    mostra o comando, sem executar
rem    SelfEvoPI-Desktop.cmd --no-app     forca o modo navegador
rem
rem  SESSAO - leia antes de mudar a raiz:
rem  este lancador e o SelfEvoPI.cmd rodam com o MESMO cwd (%ROOT%), e o pi
rem  guarda a sessao em ~/.pi/agent/sessions/<cwd-codificado>/. E o cwd igual
rem  que faz os dois atalhos enxergarem a mesma conversa. Mude a raiz de um,
rem  mude a do outro, ou os dois abrem sessoes diferentes.
rem
rem  A raiz e descoberta nesta ordem (nenhum caminho pessoal fixo aqui):
rem    1. variavel de ambiente SELFEOPI_ROOT
rem    2. uma pasta SelfEvoPI ao lado deste arquivo
rem    3. a pasta onde este arquivo esta (se ele estiver dentro do repo)
rem    4. o diretorio atual
rem    5. Area de Trabalho, Documentos e pasta pessoal do usuario
rem
rem  Se nada casar, ele diz e para. Nunca abre um painel vazio.
rem ==========================================================================
setlocal EnableExtensions EnableDelayedExpansion
title SelfEvoPI - Desktop

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
rem  So aceito linha que termina em .exe: um AutoRun (chcp) ou qualquer outro
rem  comando no perfil pode imprimir texto antes, e isso viraria "caminho".
set "NODE="
for /f "delims=" %%i in ('where node 2^>nul') do (
  set "CAND=%%i"
  if "!CAND:~-4!"==".exe" if not defined NODE set "NODE=!CAND!"
)
if not defined NODE goto :semnode

rem --------------------------------------------------------- o navegador ----
rem  Sonda por conta propria: o dry-run precisa dizer o MODO, e quem tem Edge ou
rem  Chrome nao e o mesmo que tem Chrome. A ordem e a do desktop.mjs.
set "NAV="
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" set "NAV=Edge"
if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" set "NAV=Edge"
if exist "%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe" set "NAV=Edge"
if not defined NAV if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "NAV=Chrome"
if not defined NAV if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "NAV=Chrome"
if not defined NAV if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "NAV=Chrome"

rem --------------------------------------------------------------- a CLI -----
set "FLAGS=--app"
if defined SEMAPP set "FLAGS="

if "%MODO%"=="dry" goto :dry

echo.
echo   SelfEvoPI - desktop
echo   raiz:    %ROOT%
echo   sessao:  %ROOT%
echo   mesmo cwd do SelfEvoPI.cmd - os dois atalhos veem a mesma conversa.
echo.
if defined SEMAPP (
  echo   modo: navegador, a pedido (--no-app)
) else if defined NAV (
  echo   modo: janela propria, sem barra de endereco ^(navegador: %NAV%^)
) else (
  echo   modo: navegador padrao - nem Edge nem Chrome foram encontrados.
  echo   O desktop.mjs detecta isso e abre no navegador padrao.
)
echo.
echo   Ctrl+C encerra o servidor local.
echo.
cd /d "%ROOT%"
node "%ROOT%\scripts\desktop.mjs" %FLAGS%
set "FIM=%ERRORLEVEL%"
echo.
echo   Desktop encerrado (codigo %FIM%).
pause
exit /b %FIM%

rem ------------------------------------------------------------- respostas --
:dry
echo.
echo   [dry-run]  node "%ROOT%\scripts\desktop.mjs" %FLAGS%
echo   raiz:      %ROOT%
echo   node:      %NODE%
echo   sessao:    %ROOT%
if defined SEMAPP (
  echo   modo:      navegador ^(a pedido, --no-app^)
) else if defined NAV (
  echo   modo:      janela propria, sem barra de endereco - navegador %NAV%
) else (
  echo   modo:      navegador padrao - nem Edge nem Chrome encontrados
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