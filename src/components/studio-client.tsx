"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";

import {
  MOTION_LABELS,
  MOTION_OPTIONS,
  RENDER_ENGINE_LABELS,
  RENDER_ENGINE_OPTIONS,
  SAMPLE_AVATARS,
  SCRIPT_PRESETS,
  STATUS_LABELS,
  THEME_OPTIONS,
} from "@/lib/constants";
import {
  MotionPreset,
  RenderEngine,
  SampleAvatarId,
  ThemeId,
  VideoJob,
  VoiceOption,
} from "@/lib/types";
import { cn, formatDuration, formatRelativeTime } from "@/lib/utils";

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, {
    cache: "no-store",
    ...init,
  });
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? "请求失败");
  }

  return payload;
}

export function StudioClient() {
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [title, setTitle] = useState("本地数字人演示");
  const [script, setScript] = useState(SCRIPT_PRESETS[0].script);
  const [theme, setTheme] = useState<ThemeId>("ember");
  const [motionPreset, setMotionPreset] = useState<MotionPreset>("natural");
  const [renderEngine, setRenderEngine] = useState<RenderEngine>("model");
  const [voice, setVoice] = useState("");
  const [sampleAvatarId, setSampleAvatarId] =
    useState<SampleAvatarId>("analyst-aurora");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [formError, setFormError] = useState("");
  const [isPending, startTransition] = useTransition();

  const activeJob =
    jobs.find((job) => job.status === "processing" || job.status === "queued") ??
    jobs[0] ??
    null;

  const avatarPreviewUrl = useMemo(
    () =>
      avatarFile
        ? URL.createObjectURL(avatarFile)
        : SAMPLE_AVATARS.find((avatar) => avatar.id === sampleAvatarId)?.src || "",
    [avatarFile, sampleAvatarId],
  );

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const [jobsPayload, voicesPayload] = await Promise.all([
        fetchJson<{ jobs: VideoJob[] }>("/api/jobs"),
        fetchJson<{ voices: VoiceOption[] }>("/api/voices"),
      ]);

      if (cancelled) {
        return;
      }

      startTransition(() => {
        setJobs(jobsPayload.jobs);
        setVoices(voicesPayload.voices);
        setVoice((current) => current || voicesPayload.voices[0]?.name || "zh-CN-XiaoxiaoNeural");
      });
    }

    void bootstrap();

    const timer = window.setInterval(() => {
      void fetchJson<{ jobs: VideoJob[] }>("/api/jobs")
        .then((payload) => {
          if (cancelled) {
            return;
          }

          startTransition(() => {
            setJobs(payload.jobs);
          });
        })
        .catch(() => undefined);
    }, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [startTransition]);

  useEffect(() => {
    return () => {
      if (avatarPreviewUrl) {
        URL.revokeObjectURL(avatarPreviewUrl);
      }
    };
  }, [avatarPreviewUrl]);

  async function refreshJobs() {
    const payload = await fetchJson<{ jobs: VideoJob[] }>("/api/jobs");
    startTransition(() => {
      setJobs(payload.jobs);
    });
  }

  // 切换渲染引擎：仅「实时口型」支持视频，切到其他引擎时若当前选中的是视频，
  // 就清空它（否则旧选择会残留并在提交时被服务器拒绝）。图片对所有引擎有效，保留。
  function handleEngineChange(next: RenderEngine) {
    if (next !== "musetalk" && avatarFile?.type.startsWith("video/")) {
      setAvatarFile(null);
    }
    setRenderEngine(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");

    // 实时口型（MuseTalk）依赖真人脸检测，必须上传照片或视频；
    // 内置数字人是 SVG 几何角色，检测不到人脸。提交前拦截避免无效任务。
    if (renderEngine === "musetalk" && !avatarFile) {
      setFormError(
        "「实时口型」需要上传真人照片或视频（内置数字人是几何角色，检测不到人脸，无法用于口型同步）。请先在上方选择文件。",
      );
      return;
    }

    // 引擎与文件类型一致性校验，规则与后端 route.ts 保持一致：
    // 仅「实时口型」允许视频，其他引擎只接受图片，避免到提交才被服务器拒绝。
    if (avatarFile) {
      const isImage = avatarFile.type.startsWith("image/");
      const isVideo = avatarFile.type.startsWith("video/");
      if (!isImage && !(isVideo && renderEngine === "musetalk")) {
        setFormError(
          renderEngine === "musetalk"
            ? "仅支持图片或视频文件。"
            : "该引擎仅支持图片，上传视频请切换到「实时口型（MuseTalk）」引擎。",
        );
        return;
      }
    }

    const formData = new FormData();
    formData.set("title", title);
    formData.set("script", script);
    formData.set("theme", theme);
    formData.set("motionPreset", motionPreset);
    formData.set("renderEngine", renderEngine);
    formData.set("voice", voice);
    formData.set("sampleAvatarId", sampleAvatarId);

    if (avatarFile) {
      formData.set("avatar", avatarFile);
    }

    startTransition(async () => {
      try {
        await fetchJson<{ job: VideoJob }>("/api/jobs", {
          method: "POST",
          body: formData,
        });

        await refreshJobs();
      } catch (error) {
        setFormError(
          error instanceof Error ? error.message : "创建渲染任务失败，请稍后重试。",
        );
      }
    });
  }

  return (
    <section className="studio-grid">
      <form className="surface composer" onSubmit={handleSubmit}>
        <div className="section-heading">
          <p>创建任务</p>
          <strong>头像生成视频</strong>
        </div>

        <label className="field">
          <span>视频标题</span>
          <input
            className="text-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：季度产品介绍"
          />
        </label>

        <div className="field">
          <span>脚本模板</span>
          <div className="preset-row">
            {SCRIPT_PRESETS.map((preset) => (
              <button
                className="ghost-button"
                key={preset.title}
                onClick={() => {
                  setTitle(preset.title);
                  setScript(preset.script);
                }}
                type="button"
              >
                {preset.title}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span>讲解文案</span>
          <textarea
            className="text-area"
            value={script}
            onChange={(event) => setScript(event.target.value)}
            rows={9}
            placeholder="请在这里输入或粘贴讲解文案"
          />
        </label>

        <div className="field">
          <span>画面主题</span>
          <div className="theme-grid">
            {THEME_OPTIONS.map((option) => (
              <button
                className={cn(
                  "theme-chip",
                  theme === option.id && "theme-chip-active",
                )}
                key={option.id}
                onClick={() => setTheme(option.id)}
                type="button"
              >
                <span
                  className="swatch"
                  style={{ background: option.swatch }}
                />
                <strong>{option.name}</strong>
                <small>{option.description}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>动效模式</span>
          <div className="motion-grid">
            {MOTION_OPTIONS.map((option) => (
              <button
                className={cn(
                  "motion-chip",
                  motionPreset === option.id && "motion-chip-active",
                )}
                key={option.id}
                onClick={() => setMotionPreset(option.id)}
                type="button"
              >
                <strong>{option.name}</strong>
                <small>{option.description}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>渲染引擎</span>
          <div className="motion-grid">
            {RENDER_ENGINE_OPTIONS.map((option) => (
              <button
                className={cn(
                  "motion-chip",
                  renderEngine === option.id && "motion-chip-active",
                )}
                key={option.id}
                onClick={() => handleEngineChange(option.id)}
                type="button"
              >
                <strong>{option.name}</strong>
                <small>{option.description}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="inline-fields">
          <label className="field">
            <span>语音音色</span>
            <select
              className="text-input"
              value={voice}
              onChange={(event) => setVoice(event.target.value)}
            >
              {voices.map((option) => (
                <option key={`${option.name}-${option.locale}`} value={option.name}>
                  {option.name} · {option.locale}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>上传头像{renderEngine === "musetalk" ? "或视频" : ""}</span>
            <input
              className="file-input"
              accept={renderEngine === "musetalk" ? "image/*,video/*" : "image/*"}
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setAvatarFile(file);
              }}
              type="file"
            />
            {avatarFile && (
              <small className="helper-text" style={{ marginTop: 6 }}>
                已选择：{avatarFile.name}（{avatarFile.type}）
              </small>
            )}
          </label>
        </div>

        {renderEngine !== "musetalk" && (
          <div className="field">
            <span>内置数字人</span>
            <div className="avatar-sample-grid">
              {SAMPLE_AVATARS.map((avatar) => (
                <button
                  className={cn(
                    "avatar-sample-card",
                    sampleAvatarId === avatar.id && "avatar-sample-card-active",
                  )}
                  key={avatar.id}
                  onClick={() => setSampleAvatarId(avatar.id)}
                  type="button"
                >
                  <Image
                    alt={avatar.name}
                    className="avatar-sample-image"
                    height={200}
                    sizes="(max-width: 760px) 100vw, 240px"
                    src={avatar.src}
                    width={200}
                  />
                  <strong>{avatar.name}</strong>
                  <small>{avatar.description}</small>
                </button>
              ))}
            </div>
          </div>
        )}

        {avatarPreviewUrl ? (
          <div className="avatar-preview">
            {avatarFile?.type.startsWith("video/") ? (
              <video
                className="avatar-stage"
                src={avatarPreviewUrl}
                controls
                muted
              />
            ) : (
              <Image
                alt="头像预览"
                className="avatar-stage"
                height={720}
                sizes="(max-width: 760px) 100vw, 50vw"
                src={avatarPreviewUrl}
                unoptimized
                width={1280}
              />
            )}
          </div>
        ) : (
          <div className="avatar-placeholder">
            请选择内置数字人，或上传你自己的头像
            {renderEngine === "musetalk" ? "或视频" : ""}。
          </div>
        )}

        <p className="helper-text">
          {renderEngine === "musetalk"
            ? "「实时口型」支持上传照片或视频：照片会生成口型视频；视频则保留原画面动作、仅替换嘴部配音（适合给已有视频重配音）。"
            : "上传真人头像建议使用「高质量模型」（本地 SadTalker）。「极速预览」只适合快速验证流程，不能保证真人口型和表情自然。"}
        </p>

        {formError ? <p className="form-error">{formError}</p> : null}

        <button className="primary-button" disabled={isPending} type="submit">
          {isPending ? "正在提交任务..." : "生成视频"}
        </button>
      </form>

      <section className="surface monitor">
        <div className="section-heading">
          <p>任务队列</p>
          <strong>本地任务</strong>
        </div>

        {activeJob ? (
          <article className="active-job">
            <div className="job-header">
              <div>
                <h2>{activeJob.title}</h2>
                <p>
                  {STATUS_LABELS[activeJob.status]} · {formatRelativeTime(activeJob.updatedAt)}
                </p>
              </div>
              <span className={`status-pill status-${activeJob.status}`}>
                {activeJob.progress.percent}%
              </span>
            </div>

            <div className="progress-rail">
              <div
                className="progress-fill"
                style={{ width: `${activeJob.progress.percent}%` }}
              />
            </div>

            <div className="job-meta">
              <span>{activeJob.voice}</span>
              <span>{formatDuration(activeJob.durationSeconds)}</span>
              <span>{activeJob.providers.render}</span>
              <span>{RENDER_ENGINE_LABELS[activeJob.renderEngine ?? "fast"]}</span>
              <span>{MOTION_LABELS[activeJob.motionPreset ?? "natural"]}</span>
              <span>{activeJob.avatarMode === "upload" ? "上传头像" : "内置数字人"}</span>
            </div>

            <p className="job-detail">{activeJob.progress.detail}</p>
            {activeJob.errorMessage ? (
              <p className="form-error">{activeJob.errorMessage}</p>
            ) : null}

            {activeJob.videoUrl ? (
              <video
                className="video-player"
                controls
                preload="metadata"
                src={activeJob.videoUrl}
              />
            ) : activeJob.avatarMediaType === "video" ? (
              <video
                className="avatar-stage"
                controls
                preload="metadata"
                src={activeJob.avatarUrl}
              />
            ) : (
              <Image
                alt={activeJob.title}
                className="avatar-stage"
                height={720}
                sizes="(max-width: 760px) 100vw, 40vw"
                src={activeJob.avatarUrl}
                unoptimized
                width={1280}
              />
            )}

            <div className="job-links">
              {activeJob.videoUrl ? (
                <a className="ghost-button" href={activeJob.videoUrl}>
                  打开视频
                </a>
              ) : null}
              {activeJob.audioUrl ? (
                <a className="ghost-button" href={activeJob.audioUrl}>
                  打开音频
                </a>
              ) : null}
              {activeJob.subtitlesUrl ? (
                <a className="ghost-button" href={activeJob.subtitlesUrl}>
                  打开字幕
                </a>
              ) : null}
            </div>
          </article>
        ) : (
          <div className="empty-state">
            还没有任务，生成第一条视频后会显示在这里。
          </div>
        )}

        <div className="job-list">
          {jobs.map((job) => (
            <article className="job-row" key={job.id}>
              <div className="job-row-main">
                <strong>{job.title}</strong>
                <span>
                  {STATUS_LABELS[job.status]} · {job.voice} · {formatRelativeTime(job.createdAt)}
                </span>
              </div>
              <span className={`status-dot status-${job.status}`} />
            </article>
          ))}
        </div>

        <div className="provider-strip">
          <div>
            <span>语音合成</span>
            <strong>{activeJob?.providers.tts ?? "Edge-TTS"}</strong>
          </div>
          <div>
            <span>视频合成</span>
            <strong>ffmpeg 本地渲染</strong>
          </div>
          <div>
            <span>高质量口型</span>
            <strong>本地 SadTalker</strong>
          </div>
        </div>
      </section>
    </section>
  );
}
