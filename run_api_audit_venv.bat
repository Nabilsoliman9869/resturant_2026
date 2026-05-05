@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo  مطاعم — تشغيل API (Python من .venv_audit إن وُجد)
echo  إيقاف المنفذ 2288 ثم تشغيل backend\api_server.py
echo ========================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\mat3am_kill_ports.ps1" -Ports 2288
timeout /t 2 /nobreak >nul

cd /d "%~dp0backend"
if not exist "api_server.py" (
  echo خطأ: api_server.py غير موجود في %CD%
  pause
  exit /b 1
)

if exist "%~dp0.venv_audit\Scripts\python.exe" (
  echo تشغيل: "%~dp0.venv_audit\Scripts\python.exe" api_server.py
  "%~dp0.venv_audit\Scripts\python.exe" api_server.py
) else (
  echo تحذير: لا يوجد .venv_audit — استخدام python من PATH
  python api_server.py
)

pause
