#!/usr/bin/env bash
# SadTalker 一键环境搭建（macOS Apple Silicon）
# 用法: bash scripts/setup-sadtalker.sh [安装目录] [venv目录]
#
# 本脚本完成: 克隆 SadTalker → 创建 venv → 装依赖 → 打补丁 → 下载模型
# 耗时约 20-40 分钟（取决于网速），需要约 6GB 磁盘。
set -euo pipefail

SADTALKER_DIR="${1:-$HOME/SadTalker}"
VENV_DIR="${2:-$HOME/sadtalker-venv}"
PYTHON="${PYTHON:-/opt/homebrew/bin/python3.10}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

log() { printf "\n\033[1;34m▶ %s\033[0m\n" "$1"; }
ok()  { printf "\033[1;32m  ✓ %s\033[0m\n" "$1"; }
die() { printf "\033[1;31m  ✗ %s\033[0m\n" "$1" >&2; exit 1; }

log "SadTalker 环境搭建"
echo "  SadTalker 安装到: $SADTALKER_DIR"
echo "  Python venv 安装到: $VENV_DIR"

# ---------- 前置检查 ----------
command -v ffmpeg >/dev/null || die "未找到 ffmpeg，请先 brew install ffmpeg"
command -v "$PYTHON" >/dev/null || die "未找到 python3.10 ($PYTHON)，请先 brew install python@3.10"
ok "前置依赖检查通过"

# ---------- 1. 克隆 SadTalker ----------
if [ -d "$SADTALKER_DIR/inference.py" ] || [ -f "$SADTALKER_DIR/inference.py" ]; then
  ok "SadTalker 已存在，跳过克隆"
else
  log "下载 SadTalker 源码（tarball 方式，比 git clone 更稳）"
  mkdir -p "$SADTALKER_DIR"
  curl -fL --retry 3 -o /tmp/sadtalker.tar.gz \
    "https://codeload.github.com/OpenTalker/SadTalker/tar.gz/refs/heads/main"
  tar -xzf /tmp/sadtalker.tar.gz -C "$SADTALKER_DIR" --strip-components=1
  ok "SadTalker 源码就绪"
fi

# ---------- 2. 创建 venv ----------
log "创建 Python 3.10 虚拟环境"
if [ -x "$VENV_DIR/bin/python" ]; then
  ok "venv 已存在，跳过创建"
else
  "$PYTHON" -m venv "$VENV_DIR"
  ok "venv 创建完成"
fi
PIP="$VENV_DIR/bin/pip"
"$PIP" install --upgrade pip -q

# ---------- 3. 安装依赖 ----------
log "安装依赖（约 5-10 分钟）"

"$PIP" install -q torch torchvision torchaudio
"$PIP" install -q "numpy<2"
"$PIP" install -q \
  opencv-python==4.10.0.84 imageio==2.36.1 imageio-ffmpeg==0.5.1 \
  librosa==0.10.2.post1 numba==0.60.0 scipy==1.13.1 scikit-image==0.24.0 \
  "pydub>=0.25" "tqdm>=4.66" "resampy" "kornia==0.7.2" \
  "transformers==4.37.2" "ffmpy==0.3.2" "yacs" "av" \
  "face-alignment==1.4.1" "batch-face"
"$PIP" install -q "mmcv-lite==2.1.0"
"$PIP" install -q --no-deps "mmdet==3.3.0" "mmpose==1.3.1"
"$PIP" install -q shapely "pycocotools" terminaltables rapidfuzz
"$PIP" install -q "basicsr==1.4.2" "facexlib==0.3.0" "gfpgan"
ok "Python 依赖安装完成"

# ---------- 4. 打补丁 ----------
log "打兼容性补丁"

# 补丁 A: torchvision functional_tensor shim
TV_DIR="$("$VENV_DIR/bin/python" -c "import torchvision,os;print(os.path.dirname(torchvision.transforms.__file__))")"
if [ ! -f "$TV_DIR/functional_tensor.py" ]; then
  cat > "$TV_DIR/functional_tensor.py" << 'PYEOF'
"""Compat shim: torchvision removed transforms.functional_tensor in 0.15+."""
from torchvision.transforms.functional import *  # noqa
from torchvision.transforms.functional import (  # noqa
    rgb_to_grayscale, adjust_brightness, adjust_contrast, adjust_saturation,
    adjust_hue, adjust_gamma, rotate, affine, perspective, crop, center_crop,
    resize, to_pil_image, to_tensor,
)
PYEOF
  ok "补丁 A: functional_tensor shim 已写入"
else
  ok "补丁 A: 已存在，跳过"
fi

# 补丁 B: SadTalker 源码 numpy 弃用修复
AWING="$SADTALKER_DIR/src/face3d/util/my_awing_arch.py"
if grep -q "np\.float," "$AWING" 2>/dev/null; then
  sed -i.bak 's/preds = preds\.astype(np\.float, copy=False)/preds = preds.astype(float, copy=False)/' "$AWING"
  ok "补丁 B1: my_awing_arch.py np.float 已修复"
else
  ok "补丁 B1: 已修复或不存在，跳过"
fi

PREPROC="$SADTALKER_DIR/src/face3d/util/preprocess.py"
if grep -q "np.array(\[w0, h0, s, t\[0\], t\[1\]\])" "$PREPROC" 2>/dev/null; then
  sed -i.bak 's/trans_params = np.array(\[w0, h0, s, t\[0\], t\[1\]\])/trans_params = np.array([w0, h0, float(s), float(t[0]), float(t[1])])/' "$PREPROC"
  ok "补丁 B2: preprocess.py inhomogeneous shape 已修复"
else
  ok "补丁 B2: 已修复或不存在，跳过"
fi

# ---------- 5. 下载模型 ----------
log "下载 SadTalker 模型权重（约 4.4GB，10-20 分钟）"
cd "$SADTALKER_DIR"
mkdir -p checkpoints gfpgan/weights
BASE="https://huggingface.co/barisaydin/sadtalker/resolve/main"
FILES=(
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
  if [ -s "$f" ]; then echo "  skip $f"; continue; fi
  ( curl -fL --retry 3 -o "$f" "$BASE/$f" && echo "  ok $f" || echo "  FAIL $f" ) &
  while [ "$(jobs -r | wc -l)" -ge 4 ]; do sleep 0.5; done
done
wait
ok "模型下载完成"

# 解压归档
log "解压 BFM_Fitting 和 hub"
( cd checkpoints && unzip -q -o BFM_Fitting.zip && unzip -q -o hub.zip ) || die "解压失败"
ok "归档解压完成"

# ---------- 6. 校验大文件 ----------
log "校验模型完整性"
"$VENV_DIR/bin/python" -c "
import torch
files = ['checkpoints/epoch_20.pth','checkpoints/facevid2vid_00189-model.pth.tar',
         'checkpoints/mapping_00109-model.pth.tar','checkpoints/auido2pose_00140-model.pth']
bad = []
for f in files:
    try:
        torch.load(f, map_location='cpu'); print('  OK   ', f)
    except Exception as e:
        print('  CORRUPT', f, '->', str(e)[:50]); bad.append(f)
import sys; sys.exit(1 if bad else 0)
" || die "有模型文件损坏，请按 docs/SETUP.md 重新下载上述 CORRUPT 文件"
ok "模型完整性校验通过"

# ---------- 7. 输出配置指引 ----------
log "完成！请把以下内容写入项目的 .env.local"
cat << EOF

SADTALKER_DIR=$SADTALKER_DIR
SADTALKER_PYTHON=$VENV_DIR/bin/python
SADTALKER_ENHANCER=
SADTALKER_PREPROCESS=full

EOF

echo "详细说明见 docs/SETUP.md。验证安装："
echo "  cd $SADTALKER_DIR"
echo "  $VENV_DIR/bin/python inference.py \\"
echo "    --driven_audio examples/driven_audio/bus_chinese.wav \\"
echo "    --source_image examples/source_image/full_body_1.png \\"
echo "    --checkpoint_dir checkpoints --result_dir /tmp/st-verify \\"
echo "    --preprocess full --still --cpu --size 256"
