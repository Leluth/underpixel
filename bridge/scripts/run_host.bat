@echo off
setlocal enabledelayedexpansion

:: UnderPixel Bridge — Native Messaging host wrapper for Windows
:: Discovers Node.js and launches the bridge entry point

set "SCRIPT_DIR=%~dp0"
set "ENTRY=%SCRIPT_DIR%..\dist\index.js"

:: Priority 0: UNDERPIXEL_NODE_PATH environment variable
if defined UNDERPIXEL_NODE_PATH (
    if exist "%UNDERPIXEL_NODE_PATH%" (
        "%UNDERPIXEL_NODE_PATH%" "%ENTRY%"
        exit /b %ERRORLEVEL%
    )
)

:: Priority 1: node_path.txt (written during registration)
if exist "%SCRIPT_DIR%..\node_path.txt" (
    set /p NODE_PATH_SAVED=<"%SCRIPT_DIR%..\node_path.txt"
    if exist "!NODE_PATH_SAVED!" (
        "!NODE_PATH_SAVED!" "%ENTRY%"
        exit /b %ERRORLEVEL%
    )
)

:: Priority 2: node in PATH
where node >nul 2>&1
if %ERRORLEVEL% equ 0 (
    node "%ENTRY%"
    exit /b %ERRORLEVEL%
)

:: Priority 3: Common install locations
for %%P in (
    "%ProgramFiles%\nodejs\node.exe"
    "%ProgramFiles(x86)%\nodejs\node.exe"
    "C:\Softwares\nodejs\node.exe"
    "%LOCALAPPDATA%\fnm_multishells\*\node.exe"
) do (
    if exist "%%~P" (
        "%%~P" "%ENTRY%"
        exit /b %ERRORLEVEL%
    )
)

echo ERROR: Node.js not found. Install Node.js 20+ and try again. >&2
exit /b 1
