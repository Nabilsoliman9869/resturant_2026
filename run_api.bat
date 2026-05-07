@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "MAT3AM_PY="
where python >nul 2>&1 && set "MAT3AM_PY=python"
if not defined MAT3AM_PY where py >nul 2>&1 && set "MAT3AM_PY=py"
if not defined MAT3AM_PY (
  echo ========================================
  echo [خطأ] لم يُعثر على Python في PATH.
  echo ثبّت Python 3 من https://www.python.org/downloads/
  echo وفعّل الخيار «Add python.exe to PATH» ثم أعد فتح الطرفية.
  echo ========================================
  pause
  exit /b 1
)

echo ========================================
echo  مطاعم — تشغيل API من هذا المجلد فقط
echo  إيقاف أي عملية تستمع على المنفذ 2288
echo  (غالباً نسخة قديمة من api_server تسبب رسالة «وليس dev»)
echo ========================================
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
echo يجب أن ترى في whoami: VERIFY_SCHEMA_REVISION=9 (أو أحدث) و API_FILE_PATH=مسار هذا المشروع
echo.
echo إيقاف الخادم: Ctrl+C
echo ========================================
"%MAT3AM_PY%" api_server.py
if errorlevel 1 (
  echo.
  echo [تنبيه] انتهى api_server.py برمز خطأ. راجع الرسائل أعلاه.
)

pause
