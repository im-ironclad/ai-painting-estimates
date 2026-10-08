import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { estimates, photos } from "@/db/schema";
import type { PhotoStatus } from "@/domain/photo-status";
import { priceRoom, summarizeEstimate, type EstimateSummary, type PhotoForEstimate, type RoomPrice } from "@/domain/pricing";
import type { RoomAnalysis } from "@/domain/room-analysis";

export type PhotoView = {
  id: string;
  originalName: string;
  status: PhotoStatus;
  attempts: number;
  error: string | null;
  model: string | null;
  analysis: RoomAnalysis | null;
  captionText: string | null;
  price: RoomPrice | null;
  createdAt: string;
  analyzedAt: string | null;
};

export type EstimateView = {
  id: string;
  name: string;
  photos: PhotoView[];
  summary: Omit<EstimateSummary, "rooms"> & { roomCount: number };
};

export async function createEstimate(name: string): Promise<string> {
  const [row] = await db.insert(estimates).values({ name }).returning({ id: estimates.id });
  return row.id;
}

export async function listEstimates() {
  return db
    .select({
      id: estimates.id,
      name: estimates.name,
      createdAt: estimates.createdAt,
      photoCount: sql<number>`count(${photos.id})::int`,
      analyzedCount: sql<number>`count(${photos.id}) filter (where ${photos.status} = 'analyzed')::int`,
    })
    .from(estimates)
    .leftJoin(photos, eq(photos.estimateId, estimates.id))
    .groupBy(estimates.id)
    .orderBy(desc(estimates.createdAt));
}

function forEstimate(p: { id: string; status: PhotoStatus; analysis: RoomAnalysis | null }): PhotoForEstimate {
  return p.status === "analyzed" && p.analysis
    ? { id: p.id, status: "analyzed", analysis: p.analysis }
    : { id: p.id, status: p.status === "analyzed" ? "failed" : p.status, analysis: null };
}

export async function getEstimateView(id: string): Promise<EstimateView | null> {
  const estimate = await db.query.estimates.findFirst({ where: eq(estimates.id, id) });
  if (!estimate) return null;

  const rows = await db
    .select({
      id: photos.id,
      originalName: photos.originalName,
      status: photos.status,
      attempts: photos.attempts,
      error: photos.error,
      model: photos.model,
      analysis: photos.analysis,
      captionText: photos.captionText,
      createdAt: photos.createdAt,
      analyzedAt: photos.analyzedAt,
    })
    .from(photos)
    .where(eq(photos.estimateId, id))
    .orderBy(asc(photos.createdAt));

  const { rooms, ...rest } = summarizeEstimate(rows.map(forEstimate));
  const summary = { ...rest, roomCount: rooms.length };
  return {
    id: estimate.id,
    name: estimate.name,
    summary,
    photos: rows.map((r) => ({
      ...r,
      price: r.status === "analyzed" && r.analysis ? priceRoom(r.analysis) : null,
      createdAt: r.createdAt.toISOString(),
      analyzedAt: r.analyzedAt?.toISOString() ?? null,
    })),
  };
}

export async function getPhotoFile(id: string) {
  return db.query.photos.findFirst({ where: eq(photos.id, id), columns: { filePath: true } });
}
