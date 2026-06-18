@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo  Mat3amPOS.exe — بناء نظيف + طابع زمني + أيقونة
echo ========================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\mat3am_kill_ports.ps1" -Ports 2288
timeout /t 1 /nobreak >nul

set "PY=C:\Users\NabilSirconsult\env\Scripts\python.exe"
if not exist "%PY%" (
  echo لم يُعثر على python في PATH — استخدم Python 3.12 من المسار الكامل أو أضفه لـ PATH.
  pause
  exit /b 1
)

echo [1/4] طابع البناء + ICO + خصائص ويندوز...
"%PY%" "%~dp0scripts\prepare_mat3am_exe_build.py"
if errorlevel 1 exit /b 1

echo [2/4] npm run build — واجهة ui/restaurant...
call npm run build
if errorlevel 1 exit /b 1

echo [3/5] PyInstaller --clean...
"%PY%" -m PyInstaller "%~dp0Mat3amPOS.spec" --clean --noconfirm
if errorlevel 1 exit /b 1

echo [4/5] إنشاء نسخة مرقمة...
if "%~1"=="" (
  "%PY%" "%~dp0scripts\version_exe_artifact.py"
) else (
  "%PY%" "%~dp0scripts\version_exe_artifact.py" %~1
)
if errorlevel 1 exit /b 1

echo.
echo [5/5] تم — الناتج: dist\Mat3amPOS.exe + نسخة مرقمة Mat3amPOSNNN.exe
echo  تحقق: خصائص الملف ^> التفاصيل ^> Product version = طابع التاريخ
echo  أو شغّل ثم افتح: http://127.0.0.1:2288/__whoami__  وابحث عن EXE_BUILD=
echo ========================================
pause
