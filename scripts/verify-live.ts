import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, sql } from "@/db/client";
import { estimates, photos } from "@/db/schema";
import { priceRoom, formatCents } from "@/domain/pricing";
import { ingestPhoto } from "@/ingest/ingest-photo";
import { storePhoto } from "@/ingest/photos";
import { analyzeRoomPhoto } from "@/ingest/vision";
import { searchPhotos } from "@/search/search";
import { FIXTURE_ANALYSES } from "../fixtures/room-analyses";

if (!process.env.OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY is not set in .env.local.");
  process.exit(1);
}

const [estimate] = await db.insert(estimates).values({ name: "Live OpenRouter check" }).returning();
let failures = 0;
let roomTypeMatches = 0;
let prepMatches = 0;

for (const [fileName, expected] of Object.entries(FIXTURE_ANALYSES)) {
  const bytes = await readFile(path.join("samples", fileName));
  const photoId = await storePhoto(estimate.id, { name: fileName, type: "image/jpeg", bytes });
  const started = Date.now();
  try {
    await ingestPhoto(photoId, analyzeRoomPhoto, { finalAttempt: true });
  } catch (error) {
    failures++;
    console.log(`${fileName.padEnd(28)} FAILED in ${Date.now() - started} ms: ${(error as Error).message}`);
    continue;
  }
  const [row] = await db.select().from(photos).where(eq(photos.id, photoId));
  const analysis = row.analysis!;
  const roomOk = analysis.roomType === expected.roomType;
  const prepDiff = (Object.keys(expected.prep) as (keyof typeof expected.prep)[]).filter(
    (flag) => analysis.prep[flag] !== expected.prep[flag],
  );
  const prepOk = prepDiff.length === 0;
  roomTypeMatches += Number(roomOk);
  prepMatches += Number(prepOk);
  console.log(
    `${fileName.padEnd(28)} ${String(Date.now() - started).padStart(5)} ms  ${row.model}  ` +
      `room=${analysis.roomType}${roomOk ? "" : ` (fixture: ${expected.roomType})`}  ` +
      `prep=${prepOk ? "matches" : `differs on ${prepDiff.join(", ")}`}  ` +
      `confidence=${analysis.confidence}  ${formatCents(priceRoom(analysis).totalCents)}`,
  );
}

const total = Object.keys(FIXTURE_ANALYSES).length;
console.log(`\nRoom type agrees with fixture labels on ${roomTypeMatches}/${total - failures}.`);
console.log(`Prep flags agree with fixture labels on ${prepMatches}/${total - failures}.`);

const results = await searchPhotos("peeling paint on a water damaged ceiling", {});
console.log(`Top caption hit for "peeling paint on a water damaged ceiling": ${results.caption[0]?.originalName}`);
console.log(`\nOpen http://localhost:${process.env.PORT ?? 3100}/estimates/${estimate.id}`);

await sql.end();
process.exit(failures > 0 ? 1 : 0);
