import { access, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { renderAnimatedPortraitFrames, renderAnimatedSampleFrames } from "./avatar-motion";
import { RECOMMENDED_VOICES, THEME_MAP } from "./constants";
import { runCommand } from "./render-process";
import { listEdgeTtsVoices, synthesizeEdgeTtsSpeech } from "./tts";
import { slugifyFileExtension } from "./utils";
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

// 探测图像/视频的宽高（取首个视频流），用于判断是否需要在送入 MuseTalk 前
// 缩放以提速。ffprobe 对单张图片也能返回宽高（当作单帧视频）。
async function probeVideoDimension(jobDir: string, fileName: string) {
  const output = await runCommand(
    "ffprobe",
    [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      fileName,
    ],
    { cwd: jobDir },
  );

  const parsed = JSON.parse(output) as {
    streams?: Array<{ width?: number; height?: number }>;
  };
  const stream = parsed.streams?.[0];
  const width = stream?.width ?? 0;
  const height = stream?.height ?? 0;
  // 读不到尺寸通常意味着文件损坏或不是有效图片/视频。与其让 MuseTalk
  // 在后续拿到一个不可用的输入再以晦涩的 division by zero 失败，这里直接抛错。
  if (!width || !height) {
    throw new Error("无法读取头像/视频的尺寸，文件可能损坏或不是有效的图片/视频。");
  }

  return Math.max(width, height);
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
  // 自定义角标文案，默认"本地口型模型 · voice"。MuseTalk 等其他口型引擎复用
  // 此模板时传入各自文案，避免重复一大段 filter_complex 代码。
  label?: string;
}) {
  const theme = THEME_MAP[options.theme];
  const title = escapeDrawtext(options.title);
  const label = escapeDrawtext(options.label ?? `本地口型模型 · ${options.voice}`);
  const filter = [
    `color=c=${solidColor(theme.backdropTint)}:s=1280x720:r=25[bg];`,
    // 口型视频尺寸不固定（SadTalker 512x512，MuseTalk 按底片原尺寸），
    // 用 decrease 完整放入再 pad 到 520x580，避免裁掉人脸。
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
  // size 由 SADTALKER_SIZE 控制（256/512），默认 512：原生分辨率翻倍，
  // 配合 GFPGAN 面部增强，画质显著优于 256。显存足够时建议用 512。
  const device = process.env.SADTALKER_DEVICE || "gpu";
  const size = process.env.SADTALKER_SIZE || "512";
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
    size,
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

export async function renderMuseTalkPresenterVideo(options: {
  avatarFileName: string;
  jobDir: string;
  theme: ThemeId;
  title: string;
  voice: string;
  avatarMediaType: "image" | "video";
}) {
  const musetalkDir = process.env.MUSETALK_DIR;
  const pythonBin = process.env.MUSETALK_PYTHON || "python";
  // MuseTalk 用 os.system 调 ffmpeg 抽帧/合帧，必须显式给 ffmpeg bin 目录，
  // 否则在 PATH 未刷新的会话里抽帧失败（division by zero）。
  const ffmpegPath = process.env.MUSETALK_FFMPEG_PATH || process.env.FFMPEG_BIN || "";
  const gpuId = process.env.MUSETALK_GPU_ID ?? "0";

  if (!musetalkDir) {
    throw new Error(
      "MuseTalk 未配置。请先设置 MUSETALK_DIR（MuseTalk 仓库目录）和 MUSETALK_PYTHON（Python 解释器），或切换为其他引擎。",
    );
  }

  const sourcePath = path.join(options.jobDir, options.avatarFileName);
  // MuseTalk 通过 whisper/librosa 读音频，wav 最稳。
  const wavPath = path.join(options.jobDir, "speech.wav");
  const resultDir = path.join(options.jobDir, "musetalk-out");

  await assertReadableFile(path.join(musetalkDir, "scripts", "inference.py"), "MuseTalk 推理脚本");
  await assertReadableFile(sourcePath, "头像/视频文件");

  // MuseTalk 对大图极慢：处理复杂度与图像尺寸强相关（DWPose 人脸检测 + VAE 编码 +
  // 逐帧生成都在原图尺寸上算）。手机原图常达 2000+ 像素，会让 2 分钟的任务拖到 1 小时。
  // 这里在送入 MuseTalk 前把长边缩到 1280（仍远大于 MuseTalk 实际处理的 256 脸部区域，
  // 不影响口型质量），大幅提速并降低内存峰值。
  const maxSize = Number(process.env.MUSETALK_MAX_DIMENSION ?? "1280");
  let sourceForMuseTalk = options.avatarFileName;
  const sourceWidth = await probeVideoDimension(
    options.jobDir,
    options.avatarFileName,
  );
  if (sourceWidth > maxSize) {
    const scaledFileName = `avatar_musetalk${slugifyFileExtension(
      options.avatarFileName,
    )}`;
    await runCommand(
      "ffmpeg",
      [
        "-y",
        "-i",
        options.avatarFileName,
        "-vf",
        // 限制"长边"而非仅宽度：竖图（手机自拍常态）宽度往往 < 1280，
        // 旧表达式 scale='min(1280,iw)':-2 此时是 no-op，竖图根本没被缩小。
        // 给宽高各设 maxSize 上限 + force_original_aspect_ratio=decrease：
        // 长边精确落到 maxSize、保持宽高比、且不会放大小图。
        `scale='min(${maxSize},iw)':'min(${maxSize},ih)':force_original_aspect_ratio=decrease`,
        "-q:v",
        "2",
        scaledFileName,
      ],
      { cwd: options.jobDir },
    );
    sourceForMuseTalk = scaledFileName;
  }
  const sourcePathForMuseTalk = path.join(options.jobDir, sourceForMuseTalk);
  // 仅在确实做了缩放时才需要清理临时文件（与原文件同名则不动）。
  const scaledTempPath =
    sourceForMuseTalk !== options.avatarFileName ? sourcePathForMuseTalk : null;

  // MuseTalk 的 inference.py 不接受 --video_path/--audio_path 命令行参数，
  // 输入通过 --inference_config 指向一个 yaml（task_0: {video_path, audio_path}）。
  // video_path 接受视频或单张图片（图片模式会单帧重复用）。
  const configPath = path.join(options.jobDir, "musetalk_task.yaml");

  // 结果落在 result_dir/v15/<input>_<audio>.mp4。--ffmpeg_path 给抽帧用的 ffmpeg 目录。
  const musetalkArgs = [
    "-m",
    "scripts.inference",
    "--inference_config",
    configPath,
    "--result_dir",
    resultDir,
    "--unet_model_path",
    path.join(musetalkDir, "models", "musetalkV15", "unet.pth"),
    "--unet_config",
    path.join(musetalkDir, "models", "musetalkV15", "musetalk.json"),
    "--whisper_dir",
    path.join(musetalkDir, "models", "whisper"),
    "--vae_type",
    "sd-vae",
    "--version",
    "v15",
    "--gpu_id",
    gpuId,
  ];

  if (ffmpegPath) {
    musetalkArgs.push("--ffmpeg_path", ffmpegPath);
  }

  try {
    await runCommand(
      "ffmpeg",
      ["-y", "-i", "speech.m4a", "-ac", "1", "-ar", "16000", "speech.wav"],
      { cwd: options.jobDir },
    );
    await assertReadableFile(wavPath, "WAV 音频");

    // Windows 路径反斜杠在 yaml 里需转义，统一用正斜杠。
    const configContent = [
      "task_0:",
      `  video_path: "${sourcePathForMuseTalk.replace(/\\/g, "/")}"`,
      `  audio_path: "${wavPath.replace(/\\/g, "/")}"`,
    ].join("\n");
    await writeFile(configPath, configContent, "utf8");

    await runCommand(pythonBin, musetalkArgs, { cwd: musetalkDir });
  } finally {
    // 缩放后的底片仅用于本次推理，推理结束（无论成败）即删除，避免逐任务堆积。
    if (scaledTempPath) {
      await rm(scaledTempPath, { force: true });
    }
  }

  await runCommand(pythonBin, musetalkArgs, { cwd: musetalkDir });

  // MuseTalk 输出到 result_dir/v15/ 下，取该目录唯一 mp4 作为口型源。
  const talkingHeadRelative = await pickLatestMp4(
    path.join(resultDir, "v15"),
    options.jobDir,
  );
  if (!talkingHeadRelative) {
    throw new Error("MuseTalk 未生成可用的口型视频，请检查模型是否完整。");
  }

  return renderTalkingHeadPresenterVideo({
    jobDir: options.jobDir,
    talkingHeadFileName: talkingHeadRelative,
    title: options.title,
    voice: options.voice,
    theme: options.theme,
    label: `实时口型 · ${options.voice}`,
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
