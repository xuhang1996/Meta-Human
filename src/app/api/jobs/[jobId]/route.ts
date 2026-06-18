import { getJob } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const job = await getJob(jobId);

  if (!job) {
    return Response.json({ error: "任务不存在" }, { status: 404 });
  }

  return Response.json({ job });
}
