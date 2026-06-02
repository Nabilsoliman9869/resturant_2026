@echo off
chcp 65001 >nul
title Mat3amPOS - تثبيت وتشغيل
echo ====================================
echo   Mat3amPOS - تثبيت وتشغيل تلقائي
echo ====================================
echo.

:: التحقق من وجود ODBC
powershell -Command "try { $d = Get-OdbcDriver -Name '*ODBC*17*SQL*' -Platform 64bit; if (-not $d) { $d = Get-OdbcDriver -Name '*ODBC*18*SQL*' -Platform 64bit } if ($d) { exit 0 } else { exit 1 } } catch { exit 1 }"
if %errorlevel%==0 goto RUN_APP

echo [*] Microsoft ODBC Driver غير مثبت - جاري التحميل...
echo [*] انتظر 2-3 دقائق...
powershell -Command "Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/?linkid=2280794' -OutFile '%TEMP%\msodbcsql18.msi' -UseBasicParsing" >nul 2>&1
if not exist "%TEMP%\msodbcsql18.msi" (
    echo [X] فشل التحميل
    echo     حمل يدوياً من: https://learn.microsoft.com/sql/connect/odbc/download-odbc-driver-for-sql-server
    start https://learn.microsoft.com/sql/connect/odbc/download-odbc-driver-for-sql-server
    pause
    exit /b 1
)

echo [*] جاري التثبيت...
msiexec /i "%TEMP%\msodbcsql18.msi" /quiet /norestart >nul 2>&1
del "%TEMP%\msodbcsql18.msi" 2>nul
echo [OK] تم تثبيت ODBC Driver
echo.

:RUN_APP
echo [*] تشغيل Mat3amPOS...
start "" "%~dp0Mat3amPOS.exe"
echo [OK] تم التشغيل - افتح المتصفح: http://localhost:2288
timeout /t 2 /nobreak >nul
exit
