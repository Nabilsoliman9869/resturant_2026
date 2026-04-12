param(
  [int[]] $Ports = @(2288, 9999)
)
$ErrorActionPreference = "SilentlyContinue"
foreach ($port in $Ports) {
  $raw = netstat -ano 2>$null
  if (-not $raw) { continue }
  foreach ($line in $raw) {
    if ($line -notmatch "LISTENING") { continue }
    if ($line -notmatch ":$port\s") { continue }
    $parts = ($line -split "\s+") | Where-Object { $_ -ne "" }
    if ($parts.Count -lt 5) { continue }
    $procId = 0
    [void][int]::TryParse($parts[-1], [ref]$procId)
    if ($procId -le 0) { continue }
    Write-Host "Stopping PID $procId (port $port)"
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  }
}
Write-Host "Done."
