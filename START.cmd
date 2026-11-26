@echo off
setlocal
cd /d "%~dp0"
if not exist "vendor\pdf.mjs" (
  echo In this folder, run npm ci --omit=optional before starting Paperdesk.
  pause
  exit /b 1
)
where node.exe >nul 2>nul
if not errorlevel 1 (
  node.exe server.mjs --open
  if errorlevel 1 pause
  exit /b
)
set "PAPERDESK_RUNTIME=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%PAPERDESK_RUNTIME%" (
  "%PAPERDESK_RUNTIME%" server.mjs --open
  if errorlevel 1 pause
  exit /b
)
echo Node.js 24 LTS is required. Install it from https://nodejs.org and try again.
pause
