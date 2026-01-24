@echo off
REM Launch VS Code with MSVC and Qt environment

echo Setting up development environment...

REM Setup Visual Studio 2022
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"

REM Setup Qt (change path to your Qt installation)
set PATH=C:\Qt\5.15.2\msvc2019_64\bin;%PATH%

REM Launch VS Code
echo Starting Visual Studio Code...
code .
