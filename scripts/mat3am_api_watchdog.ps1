# مراقب تشغيل API مطاعم — يعيد التشغيل تلقائياً عند أي خروج غير متعمد.
# يُشغَّل منفصلاً عن Cursor حتى لا يموت مع إغلاق طرفية الوكيل.
param(
  [int]$Port = 2288,
  [int]$RestartDelaySec = 3,
  [switch]$Once
)

$ErrorActionPreference = "Continue"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Backend = Join-Path $Root "backend"
$Api = Join-Path $Backend "api_server.py"
$LogDir = Join-Path $Root "logs"
$LogFile = Join-Path $LogDir "api_watchdog.log"
$PidFile = Join-Path $LogDir "api_watchdog.pid"
$ChildPidFile = Join-Path $LogDir "api_server.pid"
$StopFlag = Join-Path $LogDir "api_watchdog.stop"

if (-not (Test-Path $Api)) {
  Write-Host "[FATAL] missing api_server.py: $Api" -ForegroundColor Red
  exit 1
}
if (-not (Test-Path $LogDir)) {
  New-Item -ItemType Directory -Path $LogDir | Out-Null
}

function Write-Log([string]$Message) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
  Write-Host $line
}

function Resolve-Python {
  $candidates = @(
    (Join-Path $Backend ".venv312\Scripts\python.exe"),
    (Join-Path $Root ".venv312\Scripts\python.exe"),
    (Join-Path $Root ".venv_audit\Scripts\python.exe"),
    (Join-Path $Root ".venv\Scripts\python.exe"),
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
    "C:\Users\NabilSirconsult\env\Scripts\python.exe"
  )
  foreach ($p in $candidates) {
    if ($p -and (Test-Path $p)) { return $p }
  }
  $cmd = Get-Command python -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function Test-ApiReady {
  try {
    $r = Invoke-WebRequest -Uri ("http://127.0.0.1:{0}/api/ready" -f $Port) -UseBasicParsing -TimeoutSec 2
    return ($r.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Stop-PortListeners([int]$ListenPort) {
  $kill = Join-Path $PSScriptRoot "mat3am_kill_ports.ps1"
  if (Test-Path $kill) {
    & $kill -Ports @($ListenPort) 2>$null
  }
}

$python = Resolve-Python
if (-not $python) {
  Write-Log "[FATAL] Python not found"
  exit 1
}

# منع تشغيل مراقبين متزامنين
if (Test-Path $PidFile) {
  $old = 0
  [void][int]::TryParse((Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1), [ref]$old)
  if ($old -gt 0) {
    $alive = Get-Process -Id $old -ErrorAction SilentlyContinue
    if ($alive -and $alive.Id -ne $PID) {
      Write-Log ("[INFO] watchdog already running pid={0} — exiting" -f $old)
      exit 0
    }
  }
}
Set-Content -Path $PidFile -Value $PID -Encoding ASCII
if (Test-Path $StopFlag) { Remove-Item $StopFlag -Force -ErrorAction SilentlyContinue }

$env:XTRA_API_PORT = "$Port"
if (-not $env:MAT3AM_BASE_DIR) { $env:MAT3AM_BASE_DIR = $Root }

Write-Log ("[START] watchdog pid={0} python={1} port={2} data={3}" -f $PID, $python, $Port, $env:MAT3AM_BASE_DIR)

$restartCount = 0
try {
  while ($true) {
    if (Test-Path $StopFlag) {
      Write-Log "[STOP] stop flag detected"
      break
    }

    if (Test-ApiReady) {
      Write-Log "[INFO] API already ready on port $Port — monitoring only"
      while (-not (Test-Path $StopFlag)) {
        Start-Sleep -Seconds 5
        if (-not (Test-ApiReady)) {
          Write-Log "[WARN] API became unavailable — will restart"
          break
        }
      }
      if (Test-Path $StopFlag) { break }
    } else {
      Stop-PortListeners $Port
      Start-Sleep -Seconds 1
    }

    Write-Log ("[RUN] starting api_server.py attempt={0}" -f ($restartCount + 1))
    $proc = Start-Process -FilePath $python -ArgumentList @("api_server.py") -WorkingDirectory $Backend -PassThru -WindowStyle Hidden
    Set-Content -Path $ChildPidFile -Value $proc.Id -Encoding ASCII
    Write-Log ("[RUN] child pid={0}" -f $proc.Id)

    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
      if ($proc.HasExited) { break }
      if (Test-ApiReady) { $ready = $true; break }
      if (Test-Path $StopFlag) { break }
      Start-Sleep -Milliseconds 500
    }
    if ($ready) {
      Write-Log "[OK] API ready"
    } elseif ($proc.HasExited) {
      Write-Log ("[FAIL] child exited early code={0}" -f $proc.ExitCode)
    } else {
      Write-Log "[WARN] API not ready after wait — continuing to watch process"
    }

    while (-not $proc.HasExited) {
      if (Test-Path $StopFlag) {
        Write-Log ("[STOP] stopping child pid={0}" -f $proc.Id)
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        break
      }
      Start-Sleep -Seconds 3
    }

    $code = if ($null -ne $proc.ExitCode) { $proc.ExitCode } else { "n/a" }
    Write-Log ("[EXIT] child ended code={0}" -f $code)
    Remove-Item $ChildPidFile -Force -ErrorAction SilentlyContinue

    if ($Once -or (Test-Path $StopFlag)) { break }
    $restartCount++
    Write-Log ("[WAIT] restart in {0}s" -f $RestartDelaySec)
    Start-Sleep -Seconds $RestartDelaySec
  }
}
finally {
  if ((Test-Path $PidFile) -and ((Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1) -eq "$PID")) {
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
  }
  Write-Log "[END] watchdog stopped"
}
