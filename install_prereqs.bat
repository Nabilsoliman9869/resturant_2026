@echo off
setlocal ENABLEEXTENSIONS ENABLEDELAYEDEXPANSION
chcp 65001 >nul
title Install SQL Prerequisites (ODBC17 + VC++)

echo ===============================================
echo  Install prerequisites for Mat3am EXE
echo ===============================================
echo.

REM Must run as Administrator
net session >nul 2>&1
if not %errorlevel%==0 (
  echo [ERROR] Please run this file as Administrator.
  echo         Right click -^> Run as administrator
  pause
  exit /b 1
)

set "TMP_DIR=%TEMP%\mat3am-prereqs"
if not exist "%TMP_DIR%" mkdir "%TMP_DIR%"

set "VC_URL=https://aka.ms/vs/17/release/vc_redist.x64.exe"
set "VC_EXE=%TMP_DIR%\vc_redist.x64.exe"

set "ODBC17_URL=https://go.microsoft.com/fwlink/?linkid=2361646"
set "ODBC17_MSI=%TMP_DIR%\msodbcsql17.msi"

echo [1/4] Download VC++ Redistributable (x64)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri '%VC_URL%' -OutFile '%VC_EXE%'"
if errorlevel 1 (
  echo [ERROR] Failed to download VC++ package.
  pause
  exit /b 2
)

echo [2/4] Install VC++ Redistributable silently...
start /wait "" "%VC_EXE%" /install /quiet /norestart
if errorlevel 1 (
  echo [ERROR] VC++ installation failed. Exit code: %errorlevel%
  pause
  exit /b 3
)

echo [3/4] Download ODBC Driver 17 for SQL Server...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri '%ODBC17_URL%' -OutFile '%ODBC17_MSI%'"
if errorlevel 1 (
  echo [ERROR] Failed to download ODBC Driver 17 package.
  pause
  exit /b 4
)

echo [4/4] Install ODBC Driver 17 silently...
msiexec /i "%ODBC17_MSI%" /qn IACCEPTMSODBCSQLLICENSETERMS=YES
if errorlevel 1 (
  echo [ERROR] ODBC Driver 17 installation failed. Exit code: %errorlevel%
  pause
  exit /b 5
)

echo.
echo [OK] Prerequisites installed successfully.
echo      VC++ x64 + ODBC Driver 17
echo.
pause
exit /b 0
