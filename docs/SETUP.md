# SadTalker 高质量口型环境搭建指南

「高质量模型」渲染引擎依赖本地 SadTalker。这是接手本仓库时**最耗时、最容易踩坑**的部分，请完整阅读本文档。

> 如果你只想验证前端流程，可以跳过本步，使用「极速预览」引擎（无需 Python）。但真实人脸视频必须用 SadTalker。

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
