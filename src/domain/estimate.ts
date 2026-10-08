import type { ExteriorAnalysis, ExteriorSide, InteriorAnalysis } from "./photo-analysis";
import type { PhotoStatus } from "./photo-status";
import { DEFAULT_RATES, priceRoom, type Cents, type Price, type Rates } from "./pricing";
import { summarizeExterior, type ExteriorScope, type ExteriorSummary } from "./exterior";

export type PhotoForEstimate =
  | { id: string; status: "analyzed"; analysis: InteriorAnalysis }
  | { id: string; status: "analyzed"; analysis: ExteriorAnalysis; side: ExteriorSide }
  | { id: string; status: Exclude<PhotoStatus, "analyzed">; analysis: null };

export type EstimateSummary = {
  rooms: { id: string; analysis: InteriorAnalysis; price: Price }[];
  interiorCents: Cents;
  exterior: ExteriorSummary;
  pendingCount: number;
  failedCount: number;
  gallons: number;
  totalCents: Cents;
  complete: boolean;
};

/**
 * Whole-home total: analyzed rooms plus the exterior when its status counts.
 * Pending and failed photos are counted, never guessed.
 */
export function summarizeEstimate(
  photos: readonly PhotoForEstimate[],
  scope: ExteriorScope,
  rates: Rates = DEFAULT_RATES,
): EstimateSummary {
  const rooms = [];
  const exteriorPhotos = [];
  for (const p of photos) {
    if (p.status !== "analyzed") continue;
    if ("side" in p) exteriorPhotos.push({ id: p.id, side: p.side, analysis: p.analysis });
    else rooms.push({ id: p.id, analysis: p.analysis, price: priceRoom(p.analysis, rates.interior) });
  }
  const exterior = summarizeExterior(scope, exteriorPhotos, rates.exterior);
  const pendingCount = photos.filter((p) => p.status === "queued" || p.status === "analyzing").length;
  const failedCount = photos.filter((p) => p.status === "failed").length;
  const interiorCents = rooms.reduce((n, r) => n + r.price.totalCents, 0);
  const interiorGallons = rooms.reduce((n, r) => n + r.price.gallons, 0);
  const exteriorBlocks = exterior.status !== "none" && !exterior.countsInTotal;

  return {
    rooms,
    interiorCents,
    exterior,
    pendingCount,
    failedCount,
    gallons: interiorGallons + (exterior.countsInTotal ? exterior.gallons : 0),
    totalCents: interiorCents + (exterior.countsInTotal ? exterior.subtotalCents : 0),
    complete:
      pendingCount === 0 && failedCount === 0 && !exteriorBlocks && (rooms.length > 0 || exterior.countsInTotal),
  };
}
