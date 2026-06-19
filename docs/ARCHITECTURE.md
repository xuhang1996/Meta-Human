# 架构说明

本文档面向接手开发者，说明系统的整体设计、数据流和关键模块。

## 一句话定位

**低成本、本地优先的数字人口播视频生成工具**：用户上传一张真人头像 + 输入文案，系统在本地（无需第三方付费 API）生成带口型同步、字幕、波形的讲解视频。

## 系统全景

```
┌─────────────────────────────────────────────────────────────┐
│  浏览器（React 客户端）                                       │
│  studio-client.tsx                                           │
│  - 表单：文案 / 头像 / 主题 / 动效 / 渲染引擎 / 音色           │
│  - 轮询 /api/jobs 展示任务进度                                │
└──────────────────────────┬──────────────────────────────────┘
                           │ POST /api/jobs (FormData)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Next.js 服务端（Node 运行时）                                │
│                                                              │
│  api/jobs/route.ts        创建任务，保存头像，入队            │
│  api/jobs/[jobId]/route.ts 查询单个任务                      │
│  api/voices/route.ts      列出 Edge-TTS 可用音色             │
│                                                              │
│  lib/store.ts             任务持久化（.data/jobs.json）       │
│  lib/job-runner.ts        ★ 异步任务调度核心                  │
│  lib/render-process.ts    子进程封装（spawn）                 │
└──────────────────────────┬──────────────────────────────────┘
                           │ 调用外部命令
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  本地命令行工具                                              │
│                                                              │
│  Edge-TTS (Python)  TTS 语音合成（微软在线语音，免费）       │
│  ffmpeg / ffprobe   音频转码、视频合成、字幕烧录              │
│  SadTalker (Python) 高质量口型驱动（3DMM，CUDA GPU 推理）    │
│  MuseTalk  (Python) 实时口型驱动（照片/视频，CUDA GPU 推理） │
└─────────────────────────────────────────────────────────────┘
```

## 核心数据流：一次渲染任务的完整生命周期

```
用户提交
  │
  ├─ POST /api/jobs
  │    ├─ 生成 jobId (UUID)
  │    ├─ 头像保存到 public/renders/<jobId>/avatar.<ext>
  │    ├─ 任务写入 .data/jobs.json (status=queued)
  │    └─ enqueueJob(jobId)  ← 进程内异步，不阻塞响应
  │
  └─ job-runner.processJob(jobId)
       │
       1. status=processing · 「正在生成语音」
          └─ ffmpeg.ts:synthesizeSpeech (Edge-TTS，带指数退避重试)
               ├─ python -m edge_tts --voice <voice> --text ... --write-media speech.mp3
               └─ ffmpeg speech.mp3 → speech.m4a （转 AAC）

       2. status=processing · 「生成字幕时间轴」
          └─ ffmpeg.ts:buildSubtitles
               ├─ 按标点拆句
               ├─ 按字数比例分配每句时长
               └─ 写出 captions.srt

       3. status=processing · 「渲染」（按引擎分支）
          │
          ├─ renderEngine=musetalk → renderMuseTalkPresenterVideo
          │    ├─ ffprobe 探测头像长边；> MUSETALK_MAX_DIMENSION(默认1280)
          │    │   时先用 ffmpeg 等比缩放长边到 1280（竖图提速关键，见下）
          │    ├─ ffmpeg: speech.m4a → speech.wav (16kHz mono)
          │    ├─ 写 musetalk_task.yaml (video_path + audio_path)
          │    ├─ python -m scripts.inference (MuseTalk v1.5)
          │    │    输入: 头像/视频底片 + wav
          │    │    输出: musetalk-out/v15/*.mp4 (口型视频)
          │    ├─ finally: 删除缩放临时文件 avatar_musetalk.*
          │    └─ renderTalkingHeadPresenterVideo
          │
          ├─ renderEngine=model → renderModelPortraitPresenterVideo
          │    ├─ ffmpeg: speech.m4a → speech.wav (16kHz mono)
          │    ├─ python inference.py (SadTalker, CUDA)
          │    │    输入: 头像 + wav
          │    │    输出: sadtalker-out/<ts>.mp4 (256x256 口型视频)
          │    └─ renderTalkingHeadPresenterVideo
          │         用 ffmpeg 把口型视频嵌入 presenter 模板
          │
          ├─ avatarMode=sample → renderAnimatedSamplePresenterVideo
          │    内置 SVG 数字人 + 几何动效（嘴型/眨眼/漂移）
          │
          └─ 默认(上传头像+fast) → renderAnimatedPortraitPresenterVideo
               上传照片 + 本地几何动效（兜底，效果一般）

       4. status=completed · videoUrl = /renders/<jobId>/final.mp4
```

## 关键模块详解

### `lib/job-runner.ts` — 任务调度核心

进程内的轻量任务队列。`enqueueJob` 把 jobId 加入 `activeJobs` Set 防止重复执行，`processJob` 串行跑完四个阶段（语音→字幕→渲染→完成）。

**分支优先级**（重要，曾因此踩坑）：
```
if renderEngine === "musetalk"  → MuseTalk（强制要求上传照片/视频，见下）
else if renderEngine === "model" → SadTalker（高质量）
else if avatarMode === "sample" → 内置数字人动效
else                            → 上传头像几何动效
```
- MuseTalk 依赖真人脸检测（MediaPipe/DWPose），内置数字人是 SVG 几何角色检测不到脸，因此后端 (`api/jobs/route.ts`) 与前端 (`studio-client.tsx`) 都强制要求该引擎上传照片或视频，否则报错拦截。
- 一旦选了「高质量模型」，无论内置还是上传头像都走 SadTalker。

### `lib/ffmpeg.ts` — 渲染管线

这是最核心也最长的文件（约 720 行），包含：

| 函数 | 作用 |
|---|---|
| `synthesizeSpeech` | Edge-TTS → mp3 → m4a（带指数退避重试，应对网络抖动） |
| `buildSubtitles` | 文案按句拆分 + 时长分配 |
| `probeVideoDimension` | ffprobe 探测头像/视频长边，用于 MuseTalk 缩放判断 |
| `renderPresenterVideo` | 静态头像 presenter（最初版本） |
| `renderAnimatedSamplePresenterVideo` | 内置 SVG 数字人 + 几何动效 |
| `renderAnimatedPortraitPresenterVideo` | 上传照片 + 几何动效（兜底） |
| `renderModelPortraitPresenterVideo` | **★ SadTalker 高质量引擎（CUDA）** |
| `renderMuseTalkPresenterVideo` | **★ MuseTalk 实时口型引擎（CUDA）** |
| `renderTalkingHeadPresenterVideo` | 把口型视频嵌入 presenter 模板 |

所有 presenter 模板共享同一套 ffmpeg filter：背景色 → 面板 → 头像 → 波形 → 标题 → 字幕。

> **MuseTalk 预缩放**：`renderMuseTalkPresenterVideo` 在送入推理前，用 `probeVideoDimension` 取长边，超过 `MUSETALK_MAX_DIMENSION`（默认 1280）时用 `ffmpeg ... scale=...:force_original_aspect_ratio=decrease` 等比缩到长边 1280（MuseTalk 实际只处理 256 脸部区域，不影响口型质量，但大幅降低显存/耗时）。缩放是临时文件，推理结束在 `finally` 里删除。

### `lib/avatar-motion.ts` — 几何动效引擎（极速预览）

用 `@resvg/resvg-js` 把 SVG 头像逐帧渲染成 PNG，根据音频波形驱动嘴型开合、眨眼、头部漂移。这是**低成本兜底方案**，效果上限有限（口型不按音素同步），所以真实人脸推荐用 SadTalker。

### `lib/store.ts` — 任务持久化

用 `.data/jobs.json` 单文件 + 串行写链（`writeChain`）保证并发安全。任务上限无限制，但 logs 只保留最近 18 条。**不适合生产**（单机、无索引），生产应换 SQLite/Postgres。

## 渲染引擎对比

| | 极速预览 (fast) | 高质量模型 (model) | 实时口型 (musetalk) |
|---|---|---|---|
| 实现 | SVG 几何动效 | SadTalker 3DMM | MuseTalk v1.5 |
| 口型 | 按音频幅度开合（非音素） | 按音素精确同步 | 按音素精确同步 |
| 输入 | 内置数字人 / 照片 | 照片 | **照片或视频**（视频可重配音） |
| 速度 | 秒级 | ~30 秒/3 秒（CUDA） | ~20-40 秒/6 秒（CUDA） |
| 依赖 | 无（纯 Node） | Python + ~4.4GB 模型 | Python + ~3.2GB 模型 |
| 适用 | 流程验证、内置数字人 | 真实人脸正式出片 | **真实人脸、视频重配音** |

> 三个引擎都需要 Edge-TTS 合成语音（极速预览也用）。CUDA GPU 下 SadTalker/MuseTalk 都是秒级出片；纯 CPU 会慢几十倍。

## 文件结构

```
.
├── src/
│   ├── app/
│   │   ├── api/jobs/          REST 接口
│   │   ├── page.tsx           首页（hero + 工作台）
│   │   └── layout.tsx
│   ├── components/
│   │   └── studio-client.tsx  ★ 唯一的客户端组件（表单+任务监控）
│   └── lib/
│       ├── ffmpeg.ts          ★ 渲染管线
│       ├── job-runner.ts      ★ 任务调度
│       ├── avatar-motion.ts   几何动效
│       ├── portrait-features.ts 人脸特征检测
│       ├── store.ts           持久化
│       ├── render-process.ts  spawn 封装
│       ├── constants.ts       主题/动效/引擎配置
│       ├── types.ts           类型定义
│       └── utils.ts
├── scripts/
│   ├── detect-face.py         MediaPipe 人脸检测（跨平台，几何动效用）
│   ├── detect-face.swift      旧版 macOS Vision 人脸检测（已弃用，保留参考）
│   └── setup-sadtalker.sh     SadTalker 一键搭建（macOS）
├── public/avatars/            内置数字人素材
├── docs/
│   ├── ARCHITECTURE.md        本文档
│   └── SETUP.md               SadTalker / MuseTalk 环境搭建
└── .env.example               环境变量模板（含全部引擎配置）
```

## 已知限制与后续方向

- **GPU 依赖**：SadTalker / MuseTalk 在 CUDA GPU 上才实用（秒级）。纯 CPU 会慢几十倍，不建议。
- **Edge-TTS 网络**：语音合成走微软在线接口（`speech.platform.bing.com`），国内网络偶发 TLS 重置；已加指数退避重试，但仍可能需要代理。
- **进程内队列**：重启会丢失正在运行的任务。应迁移到 Redis + worker。
- **平台**：当前在 Windows + NVIDIA GPU 验证；极速预览的人脸检测用了跨平台方案（MediaPipe），SadTalker/MuseTalk 走 Python 子进程，本身跨平台。
- **单文件存储**：`.data/jobs.json` 不适合高并发，应换数据库。
- **TTS 升级**：Edge-TTS 音质尚可但依赖网络，可换本地 CosyVoice / GPT-SoVITS。
