@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo  Mat3amPOS.exe — بناء إصدار 26
echo ========================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\mat3am_kill_ports.ps1" -Ports 2288
timeout /t 1 /nobreak >nul

where python >nul 2>&1
if errorlevel 1 (
  echo لم يُعثر على python في PATH.
  pause
  exit /b 1
)

echo [1/4] طابع البناء + ICO + خصائص ويندوز...
python "%~dp0scripts\prepare_mat3am_exe_build.py"
if errorlevel 1 exit /b 1

echo [2/4] npm run build — واجهة ui/restaurant...
call npm run build
if errorlevel 1 exit /b 1

echo [3/4] PyInstaller --clean...
python -m PyInstaller "%~dp0Mat3amPOS.spec" --clean --noconfirm
if errorlevel 1 exit /b 1

echo [4/4] إنشاء نسخة مرقمة 26...
python "%~dp0scripts\version_exe_artifact.py" 26
if errorlevel 1 exit /b 1

echo.
echo [تم] الناتج: dist\Mat3amPOS026.exe
echo ========================================
pause
