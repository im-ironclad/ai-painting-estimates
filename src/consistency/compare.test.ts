import { describe, expect, it } from "vitest";
import type { InteriorAnalysis } from "@/domain/photo-analysis";
import { pricePhoto } from "@/domain/pricing";
import { FIXTURE_ANALYSES } from "../../fixtures/photo-analyses";
import { compareRuns, type EstimateRun } from "./compare";

const bedroom: InteriorAnalysis = FIXTURE_ANALYSES["bedroom.jpg"];
const kitchen: InteriorAnalysis = FIXTURE_ANALYSES["kitchen.jpg"];

function run(...analyses: [string, InteriorAnalysis][]): EstimateRun {
  const photos = analyses.map(([fileName, analysis]) => ({
    fileName,
    model: "google/gemini-3.1-flash-lite",
    provider: "Google",
    analysis,
    price: pricePhoto(analysis),
  }));
  return { estimateId: "e", totalCents: photos.reduce((n, p) => n + p.price.totalCents, 0), photos };
}

const withWallSqFt = (a: InteriorAnalysis, sqFt: number): InteriorAnalysis => ({
  ...a,
  surfaces: a.surfaces.map((s) => (s.kind === "walls" ? { ...s, estimatedSqFt: sqFt } : s)),
});

describe("compareRuns", () => {
  it("reports identical runs as consistent", () => {
    const c = compareRuns([run(["bedroom.jpg", bedroom]), run(["bedroom.jpg", bedroom])]);
    expect(c.spreadCents).toBe(0);
    expect(c.withinTolerance).toBe(true);
    expect(c.photos[0].analysisDiffs).toEqual([]);
    expect(c.photos[0].lineItemDiffs).toEqual([]);
  });

  it("detects a one-field difference and names the field, its values, and the priced lines it moved", () => {
    const changed = withWallSqFt(bedroom, 600);
    const c = compareRuns([run(["bedroom.jpg", bedroom], ["kitchen.jpg", kitchen]), run(["bedroom.jpg", changed], ["kitchen.jpg", kitchen])]);

    expect(c.photos.find((p) => p.fileName === "kitchen.jpg")!.analysisDiffs).toEqual([]);
    const diffs = c.photos.find((p) => p.fileName === "bedroom.jpg")!;
    expect(diffs.analysisDiffs).toEqual([{ path: "surfaces[walls].estimatedSqFt", values: [400, 600] }]);
    expect(diffs.lineItemDiffs).toEqual([
      { path: "walls labor (good).quantity", values: [400, 600] },
      { path: "walls paint (2 coats).quantity", values: [3, 4] },
    ]);
    expect(c.spreadCents).toBe(200 * 150 + 4500);
    expect(c.withinTolerance).toBe(false);
  });

  it("passes a difference inside the tolerance and fails one outside it", () => {
    const runs = [run(["bedroom.jpg", bedroom]), run(["bedroom.jpg", withWallSqFt(bedroom, 401)])];
    expect(compareRuns(runs, 150).withinTolerance).toBe(true);
    expect(compareRuns(runs, 149).withinTolerance).toBe(false);
  });

  it("ignores the order the model lists surfaces in", () => {
    const reordered = { ...bedroom, surfaces: [...bedroom.surfaces].reverse() };
    const c = compareRuns([run(["bedroom.jpg", bedroom]), run(["bedroom.jpg", reordered])]);
    expect(c.photos[0].analysisDiffs).toEqual([]);
  });

  it("reports a surface present in one run and absent in another", () => {
    const noTrim = { ...bedroom, surfaces: bedroom.surfaces.filter((s) => s.kind !== "trim") };
    const c = compareRuns([run(["bedroom.jpg", bedroom]), run(["bedroom.jpg", noTrim])]);
    expect(c.photos[0].analysisDiffs.map((d) => d.path)).toEqual([
      "surfaces[trim].condition",
      "surfaces[trim].estimatedSqFt",
      "surfaces[trim].kind",
    ]);
    expect(c.photos[0].analysisDiffs[1].values).toEqual([40, undefined]);
  });
});
