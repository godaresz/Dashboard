@echo off
rem Sync Excel files from the network share to GitHub once
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-from-share.ps1"
pause
