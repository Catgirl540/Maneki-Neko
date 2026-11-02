@echo off
REM Windows launcher for the Maneki-Neko local stack TUI.
REM macOS / Linux users run ./start.sh instead; both end up in tools\start-tui.mjs.
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or newer is required, but 'node' is not in PATH.
  echo Install it from https://nodejs.org/ and run this script again.
  exit /b 1
)

REM %%* forwards arguments: --check and --help must reach the launcher
node tools\start-tui.mjs %*
endlocal
