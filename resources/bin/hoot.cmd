@echo off
rem hoot, Hoot's command line program, for cmd and PowerShell on Windows (Git
rem Bash runs the hoot script beside it). Hoot puts this folder first on the
rem PATH of every session it starts, and names in the session's environment
rem its own executable, which runs hoot's script as Node.js, and the script.
setlocal
if not defined HOOT_NODE goto outside
if not defined HOOT_CLI goto outside
rem Options for the user's own Node.js are not hoot's.
set NODE_OPTIONS=
set ELECTRON_RUN_AS_NODE=1
"%HOOT_NODE%" "%HOOT_CLI%" %*
exit /b %ERRORLEVEL%
:outside
echo error: hoot works only in the sessions that Hoot starts: HOOT_NODE and HOOT_CLI are not set. 1>&2
exit /b 1
