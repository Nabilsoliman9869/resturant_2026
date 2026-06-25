# Stress Test for Customer Type Workflow
# Usage: & "e:\XTRA_WEB\مطاعم\stress_test.ps1"

$ErrorActionPreference = "Stop"
$base = "http://127.0.0.1:2288"
$results = @()
function Add-Result($step, $status, $detail, $ms) {
    $script:results += [pscustomobject]@{ Step=$step; Status=$status; Detail=$detail; Ms=$ms }
}

# ── Helper: measure POST ──────────────────────────────────────────
function Measure-Post($uri, $body, $cookies) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $headers = @{ 'Content-Type' = 'application/json' }
    if ($cookies) { $headers['Cookie'] = $cookies }
    $resp = Invoke-WebRequest -Uri $uri -Method POST -Headers $headers -Body ($body | ConvertTo-Json -Compress) -UseBasicParsing -SessionVariable sv
    $sw.Stop()
    return @{ Status=$resp.StatusCode; Content=$resp.Content; Ms=$sw.ElapsedMilliseconds; Sv=$sv }
}

# ── Helper: measure GET ───────────────────────────────────────────
function Measure-Get($uri, $cookies) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $headers = @{}
    if ($cookies) { $headers['Cookie'] = $cookies }
    $resp = Invoke-WebRequest -Uri $uri -Method GET -Headers $headers -UseBasicParsing
    $sw.Stop()
    return @{ Status=$resp.StatusCode; Content=$resp.Content; Ms=$sw.ElapsedMilliseconds }
}

# ── 1. DEV LOGIN ─────────────────────────────────────────────────
Write-Host "`n[1] DEV LOGIN ..." -ForegroundColor Cyan
$r = Measure-Post "$base/api/auth/login" @{ login="dev"; pin="dev@123"; localDate="2026-06-23" }
Add-Result "login" ($r.Status -eq 200) "status=$($r.Status)" $r.Ms
$loginJson = $r.Content | ConvertFrom-Json
$devActor = @{ id=$loginJson.user.id; login=$loginJson.user.login; name=$loginJson.user.name; role=$loginJson.user.role }
Write-Host "   Actor: $($devActor.name) / $($devActor.role)  ($($r.Ms)ms)"

# ── 2. GET TABLES (speed baseline) ──────────────────────────────
Write-Host "`n[2] GET TABLES ..." -ForegroundColor Cyan
$r = Measure-Get "$base/api/restaurant/tables"
Add-Result "get-tables" ($r.Status -eq 200) "status=$($r.Status)" $r.Ms
$tables = ($r.Content | ConvertFrom-Json).data
$table1 = $tables | Where-Object { $_.status -eq 'available' } | Select-Object -First 1
Write-Host "   Found $($tables.Count) tables, picked T$($table1.number)  ($($r.Ms)ms)"

# ── 3. SEAT with CASH (should open immediately) ──────────────────
Write-Host "`n[3] SEAT CASH on T$($table1.number) ..." -ForegroundColor Cyan
$seatBody = @{
    tableId = $table1.id
    mat3amActor = $devActor
    assignOrderTaker = $true
    startedByRole = $devActor.role
    startReason = "stress_test_cash"
    customerType = "cash"
}
$r = Measure-Post "$base/api/restaurant/table-sessions" $seatBody
Add-Result "seat-cash" ($r.Status -eq 200) "status=$($r.Status)" $r.Ms
$sessionCash = $r.Content | ConvertFrom-Json
$sidCash = $sessionCash.id
$pendingCash = if ($sessionCash.guestApprovalPending) { "YES" } else { "NO" }
Write-Host "   Session=$sidCash  approvalPending=$pendingCash  customerType=$($sessionCash.customerType)  ($($r.Ms)ms)"

# ── 4. SEAT with GUEST (should require approval) ──────────────────
$table2 = $tables | Where-Object { $_.status -eq 'available' -and $_.id -ne $table1.id } | Select-Object -First 1
Write-Host "`n[4] SEAT GUEST on T$($table2.number) ..." -ForegroundColor Cyan
$seatBody.customerType = "guest"
$r = Measure-Post "$base/api/restaurant/table-sessions" $seatBody
Add-Result "seat-guest" ($r.Status -eq 200) "status=$($r.Status)" $r.Ms
$sessionGuest = $r.Content | ConvertFrom-Json
$sidGuest = $sessionGuest.id
if ($sessionGuest.session) { $sessionGuest = $sessionGuest.session }
$pendingGuest = if ($sessionGuest.guestApprovalPending) { "YES" } else { "NO" }
Write-Host "   Session=$sidGuest  approvalPending=$pendingGuest  customerType=$($sessionGuest.customerType)  ($($r.Ms)ms)"

# ── 5. SEAT with OWNER ──────────────────────────────────────────
$table3 = $tables | Where-Object { $_.status -eq 'available' -and $_.id -notin @($table1.id, $table2.id) } | Select-Object -First 1
Write-Host "`n[5] SEAT OWNER on T$($table3.number) ..." -ForegroundColor Cyan
$seatBody.customerType = "owner"
$r = Measure-Post "$base/api/restaurant/table-sessions" $seatBody
Add-Result "seat-owner" ($r.Status -eq 200) "status=$($r.Status)" $r.Ms
$sessionOwner = $r.Content | ConvertFrom-Json
$sidOwner = $sessionOwner.id
if ($sessionOwner.session) { $sessionOwner = $sessionOwner.session }
$pendingOwner = if ($sessionOwner.guestApprovalPending) { "YES" } else { "NO" }
Write-Host "   Session=$sidOwner  approvalPending=$pendingOwner  customerType=$($sessionOwner.customerType)  ($($r.Ms)ms)"

# ── 6. SEAT with VIP ────────────────────────────────────────────
$table4 = $tables | Where-Object { $_.status -eq 'available' -and $_.id -notin @($table1.id, $table2.id, $table3.id) } | Select-Object -First 1
Write-Host "`n[6] SEAT VIP on T$($table4.number) ..." -ForegroundColor Cyan
$seatBody.customerType = "vip"
$r = Measure-Post "$base/api/restaurant/table-sessions" $seatBody
Add-Result "seat-vip" ($r.Status -eq 200) "status=$($r.Status)" $r.Ms
$sessionVip = $r.Content | ConvertFrom-Json
$sidVip = $sessionVip.id
if ($sessionVip.session) { $sessionVip = $sessionVip.session }
$pendingVip = if ($sessionVip.guestApprovalPending) { "YES" } else { "NO" }
Write-Host "   Session=$sidVip  approvalPending=$pendingVip  customerType=$($sessionVip.customerType)  ($($r.Ms)ms)"

# ── 7. CHECK OPEN-ORDER LOCK (guest should be locked) ────────────
Write-Host "`n[7] CHECK GUEST LOCKED ..." -ForegroundColor Cyan
$r = Measure-Get "$base/api/restaurant/table-sessions"
Add-Result "get-sessions" ($r.Status -eq 200) "status=$($r.Status)" $r.Ms
$sessions = ($r.Content | ConvertFrom-Json).data
$guestSess = $sessions | Where-Object { $_.id -eq $sidGuest }
$locked = $guestSess.customerTypeLocked -or $guestSess.guestApprovalPending
Add-Result "guest-locked" $locked "locked=$locked  customerType=$($guestSess.customerType)" 0
Write-Host "   guestApprovalPending=$($guestSess.guestApprovalPending)  customerTypeLocked=$($guestSess.customerTypeLocked)"

# ── 8. MANAGER APPROVAL INBOX ───────────────────────────────────
Write-Host "`n[8] MANAGER INBOX ..." -ForegroundColor Cyan
$r = Measure-Get "$base/api/manager-approval/inbox?limit=50"
Add-Result "inbox-get" ($r.Status -eq 200) "status=$($r.Status)" $r.Ms
$inbox = $r.Content | ConvertFrom-Json
$reqs = if ($inbox.data) { $inbox.data } else { $inbox }
Write-Host "   Found $($reqs.Count) approval requests  ($($r.Ms)ms)"

# ── 9. APPROVE GUEST ────────────────────────────────────────────
$guestReq = $reqs | Where-Object { $_.sessionId -eq $sidGuest } | Select-Object -First 1
if ($guestReq) {
    Write-Host "`n[9] APPROVE GUEST request=$($guestReq.id) ..." -ForegroundColor Cyan
    $apvBody = @{ requestId = $guestReq.id; decision = "approve"; mat3amActor = $devActor }
    $r = Measure-Post "$base/api/manager-approval/decide" $apvBody
    Add-Result "approve-guest" ($r.Status -eq 200) "status=$($r.Status)" $r.Ms
    Write-Host "   ($($r.Ms)ms)"
} else { Add-Result "approve-guest" $false "request not found" 0 }

# ── 10. VERIFY GUEST UNLOCKED ────────────────────────────────────
Write-Host "`n[10] VERIFY GUEST UNLOCKED ..." -ForegroundColor Cyan
Start-Sleep -Milliseconds 500
$r = Measure-Get "$base/api/restaurant/table-sessions"
$sessions2 = ($r.Content | ConvertFrom-Json).data
$guestSess2 = $sessions2 | Where-Object { $_.id -eq $sidGuest }
$unlocked = -not ($guestSess2.guestApprovalPending -or $guestSess2.customerTypeLocked)
$isGuest = $guestSess2.guestSession
Add-Result "guest-unlocked" $unlocked "unlocked=$unlocked guestSession=$isGuest customerType=$($guestSess2.customerType)" $r.Ms
Write-Host "   guestApprovalPending=$($guestSess2.guestApprovalPending)  guestSession=$isGuest  customerType=$($guestSess2.customerType)"

# ── 11. APPROVE OWNER ───────────────────────────────────────────
$ownerReq = $reqs | Where-Object { $_.sessionId -eq $sidOwner } | Select-Object -First 1
if ($ownerReq) {
    Write-Host "`n[11] APPROVE OWNER request=$($ownerReq.id) ..." -ForegroundColor Cyan
    $apvBody = @{ requestId = $ownerReq.id; decision = "approve"; mat3amActor = $devActor }
    $r = Measure-Post "$base/api/manager-approval/decide" $apvBody
    Add-Result "approve-owner" ($r.Status -eq 200) "status=$($r.Status)" $r.Ms
    Write-Host "   ($($r.Ms)ms)"
} else { Add-Result "approve-owner" $false "request not found" 0 }

# ── 12. VERIFY OWNER customerType ─────────────────────────────────
Write-Host "`n[12] VERIFY OWNER customerType ..." -ForegroundColor Cyan
Start-Sleep -Milliseconds 500
$r = Measure-Get "$base/api/restaurant/table-sessions"
$sessions3 = ($r.Content | ConvertFrom-Json).data
$ownerSess = $sessions3 | Where-Object { $_.id -eq $sidOwner }
Add-Result "owner-type" ($ownerSess.customerType -eq 'owner') "customerType=$($ownerSess.customerType)" $r.Ms
Write-Host "   customerType=$($ownerSess.customerType)"

# ── 13. DUPLICATE-SESSION GUARD ───────────────────────────────────
Write-Host "`n[13] DUPLICATE GUARD (seat same table1 again with cash) ..." -ForegroundColor Cyan
$seatBody.customerType = "cash"
$r = Measure-Post "$base/api/restaurant/table-sessions" $seatBody
Add-Result "duplicate-guard" ($r.Status -eq 200) "status=$($r.Status)  same session returned?" $r.Ms
$dupSession = $r.Content | ConvertFrom-Json
$isSame = ($dupSession.id -eq $sidCash)
Add-Result "duplicate-id" $isSame "same-id=$isSame" 0
Write-Host "   Original=$sidCash  Returned=$($dupSession.id)  Same=$isSame ($($r.Ms)ms)"

# ── 14. REJECT VIP ───────────────────────────────────────────────
$vipReq = $reqs | Where-Object { $_.sessionId -eq $sidVip } | Select-Object -First 1
if ($vipReq) {
    Write-Host "`n[14] REJECT VIP request=$($vipReq.id) ..." -ForegroundColor Cyan
    $rejBody = @{ requestId = $vipReq.id; decision = "reject"; mat3amActor = $devActor }
    $r = Measure-Post "$base/api/manager-approval/decide" $rejBody
    Add-Result "reject-vip" ($r.Status -eq 200) "status=$($r.Status)" $r.Ms
    Write-Host "   ($($r.Ms)ms)"
} else { Add-Result "reject-vip" $false "request not found" 0 }

# ── 15. VERIFY VIP REJECTED (back to cash) ──────────────────────
Write-Host "`n[15] VERIFY VIP REJECTED (should reset to cash) ..." -ForegroundColor Cyan
Start-Sleep -Milliseconds 500
$r = Measure-Get "$base/api/restaurant/table-sessions"
$sessions4 = ($r.Content | ConvertFrom-Json).data
$vipSess = $sessions4 | Where-Object { $_.id -eq $sidVip }
$isCash = ($vipSess.customerType -eq 'cash' -or -not $vipSess.customerType)
Add-Result "vip-rejected" $isCash "customerType=$($vipSess.customerType)  guestApprovalPending=$($vipSess.guestApprovalPending)" $r.Ms
Write-Host "   customerType=$($vipSess.customerType)  guestApprovalPending=$($vipSess.guestApprovalPending)"

# ── 16. SPEED: 10x get-tables burst ──────────────────────────────
Write-Host "`n[16] SPEED BURST (10x GET /tables) ..." -ForegroundColor Cyan
$times = @()
for ($i=0; $i -lt 10; $i++) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $null = Invoke-WebRequest -Uri "$base/api/restaurant/tables" -Method GET -UseBasicParsing
    $sw.Stop()
    $times += $sw.ElapsedMilliseconds
}
$avg = ($times | Measure-Object -Average).Average
$min = ($times | Measure-Object -Minimum).Minimum
$max = ($times | Measure-Object -Maximum).Maximum
Add-Result "speed-burst" $true "avg=${avg}ms min=${min}ms max=${max}ms" $avg
Write-Host "   avg=${avg}ms  min=${min}ms  max=${max}ms"

# ── 17. CLEANUP: force-close test sessions ────────────────────────
Write-Host "`n[17] CLEANUP (force-close test sessions) ..." -ForegroundColor Cyan
foreach ($sid in @($sidCash, $sidGuest, $sidOwner, $sidVip)) {
    if ($sid) {
        $r = Measure-Post "$base/api/restaurant/table-sessions/$sid/close" @{ mat3amActor = $devActor; reason = "stress_test_cleanup" }
        Write-Host "   Closed $sid  status=$($r.Status)"
    }
}

# ── SUMMARY ──────────────────────────────────────────────────────
Write-Host "`n========================================" -ForegroundColor Yellow
Write-Host "         STRESS TEST SUMMARY           " -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
$pass = ($results | Where-Object { $_.Status -eq $true }).Count
$fail = ($results | Where-Object { $_.Status -eq $false }).Count
Write-Host "PASSED: $pass  /  FAILED: $fail" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Red" })
$results | Format-Table -AutoSize
Write-Host "========================================`n" -ForegroundColor Yellow
