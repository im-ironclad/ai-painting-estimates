import type { Condition, RoomAnalysis, SurfaceKind } from "./room-analysis";
import type { PhotoStatus } from "./photo-status";

export type Cents = number;

export type Rates = {
  coverageSqFtPerGallon: number;
  coats: Record<SurfaceKind, number>;
  paintCentsPerGallon: Record<SurfaceKind, Cents>;
  laborCentsPerSqFt: Record<SurfaceKind, Cents>;
  conditionLaborMultiplier: Record<Condition, number>;
  highCeilingLaborMultiplier: number;
  patchingFlatCents: Cents;
  waterDamageFlatCents: Cents;
  wallpaperRemovalCentsPerSqFt: Cents;
};

export const DEFAULT_RATES: Rates = {
  coverageSqFtPerGallon: 350,
  coats: { walls: 2, ceiling: 2, trim: 2, doors: 2, cabinets: 3 },
  paintCentsPerGallon: { walls: 4500, ceiling: 4000, trim: 5500, doors: 5500, cabinets: 7500 },
  laborCentsPerSqFt: { walls: 150, ceiling: 175, trim: 250, doors: 225, cabinets: 400 },
  conditionLaborMultiplier: { good: 1, fair: 1.15, poor: 1.35 },
  highCeilingLaborMultiplier: 1.2,
  patchingFlatCents: 15000,
  waterDamageFlatCents: 25000,
  wallpaperRemovalCentsPerSqFt: 125,
};

export type LineItem = {
  label: string;
  quantity: number;
  unit: "gal" | "sq ft" | "flat";
  unitCents: Cents;
  totalCents: Cents;
};

export type RoomPrice = { lineItems: LineItem[]; gallons: number; totalCents: Cents };

const HIGH_CEILING_KINDS: ReadonlySet<SurfaceKind> = new Set(["walls", "ceiling"]);

/** Pure: same analysis and rates always give the same line items. */
export function priceRoom(a: RoomAnalysis, rates: Rates = DEFAULT_RATES): RoomPrice {
  const lineItems: LineItem[] = [];
  let gallons = 0;

  for (const s of a.surfaces) {
    if (s.estimatedSqFt <= 0) continue;
    const gal = Math.ceil((s.estimatedSqFt * rates.coats[s.kind]) / rates.coverageSqFtPerGallon);
    gallons += gal;
    lineItems.push({
      label: `${s.kind} paint (${rates.coats[s.kind]} coats)`,
      quantity: gal,
      unit: "gal",
      unitCents: rates.paintCentsPerGallon[s.kind],
      totalCents: gal * rates.paintCentsPerGallon[s.kind],
    });

    const multiplier =
      rates.conditionLaborMultiplier[s.condition] *
      (a.prep.highCeilings && HIGH_CEILING_KINDS.has(s.kind) ? rates.highCeilingLaborMultiplier : 1);
    const unitCents = Math.round(rates.laborCentsPerSqFt[s.kind] * multiplier);
    lineItems.push({
      label: `${s.kind} labor (${s.condition})`,
      quantity: s.estimatedSqFt,
      unit: "sq ft",
      unitCents,
      totalCents: Math.round(s.estimatedSqFt * unitCents),
    });
  }

  if (a.prep.patching) lineItems.push(flat("Patching and sanding", rates.patchingFlatCents));
  if (a.prep.waterDamage) lineItems.push(flat("Water damage repair and stain-block primer", rates.waterDamageFlatCents));
  if (a.prep.wallpaperRemoval) {
    const wallSqFt = a.surfaces.filter((s) => s.kind === "walls").reduce((n, s) => n + s.estimatedSqFt, 0);
    lineItems.push({
      label: "Wallpaper removal",
      quantity: wallSqFt,
      unit: "sq ft",
      unitCents: rates.wallpaperRemovalCentsPerSqFt,
      totalCents: Math.round(wallSqFt * rates.wallpaperRemovalCentsPerSqFt),
    });
  }

  return { lineItems, gallons, totalCents: lineItems.reduce((n, li) => n + li.totalCents, 0) };
}

function flat(label: string, cents: Cents): LineItem {
  return { label, quantity: 1, unit: "flat", unitCents: cents, totalCents: cents };
}

export type PhotoForEstimate =
  | { id: string; status: "analyzed"; analysis: RoomAnalysis }
  | { id: string; status: Exclude<PhotoStatus, "analyzed">; analysis: null };

export type EstimateSummary = {
  rooms: { id: string; analysis: RoomAnalysis; price: RoomPrice }[];
  pendingCount: number;
  failedCount: number;
  gallons: number;
  totalCents: Cents;
  complete: boolean;
};

/** Whole-home total covers analyzed rooms only; pending and failed rooms are counted, never guessed. */
export function summarizeEstimate(photos: PhotoForEstimate[], rates: Rates = DEFAULT_RATES): EstimateSummary {
  const rooms = photos.flatMap((p) =>
    p.status === "analyzed" ? [{ id: p.id, analysis: p.analysis, price: priceRoom(p.analysis, rates) }] : [],
  );
  const pendingCount = photos.filter((p) => p.status === "queued" || p.status === "analyzing").length;
  const failedCount = photos.filter((p) => p.status === "failed").length;
  return {
    rooms,
    pendingCount,
    failedCount,
    gallons: rooms.reduce((n, r) => n + r.price.gallons, 0),
    totalCents: rooms.reduce((n, r) => n + r.price.totalCents, 0),
    complete: pendingCount === 0 && failedCount === 0 && rooms.length > 0,
  };
}

export function formatCents(c: Cents): string {
  return (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
