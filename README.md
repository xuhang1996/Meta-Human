# Meta-Human · 数字人视频工作台

低成本、本地优先的数字人口播视频生成工具。上传一张真人头像 + 输入文案，即可在本地生成带**口型同步、字幕、波形**的讲解视频，无需第三方付费 API。

![engine](https://img.shields.io/badge/render-SadTalker-blue) ![tts](https://img.shields.io/badge/tts-macOS%20say-green) ![platform](https://img.shields.io/badge/platform-macOS%20Apple%20Silicon-silver)

## ✨ 特性

- **真实口型驱动**：集成 SadTalker，按音素精确同步口型，含头动、眨眼、表情（非简单的嘴部开合）
- **完全本地**：语音用 macOS `say`，视频用 `ffmpeg`，口型用本地 SadTalker，不调用任何付费云 API
- **双引擎**：「极速预览」（秒级，SVG 几何动效）+「高质量模型」（SadTalker，正式出片）
- **异步任务**：提交后后台渲染，前端实时显示进度，不阻塞界面
- **中文优先**：界面、字幕、语音全中文

## 🎬 效果

生成视频规格：1280×720，H.264 + AAC，含背景主题、头像区、音频波形、标题、SRT 字幕烧录。

> 在 Apple M1 Pro 上，一条 3 秒视频约需 13 分钟（CPU 推理）。详见[性能说明](#性能说明)。

## 🚀 快速开始

### 前置条件

- macOS（已在 Apple Silicon 验证）
- Node.js 18+ 和 [pnpm](https://pnpm.io)
- ffmpeg：`brew install ffmpeg`

### 安装与运行

```bash
git clone https://github.com/xuhang1996/Meta-Human.git
cd Meta-Human
pnpm install
pnpm dev
```

打开 http://localhost:3000 即可使用。

> 默认只有「极速预览」引擎可用（无需 Python）。要用真实人脸高质量口型，需额外配置 SadTalker，见下文。

### 使用「极速预览」（开箱即用）

1. 选择内置数字人（极光 / 溪流），或上传一张照片
2. 输入文案（≥12 字）
3. 选择画面主题、动效模式
4. 点击「生成视频」

极速预览用 SVG 几何动效驱动嘴型，**秒级出片**，但口型不按音素同步，仅适合流程验证。

### 启用「高质量模型」（SadTalker，真实口型）

这是本仓库的核心能力，但需要额外搭建 Python 环境（约 6GB）。**接手者请先阅读 [docs/SETUP.md](docs/SETUP.md)**。

一键搭建：

```bash
bash scripts/setup-sadtalker.sh
```

脚本结束后按提示把输出的变量写入 `.env.local`（参考 `.env.example`），重启 `pnpm dev`，即可在前端选择「高质量模型」上传真实人脸照片生成口型视频。

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
| TTS | macOS `say` |
| 视频合成 | ffmpeg |
| 口型驱动 | [SadTalker](https://github.com/OpenTalker/SadTalker)（3DMM） |
| 任务队列 | 进程内异步（生产应换 Redis） |
| 存储 | JSON 文件（生产应换 SQLite/Postgres） |

## ⚙️ 配置

环境变量见 [`.env.example`](.env.example)。复制为 `.env.local` 后按需修改：

```bash
SADTALKER_DIR=/path/to/SadTalker          # SadTalker 仓库目录
SADTALKER_PYTHON=/path/to/venv/bin/python # SadTalker 专用 Python
SADTALKER_ENHANCER=                        # 留空=关闭GFPGAN（CPU推荐），gfpgan=开启
SADTALKER_PREPROCESS=full                  # crop|extcrop|resize|full|extfull
```

## 性能说明

SadTalker 在 **Apple Silicon CPU** 上较慢（无 CUDA）：

| 配置 | 3 秒视频耗时 |
|---|---|
| 无增强器（CPU 推荐） | ~13 分钟 |
| GFPGAN 增强（CPU） | ~40 分钟 |
| CUDA GPU（参考） | ~30 秒 |

因此 `.env.example` 默认关闭 GFPGAN —— 基础渲染已包含完整口型同步，GFPGAN 仅提升面部细节。有 GPU 时再开。任务异步执行，UI 始终响应。

## 🔧 开发

```bash
pnpm dev      # 开发服务器
pnpm build    # 生产构建
pnpm lint     # 代码检查
```

## 🗺️ 后续方向

- 迁移到 Redis + worker 进程队列，避免重启丢任务
- 替换 macOS `say` 为 CosyVoice / GPT-SoVITS，提升音质
- 接入 MuseTalk 实现更高实时性
- 跨平台支持（替换 Swift Vision 人脸检测）
- 生产级存储（SQLite/Postgres）

## 📄 许可

本项目代码仅供学习研究。SadTalker 模型权重遵循其各自许可，商用前请确认。
