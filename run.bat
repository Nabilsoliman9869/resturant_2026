@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "node_modules" (
  echo تثبيت الحزم...
  call npm install
)
echo.
echo مطاعم XTRA — الواجهة: http://127.0.0.1:9999  (من vite.config.ts)
echo لرؤية آخر كود: أغلق Vite القديم ثم npm run dev:fresh  أو  restart_from_zero.bat
echo الخادم المحلي: run_api.bat أو run_full_stack.bat أو restart_from_zero.bat لإيقاف المنفذين وإعادة التشغيل
echo.
call npm run dev
pause
