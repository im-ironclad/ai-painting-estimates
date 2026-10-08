import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, sql } from "@/db/client";
import { estimates, photos } from "@/db/schema";
import type { PhotoAnalysis } from "@/domain/photo-analysis";
import { formatCents, pricePhoto } from "@/domain/pricing";
import { ingestPhoto, isRetryable } from "@/ingest/ingest-photo";
import { MAX_ATTEMPTS } from "@/ingest/queue";
import { storePhoto } from "@/ingest/photos";
import { analyzePhoto } from "@/ingest/vision";
import { searchPhotos } from "@/search/search";
import { getEstimateView } from "@/server/estimates";
import { FIXTURE_ANALYSES } from "../fixtures/photo-analyses";

if (!process.env.OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY is not set in .env.local.");
  process.exit(1);
}

const [estimate] = await db
  .insert(estimates)
  .values({ name: "Live OpenRouter check", exteriorScope: "whole_exterior" })
  .returning();
let failures = 0;
let labelMatches = 0;
let prepMatches = 0;

/** Kind is load-bearing (it picks the pricing path), so a wrong kind fails the run. Room and side are reported. */
function compare(analysis: PhotoAnalysis, expected: PhotoAnalysis, side: string | null) {
  if (analysis.kind !== expected.kind) return { kindOk: false, labelOk: false, text: `kind=${analysis.kind} (fixture: ${expected.kind})` };
  if (analysis.kind === "interior" && expected.kind === "interior") {
    const labelOk = analysis.roomType === expected.roomType;
    return { kindOk: true, labelOk, text: `room=${analysis.roomType}${labelOk ? "" : ` (fixture: ${expected.roomType})`}` };
  }
  if (analysis.kind === "exterior" && expected.kind === "exterior") {
    const labelOk = analysis.sideGuess === expected.sideGuess;
    return {
      kindOk: true,
      labelOk,
      text: `exterior side=${side} guess=${analysis.sideGuess}${labelOk ? "" : ` (fixture: ${expected.sideGuess})`} ${analysis.sidingMaterial} ${analysis.stories}-story`,
    };
  }
  throw new Error("unreachable");
}

for (const [fileName, expected] of Object.entries(FIXTURE_ANALYSES)) {
  const bytes = await readFile(path.join("samples", fileName));
  const photoId = await storePhoto(estimate.id, { name: fileName, type: "image/jpeg", bytes });
  const started = Date.now();
  let attempt = 0;
  let error: Error | null = null;
  do {
    attempt++;
    try {
      await ingestPhoto(photoId, analyzePhoto, { finalAttempt: attempt === MAX_ATTEMPTS });
      error = null;
    } catch (e) {
      error = e as Error;
      console.log(`${fileName.padEnd(28)} attempt ${attempt} failed: ${error.message}`);
    }
  } while (error && isRetryable(error) && attempt < MAX_ATTEMPTS);
  if (error) {
    failures++;
    console.log(`${fileName.padEnd(28)} FAILED after ${attempt} attempts in ${Date.now() - started} ms`);
    continue;
  }
  const [row] = await db.select().from(photos).where(eq(photos.id, photoId));
  const analysis = row.analysis!;
  const { kindOk, labelOk, text } = compare(analysis, expected, row.exteriorSide);
  const prepDiff = kindOk
    ? Object.entries(expected.prep)
        .filter(([flag, value]) => (analysis.prep as Record<string, boolean>)[flag] !== value)
        .map(([flag]) => flag)
    : [];
  failures += Number(!kindOk);
  labelMatches += Number(labelOk);
  prepMatches += Number(kindOk && prepDiff.length === 0);
  console.log(
    `${fileName.padEnd(28)} ${String(Date.now() - started).padStart(5)} ms  attempts=${attempt}  ${row.model}  ${text}  ` +
      `prep=${prepDiff.length === 0 ? "matches" : `differs on ${prepDiff.join(", ")}`}  ` +
      `confidence=${analysis.confidence}  ${formatCents(pricePhoto(analysis).totalCents)}`,
  );
}

const total = Object.keys(FIXTURE_ANALYSES).length;
console.log(`\nRoom type or exterior side guess agrees with fixture labels on ${labelMatches}/${total}.`);
console.log(`Prep flags agree with fixture labels on ${prepMatches}/${total}.`);

const view = await getEstimateView(estimate.id);
const ext = view!.summary.exterior;
console.log(
  `Exterior (whole_exterior scope, sides as guessed): status=${ext.status} covered=[${ext.coveredSides}] ` +
    `missing=[${ext.missingSides}] duplicates=${ext.duplicates.length} subtotal=${formatCents(ext.subtotalCents)}`,
);
console.log(`Estimate total ${formatCents(view!.summary.totalCents)}`);

const results = await searchPhotos("peeling paint on a water damaged ceiling", {});
console.log(`Top caption hit for "peeling paint on a water damaged ceiling": ${results.caption[0]?.originalName}`);
console.log(`\nOpen http://localhost:${process.env.PORT ?? 3100}/estimates/${estimate.id}`);

await sql.end();
process.exit(failures > 0 ? 1 : 0);
