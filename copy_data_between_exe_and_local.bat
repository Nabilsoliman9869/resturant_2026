@echo off
chcp 65001 >nul
title Copy Data: EXE  Local
cd /d "%~dp0"

echo ========================================
echo  Copy data between EXE and Local
echo ========================================
echo.
echo EXE data folder: %%LOCALAPPDATA%%\Mat3amPOS
echo Local data folder: %~dp0
echo.
echo [1] Copy EXE data  Local (overwrite local with EXE data)
echo [2] Copy Local data  EXE (overwrite EXE with local data)
echo [3] Show what's different
echo [0] Exit
echo.
set /p CHOICE="Enter choice (1/2/3/0): "

if "%CHOICE%"=="1" goto :exe_to_local
if "%CHOICE%"=="2" goto :local_to_exe
if "%CHOICE%"=="3" goto :show_diff
goto :eof

:exe_to_local
echo.
echo Copying EXE data to local folder...
if not exist "%LOCALAPPDATA%\Mat3amPOS" (
    echo ERROR: EXE data folder not found.
    pause
    goto :eof
)
if not exist "config" mkdir config
xcopy /E /I /Y "%LOCALAPPDATA%\Mat3amPOS\config" "%~dp0config"
echo.
echo DONE. Local now has same data as EXE.
pause
goto :eof

:local_to_exe
echo.
echo Copying local data to EXE folder...
if not exist "config" (
    echo ERROR: Local config folder not found.
    pause
    goto :eof
)
if not exist "%LOCALAPPDATA%\Mat3amPOS" mkdir "%LOCALAPPDATA%\Mat3amPOS"
xcopy /E /I /Y "%~dp0config" "%LOCALAPPDATA%\Mat3amPOS\config"
echo.
echo DONE. EXE will now use local data.
pause
goto :eof

:show_diff
echo.
echo Comparing config folders...
echo.
echo EXE side:
dir "%LOCALAPPDATA%\Mat3amPOS\config" 2>nul || echo (none)
echo.
echo Local side:
dir "%~dp0config" 2>nul || echo (none)
pause
goto :eof
