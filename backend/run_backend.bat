@echo off
setlocal

:: Move to backend folder (where this script lives)
cd /d "%~dp0"

:: Install deps if node_modules missing
if not exist "node_modules" (
  echo [INFO] Installing dependencies...
  npm install
)

echo [INFO] Starting backend (dev mode)...
npm run dev

endlocal

