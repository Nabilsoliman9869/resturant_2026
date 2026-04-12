@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo  إعادة تشغيل من الصفر — مطاعم XTRA
echo  - يوقف ما يستمع على 2288 (API) و 9999 (Vite)
echo  - يفتح نافذتين جديدتين: API ثم الواجهة
echo ========================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\mat3am_kill_ports.ps1"

timeout /t 2 /nobreak >nul

set "HERE=%~dp0"

echo.
echo تشغيل API جديد...
start "MAT3AM-API" cmd /k "cd /d \"%HERE%backend\" && echo API: http://127.0.0.1:2288 && python api_server.py"

timeout /t 3 /nobreak >nul

echo تشغيل الواجهة (Vite) جديدة...
if not exist "node_modules" (
  echo تثبيت npm...
  call npm install
)
start "MAT3AM-UI" cmd /k "cd /d \"%HERE%\" && if exist node_modules\.vite rmdir /s /q node_modules\.vite && echo واجهة: http://127.0.0.1:9999 && npm run dev -- --force"

echo.
echo ========================================
echo  بعد ثوانٍ:
echo   - API:   http://127.0.0.1:2288/api/ping
echo   - واجهة: http://127.0.0.1:9999/login
echo  في المتصفح: Ctrl+Shift+R (تحديث قوي) أو امسح كاش الموقع لـ localhost
echo  دخول مطوّر دائم: dev / dev@123
echo ========================================
pause
