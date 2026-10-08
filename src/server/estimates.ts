import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { estimates, photos } from "@/db/schema";
import { summarizeEstimate, type EstimateSummary, type PhotoForEstimate } from "@/domain/estimate";
import type { ExteriorScope } from "@/domain/exterior";
import { summarizeHome, type HomeCardSummary } from "@/domain/home-card";
import type { ExteriorSide, PhotoAnalysis } from "@/domain/photo-analysis";
import type { PhotoStatus } from "@/domain/photo-status";
import { pricePhoto, type Price } from "@/domain/pricing";

export type PhotoView = {
  id: string;
  originalName: string;
  status: PhotoStatus;
  attempts: number;
  error: string | null;
  model: string | null;
  analysis: PhotoAnalysis | null;
  exteriorSide: ExteriorSide | null;
  /** Set when another photo of the same side is the one priced. */
  duplicateOf: string | null;
  captionText: string | null;
  price: Price | null;
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

/** Two queries for every home, never one per home. Photos load in the same upload order the estimate page uses. */
export async function listHomeCards(): Promise<HomeCardSummary[]> {
  const [homes, rows] = await Promise.all([
    db
      .select({ id: estimates.id, name: estimates.name, createdAt: estimates.createdAt, exteriorScope: estimates.exteriorScope })
      .from(estimates)
      .orderBy(desc(estimates.createdAt)),
    db
      .select({ id: photos.id, estimateId: photos.estimateId, status: photos.status, analysis: photos.analysis, exteriorSide: photos.exteriorSide })
      .from(photos)
      .orderBy(asc(photos.createdAt), asc(photos.id)),
  ]);
  const byHome = new Map<string, PhotoForEstimate[]>();
  for (const row of rows) {
    const list = byHome.get(row.estimateId) ?? [];
    list.push(forEstimate(row));
    byHome.set(row.estimateId, list);
  }
  return homes.map((home) => summarizeHome(home, byHome.get(home.id) ?? []));
}

export async function setExteriorScope(id: string, exteriorScope: ExteriorScope): Promise<boolean> {
  const rows = await db.update(estimates).set({ exteriorScope }).where(eq(estimates.id, id)).returning({ id: estimates.id });
  return rows.length > 0;
}

/** Only an analyzed exterior has a side to correct. Returns false otherwise. */
export async function setPhotoSide(id: string, exteriorSide: ExteriorSide): Promise<boolean> {
  const rows = await db
    .update(photos)
    .set({ exteriorSide, updatedAt: sql`now()` })
    .where(and(eq(photos.id, id), eq(photos.status, "analyzed"), sql`${photos.analysis}->>'kind' = 'exterior'`))
    .returning({ id: photos.id });
  return rows.length > 0;
}

type Row = { id: string; status: PhotoStatus; analysis: PhotoAnalysis | null; exteriorSide: ExteriorSide | null };

function forEstimate(p: Row): PhotoForEstimate {
  if (p.status !== "analyzed" || !p.analysis) {
    return { id: p.id, status: p.status === "analyzed" ? "failed" : p.status, analysis: null };
  }
  if (p.analysis.kind === "interior") return { id: p.id, status: "analyzed", analysis: p.analysis };
  if (!p.exteriorSide) throw new Error(`analyzed exterior ${p.id} has no side; the photos check constraint should prevent this`);
  return { id: p.id, status: "analyzed", analysis: p.analysis, side: p.exteriorSide };
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
      exteriorSide: photos.exteriorSide,
      captionText: photos.captionText,
      createdAt: photos.createdAt,
      analyzedAt: photos.analyzedAt,
    })
    .from(photos)
    .where(eq(photos.estimateId, id))
    .orderBy(asc(photos.createdAt), asc(photos.id));

  const { rooms, ...rest } = summarizeEstimate(rows.map(forEstimate), estimate.exteriorScope);
  const summary = { ...rest, roomCount: rooms.length };
  const duplicateOf = new Map(rest.exterior.duplicates.map((d) => [d.photoId, d.pricedPhotoId]));
  return {
    id: estimate.id,
    name: estimate.name,
    summary,
    photos: rows.map((r) => ({
      ...r,
      duplicateOf: duplicateOf.get(r.id) ?? null,
      price: r.status === "analyzed" && r.analysis ? pricePhoto(r.analysis) : null,
      createdAt: r.createdAt.toISOString(),
      analyzedAt: r.analyzedAt?.toISOString() ?? null,
    })),
  };
}

export async function getPhotoFile(id: string) {
  return db.query.photos.findFirst({ where: eq(photos.id, id), columns: { filePath: true } });
}
