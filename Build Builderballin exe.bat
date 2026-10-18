@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js first: https://nodejs.org/en/download
  pause
  exit /b
)
call npm install
call npm run dist
echo.
echo Done. Your exe is in the dist folder.
explorer dist
pause
