import { access, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { renderAnimatedPortraitFrames, renderAnimatedSampleFrames } from "./avatar-motion";
import { RECOMMENDED_VOICES, THEME_MAP } from "./constants";
import { runCommand } from "./render-process";
import { listEdgeTtsVoices, synthesizeEdgeTtsSpeech } from "./tts";
import {
  MotionPreset,
  SampleAvatarId,
  SubtitleCue,
  ThemeId,
} from "./types";

// 字体：macOS 用华文黑体，Windows 用黑体（SimHei）。
// 通过平台判断切换，避免硬编码单一平台路径。
// 注意：用 simhei.ttf（单 TTF）而非 msyh.ttc（TTC 集合），因为 ffmpeg 的
// drawtext 和 libass subtitles 对 TTC 集合字体的 face 选择不可控，易渲染异常。
// drawtext 的 fontfile 在 Windows 下需转义盘符冒号。
const IS_WINDOWS = process.platform === "win32";
const VIDEO_FONT_FILE = IS_WINDOWS
  ? "C\\:/Windows/Fonts/simhei.ttf"
  : "/System/Library/Fonts/STHeiti Medium.ttc";
const VIDEO_FONT_NAME = IS_WINDOWS ? "SimHei" : "STHeiti";

export async function listSystemVoices() {
  // 原实现调用 macOS `say -v "?"`；跨平台改用 Edge-TTS 音色列表。
  const voices = await listEdgeTtsVoices();

  voices.sort((left, right) => {
    const leftRank = RECOMMENDED_VOICES.indexOf(left.name);
    const rightRank = RECOMMENDED_VOICES.indexOf(right.name);

    if (leftRank === -1 && rightRank === -1) {
      return left.name.localeCompare(right.name);
    }

    if (leftRank === -1) {
      return 1;
    }

    if (rightRank === -1) {
      return -1;
    }

    return leftRank - rightRank;
  });

  return voices.slice(0, 24);
}

export async function synthesizeSpeech(
  jobDir: string,
  voice: string,
  script: string,
) {
  // 原实现用 macOS `say` 生成 aiff 再转 m4a；改用 Edge-TTS 直接合成 mp3，
  // 再用 ffmpeg 转成 m4a，保持下游（showwaves、probeDuration 等）契约不变。
  await synthesizeEdgeTtsSpeech(jobDir, voice, script, "speech.mp3");

  await runCommand(
    "ffmpeg",
    ["-y", "-i", "speech.mp3", "-c:a", "aac", "-b:a", "192k", "speech.m4a"],
    { cwd: jobDir },
  );

  const durationSeconds = await probeDuration(jobDir, "speech.m4a");

  return {
    audioFileName: "speech.m4a",
    durationSeconds,
  };
}

async function probeDuration(jobDir: string, fileName: string) {
  const output = await runCommand(
    "ffprobe",
    [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      fileName,
    ],
    { cwd: jobDir },
  );

  const parsed = JSON.parse(output) as {
    format?: {
      duration?: string;
    };
  };

  return Number(parsed.format?.duration ?? 0);
}

function splitScriptIntoLines(script: string) {
  const segments = script
    .replace(/\r/g, "")
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[。！？.!?；;])/))
    .map((line) => line.trim())
    .filter(Boolean);

  if (segments.length > 0) {
    return segments;
  }

  return script
    .match(/.{1,28}/g)
    ?.map((line) => line.trim())
    .filter(Boolean) ?? [script.trim()];
}

export function buildSubtitles(script: string, durationSeconds: number) {
  const lines = splitScriptIntoLines(script);
  const totalWeight = lines.reduce((sum, line) => sum + Math.max(6, line.length), 0);
  const baseSeconds = durationSeconds > lines.length * 1.1 ? 0.8 : 0;
  const distributable = Math.max(durationSeconds - baseSeconds * lines.length, 0.01);

  let cursor = 0;

  return lines.map((line, index) => {
    const weight = Math.max(6, line.length);
    const proportional = distributable * (weight / totalWeight);
    const startSeconds = cursor;
    const endSeconds =
      index === lines.length - 1
        ? durationSeconds
        : Math.min(durationSeconds, cursor + baseSeconds + proportional);

    cursor = endSeconds;

    return {
      index: index + 1,
      startSeconds,
      endSeconds,
      text: line,
    } satisfies SubtitleCue;
  });
}

function formatSrtTime(seconds: number) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;

  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${secs.toString().padStart(2, "0")},${millis
    .toString()
    .padStart(3, "0")}`;
}

export async function writeSubtitleFile(jobDir: string, cues: SubtitleCue[]) {
  const content = cues
    .map((cue) => {
      const safeText = cue.text.replace(/\n/g, " ");
      return `${cue.index}\n${formatSrtTime(cue.startSeconds)} --> ${formatSrtTime(
        cue.endSeconds,
      )}\n${safeText}\n`;
    })
    .join("\n");

  await writeFile(`${jobDir}/captions.srt`, content, "utf8");
  return "captions.srt";
}

function escapeDrawtext(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/%/g, "\\%");
}

function solidColor(hexWithAlpha: string) {
  return hexWithAlpha.split("@")[0];
}

export async function renderPresenterVideo(options: {
  jobDir: string;
  avatarFileName: string;
  title: string;
  voice: string;
  theme: ThemeId;
}) {
  const theme = THEME_MAP[options.theme];
  const title = escapeDrawtext(options.title);
  const label = escapeDrawtext(`本地渲染 · ${options.voice}`);
  const filter = [
    `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,boxblur=32:10[bg];`,
    `[bg]drawbox=x=0:y=0:w=iw:h=ih:color=${theme.backdropTint}:t=fill[bg_tint];`,
    `[0:v]scale=520:580:force_original_aspect_ratio=increase,crop=520:580,format=rgba[fg];`,
    `[1:a]aformat=channel_layouts=mono,showwaves=s=980x120:mode=line:colors=${theme.waveformColor},format=rgba[waves];`,
    `[bg_tint]drawbox=x=110:y=78:w=1060:h=564:color=${theme.panelColor}:t=fill[panel];`,
    `[panel][fg]overlay=x='130+6*sin(t*0.8)':y='82+5*cos(t*0.65)'[stage];`,
    `[stage]drawbox=x=150:y=102:w=480:h=540:color=${theme.frameColor}:t=4[framed];`,
    `[framed][waves]overlay=x=150:y=560[with_waves];`,
    `[with_waves]drawtext=fontfile='${VIDEO_FONT_FILE}':text='${title}':fontcolor=white:fontsize=40:x=680:y=134[textured];`,
    `[textured]drawtext=fontfile='${VIDEO_FONT_FILE}':text='${label}':fontcolor=${theme.textColor}:fontsize=22:x=682:y=192[captioned];`,
    `[captioned]subtitles=captions.srt:force_style='FontName=${VIDEO_FONT_NAME},FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00333333,BackColour=&H66000000,BorderStyle=4,Outline=1,Shadow=0,MarginV=42,Alignment=2'[v]`,
  ].join("");

  await runCommand(
    "ffmpeg",
    [
      "-y",
      "-loop",
      "1",
      "-i",
      options.avatarFileName,
      "-i",
      "speech.m4a",
      "-filter_complex",
      filter,
      "-map",
      "[v]",
      "-map",
      "1:a",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-r",
      "25",
      "-shortest",
      "final.mp4",
    ],
    {
      cwd: options.jobDir,
    },
  );

  return "final.mp4";
}

async function assertReadableFile(filePath: string, label: string) {
  try {
    await access(filePath);
  } catch {
    throw new Error(`${label}不可访问：${filePath}`);
  }
}

async function renderTalkingHeadPresenterVideo(options: {
  jobDir: string;
  talkingHeadFileName: string;
  title: string;
  voice: string;
  theme: ThemeId;
}) {
  const theme = THEME_MAP[options.theme];
  const title = escapeDrawtext(options.title);
  const label = escapeDrawtext(`本地口型模型 · ${options.voice}`);
  const filter = [
    `color=c=${solidColor(theme.backdropTint)}:s=1280x720:r=25[bg];`,
    // SadTalker 输出是 512x512 正方形，用 decrease 完整放入再 pad，避免裁掉人脸。
    `[0:v]fps=25,scale=520:580:force_original_aspect_ratio=decrease,pad=520:580:(ow-iw)/2:(oh-ih)/2:color=black@0[fg];`,
    `[1:a]aformat=channel_layouts=mono,showwaves=s=980x120:mode=line:colors=${theme.waveformColor},format=rgba[waves];`,
    `[bg]drawbox=x=110:y=78:w=1060:h=564:color=${theme.panelColor}:t=fill[panel];`,
    `[panel][fg]overlay=x=130:y=82[stage];`,
    `[stage]drawbox=x=130:y=82:w=520:h=580:color=${theme.frameColor}:t=4[framed];`,
    `[framed][waves]overlay=x=150:y=560[with_waves];`,
    `[with_waves]drawtext=fontfile='${VIDEO_FONT_FILE}':text='${title}':fontcolor=white:fontsize=38:x=690:y=134[textured];`,
    `[textured]drawtext=fontfile='${VIDEO_FONT_FILE}':text='${label}':fontcolor=${theme.textColor}:fontsize=22:x=692:y=190[captioned];`,
    `[captioned]subtitles=captions.srt:force_style='FontName=${VIDEO_FONT_NAME},FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00333333,BackColour=&H66000000,BorderStyle=4,Outline=1,Shadow=0,MarginV=42,Alignment=2'[v]`,
  ].join("");

  await runCommand(
    "ffmpeg",
    [
      "-y",
      "-i",
      options.talkingHeadFileName,
      "-i",
      "speech.m4a",
      "-filter_complex",
      filter,
      "-map",
      "[v]",
      "-map",
      "1:a",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-r",
      "25",
      "-shortest",
      "final.mp4",
    ],
    {
      cwd: options.jobDir,
    },
  );

  return "final.mp4";
}

export async function renderModelPortraitPresenterVideo(options: {
  avatarFileName: string;
  jobDir: string;
  theme: ThemeId;
  title: string;
  voice: string;
}) {
  const sadtalkerDir = process.env.SADTALKER_DIR;
  const pythonBin = process.env.SADTALKER_PYTHON || "python3";
  // 空字符串表示显式关闭增强器（CPU 上 gfpgan 极慢）；仅未设置时才默认 gfpgan。
  const enhancerRaw = process.env.SADTALKER_ENHANCER;
  const enhancer =
    enhancerRaw === undefined ? "gfpgan" : enhancerRaw.trim();
  const preprocess = process.env.SADTALKER_PREPROCESS || "full";

  if (!sadtalkerDir) {
    throw new Error(
      "高质量模型未配置。请先设置 SADTALKER_DIR（SadTalker 仓库目录）和 SADTALKER_PYTHON（Python 解释器），或切换为“极速预览”。",
    );
  }

  const inferencePath = path.join(sadtalkerDir, "inference.py");
  const checkpointDir = path.join(sadtalkerDir, "checkpoints");
  const facePath = path.join(options.jobDir, options.avatarFileName);
  // SadTalker 通过 librosa 读取音频，统一转成 wav 最稳，避免 m4a 解码问题。
  const wavPath = path.join(options.jobDir, "speech.wav");
  const resultDir = path.join(options.jobDir, "sadtalker-out");

  await assertReadableFile(inferencePath, "SadTalker 推理脚本");
  await assertReadableFile(facePath, "头像文件");

  await runCommand(
    "ffmpeg",
    ["-y", "-i", "speech.m4a", "-ac", "1", "-ar", "16000", "speech.wav"],
    { cwd: options.jobDir },
  );
  await assertReadableFile(wavPath, "WAV 音频");

  // SadTalker 输出到 result_dir/<timestamp>/<timestamp>.mp4，
  // 这里用 --result_dir 指定目录，再在调用后取该目录下唯一 mp4 作为 talking-head 源。
  // enhancer 为空时不传 --enhancer，SadTalker 会跳过面部增强（CPU 上 gfpgan 极慢）。
  // 设备由 SADTALKER_DEVICE 控制：默认走 GPU（不传 --cpu，自动用 CUDA）；
  // 显式设为 cpu 时才传 --cpu。有 GPU 时推理速度提升数十倍。
  const device = process.env.SADTALKER_DEVICE || "gpu";
  const sadtalkerArgs = [
    inferencePath,
    "--driven_audio",
    wavPath,
    "--source_image",
    facePath,
    "--checkpoint_dir",
    checkpointDir,
    "--result_dir",
    resultDir,
    "--preprocess",
    preprocess,
    "--still",
    "--size",
    "256",
    "--verbose",
  ];

  if (device === "cpu") {
    sadtalkerArgs.push("--cpu");
  }

  if (enhancer) {
    sadtalkerArgs.push("--enhancer", enhancer);
  }

  await runCommand(pythonBin, sadtalkerArgs, { cwd: sadtalkerDir });

  const talkingHeadRelative = await pickLatestMp4(resultDir, options.jobDir);
  if (!talkingHeadRelative) {
    throw new Error("SadTalker 未生成可用的口型视频，请检查模型是否完整。");
  }

  return renderTalkingHeadPresenterVideo({
    jobDir: options.jobDir,
    talkingHeadFileName: talkingHeadRelative,
    title: options.title,
    voice: options.voice,
    theme: options.theme,
  });
}

// SadTalker 把成片落在 result_dir 下（文件名为时间戳）。返回相对 jobDir 的路径，
// 因为后续 ffmpeg 合成时 cwd=jobDir。
async function pickLatestMp4(resultDir: string, jobDir: string) {
  try {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(resultDir);
    const mp4s = entries.filter((name) => name.endsWith(".mp4"));

    if (mp4s.length === 0) {
      return null;
    }

    // 时间戳文件名，字典序最后一个即为最新。
    mp4s.sort();
    const resultDirRelative = path.relative(jobDir, resultDir);
    return path.join(resultDirRelative, mp4s[mp4s.length - 1]);
  } catch {
    return null;
  }
}

export async function renderAnimatedSamplePresenterVideo(options: {
  durationSeconds: number;
  jobDir: string;
  motionPreset: MotionPreset;
  sampleAvatarId: SampleAvatarId;
  theme: ThemeId;
  title: string;
  voice: string;
}) {
  const theme = THEME_MAP[options.theme];
  const title = escapeDrawtext(options.title);
  const label = escapeDrawtext(`内置数字人 · ${options.voice}`);
  const motion = await renderAnimatedSampleFrames({
    audioFileName: "speech.m4a",
    durationSeconds: options.durationSeconds,
    jobDir: options.jobDir,
    motionPreset: options.motionPreset,
    sampleAvatarId: options.sampleAvatarId,
  });
  const filter = [
    `color=c=${solidColor(theme.backdropTint)}:s=1280x720:r=25:d=${options.durationSeconds}[bg];`,
    `[0:v]fps=25,scale=520:580:force_original_aspect_ratio=increase,crop=520:580[fg];`,
    `[1:a]aformat=channel_layouts=mono,showwaves=s=980x120:mode=line:colors=${theme.waveformColor},format=rgba[waves];`,
    `[bg]drawbox=x=110:y=78:w=1060:h=564:color=${theme.panelColor}:t=fill[panel];`,
    `[panel][fg]overlay=x=130:y=82[stage];`,
    `[stage]drawbox=x=130:y=82:w=520:h=580:color=${theme.frameColor}:t=4[framed];`,
    `[framed][waves]overlay=x=150:y=560[with_waves];`,
    `[with_waves]drawtext=fontfile='${VIDEO_FONT_FILE}':text='${title}':fontcolor=white:fontsize=38:x=690:y=134[textured];`,
    `[textured]drawtext=fontfile='${VIDEO_FONT_FILE}':text='${label}':fontcolor=${theme.textColor}:fontsize=22:x=692:y=190[captioned];`,
    `[captioned]subtitles=captions.srt:force_style='FontName=${VIDEO_FONT_NAME},FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00333333,BackColour=&H66000000,BorderStyle=4,Outline=1,Shadow=0,MarginV=42,Alignment=2'[v]`,
  ].join("");

  try {
    await runCommand(
      "ffmpeg",
      [
        "-y",
        "-framerate",
        `${motion.frameRate}`,
        "-i",
        `${motion.framesDir}/frame-%04d.png`,
        "-i",
        "speech.m4a",
        "-filter_complex",
        filter,
        "-map",
        "[v]",
        "-map",
        "1:a",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-r",
        "25",
        "-shortest",
        "final.mp4",
      ],
      {
        cwd: options.jobDir,
      },
    );
  } finally {
    await rm(motion.framesDir, { recursive: true, force: true });
  }

  return "final.mp4";
}

export async function renderAnimatedPortraitPresenterVideo(options: {
  avatarFileName: string;
  durationSeconds: number;
  jobDir: string;
  motionPreset: MotionPreset;
  theme: ThemeId;
  title: string;
  voice: string;
}) {
  const theme = THEME_MAP[options.theme];
  const title = escapeDrawtext(options.title);
  const label = escapeDrawtext(`头像动效 · ${options.voice}`);
  const motion = await renderAnimatedPortraitFrames({
    audioFileName: "speech.m4a",
    avatarFileName: options.avatarFileName,
    durationSeconds: options.durationSeconds,
    jobDir: options.jobDir,
    motionPreset: options.motionPreset,
  });
  const filter = [
    `color=c=${solidColor(theme.backdropTint)}:s=1280x720:r=25:d=${options.durationSeconds}[bg];`,
    `[0:v]fps=25,scale=520:580:force_original_aspect_ratio=increase,crop=520:580[fg];`,
    `[1:a]aformat=channel_layouts=mono,showwaves=s=980x120:mode=line:colors=${theme.waveformColor},format=rgba[waves];`,
    `[bg]drawbox=x=110:y=78:w=1060:h=564:color=${theme.panelColor}:t=fill[panel];`,
    `[panel][fg]overlay=x=130:y=82[stage];`,
    `[stage]drawbox=x=130:y=82:w=520:h=580:color=${theme.frameColor}:t=4[framed];`,
    `[framed][waves]overlay=x=150:y=560[with_waves];`,
    `[with_waves]drawtext=fontfile='${VIDEO_FONT_FILE}':text='${title}':fontcolor=white:fontsize=38:x=690:y=134[textured];`,
    `[textured]drawtext=fontfile='${VIDEO_FONT_FILE}':text='${label}':fontcolor=${theme.textColor}:fontsize=22:x=692:y=190[captioned];`,
    `[captioned]subtitles=captions.srt:force_style='FontName=${VIDEO_FONT_NAME},FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00333333,BackColour=&H66000000,BorderStyle=4,Outline=1,Shadow=0,MarginV=42,Alignment=2'[v]`,
  ].join("");

  try {
    await runCommand(
      "ffmpeg",
      [
        "-y",
        "-framerate",
        `${motion.frameRate}`,
        "-i",
        `${motion.framesDir}/frame-%04d.png`,
        "-i",
        "speech.m4a",
        "-filter_complex",
        filter,
        "-map",
        "[v]",
        "-map",
        "1:a",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-r",
        "25",
        "-shortest",
        "final.mp4",
      ],
      {
        cwd: options.jobDir,
      },
    );
  } finally {
    await rm(motion.framesDir, { recursive: true, force: true });
  }

  return "final.mp4";
}
