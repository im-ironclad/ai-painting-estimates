import type {
  Condition,
  ExteriorAnalysis,
  ExteriorSurfaceKind,
  InteriorAnalysis,
  PhotoAnalysis,
  SidingMaterial,
  Stories,
  SurfaceKind,
} from "./photo-analysis";

export type Cents = number;

type ExteriorPrepFlag = keyof ExteriorAnalysis["prep"];

export type InteriorRates = {
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

export type ExteriorRates = {
  coverageSqFtPerGallon: number;
  coats: Record<ExteriorSurfaceKind, number>;
  paintCentsPerGallon: Record<ExteriorSurfaceKind, Cents>;
  laborCentsPerSqFt: Record<ExteriorSurfaceKind, Cents>;
  conditionLaborMultiplier: Record<Condition, number>;
  /** Applies to siding only: brick and stucco take longer to cut in and roll than vinyl. */
  sidingMaterialLaborMultiplier: Record<SidingMaterial, number>;
  /** Ladders, then lifts or staging, for surfaces that rise with the wall. */
  storyLaborMultiplier: Record<Stories, number>;
  /** Each flag that is set multiplies all labor on the side. */
  prepLaborMultiplier: Record<ExteriorPrepFlag, number>;
};

export type Rates = { interior: InteriorRates; exterior: ExteriorRates };

export const DEFAULT_RATES: Rates = {
  interior: {
    coverageSqFtPerGallon: 350,
    coats: { walls: 2, ceiling: 2, trim: 2, doors: 2, cabinets: 3 },
    paintCentsPerGallon: { walls: 4500, ceiling: 4000, trim: 5500, doors: 5500, cabinets: 7500 },
    laborCentsPerSqFt: { walls: 150, ceiling: 175, trim: 250, doors: 225, cabinets: 400 },
    conditionLaborMultiplier: { good: 1, fair: 1.15, poor: 1.35 },
    highCeilingLaborMultiplier: 1.2,
    patchingFlatCents: 15000,
    waterDamageFlatCents: 25000,
    wallpaperRemovalCentsPerSqFt: 125,
  },
  exterior: {
    coverageSqFtPerGallon: 300,
    coats: { siding: 2, trim: 2, doors: 2, shutters: 2, garage_door: 2, fascia_soffit: 2, deck_porch: 2 },
    paintCentsPerGallon: {
      siding: 6000,
      trim: 6500,
      doors: 6500,
      shutters: 6500,
      garage_door: 6000,
      fascia_soffit: 6000,
      deck_porch: 5500,
    },
    laborCentsPerSqFt: {
      siding: 200,
      trim: 350,
      doors: 300,
      shutters: 400,
      garage_door: 225,
      fascia_soffit: 325,
      deck_porch: 250,
    },
    conditionLaborMultiplier: { good: 1, fair: 1.15, poor: 1.35 },
    sidingMaterialLaborMultiplier: { wood: 1.2, vinyl: 0.9, fiber_cement: 1, stucco: 1.3, brick: 1.4, other: 1.1 },
    storyLaborMultiplier: { 1: 1, 2: 1.25, 3: 1.6 },
    prepLaborMultiplier: { peeling: 1.3, mildew: 1.1, woodRot: 1.15, failedCaulk: 1.1 },
  },
};

export type LineItem = {
  label: string;
  quantity: number;
  unit: "gal" | "sq ft" | "flat";
  unitCents: Cents;
  totalCents: Cents;
};

export type Price = { lineItems: LineItem[]; gallons: number; totalCents: Cents };

type SurfaceRates<K extends string> = {
  coverageSqFtPerGallon: number;
  coats: Record<K, number>;
  paintCentsPerGallon: Record<K, Cents>;
  laborCentsPerSqFt: Record<K, Cents>;
  conditionLaborMultiplier: Record<Condition, number>;
};

type Surface<K extends string> = { kind: K; condition: Condition; estimatedSqFt: number };

/** Paint and labor lines for one surface. `extraMultiplier` carries the kind-specific labor factors. */
function surfaceLines<K extends string>(s: Surface<K>, rates: SurfaceRates<K>, extraMultiplier: number) {
  const name = s.kind.replaceAll("_", " ");
  const coats = rates.coats[s.kind];
  const gallons = Math.ceil((s.estimatedSqFt * coats) / rates.coverageSqFtPerGallon);
  const laborUnit = Math.round(rates.laborCentsPerSqFt[s.kind] * rates.conditionLaborMultiplier[s.condition] * extraMultiplier);
  const lines: LineItem[] = [
    {
      label: `${name} paint (${coats} coats)`,
      quantity: gallons,
      unit: "gal",
      unitCents: rates.paintCentsPerGallon[s.kind],
      totalCents: gallons * rates.paintCentsPerGallon[s.kind],
    },
    {
      label: `${name} labor (${s.condition})`,
      quantity: s.estimatedSqFt,
      unit: "sq ft",
      unitCents: laborUnit,
      totalCents: Math.round(s.estimatedSqFt * laborUnit),
    },
  ];
  return { lines, gallons };
}

function total(lineItems: LineItem[], gallons: number): Price {
  return { lineItems, gallons, totalCents: lineItems.reduce((n, li) => n + li.totalCents, 0) };
}

const HIGH_CEILING_KINDS: ReadonlySet<SurfaceKind> = new Set(["walls", "ceiling"]);

/** Pure: same analysis and rates always give the same line items. */
export function priceRoom(a: InteriorAnalysis, rates: InteriorRates = DEFAULT_RATES.interior): Price {
  const lineItems: LineItem[] = [];
  let gallons = 0;

  for (const s of a.surfaces) {
    if (s.estimatedSqFt <= 0) continue;
    const high = a.prep.highCeilings && HIGH_CEILING_KINDS.has(s.kind) ? rates.highCeilingLaborMultiplier : 1;
    const surface = surfaceLines(s, rates, high);
    lineItems.push(...surface.lines);
    gallons += surface.gallons;
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

  return total(lineItems, gallons);
}

/** Surfaces that climb with the wall. Doors, garage doors, and decks are worked from the ground. */
const STORY_KINDS: ReadonlySet<ExteriorSurfaceKind> = new Set(["siding", "trim", "shutters", "fascia_soffit"]);

/** Pure. Prices one side of the house; the exterior summary decides which sides count. */
export function priceExteriorSide(a: ExteriorAnalysis, rates: ExteriorRates = DEFAULT_RATES.exterior): Price {
  const prep = (Object.keys(a.prep) as ExteriorPrepFlag[])
    .filter((flag) => a.prep[flag])
    .reduce((m, flag) => m * rates.prepLaborMultiplier[flag], 1);
  const lineItems: LineItem[] = [];
  let gallons = 0;

  for (const s of a.surfaces) {
    if (s.estimatedSqFt <= 0) continue;
    const material = s.kind === "siding" ? rates.sidingMaterialLaborMultiplier[a.sidingMaterial] : 1;
    const height = STORY_KINDS.has(s.kind) ? rates.storyLaborMultiplier[a.stories] : 1;
    const surface = surfaceLines(s, rates, material * height * prep);
    lineItems.push(...surface.lines);
    gallons += surface.gallons;
  }

  return total(lineItems, gallons);
}

export function pricePhoto(a: PhotoAnalysis, rates: Rates = DEFAULT_RATES): Price {
  switch (a.kind) {
    case "interior":
      return priceRoom(a, rates.interior);
    case "exterior":
      return priceExteriorSide(a, rates.exterior);
  }
}

function flat(label: string, cents: Cents): LineItem {
  return { label, quantity: 1, unit: "flat", unitCents: cents, totalCents: cents };
}

export function formatCents(c: Cents): string {
  return (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
