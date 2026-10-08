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

/** The covered sides a scope adds to the total, when its status counts at all. Undecided counts the front provisionally. */
export const COUNTED_SIDES: Record<ExteriorScope, readonly ExteriorSide[]> = {
  undecided: ["front"],
  single_side: EXTERIOR_SIDES,
  whole_exterior: EXTERIOR_SIDES,
};

/** `counts`: the status adds its counted sides to the total. `blocks`: the estimate is not complete while in this status. */
export const STATUS_RULES: Record<ExteriorStatus, { counts: boolean; blocks: boolean }> = {
  none: { counts: false, blocks: false },
  needs_decision: { counts: true, blocks: true },
  single_side_priced: { counts: true, blocks: false },
  incomplete: { counts: false, blocks: true },
  complete: { counts: true, blocks: false },
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
  countedSides: ExteriorSide[];
  /** Covered sides that are priced but left out of the total. */
  excludedSides: ExteriorSide[];
  /** Extra photos of an already covered side. Not priced. */
  duplicates: { photoId: string; side: ExteriorSide; pricedPhotoId: string }[];
  /** Every priced side, counted or not. */
  subtotalCents: Cents;
  countedCents: Cents;
  countedGallons: number;
  blocksCompletion: boolean;
};

/**
 * Highest confidence wins, and on a tie the earlier upload (`a`) wins. Ids are
 * random UUIDs, so an id tie-break would let two estimates built from the same
 * uploads price different photos.
 */
function better(earlier: ExteriorPhoto, later: ExteriorPhoto): ExteriorPhoto {
  return later.analysis.confidence > earlier.analysis.confidence ? later : earlier;
}

/** Pure. Everything the estimate page shows about the exterior derives from the scope and the analyzed photos, given in upload order. */
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

  const rules = STATUS_RULES[status];
  const counted = sides.filter((s) => rules.counts && COUNTED_SIDES[scope].includes(s.side));

  return {
    scope,
    status,
    sides,
    coveredSides,
    missingSides,
    countedSides: counted.map((s) => s.side),
    excludedSides: coveredSides.filter((side) => !counted.some((s) => s.side === side)),
    duplicates,
    subtotalCents: sides.reduce((n, s) => n + s.price.totalCents, 0),
    countedCents: counted.reduce((n, s) => n + s.price.totalCents, 0),
    countedGallons: counted.reduce((n, s) => n + s.price.gallons, 0),
    blocksCompletion: rules.blocks,
  };
}
