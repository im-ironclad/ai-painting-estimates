import { UnrecoverableError, Worker } from "bullmq";
import { warmEmbeddingModels } from "@/ingest/embeddings";
import { ingestPhoto, isRetryable } from "@/ingest/ingest-photo";
import { QUEUE_NAME, redisConnection, type AnalyzeJob } from "@/ingest/queue";
import { analyzeRoomPhoto } from "@/ingest/vision";

const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 4);

console.log("[worker] loading embedding models");
await warmEmbeddingModels();
if (!process.env.OPENROUTER_API_KEY?.trim()) {
  console.warn("[worker] OPENROUTER_API_KEY is not set; every photo will fail until it is");
}

const worker = new Worker<AnalyzeJob>(
  QUEUE_NAME,
  async (job) => {
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    try {
      return await ingestPhoto(job.data.photoId, analyzeRoomPhoto, { finalAttempt });
    } catch (err) {
      if (!isRetryable(err)) throw new UnrecoverableError((err as Error).message);
      throw err;
    }
  },
  {
    connection: redisConnection(),
    concurrency,
    limiter: { max: 10, duration: 1_000 },
  },
);

worker.on("completed", (job, outcome) => console.log(`[worker] ${job.data.photoId} ${outcome}`));
worker.on("failed", (job, err) =>
  console.log(`[worker] ${job?.data.photoId} attempt ${job?.attemptsMade} failed: ${err.message}`),
);
console.log(`[worker] listening on "${QUEUE_NAME}" with concurrency ${concurrency}`);

async function shutdown() {
  console.log("[worker] draining");
  await worker.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
