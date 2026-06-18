export type JobStatus = "queued" | "processing" | "completed" | "failed";

export type ThemeId = "ember" | "jade" | "graphite";
export type SampleAvatarId = "analyst-aurora" | "host-river";
export type MotionPreset = "natural" | "expressive";
export type RenderEngine = "fast" | "model";

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
