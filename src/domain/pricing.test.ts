import { describe, expect, it } from "vitest";
import { priceRoom, summarizeEstimate, type PhotoForEstimate } from "./pricing";
import type { RoomAnalysis } from "./room-analysis";

const base: RoomAnalysis = {
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

describe("summarizeEstimate", () => {
  it("totals analyzed rooms and counts pending and failed rooms without pricing them", () => {
    const photos: PhotoForEstimate[] = [
      { id: "a", status: "analyzed", analysis: base },
      { id: "b", status: "analyzed", analysis: base },
      { id: "c", status: "queued", analysis: null },
      { id: "d", status: "analyzing", analysis: null },
      { id: "e", status: "failed", analysis: null },
    ];
    const summary = summarizeEstimate(photos);
    expect(summary.rooms.map((r) => r.id)).toEqual(["a", "b"]);
    expect(summary.totalCents).toBe(2 * 145480);
    expect(summary.gallons).toBe(10);
    expect(summary.pendingCount).toBe(2);
    expect(summary.failedCount).toBe(1);
    expect(summary.complete).toBe(false);
  });

  it("is complete only when every photo is analyzed", () => {
    expect(summarizeEstimate([{ id: "a", status: "analyzed", analysis: base }]).complete).toBe(true);
    expect(summarizeEstimate([]).complete).toBe(false);
  });
});
