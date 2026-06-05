@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo  Mat3amPOS_Setup.exe - Build
echo ========================================

where python >nul 2>&1
if errorlevel 1 (
  echo لم يُعثر على python في PATH.
  pause
  exit /b 1
)

echo [1/2] تجهيز الأيقونة وخصائص ويندوز...
python "%~dp0scripts\prepare_mat3am_exe_build.py"
if errorlevel 1 exit /b 1

echo [2/2] بناء Launcher EXE...
python -m PyInstaller "%~dp0scripts\mat3am_setup_launcher.py" --onefile --clean --noconfirm --name Mat3amPOS_Setup --icon "%~dp0assets\mat3am_icon.ico" --distpath "%~dp0dist" --workpath "%~dp0build\setup_launcher"
if errorlevel 1 exit /b 1

copy /Y "%~dp0START_HERE.bat" "%~dp0dist\" >nul
copy /Y "%~dp0run_setup_odbc_and_install.bat" "%~dp0dist\" >nul
copy /Y "%~dp0setup_odbc_and_install.bat" "%~dp0dist\" >nul

echo.
echo [تم] الناتج: dist\Mat3amPOS_Setup.exe
echo ========================================
pause
