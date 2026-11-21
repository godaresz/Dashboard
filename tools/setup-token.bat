@echo off
rem Save GitHub token (encrypted for this Windows user)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-from-share.ps1" -SetToken
pause
