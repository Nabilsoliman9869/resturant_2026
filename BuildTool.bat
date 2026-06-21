@echo off
cd /d "%~dp0"

echo ========================================
echo  Mat3amPOS Build Tool
echo ========================================
echo.

REM --- find python ---
set "PY=C:\Users\NabilSirconsult\env\Scripts\python.exe"
if not exist "%PY%" (
    set "PY="
    where py >nul 2>&1 && set "PY=py"
    if not defined PY where python >nul 2>&1 && set "PY=python"
)
if not defined PY (
    echo ERROR: Python not found.
    echo Looked at: C:\Users\NabilSirconsult\env\Scripts\python.exe
    pause
    exit /b 1
)

echo Using: %PY%
echo.

REM --- ask for version ---
set /p VNUM="Enter version number (e.g. 30): "
if "%VNUM%"=="" (
    echo ERROR: No version entered.
    pause
    exit /b 1
)

echo.
echo Building version %VNUM% ...
echo.

REM --- step 1: prepare ---
echo [1/4] Prepare build stamp + ICO + Windows properties...
%PY% "%~dp0scripts\prepare_mat3am_exe_build.py"
if errorlevel 1 (
    echo FAILED at prepare step.
    pause
    exit /b 1
)

REM --- step 2: npm build ---
echo [2/4] npm run build frontend...
call npm run build
if errorlevel 1 (
    echo FAILED at npm build step.
    pause
    exit /b 1
)

REM --- step 3: pyinstaller ---
echo [3/4] PyInstaller build EXE...
%PY% -m PyInstaller "%~dp0Mat3amPOS.spec" --clean --noconfirm
if errorlevel 1 (
    echo FAILED at PyInstaller step.
    pause
    exit /b 1
)

REM --- step 4: version artifact ---
echo [4/4] Create versioned artifact...
%PY% "%~dp0scripts\version_exe_artifact.py" %VNUM%
if errorlevel 1 (
    echo FAILED at version step.
    pause
    exit /b 1
)

echo.
echo ========================================
echo  DONE: dist\Mat3amPOS%VNUM%.exe
echo ========================================
pause
