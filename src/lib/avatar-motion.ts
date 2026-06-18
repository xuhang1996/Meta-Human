import { spawn } from "node:child_process";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { detectPortraitFeatures, PortraitFeatures } from "./portrait-features";
import { MotionPreset, SampleAvatarId } from "./types";

const AVATAR_WIDTH = 520;
const AVATAR_HEIGHT = 580;
export const SAMPLE_AVATAR_FPS = 12;
const AUDIO_SAMPLE_RATE = 12_000;
const requireFromHere = createRequire(import.meta.url);

interface AvatarProfile {
  background: string;
  glow: string;
  jacket: string;
  jacketShade: string;
  shirt: string;
  skin: string;
  hair: string;
  hairShade: string;
  lip: string;
  innerMouth: string;
  tongue: string;
  outline: string;
  accent: string;
}

interface MotionProfile {
  sampleHeadBobX: number;
  sampleHeadBobY: number;
  sampleHeadTilt: number;
  sampleShoulderShift: number;
  sampleMouthScale: number;
  sampleMouthPulse: number;
  portraitDriftX: number;
  portraitDriftY: number;
  portraitZoom: number;
  portraitMouthScale: number;
  portraitMouthPulse: number;
  portraitJawBase: number;
  portraitJawTravel: number;
  portraitMouthWidthBoost: number;
  portraitMouthHeightBoost: number;
  portraitMouthLift: number;
  portraitBlinkHeight: number;
  portraitBlinkOpacity: number;
}

const AVATAR_PROFILES: Record<SampleAvatarId, AvatarProfile> = {
  "analyst-aurora": {
    background: "#eef4fb",
    glow: "#c9dbef",
    jacket: "#2b5f74",
    jacketShade: "#1d4250",
    shirt: "#fbfdff",
    skin: "#ffd7bd",
    hair: "#26395d",
    hairShade: "#1d2c49",
    lip: "#cc7568",
    innerMouth: "#813a42",
    tongue: "#e8a299",
    outline: "#1a2d42",
    accent: "#5e97c9",
  },
  "host-river": {
    background: "#eef5e8",
    glow: "#d2e4bf",
    jacket: "#3a6a53",
    jacketShade: "#284839",
    shirt: "#f8fbf4",
    skin: "#ffd5b5",
    hair: "#304239",
    hairShade: "#233029",
    lip: "#c56c62",
    innerMouth: "#7b3640",
    tongue: "#e8a8a0",
    outline: "#243229",
    accent: "#75ae7a",
  },
};

const MOTION_PROFILES: Record<MotionPreset, MotionProfile> = {
  natural: {
    sampleHeadBobX: 3,
    sampleHeadBobY: 4,
    sampleHeadTilt: 1.8,
    sampleShoulderShift: 5,
    sampleMouthScale: 1.15,
    sampleMouthPulse: 0.06,
    portraitDriftX: 2.6,
    portraitDriftY: 3.1,
    portraitZoom: 0.006,
    portraitMouthScale: 1.08,
    portraitMouthPulse: 0.02,
    portraitJawBase: 4,
    portraitJawTravel: 8,
    portraitMouthWidthBoost: 0.12,
    portraitMouthHeightBoost: 0.28,
    portraitMouthLift: 1.4,
    portraitBlinkHeight: 1.5,
    portraitBlinkOpacity: 0.95,
  },
  expressive: {
    sampleHeadBobX: 5.5,
    sampleHeadBobY: 7.2,
    sampleHeadTilt: 3.4,
    sampleShoulderShift: 9,
    sampleMouthScale: 1.58,
    sampleMouthPulse: 0.16,
    portraitDriftX: 6.4,
    portraitDriftY: 7.1,
    portraitZoom: 0.018,
    portraitMouthScale: 1.38,
    portraitMouthPulse: 0.05,
    portraitJawBase: 6,
    portraitJawTravel: 14,
    portraitMouthWidthBoost: 0.18,
    portraitMouthHeightBoost: 0.5,
    portraitMouthLift: 3.4,
    portraitBlinkHeight: 2.45,
    portraitBlinkOpacity: 1,
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function runBinaryCommand(command: string, args: string[], cwd: string) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(Buffer.from(chunk));
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks));
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} failed with exit code ${code}\n${stderr}`,
        ),
      );
    });
  });
}

async function extractAudioEnvelope(
  jobDir: string,
  audioFileName: string,
  frameCount: number,
) {
  const audioBuffer = await runBinaryCommand(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      audioFileName,
      "-f",
      "f32le",
      "-ac",
      "1",
      "-ar",
      `${AUDIO_SAMPLE_RATE}`,
      "pipe:1",
    ],
    jobDir,
  );

  const sampleCount = Math.floor(audioBuffer.length / 4);
  const samples = new Float32Array(sampleCount);

  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = audioBuffer.readFloatLE(index * 4);
  }

  const samplesPerFrame = AUDIO_SAMPLE_RATE / SAMPLE_AVATAR_FPS;
  const rmsValues = Array.from({ length: frameCount }, (_, frameIndex) => {
    const start = Math.floor(frameIndex * samplesPerFrame);
    const end = Math.min(
      sampleCount,
      Math.floor((frameIndex + 1) * samplesPerFrame),
    );

    if (end <= start) {
      return 0;
    }

    let energy = 0;

    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      const sample = samples[sampleIndex];
      energy += sample * sample;
    }

    return Math.sqrt(energy / (end - start));
  });

  const maxRms = Math.max(...rmsValues, 0.00001);
  const floor = maxRms * 0.12;
  let previous = 0;

  return rmsValues.map((value, index) => {
    const lifted = clamp((value - floor) / (maxRms - floor || 1), 0, 1);
    const curved = Math.pow(lifted, 0.68);
    const smoothed =
      index === 0 ? curved : previous * 0.34 + curved * 0.66;

    previous = smoothed;
    return smoothed;
  });
}

function buildBlinkAmount(timeSeconds: number, durationSeconds: number) {
  const blinkCenters: number[] = [];
  let cursor = 1.8;
  let index = 0;

  while (cursor < durationSeconds + 0.2) {
    blinkCenters.push(cursor);
    cursor += 2.4 + (index % 3) * 0.45;
    index += 1;
  }

  return blinkCenters.reduce((strongest, center) => {
    const distance = Math.abs(timeSeconds - center);

    if (distance > 0.14) {
      return strongest;
    }

    return Math.max(strongest, 1 - distance / 0.14);
  }, 0);
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function colorLuminance(hex: string) {
  const normalized = hex.replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function inferImageMimeType(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();

  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

function projectRect(
  rect: { x: number; y: number; width: number; height: number },
  sourceWidth: number,
  sourceHeight: number,
  imageX: number,
  imageY: number,
  scale: number,
  driftX: number,
  driftY: number,
) {
  return {
    x: imageX + rect.x * sourceWidth * scale + driftX,
    y: imageY + rect.y * sourceHeight * scale + driftY,
    width: rect.width * sourceWidth * scale,
    height: rect.height * sourceHeight * scale,
  };
}

function projectPoint(
  point: { x: number; y: number },
  sourceWidth: number,
  sourceHeight: number,
  imageX: number,
  imageY: number,
  scale: number,
  driftX: number,
  driftY: number,
) {
  return {
    x: imageX + point.x * sourceWidth * scale + driftX,
    y: imageY + point.y * sourceHeight * scale + driftY,
  };
}

function computePortraitPlacement(features: PortraitFeatures) {
  const coverScale = Math.max(
    AVATAR_WIDTH / features.imageWidth,
    AVATAR_HEIGHT / features.imageHeight,
  );
  const faceScale =
    (AVATAR_HEIGHT * 0.39) / (features.faceBounds.height * features.imageHeight);
  const scale = Math.max(coverScale, Math.min(faceScale, coverScale * 2.4));

  const faceCenterX =
    (features.faceBounds.x + features.faceBounds.width / 2) * features.imageWidth;
  const faceCenterY =
    (features.faceBounds.y + features.faceBounds.height / 2) * features.imageHeight;

  let imageX = AVATAR_WIDTH / 2 - faceCenterX * scale;
  let imageY = AVATAR_HEIGHT * 0.34 - faceCenterY * scale;

  const scaledWidth = features.imageWidth * scale;
  const scaledHeight = features.imageHeight * scale;
  imageX = clamp(imageX, AVATAR_WIDTH - scaledWidth, 0);
  imageY = clamp(imageY, AVATAR_HEIGHT - scaledHeight, 0);

  return {
    imageX,
    imageY,
    scaledWidth,
    scaledHeight,
    scale,
  };
}

function buildMouth(
  profile: AvatarProfile,
  mouthX: number,
  mouthY: number,
  openness: number,
) {
  if (openness < 0.16) {
    return `<path d="M ${mouthX - 34} ${mouthY} Q ${mouthX} ${mouthY + 18} ${mouthX + 34} ${mouthY}" stroke="${profile.lip}" stroke-width="10" stroke-linecap="round" fill="none" />`;
  }

  const width = 38 + openness * 18;
  const height = 12 + openness * 30;
  const tongueHeight = 6 + openness * 8;

  return [
    `<ellipse cx="${mouthX}" cy="${mouthY + 6}" rx="${width}" ry="${height}" fill="${profile.innerMouth}" />`,
    `<ellipse cx="${mouthX}" cy="${mouthY + 12 + openness * 4}" rx="${width - 10}" ry="${tongueHeight}" fill="${profile.tongue}" opacity="0.92" />`,
    `<ellipse cx="${mouthX}" cy="${mouthY + 4}" rx="${width}" ry="${height}" fill="none" stroke="${profile.lip}" stroke-width="5" />`,
  ].join("");
}

function renderSampleAvatarSvg(options: {
  avatarId: SampleAvatarId;
  frameIndex: number;
  durationSeconds: number;
  mouthOpen: number;
  motionPreset: MotionPreset;
}) {
  const profile = AVATAR_PROFILES[options.avatarId];
  const motion = MOTION_PROFILES[options.motionPreset];
  const timeSeconds = options.frameIndex / SAMPLE_AVATAR_FPS;
  const blink = buildBlinkAmount(timeSeconds, options.durationSeconds);
  const headBobY = Math.sin(timeSeconds * 1.3) * motion.sampleHeadBobY;
  const headBobX = Math.sin(timeSeconds * 0.85) * motion.sampleHeadBobX;
  const headTilt = Math.sin(timeSeconds * 0.72) * motion.sampleHeadTilt;
  const shoulderShift = Math.sin(timeSeconds * 0.68) * motion.sampleShoulderShift;
  const eyeHeight = clamp(13 - blink * 10.5, 2.5, 13);
  const pupilScale = 1 - blink * 0.35;
  const mouthOpen = clamp(
    options.mouthOpen * motion.sampleMouthScale +
      motion.sampleMouthPulse * Math.sin(timeSeconds * 11),
    0,
    1,
  );

  const headCx = 260 + headBobX;
  const headCy = 222 + headBobY;
  const faceTop = 126 + headBobY;
  const faceBottom = 334 + headBobY;
  const mouthY = 308 + headBobY;

  const eyeLeftX = 212 + headBobX;
  const eyeRightX = 308 + headBobX;
  const browY = 206 + headBobY - mouthOpen * 3;

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${AVATAR_WIDTH}" height="${AVATAR_HEIGHT}" viewBox="0 0 ${AVATAR_WIDTH} ${AVATAR_HEIGHT}">
  <defs>
    <radialGradient id="glow" cx="50%" cy="35%" r="60%">
      <stop offset="0%" stop-color="${profile.glow}" />
      <stop offset="100%" stop-color="${profile.background}" />
    </radialGradient>
    <linearGradient id="jacketShade" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${profile.jacket}" />
      <stop offset="100%" stop-color="${profile.jacketShade}" />
    </linearGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="#0b1117" flood-opacity="0.18" />
    </filter>
  </defs>
  <rect width="${AVATAR_WIDTH}" height="${AVATAR_HEIGHT}" rx="32" fill="url(#glow)" />
  <ellipse cx="260" cy="540" rx="170" ry="24" fill="#122028" opacity="0.08" />
  <g transform="translate(${shoulderShift} 0)">
    <path d="M112 472C138 406 188 372 260 372C332 372 382 406 408 472V580H112V472Z" fill="url(#jacketShade)" filter="url(#softShadow)" />
    <path d="M168 420C196 392 226 378 260 378C294 378 324 392 352 420L314 580H206L168 420Z" fill="${profile.shirt}" />
    <path d="M170 420C210 450 233 492 236 548H132V486C132 456 144 434 170 420Z" fill="${profile.jacketShade}" opacity="0.92" />
    <path d="M350 420C310 450 287 492 284 548H388V486C388 456 376 434 350 420Z" fill="${profile.jacketShade}" opacity="0.92" />
  </g>
  <g transform="rotate(${headTilt} ${headCx} ${headCy})">
    <ellipse cx="${headCx}" cy="${headCy}" rx="98" ry="116" fill="${profile.skin}" filter="url(#softShadow)" />
    <ellipse cx="${headCx - 98}" cy="${headCy}" rx="14" ry="26" fill="${profile.skin}" />
    <ellipse cx="${headCx + 98}" cy="${headCy}" rx="14" ry="26" fill="${profile.skin}" />
    <path d="M${headCx - 116} ${faceTop + 44}C${headCx - 108} ${faceTop - 6} ${headCx - 64} ${faceTop - 30} ${headCx - 10} ${faceTop - 30}H${headCx + 24}C${headCx + 84} ${faceTop - 30} ${headCx + 116} ${faceTop + 4} ${headCx + 116} ${faceTop + 62}V${faceTop + 16}C${headCx + 116} ${faceTop - 2} ${headCx + 100} ${faceTop - 18} ${headCx + 74} ${faceTop - 22}C${headCx + 58} ${faceTop - 72} ${headCx + 6} ${faceTop - 88} ${headCx - 38} ${faceTop - 84}C${headCx - 84} ${faceTop - 80} ${headCx - 118} ${faceTop - 46} ${headCx - 120} ${faceTop + 2}V${faceTop + 44}Z" fill="${profile.hair}" />
    <path d="M${headCx + 14} ${faceTop - 28}C${headCx + 56} ${faceTop - 30} ${headCx + 104} ${faceTop + 4} ${headCx + 104} ${faceTop + 72}V${faceTop + 28}C${headCx + 98} ${faceTop + 8} ${headCx + 72} ${faceTop - 8} ${headCx + 14} ${faceTop - 28}Z" fill="${profile.hairShade}" opacity="0.92" />
    <path d="M${headCx - 82} ${browY}C${headCx - 58} ${browY - 18} ${headCx - 32} ${browY - 18} ${headCx - 8} ${browY}" stroke="${profile.outline}" stroke-width="9" stroke-linecap="round" fill="none" opacity="0.32" />
    <path d="M${headCx + 8} ${browY}C${headCx + 32} ${browY - 18} ${headCx + 58} ${browY - 18} ${headCx + 82} ${browY}" stroke="${profile.outline}" stroke-width="9" stroke-linecap="round" fill="none" opacity="0.32" />
    <rect x="${eyeLeftX - 20 * pupilScale}" y="${238 + headBobY - eyeHeight / 2}" rx="${eyeHeight / 2}" width="${40 * pupilScale}" height="${eyeHeight}" fill="${profile.outline}" />
    <rect x="${eyeRightX - 20 * pupilScale}" y="${238 + headBobY - eyeHeight / 2}" rx="${eyeHeight / 2}" width="${40 * pupilScale}" height="${eyeHeight}" fill="${profile.outline}" />
    <path d="M${headCx} ${248 + headBobY}C${headCx - 8} ${268 + headBobY} ${headCx - 8} ${286 + headBobY} ${headCx + 3} ${294 + headBobY}" stroke="#d9aa8f" stroke-width="6" stroke-linecap="round" fill="none" opacity="0.9" />
    ${buildMouth(profile, headCx, mouthY, mouthOpen)}
    <ellipse cx="${headCx}" cy="${faceBottom + 22}" rx="42" ry="24" fill="${profile.skin}" />
  </g>
  <circle cx="406" cy="112" r="16" fill="${profile.accent}" opacity="0.18" />
  <circle cx="430" cy="138" r="8" fill="${profile.accent}" opacity="0.32" />
</svg>`.trim();
}

export async function renderAnimatedSampleFrames(options: {
  audioFileName: string;
  durationSeconds: number;
  jobDir: string;
  motionPreset: MotionPreset;
  sampleAvatarId: SampleAvatarId;
}) {
  const frameCount = Math.max(
    36,
    Math.ceil(options.durationSeconds * SAMPLE_AVATAR_FPS) + 1,
  );
  const framesDir = path.join(options.jobDir, "avatar-frames");
  const { Resvg } = requireFromHere("@resvg/resvg-js") as typeof import("@resvg/resvg-js");

  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });

  const envelope = await extractAudioEnvelope(
    options.jobDir,
    options.audioFileName,
    frameCount,
  );

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const svg = renderSampleAvatarSvg({
      avatarId: options.sampleAvatarId,
      frameIndex,
      durationSeconds: options.durationSeconds,
      mouthOpen: envelope[frameIndex] ?? 0,
      motionPreset: options.motionPreset,
    });
    const png = new Resvg(svg, {
      fitTo: {
        mode: "width",
        value: AVATAR_WIDTH,
      },
    })
      .render()
      .asPng();

    await writeFile(
      path.join(framesDir, `frame-${String(frameIndex + 1).padStart(4, "0")}.png`),
      png,
    );
  }

  return {
    framesDir,
    frameRate: SAMPLE_AVATAR_FPS,
  };
}

function renderPortraitFrameSvg(options: {
  dataUrl: string;
  durationSeconds: number;
  features: PortraitFeatures;
  frameIndex: number;
  mouthOpen: number;
  motionPreset: MotionPreset;
}) {
  const motion = MOTION_PROFILES[options.motionPreset];
  const timeSeconds = options.frameIndex / SAMPLE_AVATAR_FPS;
  const blink = buildBlinkAmount(timeSeconds, options.durationSeconds);
  const driftX = Math.sin(timeSeconds * 0.92) * motion.portraitDriftX;
  const driftY = Math.cos(timeSeconds * 1.14) * motion.portraitDriftY;
  const zoom = 1 + Math.sin(timeSeconds * 0.64) * motion.portraitZoom;
  const exposedTeeth =
    colorLuminance(options.features.lipColor) >
    colorLuminance(options.features.skinColor) + 0.16;
  const maxMouthOpen = exposedTeeth
    ? options.motionPreset === "expressive"
      ? 0.34
      : 0.24
    : options.motionPreset === "expressive"
      ? 0.54
      : 0.4;
  const animatedMouthOpen = clamp(
    options.mouthOpen * motion.portraitMouthScale +
      motion.portraitMouthPulse * Math.sin(timeSeconds * 9.4),
    0,
    maxMouthOpen,
  );
  const placement = computePortraitPlacement(options.features);
  const imageX =
    AVATAR_WIDTH / 2 -
    (AVATAR_WIDTH / 2 - placement.imageX) * zoom;
  const imageY =
    AVATAR_HEIGHT / 2 -
    (AVATAR_HEIGHT / 2 - placement.imageY) * zoom;
  const imageWidth = placement.scaledWidth * zoom;
  const imageHeight = placement.scaledHeight * zoom;
  const scale = placement.scale * zoom;

  const leftEye = projectRect(
    options.features.leftEye.bounds,
    options.features.imageWidth,
    options.features.imageHeight,
    imageX,
    imageY,
    scale,
    driftX,
    driftY,
  );
  const rightEye = projectRect(
    options.features.rightEye.bounds,
    options.features.imageWidth,
    options.features.imageHeight,
    imageX,
    imageY,
    scale,
    driftX,
    driftY,
  );
  const mouthFeature = options.features.innerMouth ?? options.features.mouth;
  const mouth = projectRect(
    mouthFeature.bounds,
    options.features.imageWidth,
    options.features.imageHeight,
    imageX,
    imageY,
    scale,
    driftX,
    driftY,
  );
  const outerMouth = projectRect(
    options.features.mouth.bounds,
    options.features.imageWidth,
    options.features.imageHeight,
    imageX,
    imageY,
    scale,
    driftX,
    driftY,
  );
  const mouthCenter = projectPoint(
    mouthFeature.center,
    options.features.imageWidth,
    options.features.imageHeight,
    imageX,
    imageY,
    scale,
    driftX,
    driftY,
  );
  const mouthOpacity = exposedTeeth
    ? clamp((animatedMouthOpen - 0.04) * 1.05, 0, 0.36)
    : clamp((animatedMouthOpen - 0.08) * 1.35, 0, 0.72);
  const blinkOpacity = clamp(blink * motion.portraitBlinkOpacity, 0, 0.96);
  const lidColor = hexToRgba(options.features.skinColor, 0.92);
  const mouthDark = exposedTeeth ? "#23171a" : "#120c12";
  const mouthShadow = hexToRgba(
    "#000000",
    exposedTeeth
      ? clamp(0.03 + animatedMouthOpen * 0.06, 0.03, 0.09)
      : clamp(0.04 + animatedMouthOpen * 0.1, 0.04, 0.16),
  );
  const mouthHighlight = hexToRgba(
    "#f2d6d0",
    clamp(0.02 + animatedMouthOpen * 0.04, 0.02, 0.07),
  );
  const lipEdge = hexToRgba(
    "#201217",
    clamp(0.1 + animatedMouthOpen * 0.18, 0.1, 0.3),
  );
  const mouthCenterX = mouthCenter.x;
  const mouthCenterY = mouthCenter.y + mouth.height * (exposedTeeth ? 0 : 0.02);
  const mouthShadowRx =
    mouth.width * (exposedTeeth ? 0.34 + animatedMouthOpen * 0.08 : 0.22 + animatedMouthOpen * 0.06);
  const mouthShadowRy =
    mouth.height * (exposedTeeth ? 0.04 + animatedMouthOpen * 0.1 : 0.03 + animatedMouthOpen * 0.08);
  const mouthCavityRx =
    mouth.width *
    (exposedTeeth
      ? 0.26 + animatedMouthOpen * 0.12
      : 0.16 + animatedMouthOpen * (motion.portraitMouthWidthBoost * 0.16 + 0.04));
  const mouthCavityRy =
    mouth.height *
    (exposedTeeth
      ? 0.05 + animatedMouthOpen * 0.18
      : 0.02 + animatedMouthOpen * (motion.portraitMouthHeightBoost * 0.16 + 0.03));
  const lowerLipRx = mouth.width * (exposedTeeth ? 0.18 + animatedMouthOpen * 0.04 : 0.1 + animatedMouthOpen * 0.04);
  const lowerLipRy = mouth.height * (exposedTeeth ? 0.04 + animatedMouthOpen * 0.05 : 0.02 + animatedMouthOpen * 0.04);
  const lipLineStartX = mouthCenterX - mouth.width * (exposedTeeth ? 0.38 : 0.28);
  const lipLineEndX = mouthCenterX + mouth.width * (exposedTeeth ? 0.38 : 0.28);
  const lipLineY = mouthCenterY - mouth.height * (exposedTeeth ? 0.01 : 0.04);
  const lipLineCurve = mouth.height * (exposedTeeth ? 0.02 + animatedMouthOpen * 0.03 : 0.04 + animatedMouthOpen * 0.04);
  const speechMaskOpacity = exposedTeeth
    ? clamp(animatedMouthOpen * 0.08, 0, 0.04)
    : clamp(animatedMouthOpen * 0.22, 0, 0.14);
  const mouthPatchScaleY = exposedTeeth
    ? 1 + animatedMouthOpen * 0.32
    : 1 + animatedMouthOpen * 0.18;
  const mouthPatchRx = outerMouth.width * (exposedTeeth ? 0.38 : 0.32);
  const mouthPatchRy = outerMouth.height * (exposedTeeth ? 0.28 : 0.24);

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${AVATAR_WIDTH}" height="${AVATAR_HEIGHT}" viewBox="0 0 ${AVATAR_WIDTH} ${AVATAR_HEIGHT}">
  <defs>
    <filter id="photoShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#091018" flood-opacity="0.16" />
    </filter>
    <clipPath id="mouthPatchClip">
      <ellipse cx="${mouthCenterX}" cy="${mouthCenterY}" rx="${mouthPatchRx}" ry="${mouthPatchRy}" />
    </clipPath>
  </defs>
  <rect width="${AVATAR_WIDTH}" height="${AVATAR_HEIGHT}" rx="28" fill="#f3f4ee" />
  <g filter="url(#photoShadow)">
    <image href="${options.dataUrl}" x="${imageX + driftX}" y="${imageY + driftY}" width="${imageWidth}" height="${imageHeight}" preserveAspectRatio="none" />
  </g>
  <ellipse cx="${mouthCenterX}" cy="${mouthCenterY}" rx="${mouth.width * 0.35}" ry="${mouth.height * 0.18}" fill="${hexToRgba(options.features.skinColor, speechMaskOpacity)}" />
  <g clip-path="url(#mouthPatchClip)" transform="translate(0 ${mouthCenterY}) scale(1 ${mouthPatchScaleY}) translate(0 ${-mouthCenterY})">
    <image href="${options.dataUrl}" x="${imageX + driftX}" y="${imageY + driftY}" width="${imageWidth}" height="${imageHeight}" preserveAspectRatio="none" />
  </g>
  <ellipse cx="${mouthCenterX}" cy="${mouthCenterY + mouth.height * 0.08}" rx="${mouthShadowRx}" ry="${mouthShadowRy}" fill="${mouthShadow}" />
  <ellipse cx="${mouthCenterX}" cy="${mouthCenterY}" rx="${mouthCavityRx}" ry="${mouthCavityRy}" fill="${mouthDark}" opacity="${mouthOpacity}" />
  <ellipse cx="${mouthCenterX}" cy="${mouthCenterY + mouth.height * 0.14 + animatedMouthOpen * 0.5}" rx="${lowerLipRx}" ry="${lowerLipRy}" fill="${mouthHighlight}" opacity="${mouthOpacity}" />
  <path d="M ${lipLineStartX} ${lipLineY} Q ${mouthCenterX} ${lipLineY + lipLineCurve} ${lipLineEndX} ${lipLineY}" stroke="${lipEdge}" stroke-width="${Math.max(2, mouth.height * 0.04)}" stroke-linecap="round" fill="none" opacity="${clamp(0.18 + animatedMouthOpen * 0.18, 0.18, 0.42)}" />
  <rect x="${leftEye.x - leftEye.width * 0.18}" y="${leftEye.y - leftEye.height * 0.6}" width="${leftEye.width * 1.36}" height="${leftEye.height * (0.2 + blink * motion.portraitBlinkHeight)}" rx="${leftEye.height}" fill="${lidColor}" opacity="${blinkOpacity}" />
  <rect x="${rightEye.x - rightEye.width * 0.18}" y="${rightEye.y - rightEye.height * 0.6}" width="${rightEye.width * 1.36}" height="${rightEye.height * (0.2 + blink * motion.portraitBlinkHeight)}" rx="${rightEye.height}" fill="${lidColor}" opacity="${blinkOpacity}" />
</svg>`.trim();
}

export async function renderAnimatedPortraitFrames(options: {
  audioFileName: string;
  avatarFileName: string;
  durationSeconds: number;
  jobDir: string;
  motionPreset: MotionPreset;
}) {
  const frameCount = Math.max(
    36,
    Math.ceil(options.durationSeconds * SAMPLE_AVATAR_FPS) + 1,
  );
  const framesDir = path.join(options.jobDir, "avatar-frames");
  const avatarPath = path.join(options.jobDir, options.avatarFileName);
  const features = await detectPortraitFeatures(avatarPath);
  const envelope = await extractAudioEnvelope(
    options.jobDir,
    options.audioFileName,
    frameCount,
  );
  const avatarBuffer = await readFile(avatarPath);
  const dataUrl = `data:${inferImageMimeType(options.avatarFileName)};base64,${avatarBuffer.toString("base64")}`;
  const { Resvg } = requireFromHere("@resvg/resvg-js") as typeof import("@resvg/resvg-js");

  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const svg = renderPortraitFrameSvg({
      dataUrl,
      durationSeconds: options.durationSeconds,
      features,
      frameIndex,
      mouthOpen: envelope[frameIndex] ?? 0,
      motionPreset: options.motionPreset,
    });

    const png = new Resvg(svg, {
      fitTo: {
        mode: "width",
        value: AVATAR_WIDTH,
      },
    })
      .render()
      .asPng();

    await writeFile(
      path.join(framesDir, `frame-${String(frameIndex + 1).padStart(4, "0")}.png`),
      png,
    );
  }

  return {
    framesDir,
    frameRate: SAMPLE_AVATAR_FPS,
  };
}
