@echo off
rem Keep this window open: checks the share every 5 minutes
title BP Dashboard auto-sync (close this window to stop)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-from-share.ps1" -Loop -IntervalMinutes 5
pause
