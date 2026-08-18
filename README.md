# video-plan

Tauri v2 + React 19 视频/音频学习计划管理器（Windows 桌面 + Android，含 TV）。

## 开发 / 构建

```shell
# 开发
bun tauri dev
bun tauri android dev

# 构建
bun run build:win          # 或 bun tauri build
bun run build:portable     # Windows 免安装绿色版
bun tauri android build --apk
bun tauri android build --debug
```

## 版本号管理

一条命令同步更新 4 处版本（package.json / tauri.conf.json / src/version.ts / Android tauri.properties，
并自动递增 Android versionCode）。版本号显示在设置页底部。

```shell
bun run bump              # patch +1（默认，0.3.1 -> 0.3.2）
bun run bump patch        # 0.3.1 -> 0.3.2
bun run bump minor        # 0.3.1 -> 0.4.0
bun run bump major        # 0.3.1 -> 1.0.0
bun run bump 1.2.3        # 指定版本
```

## 视频兼容性与批量转码

应用内的播放器用系统 WebView（Chromium / WebView2 / Android WebView），
它只能解码 **H.264 / VP8 / VP9 / AV1** 视频。若视频用的是 **mpeg4（DivX/Xvid）、
旧编码、或部分平台上的 H.265/HEVC**，播放时会**只有声音、没有画面**
（桌面播放器自带解码器，所以能正常放，这会造成误判）。

### 批量检测 / 转码脚本

需要先安装 [ffmpeg](https://ffmpeg.org/download.html)（`ffmpeg` 和 `ffprobe` 在 PATH 中）。

```shell
# 只检测，列出需要转码的文件，不改动
bun run transcode "D:\path\to\folder" --check

# 检测并批量转成 H.264（递归子目录；原文件保留为 .bak）
bun run transcode "D:\path\to\folder"

# 同上，但直接覆盖原文件（不留 .bak）
bun run transcode "D:\path\to\folder" --replace
```

```shell
# 只检测，列出需要转码的文件，不改动
bun run audio "D:\path\to\folder" --check

bun run audio "D:\path\to\folder"

bun run audio "D:\path\to\folder" --out "D:\out"
```

脚本只会转码 WebView 无法显示的视频（H.264 等兼容文件跳过），
音频重编码为 AAC，输出带 `+faststart` 便于边下边播。
转码完成后，在 app 里对相应计划点「重新扫描」即可。

### 批量压缩视频（降分辨率）

有些源视频分辨率很高（1080p/4K）、文件很大，可以批量压缩成 720p（或其他分辨率）来省空间。

```shell
# 只检测，列出分辨率超过 720p 需要压缩的文件，不改动
bun run compress "D:\path\to\folder" --check

# 压缩成 720p（递归子目录；原文件保留为 .bak）
bun run compress "D:\path\to\folder"

# 压缩成 480p
bun run compress "D:\path\to\folder" --height 480

# 调整画质/速度（crf 越大文件越小画质越差，默认 26；preset 越慢压缩率越高，默认 fast）
bun run compress "D:\path\to\folder" --crf 28 --preset medium

# 输出到另一个目录，不改动原文件
bun run compress "D:\path\to\folder" --out "D:\out"

# 直接覆盖原文件（不留 .bak）
bun run compress "D:\path\to\folder" --replace
```

只会压缩分辨率超过目标值的视频（横屏按高、竖屏按宽判断），不会放大小视频；
统一重新编码为 H.264 + AAC 的 `.mp4`，保持与 WebView 播放器的兼容性。

## IDE

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
