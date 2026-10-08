import { readFile } from "node:fs/promises";
import path from "node:path";
import { db, sql } from "@/db/client";
import { estimates } from "@/db/schema";
import { ingestPhoto } from "@/ingest/ingest-photo";
import { storePhoto } from "@/ingest/photos";
import { FIXTURE_ANALYSES } from "../fixtures/room-analyses";

const FIXTURE_MODEL = "fixture:hand-written";

const [estimate] = await db
  .insert(estimates)
  .values({ name: "Fixture home (hand-written analyses, not model output)" })
  .returning();

for (const [fileName, analysis] of Object.entries(FIXTURE_ANALYSES)) {
  const bytes = await readFile(path.join("samples", fileName));
  const photoId = await storePhoto(estimate.id, { name: fileName, type: "image/jpeg", bytes });
  const started = Date.now();
  const outcome = await ingestPhoto(photoId, async () => ({ analysis, model: FIXTURE_MODEL }), { finalAttempt: true });
  console.log(`${fileName.padEnd(28)} ${outcome} in ${Date.now() - started} ms`);
}

console.log(`\nSeeded estimate ${estimate.id}`);
console.log(`Open http://localhost:${process.env.PORT ?? 3100}/estimates/${estimate.id}`);
await sql.end();
