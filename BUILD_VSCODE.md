# Build GSLCloud với Visual Studio Code

## Cài đặt Extensions

1. **C/C++** (Microsoft)
2. **Qt tools** (tonybaloney.vscode-qt-tools)
3. **CMake** (optional, nếu dùng CMake)

## Setup môi trường

### 1. Tạo file `.vscode/tasks.json`

```json
{
    "version": "2.0.0",
    "tasks": [
        {
            "label": "qmake",
            "type": "shell",
            "command": "qmake",
            "args": [
                "moonlight-qt.pro",
                "-spec",
                "win32-msvc",
                "CONFIG+=release"
            ],
            "problemMatcher": [],
            "group": {
                "kind": "build",
                "isDefault": false
            }
        },
        {
            "label": "nmake",
            "type": "shell",
            "command": "nmake",
            "args": ["release"],
            "problemMatcher": "$msCompile",
            "group": {
                "kind": "build",
                "isDefault": true
            },
            "dependsOn": ["qmake"]
        },
        {
            "label": "clean",
            "type": "shell",
            "command": "nmake",
            "args": ["distclean"],
            "problemMatcher": []
        },
        {
            "label": "build",
            "dependsOn": ["nmake"],
            "group": {
                "kind": "build",
                "isDefault": true
            }
        }
    ]
}
```

### 2. Tạo file `.vscode/launch.json`

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Launch GSLCloud",
            "type": "cppvsdbg",
            "request": "launch",
            "program": "${workspaceFolder}/app/release/GSLCloud.exe",
            "args": [],
            "stopAtEntry": false,
            "cwd": "${workspaceFolder}/app/release",
            "environment": [],
            "console": "externalTerminal"
        }
    ]
}
```

### 3. Tạo file `.vscode/settings.json`

```json
{
    "qt.qmake": "C:\\Qt\\5.15.2\\msvc2019_64\\bin\\qmake.exe",
    "qt.qtPath": "C:\\Qt\\5.15.2\\msvc2019_64",
    "files.associations": {
        "*.qml": "qml",
        "*.pro": "shellscript"
    },
    "C_Cpp.default.configurationProvider": "ms-vscode.cmake-tools",
    "terminal.integrated.env.windows": {
        "PATH": "C:\\Qt\\5.15.2\\msvc2019_64\\bin;${env:PATH}"
    }
}
```

## Cách build

### Option 1: Build bằng VS Code Tasks

1. Mở Command Palette: `Ctrl+Shift+P`
2. Gõ: `Tasks: Run Build Task`
3. Chọn: `build`

Hoặc shortcut: `Ctrl+Shift+B`

### Option 2: Build bằng Terminal trong VS Code

1. Mở Terminal: `` Ctrl+` ``
2. Chạy Developer Command Prompt:
   ```cmd
   cmd /k "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
   ```
3. Build:
   ```cmd
   qmake moonlight-qt.pro -spec win32-msvc CONFIG+=release
   nmake
   ```

### Option 3: Build script

Chạy file `build-windows.bat` đã tạo:
```cmd
.\build-windows.bat
```

## Debug trong VS Code

1. Set breakpoint trong file `.cpp`
2. Press `F5` hoặc click "Run and Debug"
3. Chọn configuration: `Launch GSLCloud`

## Lưu ý

- Phải mở VS Code từ **Developer Command Prompt** để có MSVC environment
- Hoặc dùng extension **"ms-vscode.cpptools"** và configure compiler path
- Qt path trong `settings.json` phải đúng với máy bạn

## Mở VS Code với MSVC environment

Tạo shortcut hoặc script `vscode-dev.bat`:
```cmd
@echo off
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
set PATH=C:\Qt\5.15.2\msvc2019_64\bin;%PATH%
code .
```

Chạy script này để mở VS Code với đầy đủ environment.
