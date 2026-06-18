@echo off
chcp 65001 >nul
title XTRA-MAT3AM Launcher (exe30)
echo ===========================================
echo   XTRA Web — Restaurant Suite (exe30)
echo ===========================================
echo.
echo Starting BACKEND and FRONTEND...
echo.

REM --- Backend ---
echo [1/2] Starting BACKEND on port 2288 ...
start "XTRA-BACKEND :2288" cmd /k "cd /d %~dp0backend && python mat3am_exe_entry.py"
timeout /t 3 /nobreak >nul

REM --- Frontend ---
echo [2/2] Starting FRONTEND ...
start "XTRA-FRONTEND" cmd /k "cd /d %~dp0 && npm run dev"

echo.
echo ===========================================
echo   Both services started.
echo   - Backend : http://127.0.0.1:2288
;e:   - Frontend: check the second window
echo ===========================================
pause
