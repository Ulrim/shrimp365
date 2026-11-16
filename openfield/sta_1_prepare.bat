@echo off
rem STA 1. prepare (check data, build cache, check model hashes)
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"
echo === STA 1. prepare (check data, build cache, check model hashes) ===
if exist .venv\Scripts\activate.bat call .venv\Scripts\activate.bat
python scripts\sta_prepare.py %*
:done
set CODE=%ERRORLEVEL%
echo.
echo [exit code %CODE%]
pause
exit /b %CODE%
