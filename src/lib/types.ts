export type JobStatus = "queued" | "processing" | "completed" | "failed";

export type ThemeId = "ember" | "jade" | "graphite";
export type SampleAvatarId = "analyst-aurora" | "host-river";
export type MotionPreset = "natural" | "expressive";
export type RenderEngine = "fast" | "model" | "musetalk";

export interface VoiceOption {
  name: string;
  locale: string;
  sample: string;
}

export interface SampleAvatarOption {
  id: SampleAvatarId;
  name: string;
  description: string;
  src: string;
}

export interface JobLog {
  at: string;
  message: string;
}

export interface JobProgress {
  percent: number;
  stage: string;
  detail: string;
}

export interface VideoJob {
  id: string;
  title: string;
  script: string;
  voice: string;
  theme: ThemeId;
  motionPreset?: MotionPreset;
  renderEngine?: RenderEngine;
  avatarMode: "upload" | "sample";
  // MuseTalk 引擎支持上传视频底片，用于区分图片/视频处理（仅 musetalk 引擎可能为 video）。
  avatarMediaType?: "image" | "video";
  sampleAvatarId?: SampleAvatarId;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  avatarUrl: string;
  audioUrl?: string;
  subtitlesUrl?: string;
  videoUrl?: string;
  durationSeconds?: number;
  errorMessage?: string;
  progress: JobProgress;
  providers: {
    tts: string;
    render: string;
  };
  logs: JobLog[];
}

export interface SubtitleCue {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
}
