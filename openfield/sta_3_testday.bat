@echo off
rem STA 3. test day (run all steps against sealed test set)
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"
echo === STA 3. test day (run all steps against sealed test set) ===
if exist .venv\Scripts\activate.bat call .venv\Scripts\activate.bat
python scripts\sta_run_all.py --mode testday %*
:done
set CODE=%ERRORLEVEL%
echo.
echo [exit code %CODE%]
pause
exit /b %CODE%
