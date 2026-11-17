@echo off
setlocal EnableExtensions
title SelfEvoPI - Painel

set "REPO=C:\Users\Kelvin\Desktop\SelfEvoPI"

if not exist "%REPO%\scripts\desktop.mjs" (
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

echo.
echo   SelfEvoPI - painel local
echo   http://127.0.0.1:7777
echo.
echo   Fecha no navegador; esta janela mantem o painel no ar.
echo   Ctrl+C encerra.
echo.

start "" http://127.0.0.1:7777
node scripts\desktop.mjs

echo.
echo   Painel encerrado.
pause
endlocal