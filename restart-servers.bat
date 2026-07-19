@echo off
chcp 65001 >nul
taskkill /F /IM python.exe >nul 2>&1
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul

start /B "" "C:\Users\NabilSirconsult\env\Scripts\python.exe" "e:\XTRA_WEB\مطاعم\backend\api_server.py"
timeout /t 3 /nobreak >nul

cd /d "e:\XTRA_WEB\مطاعم"
start /B "" npm run dev
timeout /t 5 /nobreak >nul

netstat -ano | findstr :2288 | findstr LISTENING
netstat -ano | findstr :9999 | findstr LISTENING

curl -s http://127.0.0.1:2288/api/health -m 5 >nul && echo BackendOK || echo BackendFAIL
