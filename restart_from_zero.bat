@echo off
chcp 65001 >nul
cd /d "%~dp0"
REM Local runs use project folder by default.
REM EXE uses AppData. To match EXE exactly, uncomment:
REM set "MAT3AM_BASE_DIR=%LOCALAPPDATA%\Mat3amPOS"

echo ========================================
echo  إعادة تشغيل من الصفر — مطاعم XTRA
echo  - يوقف ما يستمع على 2288 (API) و 9999 (Vite)
echo  - يفتح نافذتين جديدتين: API ثم الواجهة
echo ========================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\mat3am_kill_ports.ps1"

timeout /t 2 /nobreak >nul

set "HERE=%~dp0"
set "MAT3AM_PY="
where python >nul 2>&1 && set "MAT3AM_PY=python"
if not defined MAT3AM_PY where py >nul 2>&1 && set "MAT3AM_PY=py"
if not defined MAT3AM_PY (
  echo [خطأ] لم يُعثر على Python في PATH. ثبّت Python 3 مع «Add to PATH».
  pause
  exit /b 1
)

echo.
echo تشغيل API جديد...
start "MAT3AM-API" cmd /k "cd /d \"%HERE%backend\" && echo API: http://127.0.0.1:2288 && %MAT3AM_PY% api_server.py"

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
