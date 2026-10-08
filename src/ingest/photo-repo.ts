import { and, eq, inArray, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { photos, type Photo } from "@/db/schema";
import { PHOTO_EVENTS, type PhotoEvent } from "@/domain/photo-status";

type Patch = Omit<PgUpdateSetSource<typeof photos>, "id" | "status">;

/**
 * Applies one event from the status table as a single conditional UPDATE.
 * Returns the updated row, or null when the photo was not in a legal `from`
 * state (already done, or another worker got there first).
 */
export async function transition(photoId: string, event: PhotoEvent, patch: Patch = {}): Promise<Photo | null> {
  const { from, to } = PHOTO_EVENTS[event];
  const [row] = await db
    .update(photos)
    .set({ ...patch, status: to, updatedAt: sql`now()` })
    .where(and(eq(photos.id, photoId), inArray(photos.status, [...from])))
    .returning();
  return row ?? null;
}

export function claimPhoto(photoId: string) {
  return transition(photoId, "claim", { attempts: sql`${photos.attempts} + 1`, error: null });
}
