@echo off
chcp 65001 >nul
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

:: Verify all required dependencies
python -c "import flask, yt_dlp, yt_dlp_ejs, PIL" >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing dependencies from requirements.txt...
    python -m pip install -r requirements.txt
)

:: Open browser after a short delay to ensure server is up
start /B cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:5000"

:: Start the Flask app (server)
python app.py
pause
