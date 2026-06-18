import { MotionPreset, RenderEngine, SampleAvatarOption, ThemeId } from "./types";

export const THEME_OPTIONS: Array<{
  id: ThemeId;
  name: string;
  description: string;
  swatch: string;
  frameColor: string;
  waveformColor: string;
  panelColor: string;
  backdropTint: string;
  textColor: string;
}> = [
  {
    id: "ember",
    name: "暖光舞台",
    description: "适合发布会和讲解场景",
    swatch: "linear-gradient(135deg, #ff8a3d 0%, #ffd277 100%)",
    frameColor: "0xFF8A3D",
    waveformColor: "0xFF9F57",
    panelColor: "0x151719@0.62",
    backdropTint: "0x27160F@0.56",
    textColor: "#f7d6b9",
  },
  {
    id: "jade",
    name: "青玉会议室",
    description: "清爽稳重的企业风格",
    swatch: "linear-gradient(135deg, #14b88f 0%, #d4f88b 100%)",
    frameColor: "0x14B88F",
    waveformColor: "0x7EF1C8",
    panelColor: "0x0F1717@0.62",
    backdropTint: "0x10231F@0.56",
    textColor: "#caf6e7",
  },
  {
    id: "graphite",
    name: "石墨控制台",
    description: "偏深色的运营控制风格",
    swatch: "linear-gradient(135deg, #6f7782 0%, #dde3ea 100%)",
    frameColor: "0xB4BDC8",
    waveformColor: "0xD3DCE5",
    panelColor: "0x111315@0.64",
    backdropTint: "0x161A20@0.54",
    textColor: "#e8edf2",
  },
];

export const THEME_MAP = Object.fromEntries(
  THEME_OPTIONS.map((theme) => [theme.id, theme]),
) as Record<ThemeId, (typeof THEME_OPTIONS)[number]>;

export const SCRIPT_PRESETS = [
  {
    title: "新品说明",
    script:
      "大家好，今天向你介绍我们的本地数字人视频工具。你只需要上传一张头像，输入一段脚本，系统就会自动生成一条带字幕和音频的讲解视频。第一版主打低成本、可私有化和易扩展，后续可以继续接入更强的口型驱动模型。",
  },
  {
    title: "客户培训",
    script:
      "欢迎来到新版本上手培训。本次更新重点优化了任务状态、字幕渲染和批量出片能力。建议你先用三十秒以内的短文案验证模板，再逐步扩展到系列课程内容。",
  },
  {
    title: "英文演示",
    script:
      "Welcome to the local digital human studio. Upload a portrait, paste a script, and generate a presenter video without paying for a third party API on day one. This version is designed to help teams validate the workflow before connecting advanced avatar models.",
  },
];

export const PIPELINE_STEPS = [
  "创建本地任务并保存头像素材",
  "使用 macOS say 生成语音，后续可替换为本地 TTS 模型",
  "自动拆分文案并生成字幕时间轴",
  "用 ffmpeg 合成数字人画面、波形和字幕",
  "导出 MP4，便于预览、下载和后续交付",
];

export const STATUS_LABELS = {
  queued: "排队中",
  processing: "生成中",
  completed: "已完成",
  failed: "失败",
} as const;

export const MOTION_OPTIONS: Array<{
  id: MotionPreset;
  name: string;
  description: string;
}> = [
  {
    id: "natural",
    name: "自然",
    description: "动作更克制，适合正式讲解和培训",
  },
  {
    id: "expressive",
    name: "增强",
    description: "嘴型和面部动作更明显，更有表现力",
  },
];

export const MOTION_LABELS: Record<MotionPreset, string> = {
  natural: "自然动效",
  expressive: "增强动效",
};

export const RENDER_ENGINE_OPTIONS: Array<{
  id: RenderEngine;
  name: string;
  description: string;
}> = [
  {
    id: "fast",
    name: "极速预览",
    description: "本地几何动效，速度快，但只适合低保真预览",
  },
  {
    id: "model",
    name: "高质量模型",
    description: "使用本地 SadTalker，口型和表情更自然，需要先配置模型",
  },
];

export const RENDER_ENGINE_LABELS: Record<RenderEngine, string> = {
  fast: "极速预览",
  model: "高质量模型",
};

export const RECOMMENDED_VOICES = [
  "Ting-Ting",
  "Sin-ji",
  "Mei-Jia",
  "Samantha",
  "Karen",
  "Daniel",
];

export const SAMPLE_AVATARS: SampleAvatarOption[] = [
  {
    id: "analyst-aurora",
    name: "极光",
    description: "适合发布和宣讲的暖场讲解人",
    src: "/avatars/analyst-aurora.png",
  },
  {
    id: "host-river",
    name: "溪流",
    description: "适合培训和说明的沉稳主持人",
    src: "/avatars/host-river.png",
  },
];

export const SAMPLE_AVATAR_MAP = Object.fromEntries(
  SAMPLE_AVATARS.map((avatar) => [avatar.id, avatar]),
) as Record<(typeof SAMPLE_AVATARS)[number]["id"], SampleAvatarOption>;
