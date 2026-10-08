import { describe, expect, it } from "vitest";
import { priceExteriorSide, priceRoom } from "./pricing";
import type { ExteriorAnalysis, InteriorAnalysis } from "./photo-analysis";

const base: InteriorAnalysis = {
  kind: "interior",
  roomType: "bedroom",
  surfaces: [
    { kind: "walls", condition: "good", estimatedSqFt: 400 },
    { kind: "ceiling", condition: "good", estimatedSqFt: 140 },
    { kind: "doors", condition: "poor", estimatedSqFt: 20 },
  ],
  estimatedFloorSqFt: 140,
  ceilingHeightFt: 11,
  currentColors: ["white"],
  prep: { patching: true, waterDamage: false, wallpaperRemoval: false, highCeilings: true },
  confidence: 0.8,
  notes: "",
};

describe("priceRoom", () => {
  it("produces exact line items from the rates table", () => {
    const price = priceRoom(base);
    expect(price.lineItems.map((li) => [li.label, li.quantity, li.unitCents, li.totalCents])).toEqual([
      ["walls paint (2 coats)", 3, 4500, 13500],
      ["walls labor (good)", 400, 180, 72000],
      ["ceiling paint (2 coats)", 1, 4000, 4000],
      ["ceiling labor (good)", 140, 210, 29400],
      ["doors paint (2 coats)", 1, 5500, 5500],
      ["doors labor (poor)", 20, 304, 6080],
      ["Patching and sanding", 1, 15000, 15000],
    ]);
    expect(price.gallons).toBe(5);
    expect(price.totalCents).toBe(145480);
  });

  it("applies the high-ceiling multiplier only to walls and ceilings", () => {
    const low = priceRoom({ ...base, prep: { ...base.prep, highCeilings: false } });
    const unit = (p: typeof low, label: string) => p.lineItems.find((li) => li.label === label)!.unitCents;
    expect(unit(low, "walls labor (good)")).toBe(150);
    expect(unit(low, "doors labor (poor)")).toBe(304);
  });

  it("adds water damage and wallpaper removal sized by wall area", () => {
    const price = priceRoom({
      ...base,
      prep: { patching: false, waterDamage: true, wallpaperRemoval: true, highCeilings: false },
    });
    expect(price.lineItems.find((li) => li.label.startsWith("Water damage"))?.totalCents).toBe(25000);
    expect(price.lineItems.find((li) => li.label === "Wallpaper removal")).toMatchObject({ quantity: 400, totalCents: 50000 });
  });

  it("prices a room with no paintable surfaces at zero", () => {
    const price = priceRoom({ ...base, surfaces: [], prep: { patching: false, waterDamage: false, wallpaperRemoval: false, highCeilings: false } });
    expect(price).toEqual({ lineItems: [], gallons: 0, totalCents: 0 });
  });
});

const side: ExteriorAnalysis = {
  kind: "exterior",
  sideGuess: "front",
  sidingMaterial: "wood",
  stories: 2,
  surfaces: [
    { kind: "siding", condition: "fair", estimatedSqFt: 500 },
    { kind: "trim", condition: "good", estimatedSqFt: 100 },
    { kind: "doors", condition: "good", estimatedSqFt: 40 },
  ],
  currentColors: ["red"],
  prep: { peeling: false, mildew: false, woodRot: false, failedCaulk: false },
  confidence: 0.7,
  notes: "",
};

const unit = (a: ExteriorAnalysis, label: string) =>
  priceExteriorSide(a).lineItems.find((li) => li.label === label)!.unitCents;

describe("priceExteriorSide", () => {
  it("produces exact line items from the exterior rates table", () => {
    const price = priceExteriorSide(side);
    expect(price.lineItems.map((li) => [li.label, li.quantity, li.unitCents, li.totalCents])).toEqual([
      ["siding paint (2 coats)", 4, 6000, 24000],
      ["siding labor (fair)", 500, 345, 172500],
      ["trim paint (2 coats)", 1, 6500, 6500],
      ["trim labor (good)", 100, 438, 43800],
      ["doors paint (2 coats)", 1, 6500, 6500],
      ["doors labor (good)", 40, 300, 12000],
    ]);
    expect(price.gallons).toBe(6);
    expect(price.totalCents).toBe(265300);
  });

  it("scales labor on wall-height surfaces by stories and leaves ground-level doors alone", () => {
    expect([1, 2, 3].map((stories) => unit({ ...side, stories: stories as 1 | 2 | 3 }, "siding labor (fair)"))).toEqual([276, 345, 442]);
    expect([1, 2, 3].map((stories) => unit({ ...side, stories: stories as 1 | 2 | 3 }, "doors labor (good)"))).toEqual([300, 300, 300]);
  });

  it("applies the siding material multiplier to siding only", () => {
    const vinyl = { ...side, sidingMaterial: "vinyl" as const };
    expect(unit(vinyl, "siding labor (fair)")).toBe(259);
    expect(unit(vinyl, "trim labor (good)")).toBe(438);
  });

  it("compounds every set prep flag into all labor", () => {
    const rough = { ...side, prep: { peeling: true, mildew: true, woodRot: false, failedCaulk: false } };
    expect(unit(rough, "doors labor (good)")).toBe(429);
    expect(priceExteriorSide(rough).lineItems.find((li) => li.label === "doors paint (2 coats)")!.totalCents).toBe(6500);
  });
});
