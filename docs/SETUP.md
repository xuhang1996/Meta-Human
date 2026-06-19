# 口型引擎环境搭建指南（SadTalker / MuseTalk）

本仓库有两个本地口型引擎，都需要 Python + 模型权重：

- **「高质量模型」(SadTalker)** — 3DMM，照片 → 口型视频。下文「一、SadTalker」。
- **「实时口型」(MuseTalk)** — 支持照片**和视频**底片（可给视频重配音）。下文「二、MuseTalk」。

> 如果你只想验证前端流程，可以跳过两者，使用「极速预览」引擎（无需 Python）。但真实人脸视频必须用 SadTalker 或 MuseTalk。

> **平台说明**：项目最初在 macOS（Apple Silicon）开发，**现已迁移到 Windows + NVIDIA GPU + Edge-TTS**。下文「一、SadTalker」保留原始 macOS 步骤（已验证可用，作为参考）；Windows 下推荐直接按「二、MuseTalk」搭建 MuseTalk 引擎（步骤已按 Windows 实测）。两个引擎都需要 CUDA GPU 才实用。

---

## 二、MuseTalk 实时口型引擎（Windows + GPU）

「实时口型」引擎依赖本地 MuseTalk。相比 SadTalker，它额外支持**视频底片**（给已有视频重新配音并对口型），且在 GPU 上出片更快。以下步骤已在 Windows + NVIDIA GPU 实测通过。

### 前置条件

| 项目 | 要求 |
|---|---|
| 操作系统 | Windows（已在 Win 11 + NVIDIA GPU 验证） |
| Python | 3.10（与 SadTalker venv 可共用一个，也可独立） |
| ffmpeg | 已安装（Gyan.FFmpeg 的 full build 即可，需含 ffprobe） |
| GPU | NVIDIA CUDA（CPU 理论可行但慢几十倍，不建议） |
| 磁盘 | 约 6GB（venv + MuseTalk 模型，其中 `unet.pth` 3.2GB） |
| 网络 | 能访问 HuggingFace（国内用 `hf-mirror.com` 镜像，见下） |

### 1. 克隆 MuseTalk

```bash
git clone https://github.com/TMElyralab/MuseTalk.git D:/ai-code/MuseTalk
# 国内 git clone 超时的话，用 tarball：
# curl -L -o /tmp/musetalk.tar.gz "https://codeload.github.com/TMElyralab/MuseTalk/tar.gz/refs/heads/main"
# tar -xzf /tmp/musetalk.tar.gz -C D:/ai-code/MuseTalk --strip-components=1
```

### 2. 创建 Python 3.10 venv 并装依赖

```bash
# 复用 SadTalker 的 venv（已装 torch/opencv 等）即可，或单独建一个：
D:/path/to/python3.10.exe -m venv D:/ai-code/musetalk-venv
D:/ai-code/musetalk-venv/Scripts/python.exe -m pip install --upgrade pip
D:/ai-code/musetalk-venv/Scripts/python.exe -m pip install -r D:/ai-code/MuseTalk/requirements.txt
```

> MuseTalk 的 `requirements.txt` 含 `tensorflow`、`diffusers`、`transformers` 等。若与 SadTalker venv 冲突，建议独立 venv。

### 3. 下载模型权重（约 5GB）

仓库自带 `download_weights.bat`，**已配置国内 HuggingFace 镜像**（`HF_ENDPOINT=https://hf-mirror.com`），直接在 MuseTalk 目录双击或在 cmd 运行：

```bat
cd /d D:\ai-code\MuseTalk
download_weights.bat
```

脚本会下载到 `models/` 下各子目录。应用实际使用的 v1.5 权重是：

- `models/musetalkV15/unet.pth`（3.2GB，**最关键**）
- `models/musetalkV15/musetalk.json`
- `models/whisper/`（whisper-tiny）

其余（dwpose / face-parse-bisent / sd-vae / syncnet）由 MuseTalk 内部依赖，脚本会一并下载。

### 4. 配置 `.env.local`

在 Meta-Human 根目录的 `.env.local` 中加入（路径按实际填写，参考 `.env.example`）：

```bash
MUSETALK_DIR=D:/ai-code/MuseTalk
MUSETALK_PYTHON=D:/ai-code/musetalk-venv/Scripts/python.exe
# MuseTalk 用 os.system 调 ffmpeg 抽帧，必须显式给 bin 目录（末尾带斜杠），
# 否则在 PATH 未刷新的会话里抽帧会 division by zero 失败。
MUSETALK_FFMPEG_PATH=C:/path/to/ffmpeg-8.1.1-full_build/bin/
MUSETALK_GPU_ID=0
# 可选：送入推理前长边缩放上限（默认 1280）
# MUSETALK_MAX_DIMENSION=1280
```

### 5. 验证安装

启动 `pnpm dev`，在前端选择「实时口型（MuseTalk）」引擎，上传一张**真人正脸照片**（竖图也可，会自动缩放），输入文案生成。成功的话任务会依次经过「语音生成 → 字幕 → 已使用实时口型渲染 → 视频渲染完成」，产物为 `public/renders/<jobId>/final.mp4`。

也可直接用 MuseTalk 自带脚本验证（不经由本应用）：

```bash
cd D:/ai-code/MuseTalk
# 编辑 configs/inference/test.yaml 填入 video_path（照片或视频）和 audio_path（wav）
bash inference.sh v1.5 normal
# 产物在 results/test/v15/*.mp4
```

### 常见问题

| 现象 | 原因 / 解决 |
|---|---|
| `division by zero` / 抽帧失败 | 没设 `MUSETALK_FFMPEG_PATH`，或路径末尾没带斜杠 |
| 任务报「MuseTalk 未生成可用的口型视频」 | 模型没下全，重点检查 `models/musetalkV15/unet.pth` 是否 3.2GB 且未损坏 |
| `CUDA out of memory` | 调小 `MUSETALK_MAX_DIMENSION`（如 768）；或换更小的底片 |
| 检测不到人脸 / 口型不动 | 底片不是清晰正脸；卡通图、侧脸、遮挡会失败。MuseTalk 需要真实人脸 |
| 下载模型超时 | 确认走的是 `hf-mirror.com` 镜像（`download_weights.bat` 已设）；或挂代理后手动 `hf download ...` |
| 竖图（手机自拍）渲染很慢 | 已自动缩放到长边 1280；若仍慢，调小 `MUSETALK_MAX_DIMENSION` |

### 性能参考（NVIDIA GPU）

| 输入 | 耗时 |
|---|---|
| 照片 + 6 秒文案 | ~20-40 秒 |
| 视频底片 + 配音 | 视视频时长而定，通常略慢于纯照片 |

> MuseTalk 在送入推理前会把长边超过 1280 的底片等比缩小（不影响口型质量，因 MuseTalk 实际只处理 256 脸部区域），缩放临时文件推理后自动删除。

---

## 一、SadTalker 高质量口型引擎（macOS 参考步骤）

> ⚠️ 以下为项目最初在 macOS（Apple Silicon）上的搭建记录，**保留作参考**。Windows + GPU 的 SadTalker 搭建与之类似但需用 CUDA 版 torch、Windows 路径与 `.bat`/`.ps1` 替代 shell 命令；已有可用的 `sadtalker-venv` 时直接配 `.env.local` 即可。

## 前置条件

| 项目 | 要求 |
|---|---|
| 操作系统 | macOS（已在 Apple Silicon M1 Pro 验证；Intel Mac 理论可用但更慢） |
| Python | 3.10（**必须 3.10**，3.11+ 的 numpy/numba 兼容性未验证） |
| ffmpeg | 已安装并在 PATH（`brew install ffmpeg`） |
| 磁盘 | 约 6GB（venv 1.5GB + SadTalker 模型 4.4GB） |
| 网络 | 能访问 GitHub 和 HuggingFace |

## 一键脚本

仓库提供 `scripts/setup-sadtalker.sh`，它会自动完成「克隆 SadTalker → 创建 venv → 装依赖 → 打补丁 → 下载模型」全流程：

```bash
# 在仓库根目录执行
bash scripts/setup-sadtalker.sh
```

脚本默认把 SadTalker 和 venv 装到 `~/SadTalker` 和 `~/sadtalker-venv`。
脚本结束后会打印需要写入 `.env.local` 的变量，按提示填写即可。

> ⚠️ 模型下载约 4.4GB，脚本会并行下载，但仍需 10-20 分钟（取决于网速）。

## 手动搭建（理解每一步）

如果你需要自定义路径，或在脚本失败后手动恢复，按以下步骤操作。

### 1. 克隆 SadTalker

```bash
# 用 tarball 比 git clone 更快更稳（git clone 在国内常超时）
curl -L -o /tmp/sadtalker.tar.gz \
  "https://codeload.github.com/OpenTalker/SadTalker/tar.gz/refs/heads/main"
mkdir -p ~/SadTalker
tar -xzf /tmp/sadtalker.tar.gz -C ~/SadTalker --strip-components=1
```

### 2. 创建 Python 3.10 venv

```bash
# 确认有 python3.10（homebrew: brew install python@3.10）
/opt/homebrew/bin/python3.10 -m venv ~/sadtalker-venv
~/sadtalker-venv/bin/pip install --upgrade pip
```

### 3. 安装依赖

依赖链有几个 Mac 专属坑，按顺序装：

```bash
VENV=~/sadtalker-venv/bin/pip

# 3.1 torch（带 MPS 支持）
$VENV install torch torchvision torchaudio
$VENV install "numpy<2"          # SadTalker 需要 numpy 1.x

# 3.2 视觉/音频基础库
$VENV install opencv-python==4.10.0.84 imageio==2.36.1 imageio-ffmpeg==0.5.1 \
  librosa==0.10.2.post1 numba==0.60.0 scipy==1.13.1 scikit-image==0.24.0 \
  "pydub>=0.25" "tqdm>=4.66" "resampy" "kornia==0.7.2" \
  "transformers==4.37.2" "ffmpy==0.3.2" "yacs" "av"

# 3.3 人脸相关
$VENV install "face-alignment==1.4.1" "batch-face"

# 3.4 mmlab 全家桶（Mac 编译坑在这里）
$VENV install "mmcv-lite==2.1.0"              # 用 lite 版，避免 CUDA ops 编译
$VENV install --no-deps "mmdet==3.3.0"        # --no-deps 跳过会编译失败的 chumpy
$VENV install --no-deps "mmpose==1.3.1"
$VENV install shapely "pycocotools" terminaltables rapidfuzz   # mmdet 的运行时依赖

# 3.5 面部增强（GFPGAN 链）
$VENV install "basicsr==1.4.2" "facexlib==0.3.0" "gfpgan"
```

### 4. 打两个兼容性补丁

新版 torch/numpy 与 SadTalker 老代码有两处不兼容，必须手动修：

**补丁 A：torchvision 的 `functional_tensor` shim**（basicsr/gfpgan 需要）

```bash
TV_DIR=$($VENV -c "import torchvision,os;print(os.path.dirname(torchvision.transforms.__file__))")
cat > "$TV_DIR/functional_tensor.py" << 'PYEOF'
"""Compat shim: torchvision removed transforms.functional_tensor in 0.15+."""
from torchvision.transforms.functional import *  # noqa
from torchvision.transforms.functional import (  # noqa
    rgb_to_grayscale, adjust_brightness, adjust_contrast, adjust_saturation,
    adjust_hue, adjust_gamma, rotate, affine, perspective, crop, center_crop,
    resize, to_pil_image, to_tensor,
)
PYEOF
```

**补丁 B：SadTalker 源码的 numpy 弃用**

编辑 `~/SadTalker/src/face3d/util/my_awing_arch.py` 第 18 行：
```python
# 改前: preds = preds.astype(np.float, copy=False)
# 改后:
preds = preds.astype(float, copy=False)
```

编辑 `~/SadTalker/src/face3d/util/preprocess.py` 第 101 行：
```python
# 改前: trans_params = np.array([w0, h0, s, t[0], t[1]])
# 改后:
trans_params = np.array([w0, h0, float(s), float(t[0]), float(t[1])])
```

### 5. 下载模型权重（约 4.4GB）

```bash
cd ~/SadTalker
# 从 HuggingFace barisaydin/sadtalker 并行下载
bash <(cat <<'SH'
BASE="https://huggingface.co/barisaydin/sadtalker/resolve/main"
mkdir -p checkpoints gfpgan/weights
declare -a FILES=(
  "checkpoints/auido2exp_00300-model.pth"
  "checkpoints/auido2pose_00140-model.pth"
  "checkpoints/epoch_20.pth"
  "checkpoints/facevid2vid_00189-model.pth.tar"
  "checkpoints/mapping_00109-model.pth.tar"
  "checkpoints/mapping_00229-model.pth.tar"
  "checkpoints/shape_predictor_68_face_landmarks.dat"
  "checkpoints/wav2lip.pth"
  "checkpoints/BFM_Fitting.zip"
  "checkpoints/hub.zip"
  "gfpgan/weights/GFPGANv1.4.pth"
  "gfpgan/weights/alignment_WFLW_4HG.pth"
  "gfpgan/weights/detection_Resnet50_Final.pth"
  "gfpgan/weights/parsing_parsenet.pth"
)
for f in "${FILES[@]}"; do
  [ -s "$f" ] && continue
  curl -fL --retry 2 -o "$f" "$BASE/$f" &
  while [ $(jobs -r|wc -l) -ge 4 ]; do sleep 0.5; done
done
wait
# 解压归档
cd checkpoints && unzip -q -o BFM_Fitting.zip && unzip -q -o hub.zip && cd ..
SH
)
```

**重要**：下载后务必校验大文件完整性（并行下载偶尔会损坏）：

```bash
$VENV -c "
import torch
for f in ['checkpoints/epoch_20.pth','checkpoints/facevid2vid_00189-model.pth.tar']:
    try: torch.load(f, map_location='cpu'); print('OK', f)
    except Exception as e: print('CORRUPT', f, str(e)[:60])
"
```

如果 `facevid2vid` 报 CORRUPT，单独重新下载（它有 1.6GB，最易损坏）。

### 6. 验证安装

```bash
cd ~/SadTalker
~/sadtalker-venv/bin/python inference.py \
  --driven_audio examples/driven_audio/bus_chinese.wav \
  --source_image examples/source_image/full_body_1.png \
  --checkpoint_dir checkpoints \
  --result_dir /tmp/st-verify \
  --preprocess full --still --cpu --size 256
```

成功的话会在 `/tmp/st-verify/` 下生成一个 mp4。在 M1 Pro 上约需 13 分钟（CPU 推理，正常）。

### 7. 配置 `.env.local`

```bash
cat > /path/to/Meta-Human/.env.local << 'EOF'
SADTALKER_DIR=/Users/<你>/SadTalker
SADTALKER_PYTHON=/Users/<你>/sadtalker-venv/bin/python
SADTALKER_ENHANCER=
SADTALKER_PREPROCESS=full
EOF
```

## 常见问题

| 现象 | 原因 / 解决 |
|---|---|
| `mmcv` 编译失败 | 用 `mmcv-lite`，不要装完整 `mmcv` |
| `chumpy` 编译失败 | 装 `mmdet`/`mmpose` 时加 `--no-deps` |
| `No module named 'torchvision.transforms.functional_tensor'` | 漏了补丁 A，按本文打 shim |
| `module 'numpy' has no attribute 'float'` | 漏了补丁 B |
| `setting an array element... inhomogeneous shape` | 漏了补丁 B 的 preprocess.py |
| `can not detect the landmark from source image` | 上传的是卡通图/非人脸，SadTalker 需要真实正脸照片 |
| `PytorchStreamReader failed reading zip archive` | 模型文件下载损坏，重新下载该文件 |
| 任务卡在渲染很久 | CPU 推理慢是正常的（见 README 性能说明）；关掉 GFPGAN 可大幅加速 |

## 性能参考（M1 Pro, 32GB）

| 配置 | 3 秒视频耗时 |
|---|---|
| 无增强器（推荐 CPU） | ~13 分钟 |
| GFPGAN 增强 | ~40 分钟 |
| 有 CUDA GPU（参考值） | ~30 秒 |
