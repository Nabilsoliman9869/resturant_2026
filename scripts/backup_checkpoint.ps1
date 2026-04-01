# نقطة استعادة: وسم Git + حزمة bundle (ملف واحد يحمل التاريخ الكامل للفروع المُعلَّمة)
# التشغيل من جذر المشروع: .\backup_checkpoint.bat
# يتطلب: git مثبتاً في PATH

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not (Test-Path (Join-Path $Root "package.json"))) {
    Write-Host "خطأ: شغّل السكربت من مجلد مطاعم (package.json غير موجود في الجذر المتوقع)." -ForegroundColor Red
    exit 1
}

Set-Location $Root

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$tag = "checkpoint-$stamp"
$outDir = Join-Path (Split-Path $Root -Parent) "مطاعم-checkpoints"
if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}
$bundleName = "mat3am-$stamp.bundle"
$bundlePath = Join-Path $outDir $bundleName

# تهيئة Git إن لم يكن موجوداً
if (-not (Test-Path (Join-Path $Root ".git"))) {
    Write-Host "تهيئة Git لأول مرة في هذا المجلد..." -ForegroundColor Cyan
    git init
    git add -A
    git status
    git commit -m "Initial checkpoint: مطاعم suite snapshot"
}

# التأكد من وجود commit
$hasCommit = git rev-parse HEAD 2>$null
if (-not $hasCommit) {
    git add -A
    git commit -m "Checkpoint before navigation/refactor work"
}

git tag -a $tag -m "لقطة استقرار $stamp"
Write-Host "تم إنشاء الوسم: $tag" -ForegroundColor Green

# حزمة واحدة تحمل كل المراجع (مناسبة للنسخ الاحتياطي الخارجي)
git bundle create $bundlePath --all
Write-Host "تم إنشاء: $bundlePath" -ForegroundColor Green
Write-Host ""
Write-Host "لاستعادة لاحقاً في مجلد جديد:" -ForegroundColor Yellow
Write-Host "  git clone $bundleName مطاعم-restored"
Write-Host "  (أو: git bundle verify $bundleName ثم git fetch / pull من الـ bundle)"
Write-Host ""
Write-Host "لعرض الوسوم: git tag -l checkpoint-*"
