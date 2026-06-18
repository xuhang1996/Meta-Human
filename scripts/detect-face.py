"""
跨平台人脸特征检测（替代 macOS Swift Vision 的 detect-face.swift）。

输入: 图片路径（命令行第一个参数）
输出: 与原 Swift 脚本完全一致的 JSON 到 stdout，结构如下：
  {
    "imageWidth": int, "imageHeight": int,
    "faceBounds": {"x","y","width","height"},          # 归一化 [0,1]，左上原点
    "leftEye":   {"center":{"x","y"},"bounds":{...}},   # 归一化
    "rightEye":  {"center":{"x","y"},"bounds":{...}},   # 归一化
    "mouth":     {"center":{"x","y"},"bounds":{...}},   # 归一化（外唇）
    "innerMouth":{"center":{"x","y"},"bounds":{...}},   # 归一化，可为 null
    "skinColor": "#RRGGBB",
    "lipColor":  "#RRGGBB"
  }

失败: 向 stderr 写信息并以非零退出码退出（与 Swift 脚本退出码语义对齐）。
"""
import json
import os
import ssl
import sys
import urllib.request

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision


# MediaPipe FaceLandmarker 的关键点索引（478 点 refine 模型）。
# 左右眼/外唇/内唇取外轮廓索引集合，复刻 Swift Vision 的 landmark 分组。
# 注意：FaceLandmarker 中"左眼"指图像中人的左眼（索引 33 等），与 Vision 一致。
LEFT_EYE_INDICES = [33, 7, 163, 144, 145, 153, 154, 155, 133,
                    246, 161, 160, 159, 158, 157, 173]
RIGHT_EYE_INDICES = [362, 382, 381, 380, 374, 373, 390, 249, 263,
                     466, 388, 387, 386, 385, 384, 398]
# 外唇（上下唇外缘）
OUTER_LIP_INDICES = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375,
                     291, 409, 270, 269, 267, 0, 37, 39, 40, 185]
# 内唇（上下唇内缘）
INNER_LIP_INDICES = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324,
                     308, 415, 310, 311, 312, 13, 82, 81, 80, 191]
# 椭圆脸型外轮廓，用于估算 faceBounds（接近 Vision 的 boundingBox）。
FACE_OVAL_INDICES = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323,
                     361, 288, 397, 365, 379, 378, 400, 377, 152, 148,
                     176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
                     162, 21, 54, 103, 67, 109]


def bounds_of(points):
    """给一组归一化点 {x,y}，返回归一化 bounds {x,y,width,height}。"""
    xs = [p["x"] for p in points]
    ys = [p["y"] for p in points]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    return {"x": min_x, "y": min_y, "width": max_x - min_x, "height": max_y - min_y}


def center_of(rect):
    return {"x": rect["x"] + rect["width"] / 2,
            "y": rect["y"] + rect["height"] / 2}


def clamp(value, low, high):
    return max(low, min(high, value))


def average_color(bgr_image, norm_point, radius):
    """
    在像素图上以归一化坐标为中心、radius 为半径取平均色，返回 '#RRGGBB'。
    复刻 Swift averageColor 的语义。bgr_image 为 OpenCV 的 BGR 数组。
    """
    h, w = bgr_image.shape[:2]
    px = clamp(int(norm_point["x"] * w), 0, w - 1)
    py = clamp(int(norm_point["y"] * h), 0, h - 1)

    r_total = g_total = b_total = 0.0
    count = 0
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            sx = clamp(px + dx, 0, w - 1)
            sy = clamp(py + dy, 0, h - 1)
            # OpenCV 顺序为 BGR
            b, g, r = bgr_image[sy, sx]
            b_total += float(b)
            g_total += float(g)
            r_total += float(r)
            count += 1

    if count == 0:
        return "#caa58d"
    return "#%02X%02X%02X" % (int(r_total / count), int(g_total / count), int(b_total / count))


FACE_LANDMARKER_URL = (
    "https://storage.googleapis.com/mediapipe-models/"
    "face_landmarker/face_landmarker/float16/1/face_landmarker.task"
)


def model_path():
    """定位 face_landmarker.task 模型，不存在则自动下载（约 3.6MB）。

    模型不随仓库分发（避免大文件入库），首次运行时按需拉取并缓存到
    scripts/models/ 下，后续直接复用。
    """
    here = os.path.dirname(os.path.abspath(__file__))
    models_dir = os.path.join(here, "models")
    dst = os.path.join(models_dir, "face_landmarker.task")

    if not os.path.exists(dst) or os.path.getsize(dst) == 0:
        os.makedirs(models_dir, exist_ok=True)
        sys.stderr.write("Downloading face_landmarker.task (~3.6MB)...\n")
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        req = urllib.request.Request(
            FACE_LANDMARKER_URL, headers={"User-Agent": "Mozilla/5.0"}
        )
        with urllib.request.urlopen(req, context=ctx, timeout=120) as resp, open(dst, "wb") as f:
            f.write(resp.read())

    return dst


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("detect-face.py requires an image path.\n")
        sys.exit(2)

    image_path = sys.argv[1]
    image = cv2.imread(image_path)
    if image is None:
        sys.stderr.write("Failed to load image.\n")
        sys.exit(3)

    h, w = image.shape[:2]

    if not os.path.exists(model_path()):
        sys.stderr.write("FaceLandmarker model not found: %s\n" % model_path())
        sys.exit(4)

    base_options = mp_python.BaseOptions(model_asset_path=model_path())
    options = mp_vision.FaceLandmarkerOptions(
        base_options=base_options,
        running_mode=mp_vision.RunningMode.IMAGE,
        num_faces=1,
    )
    landmarker = mp_vision.FaceLandmarker.create_from_options(options)
    try:
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = landmarker.detect(mp_image)
    finally:
        landmarker.close()

    if not result.face_landmarks:
        sys.stderr.write("No face detected.\n")
        sys.exit(5)

    landmarks = result.face_landmarks[0]

    def to_points(indices):
        # landmark.x/.y 已是归一化 [0,1]，左上原点向下，与目标坐标系一致。
        return [{"x": landmarks[i].x, "y": landmarks[i].y} for i in indices]

    face_bounds = bounds_of(to_points(FACE_OVAL_INDICES))
    left_eye_bounds = bounds_of(to_points(LEFT_EYE_INDICES))
    right_eye_bounds = bounds_of(to_points(RIGHT_EYE_INDICES))
    mouth_bounds = bounds_of(to_points(OUTER_LIP_INDICES))
    inner_mouth_bounds = bounds_of(to_points(INNER_LIP_INDICES))

    # 取色：在脸颊两侧与嘴唇中心采样（与 Swift 脚本一致）。
    skin1 = {
        "x": face_bounds["x"] + face_bounds["width"] * 0.28,
        "y": face_bounds["y"] + face_bounds["height"] * 0.58,
    }
    skin2 = {
        "x": face_bounds["x"] + face_bounds["width"] * 0.72,
        "y": face_bounds["y"] + face_bounds["height"] * 0.58,
    }
    lip_center = center_of(mouth_bounds)

    skin_color1 = average_color(image, skin1, 8)
    skin_color2 = average_color(image, skin2, 8)
    lip_color = average_color(image, lip_center, 6)
    skin_color = "#000000" if skin_color1 == "#000000" else skin_color1

    output = {
        "imageWidth": w,
        "imageHeight": h,
        "faceBounds": face_bounds,
        "leftEye": {"center": center_of(left_eye_bounds), "bounds": left_eye_bounds},
        "rightEye": {"center": center_of(right_eye_bounds), "bounds": right_eye_bounds},
        "mouth": {"center": lip_center, "bounds": mouth_bounds},
        "innerMouth": {"center": center_of(inner_mouth_bounds), "bounds": inner_mouth_bounds},
        "skinColor": skin_color,
        "lipColor": lip_color,
    }

    sys.stdout.write(json.dumps(output))


if __name__ == "__main__":
    main()
