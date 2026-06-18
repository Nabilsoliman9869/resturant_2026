@echo off
chcp 65001 >nul
title XTRA-MAT3AM Launcher (exe30)
echo ===========================================
echo   XTRA Web — Restaurant Suite (exe30)
echo ===========================================
echo.
echo This script launches the BACKEND and FRONTEND.
echo Press Ctrl+C on each window to stop.
echo.

REM --- Backend (Python FastAPI) ---
echo [1/2] Starting BACKEND on port 2288 ...
start "XTRA-BACKEND :2288" cmd /k "cd /d %~dp0backend && python mat3am_exe_entry.py"

REM --- Wait a bit for backend ---
timeout /t 3 /nobreak >nul

REM --- Frontend (Vite/React) ---
echo [2/2] Starting FRONTEND ...
start "XTRA-FRONTEND" cmd /k "cd /d %~dp0 && npm run dev"

echo.
echo ===========================================
echo   Both services are starting.
echo   - Backend : http://127.0.0.1:2288
:e:   - Frontend: http://localhost:5173  (or check the window title)
echo ===========================================
pause
