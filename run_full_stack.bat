@echo off

chcp 65001 >nul

set "HERE=%~dp0"

echo تشغيل من مجلد مطاعم فقط — لا يعتمد على XTRA_WEB\backend خارج هذا المجلد.
echo إيقاف أي عملية قديمة على 2288 و 9999 حتى تُحمَّل النسخة الحالية من الكود.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\mat3am_kill_ports.ps1"

timeout /t 2 /nobreak >nul

start "MAT3AM-API" cmd /k "cd /d \"%HERE%backend\" && python api_server.py"

echo انتظار جاهزية API بعد الإقلاع والتهيئة التلقائية...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; for ($i=0; $i -lt 60; $i++) { try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:2288/api/ready' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { $ok=$true; break } } catch {} Start-Sleep -Milliseconds 500 }; if ($ok) { Write-Host '[OK] API ready' } else { Write-Host '[!] API not up yet - UI will wait for /api/ready' }"

start "MAT3AM-UI" cmd /k "cd /d \"%HERE%\" && if exist node_modules\.vite rmdir /s /q node_modules\.vite && npm run dev -- --force"

echo.

echo API جاهزية: http://127.0.0.1:2288/api/ready

echo واجهة: http://127.0.0.1:9999

pause

