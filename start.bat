@echo off
title yt-dlp GUI
echo ============================================
echo   yt-dlp GUI  -  Setting up...
echo ============================================

:: Verify Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found. Please install Python 3.8+ from python.org
    pause
    exit /b 1
)

:: Install dependencies if not present
python -c "import flask" >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing dependencies...
    pip install -r requirements.txt
)

:: Open browser after a short delay to ensure server is up
start /B cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:5000"

:: Start the Flask app (server)
python app.py
pause