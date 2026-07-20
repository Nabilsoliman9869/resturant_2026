# رفع oya.bak إلى حاوية SQL Server على Railway
# الاستخدام:
#   1) railway login
#   2) railway link   (اختر مشروع + خدمة SqlServer2022Docker)
#   3) .\scripts\upload_bak_to_railway.ps1

$ErrorActionPreference = "Stop"
$LocalBak = "C:\Backups\oya.bak"
$RemotePath = "/var/opt/mssql/backup/oya.bak"
$RailwayCmd = "$env:APPDATA\npm\railway.cmd"

if (-not (Test-Path $LocalBak)) {
    throw "الملف غير موجود: $LocalBak — شغّل التحميل من Drive أولاً."
}

$sizeMb = [math]::Round((Get-Item $LocalBak).Length / 1MB, 2)
Write-Host "✓ الملف المحلي: $LocalBak ($sizeMb MB)"

if (-not (Test-Path $RailwayCmd)) {
    throw "Railway CLI غير مثبت. نفّذ: npm install -g @railway/cli"
}

Write-Host "→ التحقق من تسجيل الدخول..."
& $RailwayCmd whoami 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "سجّل الدخول أولاً: railway login"
}

Write-Host "→ إنشاء مجلد النسخ على الحاوية..."
& $RailwayCmd ssh -- "mkdir -p /var/opt/mssql/backup"

Write-Host "→ جلب أمر SSH للخدمة (للـ scp)..."
$configPreview = & $RailwayCmd ssh config --help 2>&1
Write-Host "   إن فشل الرفع التلقائي: من Dashboard → Copy SSH Command ثم:"
Write-Host "   scp -P 22 `"$LocalBak`" USER@HOST:/var/opt/mssql/backup/oya.bak"

# محاولة رفع عبر ssh config الذي يولّده Railway
$sshConfigPath = Join-Path $env:USERPROFILE ".ssh\config"
& $RailwayCmd ssh config 2>&1 | Out-Null

Write-Host "→ رفع الملف (قد يستغرق دقائق)..."
# Railway CLI لا يوفّر scp مباشرة — نستخدم curl من داخل الحاوية إن كان Drive متاحاً،
# أو scp يدوي. هنا نعطي أمر curl كبديل سريع إن كان الملف على Drive:
Write-Host ""
Write-Host "═══ بديل سريع داخل Railway Console ═══"
Write-Host "mkdir -p /var/opt/mssql/backup"
Write-Host 'curl -L "https://drive.google.com/uc?export=download&id=1m053J2OveNz2x7PtdSBszn38s3pUiTN0" -o /var/opt/mssql/backup/oya.bak'
Write-Host "ls -lh /var/opt/mssql/backup/oya.bak"
Write-Host ""
Write-Host "═══ أو من جهازك (بعد Copy SSH Command) ═══"
Write-Host "scp -P 22 `"$LocalBak`" <SSH_TARGET>:$RemotePath"
Write-Host ""
Write-Host "✓ بعد الرفع — في SSMS:"
Write-Host "RESTORE FILELISTONLY FROM DISK = '$RemotePath';"
