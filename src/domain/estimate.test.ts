import { describe, expect, it } from "vitest";
import { summarizeEstimate, type PhotoForEstimate } from "./estimate";
import { summarizeExterior, type ExteriorPhoto } from "./exterior";
import { priceExteriorSide, priceRoom } from "./pricing";
import type { ExteriorAnalysis, ExteriorSide } from "./photo-analysis";
import { FIXTURE_ANALYSES } from "../../fixtures/photo-analyses";

const fixture = (name: `exterior-${ExteriorSide}.jpg`): ExteriorAnalysis => FIXTURE_ANALYSES[name];
const ext = (id: string, side: ExteriorSide, confidence?: number): ExteriorPhoto => {
  const analysis = fixture(`exterior-${side}.jpg`);
  return { id, side, analysis: confidence === undefined ? analysis : { ...analysis, confidence } };
};
const sideCents = (side: ExteriorSide) => priceExteriorSide(fixture(`exterior-${side}.jpg`)).totalCents;

const bedroom = FIXTURE_ANALYSES["bedroom.jpg"];
const bedroomCents = priceRoom(bedroom).totalCents;

const allSides = [ext("f", "front"), ext("b", "back"), ext("l", "left"), ext("r", "right")];

describe("summarizeExterior", () => {
  it("prices a lone front but asks for a decision and keeps it out of the total", () => {
    const s = summarizeExterior("undecided", [ext("f", "front")]);
    expect(s.status).toBe("needs_decision");
    expect(s.sides).toEqual([{ side: "front", photoId: "f", price: priceExteriorSide(fixture("exterior-front.jpg")) }]);
    expect(s.subtotalCents).toBe(sideCents("front"));
    expect(s.missingSides).toEqual([]);
    expect(s.countsInTotal).toBe(false);
  });

  it("counts a single side once the user chooses it", () => {
    const s = summarizeExterior("single_side", [ext("f", "front")]);
    expect(s.status).toBe("single_side_priced");
    expect(s.countsInTotal).toBe(true);
    expect(s.subtotalCents).toBe(sideCents("front"));
  });

  it("is incomplete with two of four sides, lists the missing ones, and stays out of the total", () => {
    const s = summarizeExterior("whole_exterior", [ext("f", "front"), ext("l", "left")]);
    expect(s.status).toBe("incomplete");
    expect(s.coveredSides).toEqual(["front", "left"]);
    expect(s.missingSides).toEqual(["back", "right"]);
    expect(s.countsInTotal).toBe(false);
  });

  it("is complete and counted with all four sides", () => {
    const s = summarizeExterior("whole_exterior", allSides);
    expect(s.status).toBe("complete");
    expect(s.missingSides).toEqual([]);
    expect(s.countsInTotal).toBe(true);
    expect(s.subtotalCents).toBe(sideCents("front") + sideCents("back") + sideCents("left") + sideCents("right"));
  });

  it("asks for every side when the whole exterior is chosen before any upload", () => {
    const s = summarizeExterior("whole_exterior", []);
    expect(s.status).toBe("incomplete");
    expect(s.missingSides).toEqual(["front", "back", "left", "right"]);
  });

  it("has nothing to say about a home with no exterior photos", () => {
    expect(summarizeExterior("undecided", []).status).toBe("none");
    expect(summarizeExterior("single_side", []).status).toBe("none");
  });

  it("prices a duplicated side once, choosing the higher confidence photo whatever the order", () => {
    for (const photos of [
      [ext("low", "front", 0.3), ext("high", "front", 0.9)],
      [ext("high", "front", 0.9), ext("low", "front", 0.3)],
    ]) {
      const s = summarizeExterior("single_side", photos);
      expect(s.sides.map((x) => x.photoId)).toEqual(["high"]);
      expect(s.subtotalCents).toBe(sideCents("front"));
      expect(s.duplicates).toEqual([{ photoId: "low", side: "front", pricedPhotoId: "high" }]);
    }
  });

  it("breaks a confidence tie by id so the pick is stable", () => {
    const s = summarizeExterior("single_side", [ext("b", "front", 0.5), ext("a", "front", 0.5)]);
    expect(s.sides[0].photoId).toBe("a");
  });
});

const analyzedExt = (p: ExteriorPhoto): PhotoForEstimate => ({ ...p, status: "analyzed" });

describe("summarizeEstimate", () => {
  it("totals rooms and counts pending and failed photos without pricing them", () => {
    const s = summarizeEstimate(
      [
        { id: "a", status: "analyzed", analysis: bedroom },
        { id: "b", status: "analyzed", analysis: bedroom },
        { id: "c", status: "queued", analysis: null },
        { id: "d", status: "analyzing", analysis: null },
        { id: "e", status: "failed", analysis: null },
      ],
      "undecided",
    );
    expect(s.rooms.map((r) => r.id)).toEqual(["a", "b"]);
    expect(s.totalCents).toBe(2 * bedroomCents);
    expect(s.pendingCount).toBe(2);
    expect(s.failedCount).toBe(1);
    expect(s.complete).toBe(false);
  });

  it("adds a chosen single side to the interior total", () => {
    const s = summarizeEstimate([{ id: "a", status: "analyzed", analysis: bedroom }, analyzedExt(ext("f", "front"))], "single_side");
    expect(s.interiorCents).toBe(bedroomCents);
    expect(s.totalCents).toBe(bedroomCents + sideCents("front"));
    expect(s.complete).toBe(true);
  });

  it("leaves an undecided or incomplete exterior out of the total and marks the estimate incomplete", () => {
    for (const scope of ["undecided", "whole_exterior"] as const) {
      const s = summarizeEstimate([{ id: "a", status: "analyzed", analysis: bedroom }, analyzedExt(ext("f", "front"))], scope);
      expect(s.totalCents).toBe(bedroomCents);
      expect(s.complete).toBe(false);
    }
  });

  it("is complete with a whole exterior and no interior", () => {
    const s = summarizeEstimate(allSides.map(analyzedExt), "whole_exterior");
    expect(s.complete).toBe(true);
    expect(s.totalCents).toBe(s.exterior.subtotalCents);
  });

  it("is never complete when empty", () => {
    expect(summarizeEstimate([], "undecided").complete).toBe(false);
  });
});
