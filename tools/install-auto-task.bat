@echo off
rem Register a Windows scheduled task that syncs every 5 minutes in the background
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-sync-task.ps1" %*
pause
