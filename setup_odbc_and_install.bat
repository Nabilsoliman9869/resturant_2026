@echo off
chcp 65001 >nul
echo ====================================
echo   Mat3amPOS — تثبيت ODBC + البرنامج
echo ====================================
echo.

:: تحقق من وجود ODBC Driver
powershell -Command "try { $d = Get-OdbcDriver -Name '*SQL Server*' -Platform 64bit; if ($d) { exit 0 } else { exit 1 } } catch { exit 1 }"
if %errorlevel%==0 (
    echo [OK] Microsoft ODBC Driver موجود بالفعل.
    goto INSTALL_APP
)

echo [INFO] Microsoft ODBC Driver غير مثبت — جاري التحميل...
echo [INFO] قد يستغرق 2-3 دقائق...
echo.

:: تحميل ODBC Driver 18
powershell -Command "Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/?linkid=2280794' -OutFile '%TEMP%\msodbcsql18.msi' -UseBasicParsing"
if not exist "%TEMP%\msodbcsql18.msi" (
    echo [ERROR] فشل التحميل — جرب التثبيت اليدوي:
    echo https://learn.microsoft.com/sql/connect/odbc/download-odbc-driver-for-sql-server
    pause
    exit /b 1
)

echo [INFO] جاري التثبيت...
msiexec /i "%TEMP%\msodbcsql18.msi" /quiet /norestart
if %errorlevel% neq 0 (
    echo [ERROR] فشل التثبيت — شغّل هذا الملف كـ Administrator.
    pause
    exit /b 1
)

echo [OK] Microsoft ODBC Driver 18 تم تثبيته.
del "%TEMP%\msodbcsql18.msi" 2>nul

:INSTALL_APP
:: نسخ البرنامج
echo.
echo [INFO] جاري نسخ البرنامج...
set INSTALL_DIR=%LOCALAPPDATA%\Mat3amPOS
mkdir "%INSTALL_DIR%" 2>nul
copy /Y "%~dp0Mat3amPOS.exe" "%INSTALL_DIR%\" >nul

:: إنشاء Shortcut على سطح المكتب
echo [INFO] جاري إنشاء اختصار...
powershell -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%USERPROFILE%\Desktop\Mat3amPOS.lnk'); $Shortcut.TargetPath = '%LOCALAPPDATA%\Mat3amPOS\Mat3amPOS.exe'; $Shortcut.WorkingDirectory = '%LOCALAPPDATA%\Mat3amPOS'; $Shortcut.Save()"

echo.
echo ====================================
echo   تم بنجاح!
echo   سطح المكتب — اضغط على Mat3amPOS
echo ====================================
pause
