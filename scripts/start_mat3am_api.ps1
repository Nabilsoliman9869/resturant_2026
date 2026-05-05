# تشغيل API مطاعم من مجلد المشروع — يقتل المنفذ 2288 ثم يبحث عن Python ويشغّل api_server.py
$ErrorActionPreference = "Continue"
chcp 65001 | Out-Null

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

$KillScript = Join-Path $PSScriptRoot "mat3am_kill_ports.ps1"
Write-Host "=== Mat3am API — تنظيف المنفذ 2288 ===" -ForegroundColor Cyan
& $KillScript -Ports @(2288) 2>$null
Start-Sleep -Seconds 2

$backend = Join-Path $Root "backend"
$api = Join-Path $backend "api_server.py"
if (-not (Test-Path $api)) {
  Write-Host "[FATAL] لم يُعثر على: $api" -ForegroundColor Red
  pause
  exit 1
}

# أولاً: بيئة المشروع (فيها عادةً pip install -r requirements)
$venvPythons = @(
  (Join-Path $Root ".venv_audit\Scripts\python.exe"),
  (Join-Path $Root ".venv\Scripts\python.exe")
) | Where-Object { Test-Path $_ }

$launcher = $null
if ($venvPythons.Count -gt 0) {
  $launcher = @{ Exe = $venvPythons[0]; Args = @("api_server.py") }
  Write-Host "[INFO] استخدام بيئة المشروع: $($venvPythons[0])" -ForegroundColor Green
}

$pythons = @(
  "${env:LOCALAPPDATA}\Programs\Python\Python313\python.exe",
  "${env:LOCALAPPDATA}\Programs\Python\Python312\python.exe",
  "${env:LOCALAPPDATA}\Programs\Python\Python311\python.exe",
  "${env:ProgramFiles}\Python312\python.exe",
  "${env:ProgramFiles}\Python311\python.exe"
) | Where-Object { Test-Path $_ }

if (-not $launcher -and $pythons.Count -gt 0) {
  $launcher = @{ Exe = $pythons[0]; Args = @("api_server.py") }
  Write-Host "[WARN] لم تُوجد .venv_audit — استخدام بايثون النظام (قد تفشل الحزم)." -ForegroundColor Yellow
}

if (-not $launcher) {
  $pyCmd = Get-Command "py" -ErrorAction SilentlyContinue
  if ($pyCmd) { $launcher = @{ Exe = "py"; Args = @("-3", "api_server.py") } }
}
if (-not $launcher) {
  $pythonCmd = Get-Command "python" -ErrorAction SilentlyContinue
  if ($pythonCmd) {
    $launcher = @{ Exe = $pythonCmd.Source; Args = @("api_server.py") }
  }
}

if (-not $launcher) {
  Write-Host "[FATAL] لم يُعثر على Python. ثبّت Python 3.11+ أو أضفه للـ PATH." -ForegroundColor Red
  Write-Host "         جرّب: winget install Python.Python.3.12"
  pause
  exit 1
}

Write-Host "[OK] التشغيل من: $($launcher.Exe) $($launcher.Args -join ' ')"
Write-Host "     المجلد: $backend"
Write-Host "     بعد النجاح: http://127.0.0.1:2288/__whoami__"
Write-Host "========================================" -ForegroundColor DarkGray

$code = 0
Push-Location $backend
try {
  & $launcher.Exe @($launcher.Args)
  if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { $code = $LASTEXITCODE }
} catch {
  Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
  $code = 1
} finally {
  Pop-Location
  if ($code -ne 0) {
    Write-Host "`n[EXIT] بايثون انتهى بكود: $code — راجع الرسائل أعلاه (ImportError / ModuleNotFound / منفذ مستخدم)." -ForegroundColor Yellow
    pause
    exit $code
  }
}
