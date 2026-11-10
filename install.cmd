@echo off
setlocal
set "HERE=%~dp0"
set "POWERSHELL=powershell"
where pwsh >nul 2>nul && set "POWERSHELL=pwsh"
"%POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -File "%HERE%install.ps1" %*
exit /b %ERRORLEVEL%
