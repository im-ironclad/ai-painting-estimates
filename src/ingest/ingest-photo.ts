import { sql } from "drizzle-orm";
import { renderCaption } from "@/domain/caption";
import { embedCaption, embedImage } from "./embeddings";
import { claimPhoto, transition } from "./photo-repo";
import type { VisionResult } from "./vision";

export type Analyzer = (imagePath: string) => Promise<VisionResult>;

export type IngestOutcome = "analyzed" | "skipped";

const isRetryable = (err: unknown) => !(err instanceof Error && "retryable" in err && err.retryable === false);

/**
 * The whole ingestion step for one photo. The worker passes the OpenRouter
 * analyzer; the fixture seed passes a hand-written one. Everything after the
 * analyzer (caption, both embeddings, the status change) is shared.
 */
export async function ingestPhoto(
  photoId: string,
  analyze: Analyzer,
  { finalAttempt }: { finalAttempt: boolean },
): Promise<IngestOutcome> {
  const photo = await claimPhoto(photoId);
  if (!photo) return "skipped";

  try {
    const [vision, clipEmbedding] = await Promise.all([analyze(photo.filePath), embedImage(photo.filePath)]);
    const captionText = renderCaption(vision.analysis);
    const captionEmbedding = await embedCaption(captionText);
    await transition(photoId, "succeed", {
      analysis: vision.analysis,
      model: vision.model,
      captionText,
      captionEmbedding,
      clipEmbedding,
      error: null,
      analyzedAt: sql`now()`,
    });
    return "analyzed";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const final = finalAttempt || !isRetryable(err);
    await transition(photoId, final ? "failFinal" : "failAttempt", {
      error: final ? message : `Attempt failed, retrying: ${message}`,
    });
    throw err;
  }
}

export { isRetryable };
