@echo off
setlocal
chcp 65001 >nul
title Mat3amPOS - ODBC Setup Launcher

set "SCRIPT_DIR=%~dp0"
set "TARGET_BAT=%SCRIPT_DIR%setup_odbc_and_install.bat"

if not exist "%TARGET_BAT%" (
  echo [ERROR] الملف غير موجود:
  echo %TARGET_BAT%
  pause
  exit /b 1
)

net session >nul 2>&1
if not "%errorlevel%"=="0" (
  echo [INFO] سيتم فتح ملف التثبيت بصلاحية Administrator...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%TARGET_BAT%' -Verb RunAs"
  exit /b 0
)

echo [INFO] تشغيل setup_odbc_and_install.bat ...
call "%TARGET_BAT%"
exit /b %errorlevel%
