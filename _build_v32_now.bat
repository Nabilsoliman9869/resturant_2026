@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PATH=C:\Users\NabilSirconsult\env\Scripts;%PATH%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\mat3am_kill_ports.ps1" -Ports 2288
timeout /t 1 /nobreak >nul
echo [1/4] طابع البناء + ICO + خصائص ويندوز...
python "%~dp0scripts\prepare_mat3am_exe_build.py"
if errorlevel 1 exit /b 1
echo [2/4] npm run build — واجهة ui/restaurant...
call npm run build
if errorlevel 1 exit /b 1
echo [3/4] PyInstaller --clean...
python -m PyInstaller "%~dp0Mat3amPOS.spec" --clean --noconfirm
if errorlevel 1 exit /b 1
echo [4/4] إنشاء نسخة مرقمة 32...
python "%~dp0scripts\version_exe_artifact.py" 32
if errorlevel 1 exit /b 1
echo.
echo [تم] الناتج: dist\Mat3amPOS032.exe
echo ========================================
pause
