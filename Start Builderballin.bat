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
call npm start
