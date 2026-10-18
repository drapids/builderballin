@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Builderballin needs Node.js. Opening the download page, install the LTS version and run this again.
  start https://nodejs.org/en/download
  pause
  exit /b
)
if not exist node_modules\electron (
  echo First run, installing. This takes a minute.
  call npm install
)
powershell -NoProfile -Command "$d = (Resolve-Path '.').Path; $p = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ($d + '*') }; if ($p -and -not ($p | Where-Object { $_.MainWindowHandle -ne 0 })) { $p | Stop-Process -Force }"
call npm start
