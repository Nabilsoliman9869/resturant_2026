@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PATH=C:\Users\NabilSirconsult\env\Scripts;%PATH%

findstr /C:"@app.get(\"/api/restaurant/manager-approvals\")" "%~dp0backend\api_server.py" >nul
if errorlevel 1 (
	echo [ERROR] backend\api_server.py does not contain manager approvals endpoint.
	echo         Build aborted to prevent generating a broken EXE.
	pause
	exit /b 1
)

echo ========================================
echo  Mat3amPOS v41 build
echo ========================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\mat3am_kill_ports.ps1" -Ports 2288
timeout /t 1 /nobreak >nul

echo [1/4] Prepare build stamp + ICO + Windows version info...
python "%~dp0scripts\prepare_mat3am_exe_build.py"
if errorlevel 1 exit /b 1

echo [2/4] npm run build (ui/restaurant)...
call npm run build
if errorlevel 1 exit /b 1

echo [3/4] PyInstaller (Mat3amPOS_41.spec) --clean...
python -m PyInstaller "%~dp0Mat3amPOS_41.spec" --clean --noconfirm
if errorlevel 1 exit /b 1

echo [4/4] Done ^> dist\mat3amPos_41.exe
echo ========================================
pause
