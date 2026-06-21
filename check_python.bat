@echo off
echo Checking Python installations...
where python 2>nul && python --version && python -m pip show pyinstaller 2>nul | findstr "Name:" && echo PYINSTALLER_FOUND && exit /b 0
echo Python or PyInstaller not found in PATH
exit /b 1
