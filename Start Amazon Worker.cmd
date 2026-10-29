@echo off
cd /d "%~dp0"
call npm.cmd run build:worker
if errorlevel 1 goto failed
node scripts/start-worker.cjs
if errorlevel 1 goto failed
exit /b 0
:failed
echo Worker stopped. Review the error above before restarting.
pause
