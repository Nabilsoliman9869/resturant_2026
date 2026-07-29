#Requires -Version 5.1
<#
.SYNOPSIS
  زامِن الكود: commit + push إلى GitHub main + redeploy Railway + إعادة تشغيل API محلي (2288).

.USAGE
  .\scripts\sync_all_axes.ps1 -Message "وصف مختصر للتغيير"
  .\scripts\sync_all_axes.ps1 -Message "fix xyz" -SkipLocalRestart
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$Message,
  [switch]$SkipCommit,
  [switch]$SkipPush,
  [switch]$SkipRailway,
  [switch]$SkipLocalRestart,
  [string]$RailwayService = "resturant_2026",
  [string]$RailwayProject = "believable-comfort"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$RailwayCmd = Join-Path $env:APPDATA "npm\railway.cmd"
$SqlCmd17 = "C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\SQLCMD.EXE"

$StagePrefixes = @(
  "backend/",
  "src/",
  "docs/",
  "scripts/",
  "android/",
  ".gitignore",
  "assets/",
  "sql/",
  "ui/restaurant/index.html",
  "Dockerfile",
  "railway.toml",
  "package.json",
  "package-lock.json",
  "vite.config.ts",
  "tsconfig.json",
  "index.html",
  "PROJECT_GUIDE.md",
  "PROMO_PROFILE.md",
  "TEST_GUIDE_MANAGER.md",
  "Mat3amPOS",
  "build_v",
  "run_",
  "restart-servers.bat",
  "stop_api_watchdog.bat",
  ".cursor/rules/",
  "config/tbl_seed_pack_v1.json",
  "config/mat3am_exe_build.txt",
  "config/settings.example.json"
)

function Test-StagePath([string]$Path) {
  $p = ($Path -replace '\\', '/').Trim()
  foreach ($prefix in $StagePrefixes) {
    if ($p.StartsWith($prefix) -or $p -eq $prefix.TrimEnd('/')) { return $true }
  }
  return $false
}

function Write-Step([string]$Text) {
  Write-Host ""
  Write-Host "==> $Text" -ForegroundColor Cyan
}

Write-Step "Root: $Root"

# --- Git: stage product files only ---
if (-not $SkipCommit) {
  Write-Step "Git: staging product files"
  $changed = @(git diff --name-only; git diff --cached --name-only; git ls-files --others --exclude-standard) | Sort-Object -Unique
  $toStage = @($changed | Where-Object { Test-StagePath $_ })
  if ($toStage.Count -eq 0) {
    Write-Host "No product changes to commit." -ForegroundColor Yellow
  } else {
    foreach ($f in $toStage) { git add -- "$f" }
    git diff --cached --stat
    git commit -m $Message
    Write-Host "Committed: $(git rev-parse --short HEAD)" -ForegroundColor Green
  }
}

$Head = (git rev-parse HEAD).Trim()
$HeadShort = (git rev-parse --short HEAD).Trim()
Write-Host "HEAD = $HeadShort"

# --- Push GitHub ---
if (-not $SkipPush) {
  Write-Step "Git: push origin main"
  git push origin main
  Write-Host "Pushed to origin/main" -ForegroundColor Green
}

# --- Railway redeploy from GitHub main ---
if (-not $SkipRailway) {
  Write-Step "Railway: redeploy $RailwayService from source (main)"
  if (-not (Test-Path $RailwayCmd)) {
    Write-Warning "Railway CLI not found — skip deploy. Install: npm i -g @railway/cli"
  } else {
    & $RailwayCmd link -p $RailwayProject -s $RailwayService -e production 2>&1 | Out-Null
    $ErrorActionPreference = "Continue"
    & $RailwayCmd redeploy --service $RailwayService --from-source -y 2>&1 | Out-Null
    $ErrorActionPreference = "Stop"
    $deployed = $false
    for ($i = 1; $i -le 24; $i++) {
      Start-Sleep -Seconds 15
      try {
        $who = Invoke-RestMethod "https://resturant2026-production.up.railway.app/__whoami__" -TimeoutSec 20
        $gitLine = ($who -split "`n" | Where-Object { $_ -like "RAILWAY_GIT=*" }) -replace "RAILWAY_GIT=", ""
        Write-Host "  poll $i : RAILWAY_GIT=$gitLine"
        if ($gitLine -and $gitLine.StartsWith($HeadShort)) {
          $deployed = $true
          break
        }
      } catch {
        Write-Host "  poll $i : waiting..."
      }
    }
    if ($deployed) {
      Write-Host "Railway live at commit $HeadShort" -ForegroundColor Green
    } else {
      Write-Warning "Railway deploy not confirmed yet — check dashboard or run: railway logs --service $RailwayService"
    }
  }
}

# --- Local API 2288 restart if backend changed ---
if (-not $SkipLocalRestart) {
  $backendChanged = $false
  try {
    $lastCommitFiles = git diff-tree --no-commit-id --name-only -r HEAD 2>$null
    if ($lastCommitFiles -match "^backend/") { $backendChanged = $true }
  } catch {}
  if (-not $backendChanged) {
    $unstaged = git diff --name-only 2>$null
    if ($unstaged -match "^backend/") { $backendChanged = $true }
  }
  if ($backendChanged) {
    Write-Step "Local: restart API on 2288"
    $killScript = Join-Path $Root "scripts\mat3am_kill_ports.ps1"
    if (Test-Path $killScript) {
      & powershell -NoProfile -ExecutionPolicy Bypass -File $killScript -Ports 2288 2>&1 | Out-Null
      Start-Sleep -Seconds 2
    }
    $backendDir = Join-Path $Root "backend"
    $py = Join-Path $backendDir ".venv312\Scripts\python.exe"
    if (-not (Test-Path $py)) { $py = "python" }
    $env:XTRA_API_PORT = "2288"
    $env:MAT3AM_BASE_DIR = $Root
    Start-Process -FilePath $py -ArgumentList "api_server.py" -WorkingDirectory $backendDir -WindowStyle Hidden
    Start-Sleep -Seconds 4
    try {
      $local = Invoke-RestMethod "http://127.0.0.1:2288/__whoami__" -TimeoutSec 8
      Write-Host "Local API OK" -ForegroundColor Green
      ($local -split "`n" | Select-Object -First 3) | ForEach-Object { Write-Host "  $_" }
    } catch {
      Write-Warning "Local API not responding yet — run run_full_stack.bat"
    }
  } else {
    Write-Host "No backend change — skip local API restart (Vite HMR handles frontend)." -ForegroundColor DarkGray
  }
}

Write-Step "Done"
Write-Host "  GitHub : https://github.com/Nabilsoliman9869/resturant_2026/commit/$Head"
Write-Host "  Railway: https://resturant2026-production.up.railway.app/"
Write-Host "  Local  : http://localhost:9999 + http://127.0.0.1:2288"
