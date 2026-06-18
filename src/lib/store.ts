import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { VideoJob } from "./types";

const rootDir = process.cwd();
const dataDir = path.join(rootDir, ".data");
const jobsFile = path.join(dataDir, "jobs.json");
const rendersDir = path.join(rootDir, "public", "renders");

let writeChain = Promise.resolve();

async function ensureStorage() {
  await mkdir(dataDir, { recursive: true });
  await mkdir(rendersDir, { recursive: true });

  try {
    await access(jobsFile);
  } catch {
    await writeFile(jobsFile, "[]", "utf8");
  }
}

async function readJobsRaw() {
  await ensureStorage();
  const content = await readFile(jobsFile, "utf8");
  return JSON.parse(content) as VideoJob[];
}

async function writeJobsRaw(jobs: VideoJob[]) {
  await ensureStorage();
  await writeFile(jobsFile, JSON.stringify(jobs, null, 2), "utf8");
}

async function mutateJobs<T>(mutator: (jobs: VideoJob[]) => Promise<T> | T) {
  const operation = writeChain.then(async () => {
    const jobs = await readJobsRaw();
    const result = await mutator(jobs);
    await writeJobsRaw(jobs);
    return result;
  });

  writeChain = operation.then(
    () => undefined,
    () => undefined,
  );

  return operation;
}

export async function listJobs() {
  const jobs = await readJobsRaw();
  return jobs.sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

export async function getJob(jobId: string) {
  const jobs = await readJobsRaw();
  return jobs.find((job) => job.id === jobId) ?? null;
}

export async function insertJob(job: VideoJob) {
  return mutateJobs(async (jobs) => {
    jobs.unshift(job);
    return job;
  });
}

export async function updateJob(
  jobId: string,
  updater: (job: VideoJob) => VideoJob,
) {
  return mutateJobs(async (jobs) => {
    const index = jobs.findIndex((job) => job.id === jobId);

    if (index === -1) {
      return null;
    }

    const nextJob = updater(jobs[index]);
    jobs[index] = nextJob;
    return nextJob;
  });
}

export async function appendJobLog(jobId: string, message: string) {
  return updateJob(jobId, (job) => ({
    ...job,
    updatedAt: new Date().toISOString(),
    logs: [
      ...job.logs,
      {
        at: new Date().toISOString(),
        message,
      },
    ].slice(-18),
  }));
}

export async function ensureJobRenderDir(jobId: string) {
  await ensureStorage();
  const directory = path.join(rendersDir, jobId);
  await mkdir(directory, { recursive: true });
  return directory;
}

export function getPublicRenderUrl(jobId: string, fileName: string) {
  return `/renders/${jobId}/${fileName}`;
}

