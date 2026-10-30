@echo off
title QuizKing Debug Chrome Launcher
REM ------------------------------------------------------------
REM Launches a SEPARATE Chrome instance (C:\ChromeDebug) with the
REM remote-debugging port so the agent can attach via CDP.
REM Your main Chrome (default profile) is NOT touched.
REM Also removes the leftover scheduled task from earlier attempts.
REM ------------------------------------------------------------

REM cleanup: remove half-created task from a previous attempt (harmless if absent)
schtasks /delete /f /tn "QKDebugChrome" >nul 2>&1

REM if debug chrome is already running, do nothing
curl -s --max-time 2 http://127.0.0.1:9222/json/version >nul 2>&1
if %errorlevel%==0 (
  echo [OK] Debug Chrome is ALREADY running on port 9222. Just log in to jutiku in that window.
  pause
  exit /b 0
)

echo [..] Launching debug Chrome ...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir=C:\ChromeDebug --no-first-run --no-default-browser-check --window-size=1400,900 https://www.jutiku.cn/test?pid=5991

echo [..] Waiting for debug port (max 20s) ...
set /a tries=0
:waitloop
timeout /t 2 /nobreak >nul
curl -s --max-time 2 http://127.0.0.1:9222/json/version >nul 2>&1
if %errorlevel%==0 goto :ok
set /a tries+=1
if %tries% lss 10 goto :waitloop
echo [FAIL] Port 9222 did not open within 20 seconds.
pause
exit /b 1

:ok
echo.
echo [OK] Port 9222 is OPEN.
echo      Now log in to jutiku in the newly opened Chrome window,
echo      then tell the agent you are done.
echo.
pause
