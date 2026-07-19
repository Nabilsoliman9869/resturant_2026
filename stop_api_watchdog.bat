@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

echo Stopping Mat3am API watchdog...
if not exist "logs" mkdir logs >nul 2>&1
echo stop> "logs\api_watchdog.stop"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$logDir = Join-Path '%~dp0' 'logs';" ^
  "$child = Join-Path $logDir 'api_server.pid';" ^
  "$wd = Join-Path $logDir 'api_watchdog.pid';" ^
  "foreach ($f in @($child,$wd)) {" ^
  "  if (Test-Path $f) {" ^
  "    $id = 0; [void][int]::TryParse((Get-Content $f | Select-Object -First 1), [ref]$id);" ^
  "    if ($id -gt 0) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; Write-Host ('Stopped PID ' + $id) }" ^
  "  }" ^
  "};" ^
  "& (Join-Path '%~dp0' 'scripts\mat3am_kill_ports.ps1') -Ports @(2288);" ^
  "Start-Sleep -Seconds 1;" ^
  "Remove-Item (Join-Path $logDir 'api_watchdog.stop') -Force -ErrorAction SilentlyContinue;" ^
  "Write-Host 'Done.'"

echo.
pause
