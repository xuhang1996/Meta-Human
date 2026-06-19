# Meta-Human · 数字人视频工作台

低成本、本地优先的数字人口播视频生成工具。上传一张真人头像 + 输入文案，即可在本地生成带**口型同步、字幕、波形**的讲解视频，无需第三方付费 API。

![engine](https://img.shields.io/badge/render-SadTalker%20%2F%20MuseTalk-blue) ![tts](https://img.shields.io/badge/tts-Edge--TTS-green) ![platform](https://img.shields.io/badge/platform-Windows%20%2B%20CUDA-silver)

## ✨ 特性

- **真实口型驱动**：集成 SadTalker 与 MuseTalk，按音素精确同步口型，含头动、眨眼、表情（非简单的嘴部开合）
- **完全本地**：语音用 Edge-TTS，视频用 `ffmpeg`，口型用本地 SadTalker / MuseTalk，不调用任何付费云 API
- **三引擎**：「极速预览」（秒级，SVG 几何动效）+「高质量模型」（SadTalker，照片出片）+「实时口型」（MuseTalk，支持照片**和视频**重配音）
- **异步任务**：提交后后台渲染，前端实时显示进度，不阻塞界面
- **中文优先**：界面、字幕、语音全中文

## 🎬 效果

生成视频规格：1280×720，H.264 + AAC，含背景主题、头像区、音频波形、标题、SRT 字幕烧录。

> 在 NVIDIA GPU（CUDA）上，一条 6 秒视频用 MuseTalk 约 20-40 秒、用 SadTalker 约 30 秒。详见[性能说明](#性能说明)。

## 🚀 快速开始

### 前置条件

- Windows（已在 Win 11 + NVIDIA GPU/CUDA 验证；macOS 亦可，见 [docs/SETUP.md](docs/SETUP.md)）
- Node.js 18+ 和 [pnpm](https://pnpm.io)
- ffmpeg / ffprobe（Windows 推荐 [Gyan.FFmpeg](https://www.gyan.dev/ffmpeg/builds/) 的 full build）

### 安装与运行

```bash
git clone https://github.com/xuhang1996/Meta-Human.git
cd Meta-Human
pnpm install
pnpm dev
```

打开 http://localhost:3000 即可使用。

> 默认只有「极速预览」引擎可用（无需 Python）。要用真实人脸口型，需额外配置 SadTalker 或 MuseTalk，见下文。

### 使用「极速预览」（开箱即用）

1. 选择内置数字人（极光 / 溪流），或上传一张照片
2. 输入文案（≥12 字）
3. 选择画面主题、动效模式
4. 点击「生成视频」

极速预览用 SVG 几何动效驱动嘴型，**秒级出片**，但口型不按音素同步，仅适合流程验证。

### 启用口型引擎（SadTalker / MuseTalk，真实口型）

真实人脸口型需要额外搭建 Python 环境（每个引擎约 5-6GB）。**接手者请先阅读 [docs/SETUP.md](docs/SETUP.md)**，内有 SadTalker 与 MuseTalk 的完整搭建步骤（含 Windows + GPU 路径）。

搭建完成后把对应变量写入 `.env.local`（参考 `.env.example`，已列出全部引擎配置），重启 `pnpm dev`，即可在前端选择「高质量模型」（SadTalker，照片出片）或「实时口型」（MuseTalk，支持照片和视频重配音）上传真实人脸素材生成口型视频。

## 📖 文档

| 文档 | 内容 |
|---|---|
| **[docs/SETUP.md](docs/SETUP.md)** | SadTalker 环境搭建（手动 + 一键脚本 + 常见问题） |
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | 系统架构、数据流、模块说明、文件结构 |

## 🏗️ 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Next.js 16, React 19, TypeScript |
| 后端 | Next.js API Routes (Node 运行时) |
| TTS | Edge-TTS（微软在线语音，免费） |
| 视频合成 | ffmpeg |
| 口型驱动 | [SadTalker](https://github.com/OpenTalker/SadTalker)（3DMM）/ [MuseTalk](https://github.com/TMElyralab/MuseTalk)（v1.5，支持视频底片） |
| 任务队列 | 进程内异步（生产应换 Redis） |
| 存储 | JSON 文件（生产应换 SQLite/Postgres） |

## ⚙️ 配置

环境变量见 [`.env.example`](.env.example)（已列出全部引擎配置）。复制为 `.env.local` 后按需修改，关键项示例：

```bash
EDGE_TTS_PYTHON=/path/to/venv/python.exe   # Edge-TTS / 人脸检测共用 Python（必需）
FFMPEG_BIN=/path/to/ffmpeg/bin             # ffmpeg/ffprobe 目录

SADTALKER_DIR=/path/to/SadTalker           # 高质量模型引擎
SADTALKER_PYTHON=/path/to/venv/python.exe
SADTALKER_DEVICE=gpu                       # gpu 用 CUDA，cpu 则纯 CPU
SADTALKER_ENHANCER=gfpgan                  # 留空=关闭面部增强，GPU 下建议开

MUSETALK_DIR=/path/to/MuseTalk            # 实时口型引擎
MUSETALK_PYTHON=/path/to/venv/python.exe
MUSETALK_FFMPEG_PATH=/path/to/ffmpeg/bin/  # 末尾必须带斜杠
# MUSETALK_MAX_DIMENSION=1280              # 推理前长边缩放上限（默认 1280）
```

## 性能说明

SadTalker / MuseTalk 在 **CUDA GPU** 上是秒级出片；纯 CPU 会慢几十倍，不建议：

| 引擎 | 配置 | 6 秒视频耗时 |
|---|---|---|
| MuseTalk | GPU | ~20-40 秒 |
| SadTalker | GPU（无增强器） | ~30 秒 |
| SadTalker | GPU + GFPGAN 增强 | ~35 秒 |

`.env.example` 对 MuseTalk 默认把长边 > 1280 的底片预缩到 1280（不影响口型质量，因 MuseTalk 实际只处理 256 脸部区域），大幅降低显存/耗时；该临时文件推理后自动清理。任务异步执行，UI 始终响应。

## 🔧 开发

```bash
pnpm dev      # 开发服务器
pnpm build    # 生产构建
pnpm lint     # 代码检查
```

## 🗺️ 后续方向

- 迁移到 Redis + worker 进程队列，避免重启丢任务
- 替换 Edge-TTS 为 CosyVoice / GPT-SoVITS，提升音质
- 跨平台支持（替换 Swift Vision 人脸检测）
- 生产级存储（SQLite/Postgres）

## 📄 许可

本项目代码仅供学习研究。SadTalker 模型权重遵循其各自许可，商用前请确认。
