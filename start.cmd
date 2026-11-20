@echo off
cd /d "%~dp0"
if not exist "node_modules" (
  call npm install
  if errorlevel 1 goto error
)
if not exist "dist\index.html" (
  call npm run build
  if errorlevel 1 goto error
)
echo TeXloom: http://127.0.0.1:3001
call npm run start
exit /b %errorlevel%
:error
echo TeXloom startup failed.
exit /b 1
