@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
if not defined MAT3AM_BASE_DIR set "MAT3AM_BASE_DIR=%LOCALAPPDATA%\Mat3amPOS"

set "MAT3AM_PY=C:\Users\NabilSirconsult\env\Scripts\python.exe"
if not exist "%MAT3AM_PY%" (
  echo ========================================
  echo [خطأ] لم يُعثر على Python المتوقع.
  echo المسار: %MAT3AM_PY%
  echo.
  echo إذا تغيّر المسار عدّله في run_api.bat
  echo ========================================
  pause
  exit /b 1
)

echo ========================================
echo  مطاعم — تشغيل API من هذا المجلد فقط
echo  إيقاف أي عملية تستمع على المنفذ 2288
echo  (غالباً نسخة قديمة من api_server تسبب رسالة «وليس dev»)
echo ========================================
echo DATA_DIR: %MAT3AM_BASE_DIR%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\mat3am_kill_ports.ps1" -Ports 2288

timeout /t 2 /nobreak >nul

cd /d "%~dp0backend"
if not exist "api_server.py" (
  echo خطأ: لم يُعثر على api_server.py في %CD%
  pause
  exit /b 1
)

echo.
echo تشغيل بواسطة: %MAT3AM_PY% — %CD%\api_server.py
echo بعد ظهور «MAT3AM_API» في الأسطر أعلاه، افتح المتصفح:
echo   http://127.0.0.1:2288/__whoami__
echo   http://127.0.0.1:2288/api/dev/mat3am-schema-probe
echo يجب أن ترى في whoami: VERIFY_SCHEMA_REVISION=11 و FEATURE_GUEST_RETURNS=1
echo و API_FILE_PATH=مسار هذا المشروع\backend\api_server.py
echo.
echo إيقاف الخادم: Ctrl+C
echo ========================================
if "%MAT3AM_PY%"=="python" (
  python api_server.py
) else if "%MAT3AM_PY%"=="py" (
  py api_server.py
) else (
  "%MAT3AM_PY%" api_server.py
)
if errorlevel 1 (
  echo.
  echo [تنبيه] انتهى api_server.py برمز خطأ. راجع الرسائل أعلاه.
)

pause
