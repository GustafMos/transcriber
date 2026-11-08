@echo off
rem Start the Transcriber: whisper server + web UI + browser.
setlocal
cd /d "%~dp0.."

set "SERVER=backend\bin\whisper-server.exe"
set "MODEL=models\ggml-small.bin"

if not exist "%SERVER%" (
  echo Backend not installed. Run installer\install.bat first.
  pause
  exit /b 1
)
if not exist "%MODEL%" (
  echo Model not found. Run installer\install.bat first.
  pause
  exit /b 1
)

echo Starting Whisper server on 127.0.0.1:8080 ...
start "Transcriber Whisper" /min "%SERVER%" -m "%MODEL%" --host 127.0.0.1 --port 8080

echo Starting web UI at http://127.0.0.1:8000  (close this window to stop)
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 1; Start-Process 'http://127.0.0.1:8000'"

rem Serve the UI in the foreground; fall back to PowerShell if Python is missing.
where python >nul 2>nul
if %errorlevel%==0 (
  python server\serve.py
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File server\serve.ps1
)

rem Cleanup when the UI server stops.
taskkill /IM whisper-server.exe /F >nul 2>nul
endlocal
