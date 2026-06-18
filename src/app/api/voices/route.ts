import { listSystemVoices } from "@/lib/ffmpeg";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const voices = await listSystemVoices();
    return Response.json({ voices });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "读取本地音色失败。";

    return Response.json({ error: message }, { status: 500 });
  }
}
