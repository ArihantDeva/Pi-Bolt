@echo off
rem Pi-Bolt installer for Windows, in Command Prompt:
rem
rem   curl -fsSL https://pi-bolt.opensec.in/install.cmd -o install.cmd && install.cmd && del install.cmd
rem
rem It runs install.ps1 in Windows PowerShell, which downloads a release, verifies its checksum and signature and installs
rem it. Its environment variables (PIBOLT_VERSION, PIBOLT_VARIANT, ...) work here too.
powershell -c "irm https://pi-bolt.opensec.in/install.ps1 | iex"
exit /b %ERRORLEVEL%
