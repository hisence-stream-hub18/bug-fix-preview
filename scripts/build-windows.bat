@echo off
REM Build Windows desktop app - double click or run from CMD
cd /d "%~dp0.."
set NITRO_PRESET=node-server
call npm install || goto :err
call npm run build || goto :err
if not exist ".output\server\index.mjs" if not exist "dist\server\index.mjs" goto :noserver
powershell -ExecutionPolicy Bypass -Command "if (-not (Test-Path 'resources\ffmpeg.exe')) { Write-Warning 'resources\ffmpeg.exe missing - screen sharing will be black. Use build-windows.ps1 to download it.' }"
call node .\scripts\package-electron.mjs --platform win32 --arch x64 || goto :err
echo.
echo DONE: electron-release\UniversalMediaServer-win32-x64\UniversalMediaServer.exe
pause
exit /b 0
:noserver
echo BUILD FAILED: server bundle not found in .output\server or dist\server
pause
exit /b 1
:err
echo BUILD FAILED
pause
exit /b 1
