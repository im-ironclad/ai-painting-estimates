import { summarizeEstimate, type PhotoForEstimate } from "./estimate";
import type { ExteriorScope } from "./exterior";
import type { ExteriorSide } from "./photo-analysis";
import type { Cents } from "./pricing";

/** The one thing a home card says about where the estimate stands. Earlier kinds in `summarizeHome` win. */
export type HomeState =
  | { kind: "empty" }
  | { kind: "failed"; failed: number }
  | { kind: "analyzing"; analyzed: number; total: number }
  | { kind: "needs_scope" }
  | { kind: "exterior_incomplete"; missingSides: number }
  | { kind: "complete" };

export type HomeCardSummary = {
  id: string;
  title: string;
  createdAt: Date;
  totalCents: Cents;
  gallons: number;
  roomCount: number;
  countedSides: ExteriorSide[];
  excludedSides: ExteriorSide[];
  state: HomeState;
  /** The first uploaded photo, whatever its status. */
  thumbnailPhotoId: string | null;
};

export type Home = { id: string; name: string; createdAt: Date; exteriorScope: ExteriorScope };

/** Pure. Totals come from `summarizeEstimate`, so a card never disagrees with its estimate page. Photos in upload order. */
export function summarizeHome(home: Home, photos: readonly PhotoForEstimate[]): HomeCardSummary {
  const s = summarizeEstimate(photos, home.exteriorScope);
  return {
    id: home.id,
    title: home.name,
    createdAt: home.createdAt,
    totalCents: s.totalCents,
    gallons: s.gallons,
    roomCount: s.rooms.length,
    countedSides: s.exterior.countedSides,
    excludedSides: s.exterior.excludedSides,
    state: homeState(photos.length, s),
    thumbnailPhotoId: photos[0]?.id ?? null,
  };
}

function homeState(total: number, s: ReturnType<typeof summarizeEstimate>): HomeState {
  if (total === 0) return { kind: "empty" };
  if (s.failedCount > 0) return { kind: "failed", failed: s.failedCount };
  if (s.pendingCount > 0) return { kind: "analyzing", analyzed: total - s.pendingCount, total };
  if (s.exterior.status === "needs_decision") return { kind: "needs_scope" };
  if (s.exterior.status === "incomplete") return { kind: "exterior_incomplete", missingSides: s.exterior.missingSides.length };
  if (!s.complete) throw new Error("an estimate with no outstanding work must be complete");
  return { kind: "complete" };
}
