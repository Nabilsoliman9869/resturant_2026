@echo off
chcp 65001 >nul
title Mat3amPOS Build Tool
cd /d "%~dp0"

REM ============================================================
REM البحث عن Python في أماكن شائعة (غير PATH فقط)
REM ============================================================
set "PYTHON_EXE="

REM محاولة 1: PATH مباشرة
where python >nul 2>&1 && set "PYTHON_EXE=python" && goto :found

REM محاولة 2: AppData\Local\Programs\Python (المسار الافتراضي للمثبت)
for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do (
    if exist "%%D\python.exe" set "PYTHON_EXE=%%D\python.exe" && goto :found
)

REM محاولة 3: Program Files
for /d %%D in ("%PROGRAMFILES%\Python3*") do (
    if exist "%%D\python.exe" set "PYTHON_EXE=%%D\python.exe" && goto :found
)

REM محاولة 4: Program Files (x86)
for /d %%D in ("%PROGRAMFILES(x86)%\Python3*") do (
    if exist "%%D\python.exe" set "PYTHON_EXE=%%D\python.exe" && goto :found
)

REM محاولة 5: C:\Python
for /d %%D in ("C:\Python3*") do (
    if exist "%%D\python.exe" set "PYTHON_EXE=%%D\python.exe" && goto :found
)

REM محاولة 6: virtualenv .venv
if exist "%USERPROFILE%\.venv\Scripts\python.exe" (
    set "PYTHON_EXE=%USERPROFILE%\.venv\Scripts\python.exe"
    goto :found
)

REM محاولة 7: virtualenv env
if exist "%USERPROFILE%\env\Scripts\python.exe" (
    set "PYTHON_EXE=%USERPROFILE%\env\Scripts\python.exe"
    goto :found
)

REM ============================================================
REM لم يُعثر على Python
REM ============================================================
echo.
echo ============================================================
echo   Python not found!
echo ============================================================
echo.
echo Python مثبت لديك ولكن غير مضاف الى PATH.
echo.
echo الحل السريع:
echo   1. افتح نافذة Run (Win + R) واكتب: sysdm.cpl
echo   2. اذهب الى Advanced ^> Environment Variables
echo   3. في System Variables ابحث عن Path ^> Edit
echo   4. اضف مسار Python مثل:
echo      C:\Users\YOURNAME\AppData\Local\Programs\Python\Python311
echo      C:\Users\YOURNAME\AppData\Local\Programs\Python\Python311\Scripts
echo.
echo او شغل هذا الملف مباشرة من موجه الاوامر مع تحديد مسار Python:
echo   "C:\Path\To\python.exe" scripts\build_gui.py
echo.
pause
exit /b 1

:found
echo [OK] Found Python: %PYTHON_EXE%
echo.
"%PYTHON_EXE%" "%~dp0scripts\build_gui.py"
exit /b %errorlevel%
