import { Queue, type ConnectionOptions } from "bullmq";

export const QUEUE_NAME = "photo-analysis";
export const MAX_ATTEMPTS = 3;

export type AnalyzeJob = { photoId: string };

export function redisConnection(): ConnectionOptions {
  return { url: process.env.REDIS_URL ?? "redis://localhost:6380", maxRetriesPerRequest: null };
}

const cache = globalThis as unknown as { photoQueue?: Queue<AnalyzeJob> };

function queue(): Queue<AnalyzeJob> {
  cache.photoQueue ??= new Queue<AnalyzeJob>(QUEUE_NAME, { connection: redisConnection() });
  return cache.photoQueue;
}

/** jobId = photoId, so enqueueing the same photo twice while a job exists is a no-op. */
export async function enqueuePhoto(photoId: string): Promise<void> {
  await queue().add(
    "analyze",
    { photoId },
    {
      jobId: photoId,
      attempts: MAX_ATTEMPTS,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: { age: 3_600 },
      removeOnFail: { age: 86_400 },
    },
  );
}

/** A finished job keeps its id until removed, so drop it before adding a fresh one. */
export async function requeuePhoto(photoId: string): Promise<void> {
  await queue().remove(photoId);
  await enqueuePhoto(photoId);
}
