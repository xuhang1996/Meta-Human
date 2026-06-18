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
  const scriptPath = path.join(process.cwd(), "scripts", "detect-face.swift");
  const output = await runCommand("swift", [scriptPath, imagePath]);
  return JSON.parse(output) as PortraitFeatures;
}
