@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PY=%~dp0.venv_audit\Scripts\python.exe"
if not exist "%PY%" (
  echo [ERR] Python not found: %PY%
  exit /b 1
)
"%PY%" -m pip show pyinstaller >nul 2>nul
if errorlevel 1 (
  echo [1/5] Installing PyInstaller...
  "%PY%" -m pip install pyinstaller
  if errorlevel 1 exit /b 1
)
echo [2/5] Prepare build stamp...
"%PY%" scripts\prepare_mat3am_exe_build.py
if errorlevel 1 exit /b 1
echo [3/5] Build frontend...
call npm run build
if errorlevel 1 exit /b 1
echo [4/5] PyInstaller...
"%PY%" -m PyInstaller "%~dp0Mat3amPOS.spec" --clean --noconfirm
if errorlevel 1 exit /b 1
echo [5/5] Version artifact...
"%PY%" scripts\version_exe_artifact.py
if errorlevel 1 exit /b 1
echo DONE
