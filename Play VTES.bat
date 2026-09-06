@echo off
rem ===========================================================================
rem  VTES Player - launcher
rem
rem  Double-click this file to play. It does three things:
rem    1. checks Node.js is installed,
rem    2. installs the project's dependencies the first time only,
rem    3. starts the local web server and opens the game in your browser.
rem
rem  The black window that appears IS the server. Leave it open while you
rem  play; closing it stops the game.
rem ===========================================================================

title VTES Player
setlocal

rem Work from this file's own folder, wherever it was launched from.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :no_node

rem First run only: fetch the libraries the project needs.
if not exist "node_modules\" goto :install
goto :run

:install
echo.
echo   First run - installing dependencies.
echo   This takes a minute or two and only happens once.
echo.
call npm install
if errorlevel 1 goto :install_failed
echo.
echo   Dependencies installed.
goto :run

:run
echo.
echo   ==========================================================
echo     Starting the VTES table...
echo     Your browser will open automatically in a few seconds.
echo.
echo     LEAVE THIS WINDOW OPEN while you play.
echo     Close it, or press Ctrl+C, to stop the game.
echo   ==========================================================
echo.
call npm run play
echo.
echo   The server has stopped.
pause
exit /b 0

:no_node
echo.
echo   ----------------------------------------------------------
echo     Node.js is not installed (or Windows cannot find it).
echo.
echo     Install the "LTS" version from:  https://nodejs.org/
echo     Then close this window and double-click this file again.
echo   ----------------------------------------------------------
echo.
pause
exit /b 1

:install_failed
echo.
echo   ----------------------------------------------------------
echo     Installing dependencies failed. The error is above.
echo     You need a working internet connection for this step.
echo   ----------------------------------------------------------
echo.
pause
exit /b 1
