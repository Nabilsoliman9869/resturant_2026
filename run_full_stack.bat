@echo off
chcp 65001 >nul
set "HERE=%~dp0"
echo Running Mat3am full stack from this folder only.
echo Stopping old processes on ports 2288 and 9999.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\mat3am_kill_ports.ps1"
timeout /t 2 /nobreak >nul
start "MAT3AM-API" cmd /k "cd /d \"%HERE%backend\" && python api_server.py"
echo Waiting for API readiness endpoint...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; for ($i=0; $i -lt 60; $i++) { try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:2288/api/ready' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { $ok=$true; break } } catch {} Start-Sleep -Milliseconds 500 }; if ($ok) { Write-Host '[OK] API ready' } else { Write-Host '[!] API not up yet - UI will wait for /api/ready' }"
start "MAT3AM-UI" cmd /k "cd /d \"%HERE%\" && if exist node_modules\.vite rmdir /s /q node_modules\.vite && npm run dev -- --force"
echo.
echo API ready check: http://127.0.0.1:2288/api/ready
echo UI: http://127.0.0.1:9999
pause
