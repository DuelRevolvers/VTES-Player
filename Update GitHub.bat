@echo off
setlocal
title Update GitHub - VTES Platform
cd /d "%~dp0"

echo ==================================================
echo   Saving your work to GitHub
echo ==================================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo Git is not installed, or Windows cannot find it.
  echo Get it from https://git-scm.com/download/win then try again.
  goto :done
)

if not exist ".git" (
  echo This folder is not a git repository.
  echo Looked in: %CD%
  goto :done
)

echo Type a short note about what changed, then press Enter.
echo Press Enter on its own to just call it "Updates".
echo.
set "MSG="
set /p "MSG=Note: "
if not defined MSG set "MSG=Updates"

echo.
echo --- Gathering changes ----------------------------
git add -A
if errorlevel 1 goto :failed

echo.
echo --- Safety check ---------------------------------
git status --porcelain | findstr /C:"Cockatrice-" /C:"node_modules/" /C:"logs/" /C:"saves/" /C:".claude/" /C:"data/vtes-raw"
if errorlevel 1 (
  echo   ok - nothing that should stay private is being uploaded.
) else (
  echo.
  echo   ** STOPPED. The lines above should never be published. **
  echo.
  echo   Nothing has been sent anywhere, and none of your work has
  echo   changed - this just un-marks the files so nothing goes up.
  git reset >nul
  echo   Done. Tell Claude what the lines above said.
  goto :done
)

echo.
echo --- Saving ---------------------------------------
git commit -m "%MSG%"
if errorlevel 1 echo   Nothing new to save - looking for anything not yet uploaded.

echo.
echo --- Uploading ------------------------------------
git push
if errorlevel 1 goto :failed

echo.
echo ==================================================
echo   Done. Your work is on GitHub.
echo   The website rebuilds itself in about a minute.
echo ==================================================
goto :done

:failed
echo.
echo   Something went wrong - the message above says what.
echo   Nothing is broken. Tell Claude what it says.

:done
echo.
pause
endlocal
