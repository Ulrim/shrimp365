@echo off
rem STA 0. setup (venv + packages)
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"
echo === STA 0. setup (venv + packages) ===
python -m venv .venv
if errorlevel 1 goto done
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
:done
set CODE=%ERRORLEVEL%
echo.
echo [exit code %CODE%]
pause
exit /b %CODE%
