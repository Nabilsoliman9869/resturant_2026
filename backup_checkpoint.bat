@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo نقطة استعادة — وسم Git + ملف bundle بجانب المجلد الأب
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\backup_checkpoint.ps1"
if errorlevel 1 pause
pause
