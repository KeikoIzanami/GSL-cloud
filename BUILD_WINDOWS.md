# Hướng dẫn Build GSLCloud trên Windows

## Yêu cầu

1. **Visual Studio 2022** (Community Edition miễn phí)
   - Download: https://visualstudio.microsoft.com/downloads/
   - Cài đặt workload: "Desktop development with C++"

2. **Qt 5.15.2 hoặc Qt 6.7+**
   - Download Qt Online Installer: https://www.qt.io/download-open-source
   - Chọn component: `MSVC 2019 64-bit` (cho Qt 5.15) hoặc `MSVC 2022 64-bit` (cho Qt 6.7)
   - Đảm bảo cài: Qt Quick Controls 2

3. **Git for Windows**
   - Download: https://git-scm.com/download/win

## Bước 1: Download Source Code

### Option A: Download từ GitHub
```cmd
git clone https://github.com/KeikoIzanami/GSL-cloud.git
cd GSL-cloud
```

### Option B: Download ZIP
1. Vào https://github.com/KeikoIzanami/GSL-cloud
2. Click `Code` → `Download ZIP`
3. Giải nén vào thư mục (ví dụ: `C:\Projects\GSL-cloud`)

## Bước 2: Mở Qt Command Prompt

1. Tìm trong Start Menu: **Qt 5.15.2 for Desktop (MSVC 2019 64-bit)**
2. Hoặc: **Qt 6.7.0 for Desktop (MSVC 2022 64-bit)**
3. Chạy as Administrator

## Bước 3: Build

```cmd
:: Di chuyển đến thư mục project
cd C:\Projects\GSL-cloud

:: Chạy qmake để tạo Makefile
qmake moonlight-qt.pro -spec win32-msvc CONFIG+=release

:: Build project
nmake release
```

## Bước 4: Kiểm tra File Build

File executable sẽ ở:
```
app\release\GSLCloud.exe
```

Hoặc:
```
app\Moonlight.exe
```

## Bước 5: Deploy (Tạo Package Standalone)

```cmd
:: Di chuyển vào thư mục release
cd app\release

:: Chạy windeployqt để copy tất cả DLL cần thiết
windeployqt GSLCloud.exe

:: Tạo folder phân phối
mkdir GSLCloud-Windows
xcopy GSLCloud.exe GSLCloud-Windows\
xcopy /E /I *.dll GSLCloud-Windows\

:: Zip file để phân phối
powershell Compress-Archive -Path GSLCloud-Windows -DestinationPath GSLCloud-Windows.zip
```

## Xử lý Lỗi Thường Gặp

### Lỗi: "qmake is not recognized"
**Giải pháp**: Phải mở Qt Command Prompt, không phải CMD thông thường

### Lỗi: "MSVC compiler not found"
**Giải pháp**: 
```cmd
:: Chạy vcvarsall.bat trước khi build
"C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
```

### Lỗi: "Cannot find -lSDL2"
**Giải pháp**: Đảm bảo các libraries trong `libs\windows\` tồn tại

### Lỗi: Build thành công nhưng exe không chạy
**Giải pháp**: Chạy `windeployqt` để copy DLL dependencies

## Build bằng Qt Creator (Dễ hơn)

1. Mở Qt Creator
2. File → Open File or Project → chọn `moonlight-qt.pro`
3. Configure Project với Kit: **Desktop Qt 5.15.2 MSVC2019 64bit**
4. Click nút **Build** (Ctrl+B)
5. Click nút **Run** (Ctrl+R)

## Tạo Installer (Optional)

Nếu muốn tạo installer .exe:

1. Download WiX Toolset: https://wixtoolset.org/
2. Mở file `wix\Moonlight.sln` trong Visual Studio
3. Build solution

## File Output

Sau khi build thành công:
- **Executable**: `app\release\GSLCloud.exe` (hoặc `Moonlight.exe`)
- **Size**: ~5-10MB (chưa bao gồm Qt DLLs)
- **Yêu cầu**: Windows 10/11 64-bit

## Notes

- Build time: ~5-10 phút (lần đầu)
- Rebuild: ~1-2 phút
- Final package size: ~100-150MB (bao gồm Qt runtime)
- Ngôn ngữ mặc định: **Tiếng Việt** (đã được set trong source code)

## Hỗ trợ

Nếu gặp vấn đề:
1. Check file `config.log` để xem lỗi chi tiết
2. Đảm bảo đã cài đủ Visual Studio C++ components
3. Thử clean build: `nmake clean` rồi build lại
