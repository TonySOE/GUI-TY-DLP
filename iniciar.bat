@echo off
title yt-dlp GUI
echo ============================================
echo   yt-dlp GUI  -  Iniciando...
echo ============================================

:: Verificar Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python no encontrado. Instala Python 3.8+ desde python.org
    pause
    exit /b 1
)

:: Instalar dependencias si no existen
python -c "import flask" >nul 2>&1
if %errorlevel% neq 0 (
    echo Instalando dependencias...
    pip install -r requirements.txt
)

:: Abrir navegador automaticamente
start /B cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:5000"

:: Iniciar servidor
python app.py
pause