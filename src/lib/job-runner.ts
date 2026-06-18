import { appendJobLog, ensureJobRenderDir, getJob, getPublicRenderUrl, updateJob } from "./store";
import {
  buildSubtitles,
  renderAnimatedPortraitPresenterVideo,
  renderAnimatedSamplePresenterVideo,
  renderModelPortraitPresenterVideo,
  renderPresenterVideo,
  synthesizeSpeech,
  writeSubtitleFile,
} from "./ffmpeg";
import { MOTION_LABELS, RENDER_ENGINE_LABELS } from "./constants";

const activeJobs = new Set<string>();

export function enqueueJob(jobId: string) {
  if (activeJobs.has(jobId)) {
    return;
  }

  activeJobs.add(jobId);

  void processJob(jobId).finally(() => {
    activeJobs.delete(jobId);
  });
}

async function processJob(jobId: string) {
  const job = await getJob(jobId);

  if (!job) {
    return;
  }

  const jobDir = await ensureJobRenderDir(jobId);

  try {
    await updateJob(jobId, (current) => ({
      ...current,
      status: "processing",
      updatedAt: new Date().toISOString(),
      progress: {
        percent: 18,
        stage: "speech",
        detail: "正在使用 macOS say 生成本地配音",
      },
    }));
    await appendJobLog(jobId, "开始生成语音");

    const audio = await synthesizeSpeech(jobDir, job.voice, job.script);

    await updateJob(jobId, (current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      audioUrl: getPublicRenderUrl(jobId, audio.audioFileName),
      durationSeconds: audio.durationSeconds,
      progress: {
        percent: 48,
        stage: "subtitles",
        detail: "正在根据文案生成字幕时间轴",
      },
    }));
    await appendJobLog(jobId, "语音生成完成");

    const subtitles = buildSubtitles(job.script, audio.durationSeconds);
    const subtitleFileName = await writeSubtitleFile(jobDir, subtitles);

    await updateJob(jobId, (current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      subtitlesUrl: getPublicRenderUrl(jobId, subtitleFileName),
      progress: {
        percent: 70,
        stage: "render",
        detail:
          current.renderEngine === "model"
            ? "正在使用本地 SadTalker 进行口型驱动（CPU 推理，约每 3 秒视频需 12-15 分钟，请耐心等待）"
            : current.avatarMode === "sample"
              ? "正在驱动内置数字人并合成最终画面"
              : `正在使用${MOTION_LABELS[current.motionPreset ?? "natural"]}处理上传头像`,
      },
    }));
    await appendJobLog(jobId, "字幕时间轴生成完成");

    const avatarFileName = job.avatarUrl.split("/").pop();

    if (!avatarFileName) {
      throw new Error("头像素材缺失");
    }

    let videoFileName: string;

    if (job.renderEngine === "model") {
      videoFileName = await renderModelPortraitPresenterVideo({
        avatarFileName,
        jobDir,
        theme: job.theme,
        title: job.title,
        voice: job.voice,
      });
      await appendJobLog(
        jobId,
        `已使用${RENDER_ENGINE_LABELS[job.renderEngine]}（SadTalker）渲染`,
      );
    } else if (job.avatarMode === "sample" && job.sampleAvatarId) {
      videoFileName = await renderAnimatedSamplePresenterVideo({
        durationSeconds: audio.durationSeconds,
        jobDir,
        motionPreset: job.motionPreset ?? "natural",
        sampleAvatarId: job.sampleAvatarId,
        theme: job.theme,
        title: job.title,
        voice: job.voice,
      });
    } else {
      try {
        videoFileName = await renderAnimatedPortraitPresenterVideo({
        avatarFileName,
        durationSeconds: audio.durationSeconds,
        jobDir,
        motionPreset: job.motionPreset ?? "natural",
        theme: job.theme,
        title: job.title,
        voice: job.voice,
        });
        await appendJobLog(
          jobId,
          `上传头像动效已应用（${MOTION_LABELS[job.motionPreset ?? "natural"]}）`,
        );
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "未知的人像动效错误";
        await appendJobLog(
          jobId,
          `人像动效不可用（${reason}），已回退到静态头像模式`,
        );
        videoFileName = await renderPresenterVideo({
          jobDir,
          avatarFileName,
          title: job.title,
          voice: job.voice,
          theme: job.theme,
        });
      }
    }

    await updateJob(jobId, (current) => ({
      ...current,
      status: "completed",
      updatedAt: new Date().toISOString(),
      videoUrl: getPublicRenderUrl(jobId, videoFileName),
      progress: {
        percent: 100,
        stage: "done",
        detail: "视频已生成，可预览和下载",
      },
    }));
    await appendJobLog(jobId, "视频渲染完成");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "未知渲染错误";

    await updateJob(jobId, (current) => ({
      ...current,
      status: "failed",
      updatedAt: new Date().toISOString(),
      errorMessage: message,
      progress: {
        percent: current.progress.percent,
        stage: "failed",
        detail: "本地渲染流程异常中断",
      },
    }));
    await appendJobLog(jobId, "渲染失败");
  }
}
