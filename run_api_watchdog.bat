@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

if not defined MAT3AM_BASE_DIR set "MAT3AM_BASE_DIR=%~dp0"
if "%MAT3AM_BASE_DIR:~-1%"=="\" set "MAT3AM_BASE_DIR=%MAT3AM_BASE_DIR:~0,-1%"
if not defined XTRA_API_PORT set "XTRA_API_PORT=2288"

echo ========================================
echo  مطاعم — تشغيل API بمراقب إعادة التشغيل
echo  المنفذ: %XTRA_API_PORT%
echo  البيانات: %MAT3AM_BASE_DIR%
echo  السجل: logs\api_watchdog.log
echo ========================================
echo.
echo هذا التشغيل منفصل عن Cursor — لن يتوقف عند إغلاق الترمينال.
echo للإيقاف: stop_api_watchdog.bat
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$wd = Join-Path '%~dp0' 'scripts\mat3am_api_watchdog.ps1';" ^
  "$logDir = Join-Path '%~dp0' 'logs'; if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null };" ^
  "$out = Join-Path $logDir 'api_watchdog.out.log';" ^
  "Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$wd) -WorkingDirectory '%~dp0' -WindowStyle Minimized -RedirectStandardOutput $out -RedirectStandardError $out;" ^
  "Start-Sleep -Seconds 2;" ^
  "Write-Host '[OK] watchdog launched';" ^
  "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:%XTRA_API_PORT%/api/ready' -UseBasicParsing -TimeoutSec 8; Write-Host ('[OK] API ready HTTP ' + $r.StatusCode) } catch { Write-Host '[..] API still starting — check logs\api_watchdog.log' }"

echo.
echo تحقق: http://127.0.0.1:%XTRA_API_PORT%/__whoami__
echo.
pause
