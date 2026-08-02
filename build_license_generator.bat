@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo  مولّد رخص Mat3amPOS (داخلي للشركة)
echo ========================================
set "PY=C:\Users\NabilSirconsult\env\Scripts\python.exe"
if not exist "%PY%" set "PY=python"
"%PY%" "%~dp0scripts\mat3am_license_generator.py" %*
if errorlevel 1 pause
