@echo off

chcp 65001 >nul

cd /d "%~dp0backend"

echo خادم مطاعم — http://127.0.0.1:2288  (أوقف بـ Ctrl+C)

python api_server.py

pause

