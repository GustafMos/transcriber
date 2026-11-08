@echo off
rem Thin launcher for the Transcriber installer.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
pause
