@echo off
setlocal EnableExtensions EnableDelayedExpansion
title SelfEvoPI

set "REPO=C:\Users\Kelvin\Desktop\SelfEvoPI"

if not exist "%REPO%\core\forge\cli.mjs" (
  echo.
  echo   Nao encontrei o SelfEvoPI em:
  echo     %REPO%
  echo.
  echo   Edite a variavel REPO no inicio deste arquivo.
  echo.
  pause
  exit /b 1
)

cd /d "%REPO%"

:menu
cls
echo.
echo   ===============================================
echo    SelfEvoPI
echo   ===============================================
echo.
echo    1  Estado do harness
echo    2  Detectar lacunas
echo    3  Rodar evals estruturais (grupos A e C)
echo    4  Verificacao completa (testes + evals + URLs)
echo    5  Gate de regressao (modelo real, lento)
echo    6  Abrir painel grafico
echo    7  O que ja foi gerado (skills)
echo    0  Sair
echo.
set "OPCAO="
set /p "OPCAO=  escolha: "

if "%OPCAO%"=="1" goto status
if "%OPCAO%"=="2" goto detect
if "%OPCAO%"=="3" goto evals
if "%OPCAO%"=="4" goto verify
if "%OPCAO%"=="5" goto gate
if "%OPCAO%"=="6" goto painel
if "%OPCAO%"=="7" goto skills
if "%OPCAO%"=="0" goto fim
goto menu

:status
echo.
node core\forge\cli.mjs status
echo.
pause
goto menu

:detect
echo.
node core\forge\cli.mjs detect
echo.
pause
goto menu

:evals
echo.
node evals\run.mjs --group A
node evals\run.mjs --group C
echo.
pause
goto menu

:verify
echo.
call npm run verify
echo.
pause
goto menu

:gate
echo.
echo  O gate chama modelo real e pode levar alguns minutos.
echo.
node evals\gate.mjs
echo.
pause
goto menu

:painel
echo.
echo  Abrindo o painel em http://127.0.0.1:7777
echo  (a janela do painel fica aberta; feche-a para encerrar)
echo.
start "SelfEvoPI painel" cmd /c "node scripts\desktop.mjs"
timeout /t 4 /nobreak >nul
start "" http://127.0.0.1:7777
goto menu

:skills
echo.
node core\forge\cli.mjs skills
echo.
echo  Para buscar por termo: node core\forge\cli.mjs skills ^<termo^>
echo.
pause
goto menu

:fim
endlocal
exit /b 0