import { EXTERIOR_SIDES, type ExteriorAnalysis, type ExteriorSide } from "./photo-analysis";
import { DEFAULT_RATES, priceExteriorSide, type Cents, type ExteriorRates, type Price } from "./pricing";

export const EXTERIOR_SCOPES = ["undecided", "single_side", "whole_exterior"] as const;
export type ExteriorScope = (typeof EXTERIOR_SCOPES)[number];

export type ExteriorStatus = "none" | "needs_decision" | "single_side_priced" | "incomplete" | "complete";

/** The sides a scope demands before the exterior counts. Single side and undecided demand nothing extra. */
export const REQUIRED_SIDES: Record<ExteriorScope, readonly ExteriorSide[]> = {
  undecided: [],
  single_side: [],
  whole_exterior: EXTERIOR_SIDES,
};

const STATUS_BY_SCOPE: Record<ExteriorScope, (missing: number) => ExteriorStatus> = {
  undecided: () => "needs_decision",
  single_side: () => "single_side_priced",
  whole_exterior: (missing) => (missing === 0 ? "complete" : "incomplete"),
};

export const COUNTS_IN_TOTAL: Record<ExteriorStatus, boolean> = {
  none: false,
  needs_decision: false,
  single_side_priced: true,
  incomplete: false,
  complete: true,
};

/** An analyzed exterior photo. `side` is the stored side (user's choice, else the model's guess), never re-derived. */
export type ExteriorPhoto = { id: string; side: ExteriorSide; analysis: ExteriorAnalysis };

export type PricedSide = { side: ExteriorSide; photoId: string; price: Price };

export type ExteriorSummary = {
  scope: ExteriorScope;
  status: ExteriorStatus;
  sides: PricedSide[];
  coveredSides: ExteriorSide[];
  missingSides: ExteriorSide[];
  /** Extra photos of an already covered side. Not priced. */
  duplicates: { photoId: string; side: ExteriorSide; pricedPhotoId: string }[];
  subtotalCents: Cents;
  gallons: number;
  countsInTotal: boolean;
};

/** Highest confidence wins; the smaller id breaks ties so the pick never depends on row order. */
function better(a: ExteriorPhoto, b: ExteriorPhoto): ExteriorPhoto {
  if (a.analysis.confidence !== b.analysis.confidence) return a.analysis.confidence > b.analysis.confidence ? a : b;
  return a.id < b.id ? a : b;
}

/** Pure. Everything the estimate page shows about the exterior derives from the scope and the analyzed photos. */
export function summarizeExterior(
  scope: ExteriorScope,
  photos: readonly ExteriorPhoto[],
  rates: ExteriorRates = DEFAULT_RATES.exterior,
): ExteriorSummary {
  const chosen = new Map<ExteriorSide, ExteriorPhoto>();
  for (const p of photos) {
    const current = chosen.get(p.side);
    chosen.set(p.side, current ? better(current, p) : p);
  }

  const coveredSides = EXTERIOR_SIDES.filter((side) => chosen.has(side));
  const missingSides = REQUIRED_SIDES[scope].filter((side) => !chosen.has(side));
  const sides = coveredSides.map((side) => {
    const photo = chosen.get(side)!;
    return { side, photoId: photo.id, price: priceExteriorSide(photo.analysis, rates) };
  });
  const duplicates = photos
    .filter((p) => chosen.get(p.side)!.id !== p.id)
    .map((p) => ({ photoId: p.id, side: p.side, pricedPhotoId: chosen.get(p.side)!.id }));

  const status: ExteriorStatus =
    coveredSides.length === 0 && REQUIRED_SIDES[scope].length === 0 ? "none" : STATUS_BY_SCOPE[scope](missingSides.length);

  return {
    scope,
    status,
    sides,
    coveredSides,
    missingSides,
    duplicates,
    subtotalCents: sides.reduce((n, s) => n + s.price.totalCents, 0),
    gallons: sides.reduce((n, s) => n + s.price.gallons, 0),
    countsInTotal: COUNTS_IN_TOTAL[status],
  };
}
