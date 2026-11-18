@echo off
rem ==========================================================================
rem  SelfEvoPI-Painel.cmd - nome antigo do lancador desktop
rem
rem  O lancador do desktop agora e o SelfEvoPI-Desktop.cmd. Este arquivo
rem  continua aqui SO para nao quebrar quem ainda digita "Painel": ele repassa
rem  a chamada e pronto. Nao e instalado na Area de Trabalho.
rem
rem  Uso (igual ao novo):
rem    SelfEvoPI-Painel.cmd              abre
rem    SelfEvoPI-Painel.cmd --dry-run    mostra o comando, sem executar
rem ==========================================================================
setlocal
call "%~dp0SelfEvoPI-Desktop.cmd" %*
exit /b %ERRORLEVEL%