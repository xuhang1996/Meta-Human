import path from "node:path";

import { runCommand } from "./render-process";

export interface Point2D {
  x: number;
  y: number;
}

export interface Rect2D {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PortraitFeatures {
  imageWidth: number;
  imageHeight: number;
  faceBounds: Rect2D;
  leftEye: {
    center: Point2D;
    bounds: Rect2D;
  };
  rightEye: {
    center: Point2D;
    bounds: Rect2D;
  };
  mouth: {
    center: Point2D;
    bounds: Rect2D;
  };
  innerMouth?: {
    center: Point2D;
    bounds: Rect2D;
  } | null;
  skinColor: string;
  lipColor: string;
}

export async function detectPortraitFeatures(imagePath: string) {
  // 原实现调用 macOS Swift Vision（detect-face.swift）；跨平台改用
  // MediaPipe 版 Python 脚本 detect-face.py，输出 JSON 结构保持一致。
  // 解释器路径由 EDGE_TTS_PYTHON 指定（与 TTS 共用 venv），未配置回退 python。
  const scriptPath = path.join(process.cwd(), "scripts", "detect-face.py");
  const pythonBin = process.env.EDGE_TTS_PYTHON || "python";
  const output = await runCommand(pythonBin, [scriptPath, imagePath]);
  return JSON.parse(output) as PortraitFeatures;
}
