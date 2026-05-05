@echo off
chcp 65001 >nul
cd /d "%~dp0"

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
echo تشغيل: %CD%\api_server.py
echo بعد ظهور «MAT3AM_API» في الأسطر أعلاه، افتح المتصفح:
echo   http://127.0.0.1:2288/__whoami__
echo   http://127.0.0.1:2288/api/dev/mat3am-schema-probe
echo يجب أن ترى في whoami: VERIFY_SCHEMA_REVISION=9 (أو أحدث) و API_FILE_PATH=مسار هذا المشروع
echo.
echo إيقاف الخادم: Ctrl+C
echo ========================================
python api_server.py

pause
