import { copyFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { enqueueJob } from "@/lib/job-runner";
import { SAMPLE_AVATAR_MAP } from "@/lib/constants";
import { ensureJobRenderDir, getPublicRenderUrl, insertJob, listJobs } from "@/lib/store";
import { MotionPreset, RenderEngine, SampleAvatarId, ThemeId, VideoJob } from "@/lib/types";
import { slugifyFileExtension } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET() {
  const jobs = await listJobs();
  return Response.json({ jobs });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const title = formData.get("title")?.toString().trim() || "未命名视频";
  const script = formData.get("script")?.toString().trim() ?? "";
  const voice = formData.get("voice")?.toString().trim() || "zh-CN-XiaoxiaoNeural";
  const theme = formData.get("theme")?.toString().trim() as ThemeId;
  const motionPreset = (formData.get("motionPreset")?.toString().trim() ===
  "expressive"
    ? "expressive"
    : "natural") as MotionPreset;
  const renderEngineRaw = formData.get("renderEngine")?.toString().trim();
  const renderEngine = (["fast", "model", "musetalk"].includes(renderEngineRaw ?? "")
    ? renderEngineRaw
    : "fast") as RenderEngine;
  const sampleAvatarId = (formData.get("sampleAvatarId")?.toString().trim() ||
    "analyst-aurora") as SampleAvatarId;
  const avatar = formData.get("avatar");

  if (script.length < 12) {
    return Response.json(
      { error: "文案长度至少需要 12 个字符。" },
      { status: 400 },
    );
  }

  // MuseTalk 引擎支持上传视频底片（重配音）；其他引擎仅支持图片。
  if (avatar instanceof File && avatar.size > 0) {
    const isImage = avatar.type.startsWith("image/");
    const isVideo = avatar.type.startsWith("video/");
    const allowVideo = renderEngine === "musetalk";

    if (!isImage && !(isVideo && allowVideo)) {
      return Response.json(
        {
          error: allowVideo
            ? "仅支持图片或视频文件。"
            : "该引擎仅支持图片文件，上传视频请切换到「实时口型（MuseTalk）」引擎。",
        },
        { status: 400 },
      );
    }
  }

  const jobId = crypto.randomUUID();
  const jobDir = await ensureJobRenderDir(jobId);
  let avatarFileName = "avatar.png";
  let avatarMode: VideoJob["avatarMode"] = "sample";
  let avatarMediaType: VideoJob["avatarMediaType"] = "image";

  if (avatar instanceof File && avatar.size > 0) {
    avatarFileName = `avatar${slugifyFileExtension(avatar.name)}`;
    const avatarBytes = Buffer.from(await avatar.arrayBuffer());
    await writeFile(`${jobDir}/${avatarFileName}`, avatarBytes);
    avatarMode = "upload";
    avatarMediaType = avatar.type.startsWith("video/") ? "video" : "image";
  } else {
    const sample = SAMPLE_AVATAR_MAP[sampleAvatarId] ?? SAMPLE_AVATAR_MAP["analyst-aurora"];
    const sourcePath = path.join(process.cwd(), "public", sample.src.replace(/^\//, ""));
    await copyFile(sourcePath, `${jobDir}/${avatarFileName}`);
  }

  const now = new Date().toISOString();
  const job: VideoJob = {
    id: jobId,
    title,
    script,
    voice,
    theme: theme || "ember",
    motionPreset,
    renderEngine,
    avatarMode,
    avatarMediaType,
    sampleAvatarId,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    avatarUrl: getPublicRenderUrl(jobId, avatarFileName),
    progress: {
      percent: 8,
      stage: "queued",
      detail: "等待本地渲染队列处理",
    },
    providers: {
      tts: "Edge-TTS",
      render:
        renderEngine === "model"
          ? "本地 SadTalker"
          : renderEngine === "musetalk"
            ? avatarMediaType === "video"
              ? "本地 MuseTalk（视频配音）"
              : "本地 MuseTalk"
            : avatarMode === "sample"
              ? "内置数字人动效"
              : "上传头像动效",
    },
    logs: [
      {
        at: now,
        message: "任务已创建，等待开始",
      },
    ],
  };

  await insertJob(job);
  enqueueJob(job.id);

  return Response.json({ job }, { status: 201 });
}
