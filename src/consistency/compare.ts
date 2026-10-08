import type { PhotoAnalysis } from "@/domain/photo-analysis";
import type { Cents, Price } from "@/domain/pricing";

/** One photo's outcome in one run. `provider` is the OpenRouter backend that answered, when it says. */
export type PhotoRun = {
  fileName: string;
  model: string;
  provider: string | null;
  analysis: PhotoAnalysis;
  price: Price;
};

/** One estimate built from the whole photo set. */
export type EstimateRun = { estimateId: string; totalCents: Cents; photos: PhotoRun[] };

/** A field whose value is not the same in every run. `values[i]` is run i's value, `undefined` when absent. */
export type FieldDiff = { path: string; values: unknown[] };

export type PhotoComparison = {
  fileName: string;
  totalsCents: Cents[];
  routes: string[];
  analysisDiffs: FieldDiff[];
  lineItemDiffs: FieldDiff[];
};

export type Comparison = {
  totalsCents: Cents[];
  spreadCents: Cents;
  toleranceCents: Cents;
  withinTolerance: boolean;
  photos: PhotoComparison[];
};

type Flat = Map<string, unknown>;

/**
 * Flattens to `path -> leaf`. An array of `{ kind }` objects (surfaces) is keyed
 * by kind, so two runs that list the same surfaces in a different order compare
 * equal and a missing surface shows up as one absent path, not a shifted index.
 */
export function flatten(value: unknown, prefix = "", out: Flat = new Map()): Flat {
  if (Array.isArray(value)) {
    const keyed = value.every((v) => typeof v === "object" && v !== null && typeof v.kind === "string");
    if (value.length === 0) out.set(prefix, "[]");
    const seen = new Map<string, number>();
    value.forEach((v, i) => {
      let key = String(i);
      if (keyed) {
        const n = seen.get(v.kind) ?? 0;
        seen.set(v.kind, n + 1);
        key = n === 0 ? v.kind : `${v.kind}#${n + 1}`;
      }
      flatten(v, `${prefix}[${key}]`, out);
    });
  } else if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix, value);
  }
  return out;
}

export function diffFlat(runs: readonly Flat[]): FieldDiff[] {
  const paths = [...new Set(runs.flatMap((r) => [...r.keys()]))].sort();
  return paths
    .map((path) => ({ path, values: runs.map((r) => r.get(path)) }))
    .filter(({ values }) => new Set(values.map((v) => JSON.stringify(v) ?? "absent")).size > 1);
}

const lineItemsFlat = (price: Price): Flat =>
  new Map(price.lineItems.flatMap((li) => [[`${li.label}.quantity`, li.quantity], [`${li.label}.unitCents`, li.unitCents]]));

/** Compares runs of the same photo set. Photos are matched by file name, never by upload order. */
export function compareRuns(runs: readonly EstimateRun[], toleranceCents: Cents = 0): Comparison {
  const totalsCents = runs.map((r) => r.totalCents);
  const spreadCents = Math.max(...totalsCents) - Math.min(...totalsCents);
  const fileNames = [...new Set(runs.flatMap((r) => r.photos.map((p) => p.fileName)))].sort();

  const photos = fileNames.map((fileName) => {
    const perRun = runs.map((r) => r.photos.find((p) => p.fileName === fileName));
    const missing = perRun.findIndex((p) => !p);
    if (missing >= 0) throw new Error(`${fileName} has no result in run ${missing + 1}`);
    const present = perRun as PhotoRun[];
    return {
      fileName,
      totalsCents: present.map((p) => p.price.totalCents),
      routes: present.map((p) => `${p.model}${p.provider ? ` via ${p.provider}` : ""}`),
      analysisDiffs: diffFlat(present.map((p) => flatten(p.analysis))),
      lineItemDiffs: diffFlat(present.map((p) => lineItemsFlat(p.price))),
    };
  });

  return { totalsCents, spreadCents, toleranceCents, withinTolerance: spreadCents <= toleranceCents, photos };
}
