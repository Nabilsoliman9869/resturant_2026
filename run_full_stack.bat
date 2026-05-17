@echo off
chcp 65001 >nul
set "HERE=%~dp0"
set "MAT3AM_PY="
where python >nul 2>&1 && set "MAT3AM_PY=python"
if not defined MAT3AM_PY where py >nul 2>&1 && set "MAT3AM_PY=py"
if not defined MAT3AM_PY if exist "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" set "MAT3AM_PY=%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
if not defined MAT3AM_PY if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "MAT3AM_PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not defined MAT3AM_PY if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" set "MAT3AM_PY=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
if not defined MAT3AM_PY if exist "%LOCALAPPDATA%\Programs\Python\Python310\python.exe" set "MAT3AM_PY=%LOCALAPPDATA%\Programs\Python\Python310\python.exe"
if not defined MAT3AM_PY (
  echo [ERROR] Python not found. Install Python 3 or add python.exe to PATH, then reopen.
  pause
  exit /b 1
)
echo Running Mat3am full stack from this folder only.
echo Stopping old processes on ports 2288 and 9999.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\mat3am_kill_ports.ps1"
timeout /t 2 /nobreak >nul
if "%MAT3AM_PY%"=="python" (
  start "MAT3AM-API" cmd /k "cd /d \"%HERE%backend\" && python api_server.py"
) else if "%MAT3AM_PY%"=="py" (
  start "MAT3AM-API" cmd /k "cd /d \"%HERE%backend\" && py api_server.py"
) else (
  start "MAT3AM-API" cmd /k "cd /d \"%HERE%backend\" && \"%MAT3AM_PY%\" api_server.py"
)
echo Waiting for API readiness endpoint...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; for ($i=0; $i -lt 60; $i++) { try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:2288/api/ready' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { $ok=$true; break } } catch {} Start-Sleep -Milliseconds 500 }; if ($ok) { Write-Host '[OK] API ready' } else { Write-Host '[!] API not up yet - UI will wait for /api/ready' }"
start "MAT3AM-UI" cmd /k "cd /d \"%HERE%\" && if exist node_modules\.vite rmdir /s /q node_modules\.vite && npm run dev -- --force"
echo.
echo API ready check: http://127.0.0.1:2288/api/ready
echo UI: http://127.0.0.1:9999
pause
